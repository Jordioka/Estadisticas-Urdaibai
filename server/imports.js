// Importación desde CSV/Excel (las filas llegan ya leídas por el navegador).
// Siempre: 1) validar y mostrar informe (dry_run), 2) guardar solo cuando el usuario confirma.
import {
  COUNTERS, validateEvent, isIsoDate, ZONES, counterWarnings, totalCounters,
} from '../public/js/stats.js';
import { eventsFor, adjustmentsFor } from './reports.js';
import { HttpError, nowIso, uuid, normName, cleanStr, accessibleTeams, audit, ensureSeason, requireAdmin } from './core.js';
import { playerFields } from './ops.js';

const MAX_ROWS = 3000;

const key = (k) => normName(k).replace(/[^a-z0-9]/g, '');

// Lee una fila con cabeceras flexibles (castellano, euskera o inglés)
function reader(row) {
  const m = new Map();
  for (const [k, v] of Object.entries(row)) m.set(key(k), v);
  return (...aliases) => {
    for (const a of aliases) if (m.has(a) && m.get(a) !== '' && m.get(a) != null) return m.get(a);
    return null;
  };
}

const ALIAS = {
  team: ['equipo', 'team', 'taldea', 'talde'],
  name: ['nombre', 'name', 'izena'],
  surname: ['apellidos', 'apellido', 'surname', 'abizenak'],
  number: ['dorsal', 'numero', 'number', 'zenbakia'],
  position: ['posicion', 'position', 'posizioa'],
  goalkeeper: ['portero', 'goalkeeper', 'atezaina', 'porteroa'],
  date: ['fecha', 'date', 'data'],
  rival: ['rival', 'contrario', 'aurkaria'],
  part: ['parte', 'part', 'zatia'],
  minute: ['minuto', 'minute', 'minutua'],
  event: ['evento', 'event', 'ekintza'],
  player: ['jugador', 'player', 'jokalaria'],
  zone: ['zona', 'zone', 'eremua'],
  point: ['punto', 'puntoporteria', 'porteria', 'point', 'puntua'],
  result: ['resultado', 'result', 'emaitza'],
  shot_type: ['tipolanzamiento', 'tipo', 'shottype'],
  trajectory: ['trayectoria', 'trajectory'],
  pressure: ['presion', 'pressure'],
  phase: ['fase', 'phase'],
  subtype: ['detalle', 'detail', 'subtipo', 'xehetasuna'],
  venue: ['condicion', 'casafuera', 'local', 'venue', 'campo'],
  possessions: ['posesiones', 'possessions', 'posesioak'],
  losses: ['perdidas', 'losses', 'galerak'],
  shots: ['lanzamientos', 'shots', 'jaurtiketak'],
  goals: ['goles', 'goals', 'golak'],
  goals_against: ['golesencontra', 'golescontra', 'goalsagainst', 'kontrakogolak'],
  shots_against: ['lanzamientoscontrarios', 'shotsagainst', 'kontrakojaurtiketak'],
  saves: ['paradas', 'saves', 'geldiketak'],
};

const parseBool = (v) => {
  const s = normName(v);
  if (['si', 's', '1', 'x', 'true', 'yes', 'y', 'bai'].includes(s)) return true;
  if (['', 'no', 'n', '0', 'false', 'ez'].includes(s)) return false;
  return undefined;
};

export function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y, mo, d;
  if (m) [y, mo, d] = [m[1], m[2], m[3]];
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    [d, mo, y] = [m[1], m[2], m[3]];
    if (y.length === 2) y = '20' + y;
  } else return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

const parseCount = (v) => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

// Resuelve el equipo de la fila respetando los permisos
async function makeTeamResolver(ctx, { createTeams }) {
  const accessible = await accessibleTeams(ctx);
  const allOwn = await ctx.db.all('SELECT id, name FROM teams WHERE is_own = 1 AND deleted_at IS NULL');
  const accMap = new Map(accessible.map((t) => [normName(t.name), t]));
  const allMap = new Map(allOwn.map((t) => [normName(t.name), t]));
  const toCreate = new Map(); // nombre normalizado → {id,name}
  const unknown = new Set();
  return {
    accessible, toCreate, unknown,
    resolve(raw) {
      const name = cleanStr(raw, 80);
      if (!name) {
        if (accessible.length === 1) return { team: accessible[0] };
        return { error: 'team_required' };
      }
      const k = normName(name);
      if (accMap.has(k)) return { team: accMap.get(k) };
      if (allMap.has(k)) return { error: 'team_forbidden', name };
      if (createTeams && ctx.user.role === 'admin') {
        if (!toCreate.has(k)) toCreate.set(k, { id: uuid(), name, isNew: true });
        return { team: toCreate.get(k) };
      }
      unknown.add(name);
      return { error: 'team_unknown', name };
    },
  };
}

const rowNo = (i) => i + 2; // fila del archivo (la 1 es la cabecera)

function prepRows(body) {
  if (!Array.isArray(body.rows)) throw new HttpError(400, 'invalid_rows');
  if (body.rows.length > MAX_ROWS) throw new HttpError(400, 'too_many_rows');
  return body.rows;
}

// ================= JUGADORES =================
export async function importPlayers(ctx, body) {
  const rows = prepRows(body);
  const dry = body.dry_run !== false;
  const onDup = ['update', 'skip'].includes(body.on_duplicate) ? body.on_duplicate : 'ask';
  const teams = await makeTeamResolver(ctx, { createTeams: !!body.create_teams });
  const existing = teams.accessible.length
    ? await ctx.db.all(
        `SELECT * FROM players WHERE deleted_at IS NULL AND team_id IN (${teams.accessible.map(() => '?').join(',')})`,
        ...teams.accessible.map((t) => t.id))
    : [];
  const state = new Map(); // team_id → { names: Map(key→player), numbers: Map(number→key) }
  const stateFor = (teamId) => {
    if (!state.has(teamId)) {
      const names = new Map(), numbers = new Map();
      for (const p of existing.filter((e) => e.team_id === teamId)) {
        const k = normName(`${p.name} ${p.surname}`);
        names.set(k, p);
        if (p.number != null) numbers.set(p.number, k);
      }
      state.set(teamId, { names, numbers, seen: new Set() });
    }
    return state.get(teamId);
  };

  const report = { kind: 'players', total: 0, create: [], update: [], unchanged: [], errors: [], unknown_teams: [], committed: false };
  const plan = [];
  rows.forEach((row, i) => {
    const get = reader(row);
    const A = (n) => get(...ALIAS[n]);
    if (![...Object.values(row)].some((v) => v !== '' && v != null)) return; // fila vacía
    report.total++;
    const err = (code, extra = {}) => report.errors.push({ row: rowNo(i), error: code, ...extra });
    const t = teams.resolve(A('team'));
    if (t.error) return err(t.error, { name: t.name });
    let f;
    try {
      const gk = parseBool(A('goalkeeper'));
      if (gk === undefined) return err('invalid_goalkeeper');
      f = playerFields({ name: A('name'), surname: A('surname'), number: A('number'), position: A('position'), is_goalkeeper: gk });
    } catch (e) {
      return err(e.code || 'invalid_row');
    }
    const st = stateFor(t.team.id);
    const k = normName(`${f.name} ${f.surname}`);
    if (st.seen.has(k)) return err('duplicate_in_file', { name: `${f.name} ${f.surname}`.trim() });
    st.seen.add(k);
    const cur = st.names.get(k);
    if (f.number != null) {
      const owner = st.numbers.get(f.number);
      if (owner && owner !== k) return err('number_in_use', { number: f.number });
    }
    const item = { row: rowNo(i), team: t.team.name, name: f.name, surname: f.surname, number: f.number };
    if (cur) {
      const same = cur.number === f.number && cur.position === f.position && !!cur.is_goalkeeper === !!f.is_goalkeeper;
      if (same) return report.unchanged.push(item);
      report.update.push(item);
      plan.push({ type: 'update', team: t.team, f, cur });
    } else {
      report.create.push(item);
      plan.push({ type: 'create', team: t.team, f });
    }
    if (f.number != null) st.numbers.set(f.number, k);
    st.names.set(k, cur || { id: null, number: f.number });
  });
  report.unknown_teams = [...teams.unknown];
  report.new_teams = [...teams.toCreate.values()].map((t) => t.name);
  report.duplicates = report.update.length;

  if (dry) return report;
  if (report.errors.length && !body.ignore_errors) return { ...report, blocked: 'errors' };
  if (report.update.length && onDup === 'ask') return { ...report, blocked: 'duplicates' };

  const stmts = [];
  for (const t of teams.toCreate.values()) stmts.push(ctx.db.stmt('INSERT INTO teams (id, name, is_own, created_at) VALUES (?,?,1,?)', t.id, t.name, nowIso()));
  for (const p of plan) {
    if (p.type === 'create')
      stmts.push(ctx.db.stmt(
        'INSERT INTO players (id, team_id, name, surname, number, position, is_goalkeeper, created_at) VALUES (?,?,?,?,?,?,?,?)',
        uuid(), p.team.id, p.f.name, p.f.surname, p.f.number, p.f.position, p.f.is_goalkeeper, nowIso()));
    else if (onDup === 'update')
      stmts.push(ctx.db.stmt('UPDATE players SET number=?, position=?, is_goalkeeper=? WHERE id=?', p.f.number, p.f.position, p.f.is_goalkeeper, p.cur.id));
  }
  if (stmts.length) await ctx.db.batch(stmts);
  if (onDup === 'skip') report.update = [];
  report.committed = true;
  await audit(ctx, 'import.players', 'players', null, { created: report.create.length, updated: onDup === 'update' ? plan.filter((p) => p.type === 'update').length : 0 });
  return report;
}

// ================= ESTADÍSTICAS DE PARTIDOS =================
const EVENT_MAP = {
  posesion: 'possession', perdida: 'loss', gol: 'goal',
  lanzamientofallado: 'shot_miss', golencontra: 'goal_against', parada: 'save',
  lanzamientocontrariofallado: 'shot_against_miss',
  recuperacion: 'recovery', amonestacion: 'sanction', contrapase: 'counter_pass',
};
const SUBTYPE_MAP = { // sinónimos admitidos en la columna "Detalle"
  pase: 'pase', pases: 'pase', pisando: 'pisando', faltaataque: 'falta_ataque', fataque: 'falta_ataque', pasos: 'pasos',
  robo: 'robo', robos: 'robo', chapa: 'chapa', chapas: 'chapa',
  '2': 'dos_min', '2min': 'dos_min', dosmin: 'dos_min', dosminutos: 'dos_min',
  ok: 'ok', bien: 'ok', fallo: 'fallo', mal: 'fallo',
};
const RESULT_MAP = { parada: 'save', fuera: 'out', poste: 'post', bloqueo: 'block' };

function findPlayer(players, raw) {
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) {
    const p = players.filter((x) => x.number === Number(s));
    return p.length === 1 ? { player: p[0] } : { error: p.length ? 'player_ambiguous' : 'player_not_found' };
  }
  const k = normName(s);
  const p = players.filter((x) => normName(`${x.name} ${x.surname}`) === k || normName(x.name) === k);
  return p.length === 1 ? { player: p[0] } : { error: p.length ? 'player_ambiguous' : 'player_not_found' };
}

export async function importMatches(ctx, body) {
  const kind = body.kind === 'advanced' ? 'advanced' : 'simple';
  const rows = prepRows(body);
  const dry = body.dry_run !== false;
  const onDup = ['replace', 'add', 'skip'].includes(body.on_duplicate) ? body.on_duplicate : 'ask';
  const teams = await makeTeamResolver(ctx, { createTeams: !!body.create_teams });
  const rivals = await ctx.db.all('SELECT id, name FROM teams WHERE is_own = 0 AND deleted_at IS NULL');
  const rivalMap = new Map(rivals.map((r) => [normName(r.name), r]));
  const newRivals = new Map();
  const playersByTeam = new Map();
  const teamPlayers = async (teamId) => {
    if (!playersByTeam.has(teamId))
      playersByTeam.set(teamId, await ctx.db.all('SELECT id, name, surname, number, is_goalkeeper FROM players WHERE team_id = ? AND deleted_at IS NULL', teamId));
    return playersByTeam.get(teamId);
  };

  const report = { kind, total: 0, matches: [], errors: [], warnings: [], duplicates: 0, new_rivals: [], unknown_teams: [], committed: false };
  const groups = new Map(); // equipo|fecha|rival → partido
  const matchesList = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = reader(row);
    const A = (n) => get(...ALIAS[n]);
    const empty = ![...Object.values(row)].some((v) => v !== '' && v != null);
    if (empty) continue;
    const err = (code, extra = {}) => report.errors.push({ row: rowNo(i), error: code, ...extra });
    const hasData = (kind === 'simple' ? ['possessions', 'losses', 'shots', 'goals', 'goals_against', 'shots_against', 'saves'] : ['event']).some((n) => A(n) != null);
    if (!A('date') && !A('rival') && !hasData) continue; // fila de plantilla sin rellenar
    report.total++;
    const t = teams.resolve(A('team'));
    if (t.error) { err(t.error, { name: t.name }); continue; }
    const date = parseDate(A('date'));
    if (!date) { err('invalid_date'); continue; }
    const rivalName = cleanStr(A('rival'), 80);
    if (!rivalName) { err('rival_required'); continue; }
    const rk = normName(rivalName);
    let rival = rivalMap.get(rk) || newRivals.get(rk);
    if (!rival) { rival = { id: uuid(), name: rivalName, isNew: true }; newRivals.set(rk, rival); }
    const gkey = `${t.team.id}|${date}|${rival.id}`;
    let g = groups.get(gkey);
    if (!g) {
      const vv = key(A('venue') ?? '');
      g = { team: t.team, date, rival, home_away: ['fuera', 'visitante', 'away', 'kanpoan', 'x'].includes(vv) ? 'away' : 'home', counters: Object.fromEntries(COUNTERS.map((c) => [c, 0])), events: [], rows: [] };
      groups.set(gkey, g);
      matchesList.push(g);
    }
    g.rows.push(rowNo(i));

    if (kind === 'simple') {
      if (g.rows.length > 1) { err('duplicate_match_in_file'); continue; }
      let bad = false;
      for (const c of COUNTERS) {
        const n = parseCount(A(c));
        if (Number.isNaN(n)) { err('invalid_number', { field: c }); bad = true; break; }
        g.counters[c] = n;
      }
      if (bad) g.invalid = true;
    } else {
      const evKey = key(A('event') ?? '');
      const type = EVENT_MAP[evKey];
      if (!type) { err('invalid_event_type'); g.invalid = true; continue; }
      const e = { type, part: null, minute: null, player_id: null, goalkeeper_id: null, zone: null, goal_cell: null, result: null,
        shot_type: null, trajectory: null, pressure: null, phase: null, subtype: null };
      const players = await teamPlayers(t.team.id);
      const part = A('part'); if (part != null) e.part = Number(part);
      const minute = A('minute'); if (minute != null) e.minute = Number(minute);
      const zone = A('zone'); if (zone != null) e.zone = String(zone).trim().toUpperCase();
      const point = A('point'); if (point != null) e.goal_cell = Number(point);
      const result = A('result');
      if (result != null) {
        e.result = RESULT_MAP[key(result)];
        if (!e.result && key(result) !== 'gol') { err('invalid_result'); g.invalid = true; continue; }
      }
      for (const [f, n] of [['shot_type', 'shot_type'], ['trajectory', 'trajectory'], ['pressure', 'pressure'], ['phase', 'phase']]) {
        const v = A(n); if (v != null) e[f] = normName(v).replace(/ /g, '_');
      }
      const sub = A('subtype');
      if (sub != null) {
        e.subtype = SUBTYPE_MAP[key(sub)];
        if (!e.subtype) { err('invalid_event', { field: 'subtype' }); g.invalid = true; continue; }
      }
      const pl = A('player');
      if (pl != null) {
        const r = findPlayer(players, pl);
        if (r.error) { err(r.error, { name: String(pl) }); g.invalid = true; continue; }
        e.player_id = r.player.id;
      }
      const gk = A('goalkeeper');
      if (gk != null) {
        const r = findPlayer(players.filter((p) => p.is_goalkeeper), gk);
        if (r.error) { err(r.error, { name: String(gk) }); g.invalid = true; continue; }
        e.goalkeeper_id = r.player.id;
      }
      const v = validateEvent(e);
      if (v) { err('invalid_event', { field: v }); g.invalid = true; continue; }
      g.events.push(e);
    }
  }

  // Informe por partido + detección de duplicados (mismo equipo, rival y fecha)
  for (const g of matchesList) {
    const existing = rivalMap.has(normName(g.rival.name))
      ? await ctx.db.all('SELECT id FROM matches WHERE team_id = ? AND rival_id = ? AND date = ? AND deleted_at IS NULL', g.team.id, rivalMap.get(normName(g.rival.name)).id, g.date)
      : [];
    g.existing = existing.map((x) => x.id);
    // Marcador ya guardado (para compararlo con el nuevo) y partidos «parecidos»: mismo rival, fecha distinta pero cercana (±7 días)
    g.existing_score = null;
    if (g.existing.length) {
      const ev = await eventsFor(ctx.db, [g.existing[0]]), adj = await adjustmentsFor(ctx.db, [g.existing[0]]);
      const c = totalCounters(ev, adj);
      g.existing_score = { goals: c.goals, goals_against: c.goals_against, events: ev.length };
    }
    g.similar = [];
    if (rivalMap.has(normName(g.rival.name))) {
      const sim = await ctx.db.all(
        "SELECT id, date FROM matches WHERE team_id = ? AND rival_id = ? AND deleted_at IS NULL AND date <> ? AND date BETWEEN date(?, '-7 day') AND date(?, '+7 day')",
        g.team.id, rivalMap.get(normName(g.rival.name)).id, g.date, g.date, g.date);
      g.similar = sim.map((x) => x.date);
    }
    const season = await ctx.db.first('SELECT closed FROM seasons WHERE ? BETWEEN start_date AND end_date', g.date);
    if (season?.closed && ctx.user.role !== 'admin') { report.errors.push({ row: g.rows[0], error: 'season_closed' }); g.invalid = true; }
    if (kind === 'simple') for (const w of counterWarnings(g.counters)) report.warnings.push({ row: g.rows[0], warning: w });
    if (g.existing.length) report.duplicates++;
    report.matches.push({
      team: g.team.name, date: g.date, rival: g.rival.name, rows: g.rows, duplicate: g.existing.length > 0, invalid: !!g.invalid,
      existing_score: g.existing_score, similar: g.similar,
      ...(kind === 'simple' ? { counters: g.counters } : { events: g.events.length }),
    });
  }
  report.new_rivals = [...newRivals.values()].map((r) => r.name);
  report.unknown_teams = [...teams.unknown];
  report.new_teams = [...teams.toCreate.values()].map((t) => t.name);

  if (dry) return report;
  if (report.errors.length && !body.ignore_errors) return { ...report, blocked: 'errors' };
  if (report.duplicates && onDup === 'ask') return { ...report, blocked: 'duplicates' };

  let created = 0;
  const usedRivals = new Set();
  for (const t of teams.toCreate.values()) await ctx.db.run('INSERT INTO teams (id, name, is_own, created_at) VALUES (?,?,1,?)', t.id, t.name, nowIso());
  for (const g of matchesList) {
    if (g.invalid) continue;
    if (g.existing.length && onDup === 'skip') continue;
    const stmts = [];
    if (g.rival.isNew && !usedRivals.has(g.rival.id)) {
      usedRivals.add(g.rival.id);
      stmts.push(ctx.db.stmt('INSERT INTO teams (id, name, is_own, created_at) VALUES (?,?,0,?)', g.rival.id, g.rival.name, nowIso()));
    }
    if (g.existing.length && onDup === 'replace')
      for (const id of g.existing) stmts.push(ctx.db.stmt('UPDATE matches SET deleted_at = ? WHERE id = ?', nowIso(), id));
    const mid = uuid();
    const seasonId = await ensureSeason(ctx.db, g.date);
    const now = nowIso();
    stmts.push(ctx.db.stmt(
      "INSERT INTO matches (id, team_id, rival_id, date, home_away, season_id, is_practice, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,0,?,?,?)",
      mid, g.team.id, g.rival.id, g.date, g.home_away, seasonId, ctx.user.id, now, now));
    if (kind === 'simple') {
      for (const c of COUNTERS)
        if (g.counters[c] !== 0) stmts.push(ctx.db.stmt('INSERT INTO adjustments (match_id, stat, delta, updated_by, updated_at) VALUES (?,?,?,?,?)', mid, c, g.counters[c], ctx.user.id, now));
    } else {
      g.events.forEach((e, n) => {
        const ts = new Date(Date.parse(now) + n).toISOString(); // conserva el orden del archivo
        stmts.push(ctx.db.stmt(
          `INSERT INTO events (id, match_id, type, part, minute, player_id, goalkeeper_id, zone, goal_cell, result, shot_type, trajectory, pressure, phase, subtype, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          uuid(), mid, e.type, e.part, e.minute, e.player_id, e.goalkeeper_id, e.zone, e.goal_cell, e.result, e.shot_type, e.trajectory, e.pressure, e.phase, e.subtype, ctx.user.id, ts, ts));
      });
    }
    await ctx.db.batch(stmts);
    created++;
  }
  report.committed = true;
  report.created = created;
  await audit(ctx, `import.matches.${kind}`, 'matches', null, { created, mode: onDup });
  return report;
}
