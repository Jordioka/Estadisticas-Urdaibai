// Operaciones de anotación que llegan por /api/sync (idempotentes: el mismo id nunca se duplica).
import { validateEvent, isIsoDate, COUNTERS } from '../public/js/stats.js';
import { HttpError, nowIso, canTeam, ensureSeason, audit, requireMatchWrite, cleanStr, validId } from './core.js';

export const EVENT_FIELDS = ['part', 'minute', 'player_id', 'goalkeeper_id', 'zone', 'goal_cell', 'result', 'shot_type', 'trajectory', 'pressure', 'phase', 'subtype'];
const INT_FIELDS = ['part', 'minute', 'goal_cell'];

function normEventFields(src) {
  const out = {};
  for (const f of EVENT_FIELDS) {
    if (!(f in src)) continue;
    let v = src[f];
    if (v === '' || v === undefined) v = null;
    if (v != null && INT_FIELDS.includes(f)) v = Number(v);
    out[f] = v;
  }
  return out;
}

const fullEvent = (type, f) => ({ type, ...Object.fromEntries(EVENT_FIELDS.map((k) => [k, f[k] ?? null])) });

async function checkPeople(ctx, match, e) {
  for (const k of ['player_id', 'goalkeeper_id']) {
    if (!e[k]) continue;
    const p = await ctx.db.first('SELECT team_id FROM players WHERE id = ?', e[k]);
    if (!p || p.team_id !== match.team_id) throw new HttpError(400, 'invalid_event', { field: k });
  }
}

// Fecha de creación enviada por el dispositivo (para ordenar bien lo anotado sin conexión)
function clientTs(ts) {
  const t = Date.parse(ts);
  if (!isNaN(t) && t < Date.now() + 3600_000 && t > Date.now() - 7 * 86400_000) return new Date(t).toISOString();
  return nowIso();
}

const OPS = {
  async 'rival.create'(ctx, op) {
    if (!validId(op.id)) throw new HttpError(400, 'invalid_id');
    const name = cleanStr(op.name, 80);
    if (!name) throw new HttpError(400, 'name_required');
    const ex = await ctx.db.first('SELECT is_own FROM teams WHERE id = ?', op.id);
    if (ex) return;
    await ctx.db.run('INSERT INTO teams (id, name, is_own, created_at) VALUES (?,?,0,?)', op.id, name, nowIso());
  },

  async 'match.create'(ctx, op) {
    if (!validId(op.id)) throw new HttpError(400, 'invalid_id');
    if (!(await canTeam(ctx, op.team_id))) throw new HttpError(403, 'forbidden_team');
    if (!isIsoDate(op.date)) throw new HttpError(400, 'invalid_date');
    const rival = await ctx.db.first('SELECT id FROM teams WHERE id = ? AND is_own = 0 AND deleted_at IS NULL', op.rival_id);
    if (!rival) throw new HttpError(400, 'rival_not_found');
    const ex = await ctx.db.first('SELECT team_id FROM matches WHERE id = ?', op.id);
    if (ex) {
      if (ex.team_id !== op.team_id) throw new HttpError(409, 'id_conflict');
      return; // reintento: ya existe
    }
    const seasonId = await ensureSeason(ctx.db, op.date);
    if (ctx.user.role !== 'admin') {
      const s = await ctx.db.first('SELECT closed FROM seasons WHERE id = ?', seasonId);
      if (s?.closed) throw new HttpError(403, 'season_closed');
    }
    const now = nowIso();
    await ctx.db.run(
      'INSERT INTO matches (id, team_id, rival_id, date, home_away, season_id, is_practice, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      op.id, op.team_id, op.rival_id, op.date, op.home_away === 'away' ? 'away' : 'home', seasonId, op.is_practice ? 1 : 0, ctx.user.id, now, now
    );
    await audit(ctx, 'match.create', 'match', op.id, { team_id: op.team_id, date: op.date, practice: !!op.is_practice });
  },

  async 'match.update'(ctx, op) {
    const m = await requireMatchWrite(ctx, op.id);
    const f = op.fields || {};
    const next = { rival_id: m.rival_id, date: m.date, home_away: m.home_away };
    if (f.rival_id) {
      const r = await ctx.db.first('SELECT id FROM teams WHERE id = ? AND is_own = 0 AND deleted_at IS NULL', f.rival_id);
      if (!r) throw new HttpError(400, 'rival_not_found');
      next.rival_id = f.rival_id;
    }
    if (f.date) {
      if (!isIsoDate(f.date)) throw new HttpError(400, 'invalid_date');
      next.date = f.date;
    }
    if (f.home_away) next.home_away = f.home_away === 'away' ? 'away' : 'home';
    const seasonId = await ensureSeason(ctx.db, next.date);
    await ctx.db.run('UPDATE matches SET rival_id=?, date=?, home_away=?, season_id=?, updated_at=? WHERE id=?',
      next.rival_id, next.date, next.home_away, seasonId, nowIso(), m.id);
    await audit(ctx, 'match.update', 'match', m.id, f);
  },

  async 'match.delete'(ctx, op) {
    const m = await requireMatchWrite(ctx, op.id, { allowDeleted: true });
    if (m.deleted_at) return;
    await ctx.db.run('UPDATE matches SET deleted_at=?, updated_at=? WHERE id=?', nowIso(), nowIso(), m.id);
    await audit(ctx, 'match.delete', 'match', m.id, { date: m.date });
  },

  async 'event.create'(ctx, op) {
    if (!validId(op.id)) throw new HttpError(400, 'invalid_id');
    const m = await requireMatchWrite(ctx, op.match_id);
    const e = fullEvent(op.type, normEventFields(op));
    const err = validateEvent(e);
    if (err) throw new HttpError(400, 'invalid_event', { field: err });
    await checkPeople(ctx, m, e);
    const ex = await ctx.db.first('SELECT match_id FROM events WHERE id = ?', op.id);
    if (ex) {
      if (ex.match_id !== m.id) throw new HttpError(409, 'id_conflict');
      return; // mismo toque reenviado: se ignora (sin duplicar)
    }
    const ts = clientTs(op.ts);
    await ctx.db.run(
      `INSERT INTO events (id, match_id, type, part, minute, player_id, goalkeeper_id, zone, goal_cell, result,
        shot_type, trajectory, pressure, phase, subtype, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      op.id, m.id, e.type, e.part, e.minute, e.player_id, e.goalkeeper_id, e.zone, e.goal_cell, e.result,
      e.shot_type, e.trajectory, e.pressure, e.phase, e.subtype, ctx.user.id, ts, ts
    );
  },

  async 'event.update'(ctx, op) {
    const ev = await ctx.db.first('SELECT * FROM events WHERE id = ?', op.id);
    if (!ev || ev.deleted_at) throw new HttpError(404, 'event_not_found');
    const m = await requireMatchWrite(ctx, ev.match_id);
    const patch = normEventFields(op.fields || {});
    const type = op.fields?.type || ev.type;
    const merged = fullEvent(type, { ...ev, ...patch });
    const err = validateEvent(merged);
    if (err) throw new HttpError(400, 'invalid_event', { field: err });
    await checkPeople(ctx, m, merged);
    await ctx.db.run(
      `UPDATE events SET type=?, part=?, minute=?, player_id=?, goalkeeper_id=?, zone=?, goal_cell=?, result=?,
        shot_type=?, trajectory=?, pressure=?, phase=?, subtype=?, updated_at=? WHERE id=?`,
      merged.type, merged.part, merged.minute, merged.player_id, merged.goalkeeper_id, merged.zone, merged.goal_cell, merged.result,
      merged.shot_type, merged.trajectory, merged.pressure, merged.phase, merged.subtype, nowIso(), ev.id
    );
    await audit(ctx, 'event.update', 'event', ev.id, { match_id: ev.match_id, from: ev.type, to: merged.type });
  },

  async 'event.delete'(ctx, op) {
    const ev = await ctx.db.first('SELECT * FROM events WHERE id = ?', op.id);
    if (!ev || ev.deleted_at) return; // ya borrado: idempotente
    await requireMatchWrite(ctx, ev.match_id);
    await ctx.db.run('UPDATE events SET deleted_at=?, updated_at=? WHERE id=?', nowIso(), nowIso(), ev.id);
    await audit(ctx, 'event.delete', 'event', ev.id, { match_id: ev.match_id, type: ev.type });
  },

  // Total tecleado a mano → ajuste (delta sobre lo calculado por eventos). delta 0 = quitar ajuste.
  async 'adj.set'(ctx, op) {
    if (!COUNTERS.includes(op.stat)) throw new HttpError(400, 'invalid_stat');
    const delta = Number(op.delta);
    if (!Number.isInteger(delta) || Math.abs(delta) > 1000) throw new HttpError(400, 'invalid_delta');
    const m = await requireMatchWrite(ctx, op.match_id);
    if (delta === 0) await ctx.db.run('DELETE FROM adjustments WHERE match_id=? AND stat=?', m.id, op.stat);
    else
      await ctx.db.run(
        `INSERT INTO adjustments (match_id, stat, delta, updated_by, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(match_id, stat) DO UPDATE SET delta=excluded.delta, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
        m.id, op.stat, delta, ctx.user.id, nowIso()
      );
    await audit(ctx, 'adj.set', 'match', m.id, { stat: op.stat, delta });
  },

  async 'player.create'(ctx, op) {
    if (!validId(op.id)) throw new HttpError(400, 'invalid_id');
    if (!(await canTeam(ctx, op.team_id))) throw new HttpError(403, 'forbidden_team');
    const f = playerFields(op);
    const ex = await ctx.db.first('SELECT team_id FROM players WHERE id = ?', op.id);
    if (ex) return;
    await assertNumberFree(ctx, op.team_id, f.number, null);
    await ctx.db.run(
      'INSERT INTO players (id, team_id, name, surname, number, position, is_goalkeeper, created_at) VALUES (?,?,?,?,?,?,?,?)',
      op.id, op.team_id, f.name, f.surname, f.number, f.position, f.is_goalkeeper, nowIso()
    );
    await audit(ctx, 'player.create', 'player', op.id, { team_id: op.team_id, name: f.name });
  },

  async 'player.update'(ctx, op) {
    const p = await ctx.db.first('SELECT * FROM players WHERE id = ? AND deleted_at IS NULL', op.id);
    if (!p) throw new HttpError(404, 'player_not_found');
    if (!(await canTeam(ctx, p.team_id))) throw new HttpError(403, 'forbidden_team');
    const f = playerFields({ ...p, ...(op.fields || {}) });
    await assertNumberFree(ctx, p.team_id, f.number, p.id);
    await ctx.db.run('UPDATE players SET name=?, surname=?, number=?, position=?, is_goalkeeper=? WHERE id=?',
      f.name, f.surname, f.number, f.position, f.is_goalkeeper, p.id);
    await audit(ctx, 'player.update', 'player', p.id, op.fields);
  },

  async 'player.delete'(ctx, op) {
    const p = await ctx.db.first('SELECT * FROM players WHERE id = ?', op.id);
    if (!p || p.deleted_at) return;
    if (!(await canTeam(ctx, p.team_id))) throw new HttpError(403, 'forbidden_team');
    await ctx.db.run('UPDATE players SET deleted_at=? WHERE id=?', nowIso(), p.id);
    await audit(ctx, 'player.delete', 'player', p.id, { name: p.name });
  },
};

export function playerFields(src) {
  const name = cleanStr(src.name, 60);
  if (!name) throw new HttpError(400, 'name_required');
  let number = src.number === '' || src.number == null ? null : Number(src.number);
  if (number != null && !(Number.isInteger(number) && number >= 0 && number <= 99)) throw new HttpError(400, 'invalid_number');
  return {
    name,
    surname: cleanStr(src.surname, 60),
    number,
    position: cleanStr(src.position, 30),
    is_goalkeeper: src.is_goalkeeper ? 1 : 0,
  };
}

export async function assertNumberFree(ctx, teamId, number, exceptId) {
  if (number == null) return;
  const dup = await ctx.db.first(
    'SELECT id FROM players WHERE team_id = ? AND number = ? AND deleted_at IS NULL AND id != ?', teamId, number, exceptId ?? ''
  );
  if (dup) throw new HttpError(409, 'duplicate_number');
}

export async function applyOps(ctx, ops) {
  const results = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      const fn = OPS[op?.op];
      if (!fn) throw new HttpError(400, 'unknown_op');
      await fn(ctx, op);
      results.push({ i, ok: true });
    } catch (e) {
      if (e instanceof HttpError) results.push({ i, ok: false, error: e.code, ...e.extra });
      else throw e;
    }
  }
  return results;
}
