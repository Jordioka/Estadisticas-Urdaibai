// Estado de la aplicación, caché local y cola de sincronización sin conexión.
// Cada toque se guarda como operación con identificador único: si se reenvía, el servidor la ignora (sin duplicados).
import { totalCounters, emptyCounters, squadPlayers } from './stats.js';

const K = { cache: 'urd.cache.v2', outbox: 'urd.outbox.v2', match: (id) => `urd.match.v2.${id}` };

export const state = {
  ready: false, user: null, teams: [], rivals: [], players: [], matches: [], seasons: [], thresholds: null,
  online: true, pending: 0, last_backup: null,
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
let on401 = () => {};
export const onUnauthorized = (fn) => { on401 = fn; };
let errorHandler = () => {};
export const onSyncError = (fn) => { errorHandler = fn; };

const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* almacenamiento lleno o bloqueado */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* nada */ } };

let outbox = lsGet(K.outbox, []);
state.pending = outbox.length;

// ---------- Red ----------
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error('network'); e.network = true; state.online = false; emit(); throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  state.online = true;
  if (res.status === 401 && path !== '/api/login') { state.user = null; on401(); }
  if (!res.ok) { const e = new Error(data?.error || 'error'); e.status = res.status; e.code = data?.error; e.data = data; throw e; }
  return data;
}

// ---------- Datos generales ----------
function applyBootstrap(d) {
  Object.assign(state, {
    user: d.user, teams: d.teams, rivals: d.rivals, players: d.players, matches: d.matches, seasons: d.seasons,
    thresholds: d.thresholds, last_backup: d.last_backup ?? null, ready: true,
  });
}
const persistState = () => lsSet(K.cache, {
  user: state.user, teams: state.teams, rivals: state.rivals, players: state.players, matches: state.matches,
  seasons: state.seasons, thresholds: state.thresholds, last_backup: state.last_backup,
});

export async function loadBootstrap() {
  try {
    await flush();
    if (outbox.length) { // aún hay cosas por enviar: se conserva lo local
      if (!state.ready) { const c = lsGet(K.cache, null); if (c) applyBootstrap(c); }
    } else {
      const d = await api('GET', '/api/bootstrap');
      applyBootstrap(d);
      persistState();
    }
  } catch (e) {
    if (!e.network) throw e;
    if (!state.ready) {
      const c = lsGet(K.cache, null);
      if (!c) throw e;
      applyBootstrap(c);
    }
  }
  emit();
}

export const forgetLocal = () => {
  try { Object.keys(localStorage).filter((k) => k.startsWith('urd.match.') || k === K.cache || k === K.outbox).forEach(lsDel); } catch { /* nada */ }
  outbox = []; state.pending = 0; state.ready = false;
};

// ---------- Detalle de partido ----------
const hasPendingFor = (id) => outbox.some((o) => (o.match_id || o.id) === id);

export async function getMatch(id) {
  await flush().catch(() => {});
  if (!hasPendingFor(id)) {
    try { const d = await api('GET', `/api/matches/${id}`); lsSet(K.match(id), d); return d; } catch (e) { if (!e.network) throw e; }
  }
  const c = lsGet(K.match(id), null);
  if (!c) { const e = new Error('not_cached'); e.code = 'not_cached'; throw e; }
  return c;
}

let live = null; // partido abierto en pantalla (se comparte para que los cambios se vean al momento)
export const setLive = (d) => { live = d; };
const matchData = (id) => (live?.match?.id === id ? live : lsGet(K.match(id), null));

function recount(id, d) {
  const m = state.matches.find((x) => x.id === id);
  if (m && d) m.counters = totalCounters(d.events, d.adjustments);
}

// ---------- Cola de operaciones ----------
function applyLocal(op) {
  const sortRivals = () => state.rivals.sort((a, b) => a.name.localeCompare(b.name));
  switch (op.op) {
    case 'rival.create':
      if (!state.rivals.some((r) => r.id === op.id)) { state.rivals.push({ id: op.id, name: op.name }); sortRivals(); }
      persistState(); return;
    case 'match.create': {
      const m = { id: op.id, team_id: op.team_id, rival_id: op.rival_id, date: op.date, home_away: op.home_away || 'home', is_practice: op.is_practice ? 1 : 0, squad: Array.isArray(op.squad) && op.squad.length ? op.squad : null };
      if (!state.matches.some((x) => x.id === op.id)) state.matches.unshift({ ...m, counters: emptyCounters() });
      state.matches.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      lsSet(K.match(op.id), { match: { ...m, rival: state.rivals.find((r) => r.id === op.rival_id)?.name, team: state.teams.find((t) => t.id === op.team_id)?.name }, events: [], adjustments: [] });
      persistState(); return;
    }
    case 'match.update': {
      const m = state.matches.find((x) => x.id === op.id);
      if (m) Object.assign(m, op.fields);
      if (m && 'squad' in op.fields && !(op.fields.squad && op.fields.squad.length)) m.squad = null;
      const d = matchData(op.id);
      if (d) { Object.assign(d.match, op.fields); if (op.fields.rival_id) d.match.rival = state.rivals.find((r) => r.id === op.fields.rival_id)?.name; lsSet(K.match(op.id), d); }
      state.matches.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      persistState(); return;
    }
    case 'match.delete':
      state.matches = state.matches.filter((x) => x.id !== op.id); lsDel(K.match(op.id)); persistState(); return;
    case 'player.create':
      if (!state.players.some((p) => p.id === op.id))
        state.players.push({ id: op.id, team_id: op.team_id, name: op.name, surname: op.surname || '', number: op.number ?? null, position: op.position || '', is_goalkeeper: op.is_goalkeeper ? 1 : 0 });
      state.players.sort((a, b) => (a.number ?? 999) - (b.number ?? 999)); persistState(); return;
    case 'player.update': {
      const p = state.players.find((x) => x.id === op.id);
      if (p) Object.assign(p, op.fields, { is_goalkeeper: op.fields.is_goalkeeper ? 1 : 0 });
      state.players.sort((a, b) => (a.number ?? 999) - (b.number ?? 999)); persistState(); return;
    }
    case 'player.delete':
      state.players = state.players.filter((x) => x.id !== op.id); persistState(); return;
    case 'event.create': case 'event.update': case 'event.delete': case 'adj.set': {
      const d = matchData(op.match_id);
      if (!d) return;
      if (op.op === 'event.create') {
        if (!d.events.some((e) => e.id === op.id)) {
          const { op: _o, ts, ...rest } = op;
          d.events.push({ part: null, minute: null, player_id: null, goalkeeper_id: null, zone: null, goal_cell: null, result: null, shot_type: null, trajectory: null, pressure: null, phase: null, subtype: null, ...rest, created_at: ts || new Date().toISOString(), deleted_at: null });
        }
      } else if (op.op === 'event.update') {
        const e = d.events.find((x) => x.id === op.id);
        if (e) Object.assign(e, op.fields);
      } else if (op.op === 'event.delete') {
        d.events = d.events.filter((x) => x.id !== op.id);
      } else {
        d.adjustments = d.adjustments.filter((a) => a.stat !== op.stat);
        if (op.delta !== 0) d.adjustments.push({ stat: op.stat, delta: op.delta });
      }
      if (live?.match?.id === op.match_id) live.events = d.events, live.adjustments = d.adjustments;
      lsSet(K.match(op.match_id), d);
      recount(op.match_id, d);
      persistState();
    }
  }
}

export function enqueue(op) {
  outbox.push(op);
  lsSet(K.outbox, outbox);
  state.pending = outbox.length;
  applyLocal(op);
  emit();
  flushSoon();
}

let flushing = null, flushTimer = null;
export const flushSoon = () => { clearTimeout(flushTimer); flushTimer = setTimeout(() => flush().catch(() => {}), 150); };

export function flush() {
  if (flushing) return flushing;
  const p = (async () => {
    await Promise.resolve(); // garantiza que 'flushing' ya está asignado antes del finally
    try {
      while (outbox.length) {
        const batch = outbox.slice(0, 100);
        let res;
        try { res = await api('POST', '/api/sync', { ops: batch }); }
        catch (e) { if (e.network || e.status === 401 || e.status >= 500) break; throw e; }
        const failed = res.results.filter((r) => !r.ok).map((r) => ({ op: batch[r.i], error: r.error }));
        outbox = outbox.slice(batch.length);
        lsSet(K.outbox, outbox);
        state.pending = outbox.length;
        if (failed.length) {
          errorHandler(failed);
          // la verdad es el servidor: se vuelven a pedir los datos
          for (const f of failed) if (f.op.match_id || f.op.id) lsDel(K.match(f.op.match_id || f.op.id));
          if (!outbox.length) { try { applyBootstrap(await api('GET', '/api/bootstrap')); persistState(); } catch { /* sin red */ } }
        }
      }
    } finally {
      flushing = null;
      state.pending = outbox.length;
      emit();
    }
  })();
  flushing = p;
  return p;
}

window.addEventListener('online', () => flush().catch(() => {}));
setInterval(() => { if (outbox.length) flush().catch(() => {}); }, 8000);

// ---------- Ayudantes ----------
export const teamName = (id) => state.teams.find((t) => t.id === id)?.name || '';
export const rivalName = (id) => state.rivals.find((r) => r.id === id)?.name || '';
export const playersOf = (teamId) => state.players.filter((p) => p.team_id === teamId);
// Jugadores convocados a un partido (si no se ha marcado a nadie, toda la plantilla)
export const squadOf = (match) => squadPlayers(playersOf(match.team_id), match.squad);
export const setLastBackup = (v) => { state.last_backup = v; persistState(); emit(); };
export const playerLabel = (p) => (p ? `${p.number != null ? '#' + p.number + ' ' : ''}${p.name}${p.surname ? ' ' + p.surname : ''}` : '');
