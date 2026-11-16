// Excel de detalle de portería: una hoja por partido y portero con dos cuadrículas
// (PARADAS y GOLES): filas = zona de lanzamiento, columnas = cuadrado de la portería (1-9).
// Cada celda es «cuántos». Así zona y cuadrado quedan asociados. Se convierte a filas planas para el servidor.
import { t } from './i18n.js';
import { normName } from './names.js';
import { loadXLSX } from './files.js';

export const KEEPER_ZONES = ['EI', 'ED', '6I', '6C', '6D', '7M', '9I', '9C', '9D'];
const k = (s) => normName(String(s ?? '')).replace(/[^a-z0-9]/g, '');
const SAVE_KEYS = ['paradas', 'saves', 'geldiketak'];
const GOAL_KEYS = ['goles', 'golesencontra', 'goals', 'golak'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const KEEPER_FLAT_HEADERS = ['Equipo', 'Fecha', 'Rival', 'Portero', 'Tipo', 'Zona', 'Punto portería', 'Cantidad'];

export function keeperTemplate(team) {
  const head = ['Zona', 1, 2, 3, 4, 5, 6, 7, 8, 9, 'Sin punto'];
  const block = (title, fill) => [[title], head, ...[...KEEPER_ZONES, 'Sin zona'].map((z) => [z, ...Array(10).fill('').map((_, i) => fill(z, i))]), []];
  const ex = (z, i) => (z === '9C' && i === 4 ? 2 : z === '7M' && i === 0 ? 1 : '');
  const ex2 = (z, i) => (z === 'EI' && i === 8 ? 1 : '');
  return [
    { name: 'Portero 1', aoa: [['Equipo', team], ['Fecha', '2026-11-07'], ['Rival', 'Rival de ejemplo'], ['Portero', 1], [], ...block('PARADAS', ex), ...block('GOLES', ex2)], widths: [14, 7, 7, 7, 7, 7, 7, 7, 7, 7, 11] },
    { name: t('tpl.help'), aoa: [[t('tpl.keeper.help1')], [t('tpl.keeper.help2')], [t('tpl.keeper.help3')], [t('tpl.keeper.help4')]], widths: [130] },
  ];
}

// Hoja (matriz) → filas planas
export function parseKeeperSheet(aoa) {
  const meta = {};
  const out = [];
  let type = null, cols = null;
  for (const row of aoa) {
    const a = k(row[0]);
    if (!a) { if (cols) { type = null; cols = null; } continue; }
    if (!type && ['equipo', 'fecha', 'rival', 'portero', 'team', 'date', 'goalkeeper', 'taldea', 'data', 'aurkaria', 'atezaina'].includes(a)) {
      const key = { team: 'equipo', taldea: 'equipo', date: 'fecha', data: 'fecha', aurkaria: 'rival', goalkeeper: 'portero', atezaina: 'portero' }[a] || a;
      meta[key] = row[1]; continue;
    }
    if (SAVE_KEYS.includes(a) || GOAL_KEYS.includes(a)) { type = SAVE_KEYS.includes(a) ? 'Parada' : 'Gol'; cols = null; continue; }
    if (type && !cols && (a === 'zona' || a === 'zone' || a === 'eremua')) {
      cols = [];
      row.forEach((v, i) => { if (i === 0) return; const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= 9) cols.push([i, n]); else if (v !== '' && v != null) cols.push([i, null]); });
      continue;
    }
    if (type && cols) {
      const zone = KEEPER_ZONES.find((z) => k(z) === a) || (['sinzona', 'zonarik'].includes(a) ? '' : undefined);
      if (zone === undefined) continue;
      for (const [i, cell] of cols) {
        const v = row[i];
        if (v === '' || v == null) continue;
        out.push({ Equipo: meta.equipo, Fecha: meta.fecha, Rival: meta.rival, Portero: meta.portero, Tipo: type, Zona: zone, 'Punto portería': cell ?? '', Cantidad: v });
      }
    }
  }
  const date = meta.fecha instanceof Date ? iso(meta.fecha) : meta.fecha;
  return out.map((r) => ({ ...r, Fecha: r.Fecha instanceof Date ? iso(r.Fecha) : r.Fecha ?? date, Equipo: r.Equipo ?? '' }));
}

// Libro completo: todas las hojas con cuadrícula. Devuelve null si no hay ninguna (se probará como tabla plana).
export async function parseKeeperWorkbook(buf) {
  const X = await loadXLSX();
  const wb = X.read(buf, { type: 'array', cellDates: true });
  const rows = [];
  let found = false;
  for (const name of wb.SheetNames) {
    const aoa = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    if (!aoa.some((r) => SAVE_KEYS.concat(GOAL_KEYS).includes(k(r[0])))) continue;
    found = true;
    rows.push(...parseKeeperSheet(aoa));
  }
  return found ? rows : null;
}
