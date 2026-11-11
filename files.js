// Lectura de CSV/Excel y descarga de plantillas y exportaciones (SheetJS se carga solo cuando hace falta).
import { normName } from './names.js';

let xlsxPromise;
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('xlsx_load'));
    document.head.append(s);
  });
  return xlsxPromise;
}

// Cabeceras conocidas: sirven para encontrar la fila de títulos aunque haya filas de cabecera extra (como en el Excel del club)
const KNOWN = new Set(['equipo', 'nombre', 'apellidos', 'dorsal', 'posicion', 'portero', 'fecha', 'rival', 'posesiones', 'perdidas', 'lanzamientos',
  'goles', 'golesencontra', 'lanzamientoscontrarios', 'paradas', 'evento', 'jugador', 'zona', 'parte', 'minuto', 'resultado', 'puntoporteria', 'partido',
  'team', 'name', 'surname', 'number', 'date', 'event', 'player', 'taldea', 'izena', 'abizenak', 'zenbakia', 'data']);
const keyOf = (s) => normName(s).replace(/[^a-z0-9]/g, '');

function pad2(n) { return String(n).padStart(2, '0'); }
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function aoaToObjects(aoa) {
  let best = 0, bestScore = 0;
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const score = aoa[i].filter((c) => KNOWN.has(keyOf(c))).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (bestScore < 2) throw Object.assign(new Error('no_headers'), { code: 'no_headers' });
  const headers = aoa[best].map((c) => String(c ?? '').trim());
  const rows = [];
  for (const r of aoa.slice(best + 1)) {
    const o = {};
    headers.forEach((hd, i) => {
      if (!hd) return;
      let v = r[i];
      if (v instanceof Date) v = isoOf(v);
      o[hd] = v ?? '';
    });
    rows.push(o);
  }
  return rows;
}

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

export async function readFileRows(file) {
  const buf = await file.arrayBuffer();
  if (/\.(csv|txt)$/i.test(file.name)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
    return aoaToObjects(parseCSV(text));
  }
  const X = await loadXLSX();
  const wb = X.read(buf, { type: 'array', cellDates: true });
  let lastErr;
  for (const name of wb.SheetNames) { // la primera hoja que tenga cabeceras reconocibles
    try { return aoaToObjects(X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no_headers');
}

const csvCell = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function save(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function downloadCsv(filename, aoa) {
  save(new Blob(['﻿' + aoa.map((r) => r.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

// sheets: [{ name, aoa, widths? }]
export async function downloadXlsx(filename, sheets) {
  const X = await loadXLSX();
  const wb = X.utils.book_new();
  for (const s of sheets) {
    const ws = X.utils.aoa_to_sheet(s.aoa);
    ws['!cols'] = (s.widths || s.aoa[0].map((c) => String(c).length + 4)).map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  save(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
