// Informes: partido, partidos y temporada. Todo se calcula desde eventos + ajustes (sin duplicar).
import {
  totalCounters, sumCounters, playerStats, goalkeeperStats, zoneStats, cellStats, unassignedPlayers, unassignedGoalkeepers, isIsoDate,
  DEFAULT_THRESHOLDS,
} from '../public/js/stats.js';
import { HttpError, canTeam } from './core.js';

export const chunk = (arr, n = 50) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function eventsFor(db, matchIds) {
  const out = [];
  for (const ids of chunk(matchIds)) {
    const ph = ids.map(() => '?').join(',');
    out.push(...(await db.all(`SELECT * FROM events WHERE deleted_at IS NULL AND match_id IN (${ph}) ORDER BY created_at, rowid`, ...ids)));
  }
  return out;
}

export async function adjustmentsFor(db, matchIds) {
  const out = [];
  for (const ids of chunk(matchIds)) {
    const ph = ids.map(() => '?').join(',');
    out.push(...(await db.all(`SELECT match_id, stat, delta FROM adjustments WHERE match_id IN (${ph})`, ...ids)));
  }
  return out;
}

export async function loadMatchDetail(ctx, id) {
  const m = await ctx.db.first(
    `SELECT m.*, r.name AS rival, t.name AS team FROM matches m JOIN teams r ON r.id = m.rival_id JOIN teams t ON t.id = m.team_id
     WHERE m.id = ? AND m.deleted_at IS NULL`, id);
  if (!m) throw new HttpError(404, 'match_not_found');
  if (!(await canTeam(ctx, m.team_id))) throw new HttpError(403, 'forbidden_team');
  const events = await eventsFor(ctx.db, [id]);
  const adjustments = await ctx.db.all('SELECT stat, delta FROM adjustments WHERE match_id = ?', id);
  try { const a = JSON.parse(m.squad); m.squad = Array.isArray(a) ? a : null; } catch { m.squad = null; }
  return { match: m, events, adjustments };
}

export async function buildReport(ctx, q) {
  const { db } = ctx;
  if (!(await canTeam(ctx, q.team_id))) throw new HttpError(403, 'forbidden_team');
  const team = await db.first('SELECT id, name FROM teams WHERE id = ?', q.team_id);
  const where = ['m.team_id = ?', 'm.deleted_at IS NULL', 'm.is_practice = 0'];
  const args = [q.team_id];
  if (q.season_id) { where.push('m.season_id = ?'); args.push(q.season_id); }
  if (q.from) { if (!isIsoDate(q.from)) throw new HttpError(400, 'invalid_date'); where.push('m.date >= ?'); args.push(q.from); }
  if (q.to) { if (!isIsoDate(q.to)) throw new HttpError(400, 'invalid_date'); where.push('m.date <= ?'); args.push(q.to); }
  if (q.rival_id) { where.push('m.rival_id = ?'); args.push(q.rival_id); }
  if (q.home_away === 'home' || q.home_away === 'away') { where.push('m.home_away = ?'); args.push(q.home_away); }
  const matches = await db.all(
    `SELECT m.id, m.date, m.home_away, m.season_id, m.rival_id, r.name AS rival FROM matches m
     JOIN teams r ON r.id = m.rival_id WHERE ${where.join(' AND ')} ORDER BY m.date, m.created_at`, ...args);
  const ids = matches.map((m) => m.id);
  const events = ids.length ? await eventsFor(db, ids) : [];
  const adjustments = ids.length ? await adjustmentsFor(db, ids) : [];
  const evBy = new Map(), adBy = new Map();
  for (const e of events) (evBy.get(e.match_id) || evBy.set(e.match_id, []).get(e.match_id)).push(e);
  for (const a of adjustments) (adBy.get(a.match_id) || adBy.set(a.match_id, []).get(a.match_id)).push(a);
  for (const m of matches) m.counters = totalCounters(evBy.get(m.id) || [], adBy.get(m.id) || []);
  const totals = sumCounters(matches.map((m) => m.counters));
  const pRows = playerStats(events), gRows = goalkeeperStats(events);
  const players_info = await db.all(
    'SELECT id, name, surname, number, is_goalkeeper, deleted_at FROM players WHERE team_id = ? ORDER BY number, name', q.team_id);
  // Datos de cada jugador/portero partido a partido (pestaña «Jugadores» de informes)
  const by_match = matches.map((m) => {
    const ev = evBy.get(m.id) || [];
    return { match_id: m.id, players: playerStats(ev).filter((r) => r.player_id), keepers: goalkeeperStats(ev).filter((r) => r.player_id) };
  });
  const row = await db.first("SELECT value FROM settings WHERE key = 'thresholds'");
  let thresholds = DEFAULT_THRESHOLDS;
  try { if (row) thresholds = { ...DEFAULT_THRESHOLDS, ...JSON.parse(row.value) }; } catch { /* valores por defecto */ }
  return {
    team, filters: { season_id: q.season_id || null, from: q.from || null, to: q.to || null, rival_id: q.rival_id || null, home_away: q.home_away || null },
    matches, totals,
    players: { rows: pRows.filter((r) => r.player_id), unassigned: unassignedPlayers(totals, pRows) },
    goalkeepers: { rows: gRows.filter((r) => r.player_id), unassigned: unassignedGoalkeepers(totals, gRows) },
    zones: zoneStats(events), cells: cellStats(events), players_info, by_match, thresholds,
  };
}
