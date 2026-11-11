// Textos en euskera (por defecto) y castellano. Cada clave lleva [castellano, euskera].
import { D } from './strings.js';

const KEY = 'urd.lang';
let lang = 'eu';
try { const s = localStorage.getItem(KEY); if (s === 'es' || s === 'eu') lang = s; } catch { /* sin almacenamiento */ }

const listeners = new Set();
export const onLangChange = (fn) => listeners.add(fn);
export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'es' ? 'es' : 'eu';
  try { localStorage.setItem(KEY, lang); } catch { /* nada */ }
  listeners.forEach((f) => f());
}

export function t(key, vars) {
  const e = D[key];
  let s = e ? (lang === 'eu' ? e[1] ?? e[0] : e[0]) : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  return s;
}
