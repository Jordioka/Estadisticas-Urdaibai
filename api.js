// API de Urdaibai E.T. · Estadísticas. Un único manejador para Cloudflare Pages Functions.
import { CONTRIB, COUNTERS, DEFAULT_THRESHOLDS, isIsoDate, emptyCounters } from '../public/js/stats.js';
import {
  HttpError, makeDb, nowIso, uuid, hashPassword, verifyPassword, sha256Hex, randomToken, cleanStr, placeholders,
  loadAccess, canTeam, accessibleTeams, audit, requireAdmin, requireOwner, ensureSeason, validId,
} from './core.js';
import { applyOps } from './ops.js';
import { importPlayers, importMatches } from './imports.js';
import { buildReport, loadMatchDetail } from './reports.js';

const SESSION_DAYS = 60;
const MAX_FAILS = 5;
const MIN_PASSWORD = 6;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

const sessionCookie = (token, secure, maxAge) =>
  `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const text = await req.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'invalid_json'); }
}

async function authenticate(db, req) {
  const token = getCookie(req, 'session');
  if (!token) return null;
  const th = await sha256Hex(token);
  const row = await db.first(
    `SELECT u.id, u.username, u.name, u.role, u.all_teams, u.is_owner, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    th, nowIso()
  );
  if (!row) return null;
  // sesión larga y renovable: así no se pide login en mitad de un partido
  if (Date.parse(row.expires_at) - Date.now() < (SESSION_DAYS - 7) * 86400_000) {
    await db.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString(), th);
  }
  return row;
}

// ---------- Ajustes ----------
async function getThresholds(db) {
  const row = await db.first("SELECT value FROM settings WHERE key = 'thresholds'");
  if (!row) return DEFAULT_THRESHOLDS;
  try { return { ...DEFAULT_THRESHOLDS, ...JSON.parse(row.value) }; } catch { return DEFAULT_THRESHOLDS; }
}

function validateThresholds(t) {
  const num = (v) => typeof v === 'number' && isFinite(v);
  const out = {};
  const p = t?.possessions, o = t?.off_eff, s = t?.save_pct, l = t?.loss_pct;
  if (![p?.green_gt, p?.orange_gte, o?.green_gt, o?.orange_gte, s?.green_gt, s?.orange_gte, l?.great_lt, l?.good_lt, l?.orange_lt].every(num))
    throw new HttpError(400, 'invalid_thresholds');
  if (p.orange_gte > p.green_gt || o.orange_gte > o.green_gt || s.orange_gte > s.green_gt) throw new HttpError(400, 'invalid_thresholds');
  if (!(l.great_lt <= l.good_lt && l.good_lt <= l.orange_lt)) throw new HttpError(400, 'invalid_thresholds');
  for (const v of [o.green_gt, o.orange_gte, s.green_gt, s.orange_gte, l.great_lt, l.good_lt, l.orange_lt])
    if (v < 0 || v > 1) throw new HttpError(400, 'invalid_thresholds');
  out.possessions = { green_gt: p.green_gt, orange_gte: p.orange_gte };
  out.off_eff = { green_gt: o.green_gt, orange_gte: o.orange_gte };
  out.save_pct = { green_gt: s.green_gt, orange_gte: s.orange_gte };
  out.loss_pct = { great_lt: l.great_lt, good_lt: l.good_lt, orange_lt: l.orange_lt };
  return out;
}

// ---------- Bootstrap: todo lo que el móvil necesita para trabajar (también sin conexión) ----------
async function bootstrap(ctx) {
  const { db, user } = ctx;
  const teams = await accessibleTeams(ctx);
  const teamIds = teams.map((t) => t.id);
  const rivals = await db.all('SELECT id, name FROM teams WHERE is_own = 0 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE');
  let players = [], matches = [];
  if (teamIds.length) {
    const ph = placeholders(teamIds.length);
    players = await db.all(
      `SELECT id, team_id, name, surname, number, position, is_goalkeeper FROM players
       WHERE deleted_at IS NULL AND team_id IN (${ph}) ORDER BY number, name COLLATE NOCASE`, ...teamIds);
    matches = await db.all(
      `SELECT id, team_id, rival_id, date, home_away, season_id, is_practice FROM matches
       WHERE deleted_at IS NULL AND team_id IN (${ph}) ORDER BY date DESC, created_at DESC`, ...teamIds);
    const counts = await db.all(
      `SELECT e.match_id, e.type, COUNT(*) AS n FROM events e JOIN matches m ON m.id = e.match_id
       WHERE e.deleted_at IS NULL AND m.deleted_at IS NULL AND m.team_id IN (${ph}) GROUP BY e.match_id, e.type`, ...teamIds);
    const adj = await db.all(
      `SELECT a.match_id, a.stat, a.delta FROM adjustments a JOIN matches m ON m.id = a.match_id
       WHERE m.deleted_at IS NULL AND m.team_id IN (${ph})`, ...teamIds);
    const byMatch = new Map(matches.map((m) => [m.id, (m.counters = emptyCounters(), m.counters)]));
    for (const c of counts) {
      const add = CONTRIB[c.type];
      const target = byMatch.get(c.match_id);
      if (add && target) for (const k in add) target[k] += add[k] * c.n;
    }
    for (const a of adj) { const t = byMatch.get(a.match_id); if (t) t[a.stat] += a.delta; }
  }
  const seasons = await db.all('SELECT id, name, start_date, end_date, closed FROM seasons ORDER BY start_date DESC');
  return {
    user: { id: user.id, username: user.username, name: user.name, role: user.role, all_teams: !!user.all_teams, is_owner: !!user.is_owner },
    teams, rivals, players, matches, seasons, thresholds: await getThresholds(db), server_time: nowIso(),
  };
}

// ---------- Rutas ----------
const routes = [];
const route = (method, path, fn, { auth = true, admin = false } = {}) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:([a-z_]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, fn, auth, admin });
};

route('POST', '/api/login', async (ctx) => {
  const { username, password } = ctx.body;
  const uname = cleanStr(username, 60);
  if (!uname || typeof password !== 'string') throw new HttpError(400, 'invalid_credentials');
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const fails = await ctx.db.first('SELECT COUNT(*) AS n FROM login_attempts WHERE username = ? AND at > ?', uname.toLowerCase(), since);
  if (fails.n >= MAX_FAILS) throw new HttpError(429, 'too_many_attempts');
  const u = await ctx.db.first('SELECT * FROM users WHERE username = ? AND active = 1', uname);
  const ok = u ? await verifyPassword(password, u.pass_hash) : (await verifyPassword(password, 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='), false);
  if (!ok) {
    await ctx.db.run('INSERT INTO login_attempts (username, at) VALUES (?,?)', uname.toLowerCase(), nowIso());
    throw new HttpError(401, 'invalid_credentials');
  }
  await ctx.db.run('DELETE FROM login_attempts WHERE username = ?', uname.toLowerCase());
  const token = randomToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await ctx.db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', await sha256Hex(token), u.id, exp);
  await ctx.db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, ctx.secure, SESSION_DAYS * 86400) });
}, { auth: false });

route('POST', '/api/logout', async (ctx) => {
  const token = getCookie(ctx.req, 'session');
  if (token) await ctx.db.run('DELETE FROM sessions WHERE token_hash = ?', await sha256Hex(token));
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', ctx.secure, 0) });
}, { auth: false });

route('GET', '/api/bootstrap', async (ctx) => json(await bootstrap(ctx)));

route('POST', '/api/sync', async (ctx) => {
  const ops = Array.isArray(ctx.body.ops) ? ctx.body.ops.slice(0, 500) : [];
  return json({ results: await applyOps(ctx, ops) });
});

route('GET', '/api/matches/:id', async (ctx) => json(await loadMatchDetail(ctx, ctx.params.id)));

route('GET', '/api/reports', async (ctx) => json(await buildReport(ctx, Object.fromEntries(ctx.url.searchParams))));

route('POST', '/api/import/players', async (ctx) => json(await importPlayers(ctx, ctx.body)));
route('POST', '/api/import/matches', async (ctx) => json(await importMatches(ctx, ctx.body)));

// ----- Administración -----
const userOut = async (db, u) => ({
  id: u.id, username: u.username, name: u.name, role: u.role, all_teams: !!u.all_teams, active: !!u.active,
  team_ids: (await db.all('SELECT team_id FROM user_teams WHERE user_id = ?', u.id)).map((r) => r.team_id),
});

route('GET', '/api/users', async (ctx) => {
  const rows = await ctx.db.all('SELECT * FROM users ORDER BY username COLLATE NOCASE');
  return json({ users: await Promise.all(rows.map((u) => userOut(ctx.db, u))) });
}, { admin: true });

async function setUserTeams(ctx, userId, teamIds) {
  const valid = [];
  for (const id of teamIds || []) {
    const t = await ctx.db.first('SELECT id FROM teams WHERE id = ? AND is_own = 1 AND deleted_at IS NULL', id);
    if (t) valid.push(id);
  }
  await ctx.db.run('DELETE FROM user_teams WHERE user_id = ?', userId);
  for (const id of valid) await ctx.db.run('INSERT INTO user_teams (user_id, team_id) VALUES (?,?)', userId, id);
}

route('POST', '/api/users', async (ctx) => {
  const b = ctx.body;
  const username = cleanStr(b.username, 40);
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) throw new HttpError(400, 'invalid_username');
  if (typeof b.password !== 'string' || b.password.length < MIN_PASSWORD) throw new HttpError(400, 'weak_password');
  if (await ctx.db.first('SELECT id FROM users WHERE username = ?', username)) throw new HttpError(409, 'username_taken');
  const id = uuid();
  await ctx.db.run('INSERT INTO users (id, username, name, pass_hash, role, all_teams, active, created_at) VALUES (?,?,?,?,?,?,1,?)',
    id, username, cleanStr(b.name, 80), await hashPassword(b.password), b.role === 'admin' ? 'admin' : 'scorer', b.all_teams ? 1 : 0, nowIso());
  await setUserTeams(ctx, id, b.team_ids);
  await audit(ctx, 'user.create', 'user', id, { username, role: b.role });
  return json({ user: await userOut(ctx.db, await ctx.db.first('SELECT * FROM users WHERE id = ?', id)) });
}, { admin: true });

route('PATCH', '/api/users/:id', async (ctx) => {
  const u = await ctx.db.first('SELECT * FROM users WHERE id = ?', ctx.params.id);
  if (!u) throw new HttpError(404, 'not_found');
  const b = ctx.body;
  const self = u.id === ctx.user.id;
  if (self && (b.active === false || (b.role && b.role !== 'admin'))) throw new HttpError(400, 'cannot_demote_self');
  let invalidate = false;
  if (b.password !== undefined) {
    if (typeof b.password !== 'string' || b.password.length < MIN_PASSWORD) throw new HttpError(400, 'weak_password');
    await ctx.db.run('UPDATE users SET pass_hash = ? WHERE id = ?', await hashPassword(b.password), u.id);
    invalidate = true;
  }
  if (b.name !== undefined) await ctx.db.run('UPDATE users SET name = ? WHERE id = ?', cleanStr(b.name, 80), u.id);
  if (b.role) await ctx.db.run('UPDATE users SET role = ? WHERE id = ?', b.role === 'admin' ? 'admin' : 'scorer', u.id);
  if (b.all_teams !== undefined) await ctx.db.run('UPDATE users SET all_teams = ? WHERE id = ?', b.all_teams ? 1 : 0, u.id);
  if (b.active !== undefined) { await ctx.db.run('UPDATE users SET active = ? WHERE id = ?', b.active ? 1 : 0, u.id); if (!b.active) invalidate = true; }
  if (b.team_ids) await setUserTeams(ctx, u.id, b.team_ids);
  if (invalidate && !self) await ctx.db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  await audit(ctx, 'user.update', 'user', u.id, { ...b, password: b.password ? '***' : undefined });
  return json({ user: await userOut(ctx.db, await ctx.db.first('SELECT * FROM users WHERE id = ?', u.id)) });
}, { admin: true });

route('POST', '/api/teams', async (ctx) => {
  const name = cleanStr(ctx.body.name, 80);
  if (!name) throw new HttpError(400, 'name_required');
  const dup = await ctx.db.first('SELECT id FROM teams WHERE is_own = 1 AND deleted_at IS NULL AND name = ? COLLATE NOCASE', name);
  if (dup) throw new HttpError(409, 'team_exists');
  const id = uuid();
  await ctx.db.run('INSERT INTO teams (id, name, is_own, created_at) VALUES (?,?,1,?)', id, name, nowIso());
  await audit(ctx, 'team.create', 'team', id, { name });
  return json({ team: { id, name } });
}, { admin: true });

route('PATCH', '/api/teams/:id', async (ctx) => {
  const name = cleanStr(ctx.body.name, 80);
  if (!name) throw new HttpError(400, 'name_required');
  const t = await ctx.db.first('SELECT id FROM teams WHERE id = ? AND deleted_at IS NULL', ctx.params.id);
  if (!t) throw new HttpError(404, 'not_found');
  await ctx.db.run('UPDATE teams SET name = ? WHERE id = ?', name, t.id);
  await audit(ctx, 'team.update', 'team', t.id, { name });
  return json({ ok: true });
}, { admin: true });

route('DELETE', '/api/teams/:id', async (ctx) => {
  const t = await ctx.db.first('SELECT id, name FROM teams WHERE id = ? AND deleted_at IS NULL', ctx.params.id);
  if (!t) throw new HttpError(404, 'not_found');
  await ctx.db.run('UPDATE teams SET deleted_at = ? WHERE id = ?', nowIso(), t.id);
  await audit(ctx, 'team.delete', 'team', t.id, { name: t.name });
  return json({ ok: true });
}, { admin: true });

route('PUT', '/api/settings/thresholds', async (ctx) => {
  const t = validateThresholds(ctx.body);
  await ctx.db.run("INSERT INTO settings (key, value) VALUES ('thresholds', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(t));
  await audit(ctx, 'settings.thresholds', 'settings', 'thresholds', t);
  return json({ thresholds: t });
}, { admin: true });

route('POST', '/api/seasons', async (ctx) => {
  const b = ctx.body, name = cleanStr(b.name, 20);
  if (!name || !isIsoDate(b.start_date) || !isIsoDate(b.end_date) || b.start_date > b.end_date) throw new HttpError(400, 'invalid_season');
  if (await ctx.db.first('SELECT id FROM seasons WHERE name = ?', name)) throw new HttpError(409, 'season_exists');
  const id = uuid();
  await ctx.db.run('INSERT INTO seasons (id, name, start_date, end_date, closed) VALUES (?,?,?,?,?)', id, name, b.start_date, b.end_date, b.closed ? 1 : 0);
  await reassignSeasons(ctx.db);
  return json({ ok: true, id });
}, { admin: true });

route('PATCH', '/api/seasons/:id', async (ctx) => {
  const s = await ctx.db.first('SELECT * FROM seasons WHERE id = ?', ctx.params.id);
  if (!s) throw new HttpError(404, 'not_found');
  const b = { ...s, ...ctx.body };
  if (!isIsoDate(b.start_date) || !isIsoDate(b.end_date) || b.start_date > b.end_date || !cleanStr(b.name, 20)) throw new HttpError(400, 'invalid_season');
  await ctx.db.run('UPDATE seasons SET name=?, start_date=?, end_date=?, closed=? WHERE id=?', cleanStr(b.name, 20), b.start_date, b.end_date, b.closed ? 1 : 0, s.id);
  await reassignSeasons(ctx.db);
  await audit(ctx, 'season.update', 'season', s.id, ctx.body);
  return json({ ok: true });
}, { admin: true });

// Cada partido pertenece a la temporada que contiene su fecha
async function reassignSeasons(db) {
  await db.run(`UPDATE matches SET season_id = (SELECT id FROM seasons s WHERE matches.date BETWEEN s.start_date AND s.end_date ORDER BY s.start_date DESC LIMIT 1)
    WHERE EXISTS (SELECT 1 FROM seasons s WHERE matches.date BETWEEN s.start_date AND s.end_date)`);
}

route('GET', '/api/trash', async (ctx) => {
  const matches = await ctx.db.all(
    `SELECT m.id, m.date, m.deleted_at, t.name AS team, r.name AS rival FROM matches m
     JOIN teams t ON t.id = m.team_id JOIN teams r ON r.id = m.rival_id WHERE m.deleted_at IS NOT NULL ORDER BY m.deleted_at DESC LIMIT 100`);
  const players = await ctx.db.all(
    `SELECT p.id, p.name, p.surname, p.number, p.deleted_at, t.name AS team FROM players p JOIN teams t ON t.id = p.team_id
     WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC LIMIT 100`);
  const teams = await ctx.db.all('SELECT id, name, is_own, deleted_at FROM teams WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100');
  const events = await ctx.db.all(
    `SELECT e.id, e.type, e.part, e.deleted_at, m.date, r.name AS rival, t.name AS team FROM events e
     JOIN matches m ON m.id = e.match_id JOIN teams t ON t.id = m.team_id JOIN teams r ON r.id = m.rival_id
     WHERE e.deleted_at IS NOT NULL ORDER BY e.deleted_at DESC LIMIT 100`);
  return json({ matches, players, teams, events });
}, { admin: true });

route('POST', '/api/trash/restore', async (ctx) => {
  const { entity, id } = ctx.body;
  const table = { match: 'matches', player: 'players', team: 'teams', event: 'events' }[entity];
  if (!table || !validId(id)) throw new HttpError(400, 'invalid_request');
  const r = await ctx.db.run(`UPDATE ${table} SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`, id);
  if (!(r.meta?.changes > 0)) throw new HttpError(404, 'not_found');
  await audit(ctx, 'restore', entity, id, null);
  return json({ ok: true });
}, { admin: true });

route('GET', '/api/audit', async (ctx) => {
  const rows = await ctx.db.all(
    `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.detail, u.username FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`);
  return json({ log: rows });
}, { admin: true });

// ---------- Entrada ----------
// Límites del plan gratuito de Cloudflare (se reinician a las 00:00 UTC; ver developers.cloudflare.com)
export const FREE_LIMITS = { requests: 100_000, rows_read: 5_000_000, rows_written: 100_000, db_bytes: 5 * 1024 ** 3, github_repo_bytes: 1024 ** 3 };

async function recordUsage(env, usage) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const r = await env.DB.prepare(
      `INSERT INTO usage_daily (day, requests, rows_read, rows_written) VALUES (?, 1, ?, ?)
       ON CONFLICT(day) DO UPDATE SET requests = requests + 1, rows_read = rows_read + excluded.rows_read, rows_written = rows_written + excluded.rows_written`
    ).bind(day, usage.read, usage.written + 1).run();
    const size = r?.meta?.size_after;
    if (size != null) await env.DB.prepare('UPDATE usage_daily SET db_size = ? WHERE day = ?').bind(size, day).run();
  } catch { /* contar el uso nunca debe romper una petición */ }
}

route('GET', '/api/usage', async (ctx) => {
  requireOwner(ctx);
  const day = new Date().toISOString().slice(0, 10);
  const days = await ctx.db.all('SELECT day, requests, rows_read, rows_written FROM usage_daily ORDER BY day DESC LIMIT 14');
  const sizeRow = await ctx.db.first('SELECT db_size FROM usage_daily WHERE db_size IS NOT NULL ORDER BY day DESC LIMIT 1');
  const today = days.find((d) => d.day === day) || { day, requests: 0, rows_read: 0, rows_written: 0 };
  let github = null;
  const repo = ctx.env.GITHUB_REPO;
  if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { 'User-Agent': 'urdaibai-stats', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000) });
      if (r.ok) { const j = await r.json(); github = { repo, bytes: (j.size || 0) * 1024, private: !!j.private }; }
      else github = { repo, error: r.status };
    } catch { github = { repo, error: 'network' }; }
  }
  return json({ day, today, days, db_bytes: sizeRow?.db_size ?? null, limits: FREE_LIMITS, github });
}, { auth: true });

export async function handle(request, env) {
  let usage = { read: 0, written: 0 };
  try {
    return await handleInner(request, env, (u) => { usage = u; });
  } finally {
    await recordUsage(env, usage);
  }
}

async function handleInner(request, env, setUsage) {
  const url = new URL(request.url);
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'bad_origin');
    }
    const db = makeDb(env.DB);
    setUsage(db.usage);
    let matched = null, params = {};
    for (const r of routes) {
      if (r.method !== request.method) continue;
      const m = url.pathname.match(r.re);
      if (m) { matched = r; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); break; }
    }
    if (!matched) throw new HttpError(404, 'not_found');
    const ctx = { req: request, url, env, db, params, secure: url.protocol === 'https:', body: await readBody(request), user: null, access: null };
    if (matched.auth) {
      ctx.user = await authenticate(db, request);
      if (!ctx.user) throw new HttpError(401, 'unauthorized');
      ctx.access = await loadAccess(db, ctx.user);
      if (matched.admin) requireAdmin(ctx);
    }
    return await matched.fn(ctx);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status);
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
}
