// Cronómetro del partido para anotar: 00:00 → 30:00 (descanso) → 60:00 (fin) → prórrogas de 5 min.
// Se puede parar y reanudar; sobrevive a recargas (se guarda la hora de inicio, no un contador). Sin dependencias de interfaz.
export const HALF = 1800, FULL = 3600, OT = 300, MAX_MIN = 90;

// Siguiente parada automática estrictamente posterior a sec: 30:00, 60:00, 65:00, 70:00…
export const limitFor = (sec) => (sec < HALF ? HALF : sec < FULL ? FULL : FULL + OT * (Math.floor((sec - FULL) / OT) + 1));
export const fmt = (sec) => { const s = Math.max(0, Math.floor(sec)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export function createClock(matchId, storage = (typeof localStorage !== 'undefined' ? localStorage : null), now = () => Date.now()) {
  const key = `urd.clock.${matchId}`;
  let st = { base: 0, startedAt: null, limit: HALF };
  try { const raw = storage?.getItem(key); if (raw) st = { ...st, ...JSON.parse(raw) }; } catch { /* sin guardado */ }
  const save = () => { try { storage?.setItem(key, JSON.stringify(st)); } catch { /* sin guardado */ } };
  const elapsed = () => st.base + (st.startedAt ? Math.max(0, (now() - st.startedAt) / 1000) : 0);
  const api = {
    elapsed, running: () => st.startedAt != null,
    used: () => st.base > 0 || st.startedAt != null,
    start() { if (st.startedAt) return; st.limit = limitFor(st.base); st.startedAt = now(); save(); },
    pause() { if (!st.startedAt) return; st.base = elapsed(); st.startedAt = null; save(); },
    toggle() { if (st.startedAt) api.pause(); else api.start(); },
    set(sec) { const run = st.startedAt != null; st.base = Math.max(0, Math.min(MAX_MIN * 60, Math.round(sec))); st.startedAt = run ? now() : null; st.limit = limitFor(st.base); save(); },
    reset() { st = { base: 0, startedAt: null, limit: HALF }; save(); },
    // Debe llamarse a menudo: si se llega al límite, para justo ahí y devuelve el límite alcanzado (si no, null)
    tick() { if (st.startedAt && elapsed() >= st.limit) { const hit = st.limit; st.base = hit; st.startedAt = null; save(); return hit; } return null; },
    // Siguiente paso cuando está parado: 'start' | 'half2' | 'ot' | 'resume'
    nextStep() { if (st.startedAt) return null; const e = Math.round(st.base); if (e === 0) return 'start'; if (e === HALF) return 'half2'; if (e >= FULL && (e - FULL) % OT === 0) return 'ot'; return 'resume'; },
    part: () => (elapsed() < HALF ? 1 : 2),
    minute: () => Math.min(MAX_MIN, Math.floor(elapsed() / 60)),
    // Lo que se asocia a cada botón pulsado (null si el cronómetro no se ha usado)
    stamp: () => (api.used() ? { part: api.part(), minute: api.minute() } : null),
  };
  return api;
}
