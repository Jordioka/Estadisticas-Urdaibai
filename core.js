// Utilidades de servidor: base de datos, errores, contraseñas, permisos por equipo.
import { seasonForDate } from '../public/js/stats.js';

export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

// ---------- Base de datos (D1) ----------
export function makeDb(d1) {
  // Acumula lo que consume cada petición (filas leídas/escritas) para la pantalla de uso del propietario.
  const usage = { read: 0, written: 0 };
  const count = (meta) => { if (meta) { usage.read += meta.rows_read || 0; usage.written += meta.rows_written || 0; } };
  const prep = (sql, p) => d1.prepare(sql).bind(...p.map((v) => (v === undefined ? null : v)));
  return {
    raw: d1,
    usage,
    stmt: (sql, ...p) => prep(sql, p),
    all: async (sql, ...p) => { const r = await prep(sql, p).all(); count(r.meta); return r.results || []; },
    first: async (sql, ...p) => { usage.read += 1; return (await prep(sql, p).first()) || null; },
    run: async (sql, ...p) => { const r = await prep(sql, p).run(); count(r.meta); return r; },
    batch: async (stmts) => { const r = await d1.batch(stmts); for (const x of r || []) count(x.meta); return r; },
  };
}

export const placeholders = (n) => Array(n).fill('?').join(',');

// ---------- Contraseñas y sesiones (WebCrypto: PBKDF2, 100.000 iteraciones = máximo de Workers) ----------
const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITER = 100000;

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, ITER);
  return `pbkdf2$${ITER}$${toB64(salt)}$${toB64(bits)}`;
}

export async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored).split('$');
  if (alg !== 'pbkdf2') return false;
  const bits = new Uint8Array(await pbkdf2(password, fromB64(salt), Number(iter)));
  const want = fromB64(hash);
  if (bits.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ want[i];
  return diff === 0;
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const randomToken = () => toB64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));

// ---------- Texto ----------
export const normName = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const cleanStr = (v, max = 100) => (v == null ? '' : String(v).trim().slice(0, max));

export const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

// ---------- Permisos por equipo ----------
export async function loadAccess(db, user) {
  if (user.role === 'admin' || user.all_teams) return { all: true, set: null };
  const rows = await db.all('SELECT team_id FROM user_teams WHERE user_id = ?', user.id);
  return { all: false, set: new Set(rows.map((r) => r.team_id)) };
}

// ¿Puede este usuario ver/anotar este equipo propio? (se comprueba siempre en el servidor)
export async function canTeam(ctx, teamId) {
  if (!teamId) return false;
  if (!ctx.access.all && !ctx.access.set.has(teamId)) return false;
  const t = await ctx.db.first('SELECT id FROM teams WHERE id = ? AND is_own = 1 AND deleted_at IS NULL', teamId);
  return !!t;
}

export async function accessibleTeams(ctx) {
  const rows = await ctx.db.all('SELECT id, name FROM teams WHERE is_own = 1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE');
  return ctx.access.all ? rows : rows.filter((t) => ctx.access.set.has(t.id));
}

export async function ensureSeason(db, date) {
  const found = await db.first('SELECT id FROM seasons WHERE start_date <= ? AND end_date >= ? ORDER BY start_date DESC', date, date);
  if (found) return found.id;
  const s = seasonForDate(date);
  const byName = await db.first('SELECT id FROM seasons WHERE name = ?', s.name);
  if (byName) return byName.id;
  const id = uuid();
  await db.run('INSERT INTO seasons (id, name, start_date, end_date, closed) VALUES (?,?,?,?,0)', id, s.name, s.start_date, s.end_date);
  return id;
}

export async function audit(ctx, action, entity, entityId, detail) {
  await ctx.db.run(
    'INSERT INTO audit_log (at, user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)',
    nowIso(), ctx.user?.id ?? null, action, entity ?? null, entityId ?? null, detail == null ? null : JSON.stringify(detail).slice(0, 1000)
  );
}

export function requireOwner(ctx) {
  if (!ctx.user.is_owner) throw new HttpError(403, 'forbidden');
}

export function requireAdmin(ctx) {
  if (ctx.user.role !== 'admin') throw new HttpError(403, 'forbidden');
}

// Un partido se puede modificar si existe, el usuario tiene permiso sobre su equipo
// y (salvo administrador) su temporada no está cerrada.
export async function requireMatchWrite(ctx, matchId, { allowDeleted = false } = {}) {
  const m = await ctx.db.first('SELECT * FROM matches WHERE id = ?', matchId);
  if (!m || (m.deleted_at && !allowDeleted)) throw new HttpError(404, 'match_not_found');
  if (!(await canTeam(ctx, m.team_id))) throw new HttpError(403, 'forbidden_team');
  if (ctx.user.role !== 'admin' && m.season_id) {
    const s = await ctx.db.first('SELECT closed FROM seasons WHERE id = ?', m.season_id);
    if (s?.closed) throw new HttpError(403, 'season_closed');
  }
  return m;
}
