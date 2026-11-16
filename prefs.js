// Preferencias de uso de este móvil (no se comparten con otros dispositivos): se guardan en el propio teléfono.
const DEFAULTS = { vibrate: '1', awake: '1', big: '0', lefty: '0', theme: 'auto' };

export const pref = (k) => { try { return localStorage.getItem(`urd.pref.${k}`) ?? DEFAULTS[k]; } catch { return DEFAULTS[k]; } };
export const prefOn = (k) => pref(k) === '1';

export function setPref(k, v) {
  try { localStorage.setItem(`urd.pref.${k}`, v); } catch { /* sin almacenamiento */ }
  applyPrefs();
}

// Aplica tema y tamaño de botones a toda la página
export function applyPrefs() {
  const el = document.documentElement;
  const th = pref('theme');
  if (th === 'dark' || th === 'light') el.dataset.theme = th; else delete el.dataset.theme;
  el.classList.toggle('big-btns', prefOn('big'));
  el.classList.toggle('lefty', prefOn('lefty'));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = (th === 'dark' || (th === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)) ? '#1a1d21' : '#E8140C';
}

// Mantiene la pantalla encendida mientras se anota (si el navegador lo permite). Devuelve una función para soltarla.
export function keepAwake() {
  let lock = null, stopped = false;
  const get = async () => {
    if (stopped || !prefOn('awake') || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } catch { /* sin permiso */ }
  };
  const onVis = () => { if (!lock) get(); };
  document.addEventListener('visibilitychange', onVis);
  get();
  return () => { stopped = true; document.removeEventListener('visibilitychange', onVis); lock?.release?.().catch(() => {}); lock = null; };
}
