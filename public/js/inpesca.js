// Lectura de las hojas del Excel de estadísticas individualizadas del club (INPESCA): una hoja = un partido.
// Funciona con la hoja de SheetJS (se usa en el navegador y en las pruebas). No guarda nada: solo convierte a filas de «Estadísticas avanzadas».
//
// Diseño de la hoja: F6 fecha · K6 rival · Q6 tipo de partido · AA6 «X» si es visitante
//  filas 10-22: jugadores (C dorsal, D nombre) con parejas (1ª parte, 2ª parte) por categoría
//  filas 26-28: porteros (C dorsal, D nombre)

const letter = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const colIdx = (L) => L.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const cell = (ws, addr) => { const c = ws[addr]; return c && c.t !== 'e' ? c : null; };
const text = (ws, addr) => { const c = cell(ws, addr); return c && c.v != null ? String(c.v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : ''; };
const num = (ws, L, r, off = 0) => {
  const c = cell(ws, letter(colIdx(L) + off) + r);
  if (!c) return 0;
  const n = Number(c.v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const pair = (ws, L, r) => [num(ws, L, r, 0), num(ws, L, r, 1)];

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s.])(\S)/g, (m, a, b) => a + b.toUpperCase());
const pad = (n) => String(n).padStart(2, '0');

// Fecha de la hoja → 'AAAA-MM-DD' (o null si no se entiende)
export function sheetDate(ws, SSF, addr = 'F6') {
  const c = cell(ws, addr);
  if (!c) return null;
  if (typeof c.v === 'number' && SSF) {
    const d = SSF.parse_date_code(c.v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  if (c.v instanceof Date) return `${c.v.getFullYear()}-${pad(c.v.getMonth() + 1)}-${pad(c.v.getDate())}`;
  const s = String(c.v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

const PLAYER_COLS = { gol: 'E', cgol: 'G', fuera: 'I', parada: 'K', cfallo: 'M', pases: 'O', pisando: 'Q', fataque: 'S', pasos: 'U', robos: 'W', chapas: 'Y', dos: 'AA' };
const GK_COLS = { paradas: 'E', goles: 'G', fuera: 'I', cp_ok: 'K', cp_fallo: 'M', pen_par: 'O', pen_gol: 'Q', pen_fuera: 'S' };

// Valor que hay a la derecha de un rótulo («Fecha», «Adversario:», «Visitante:»…) en las primeras filas.
// Así se leen también las plantillas con las columnas desplazadas.
function afterLabel(ws, re, maxGap = 6) {
  for (let r = 1; r <= 8; r++) for (let c = 0; c < 30; c++) {
    if (!re.test(text(ws, letter(c) + r))) continue;
    for (let k = 1; k <= maxGap; k++) { const a = letter(c + k) + r; if (text(ws, a) && !/:\s*$/.test(text(ws, a))) return a; }
  }
  return null;
}

// Filas de jugadores y de porteros: se buscan por el rótulo «NOMBRE DEL JUGADOR/A» (hay plantillas con más filas);
// si no se encuentra, las posiciones clásicas (10-22 y 26-28)
function sectionRows(ws) {
  const heads = []; let sh = 0;
  for (let r = 1; r <= 80; r++) for (const L of ['B', 'C']) if (/^NOMBRE DEL/i.test(text(ws, `${L}${r}`))) { heads.push(r); sh = colIdx(L) - 2; }
  if (heads.length < 2) return { players: [10, 22], keepers: [26, 28], sh: 0 };
  return { players: [heads[0] + 2, heads[1] - 2], keepers: [heads[1] + 2, heads[1] + 8], sh };
}

function readPeople(ws, r1, r2, cols, sh = 0) {
  const out = [];
  const at = (L) => letter(colIdx(L) + sh);
  for (let r = r1; r <= r2; r++) {
    const num0 = parseInt(text(ws, `${at('C')}${r}`), 10), name = text(ws, `${at('D')}${r}`);
    if (!Number.isInteger(num0) || num0 <= 0 || !name || name === '0') continue; // filas vacías con fórmula (0)
    const row = { num: num0, name };
    for (const [k, L] of Object.entries(cols)) row[k] = pair(ws, at(L), r);
    out.push(row);
  }
  return out;
}

// Una hoja → partido (o null si no es una hoja de partido)
export function parseInpescaSheet(ws, sheetName, SSF) {
  const sec = sectionRows(ws);
  const rivalAddr = sec.sh ? afterLabel(ws, /^Adversari/i) : 'K6';
  const rival = rivalAddr ? text(ws, rivalAddr) : '';
  if (!rival) return null;
  const players = readPeople(ws, ...sec.players, PLAYER_COLS, sec.sh);
  const keepers = readPeople(ws, ...sec.keepers, GK_COLS, sec.sh);
  const dateAddr = sec.sh ? afterLabel(ws, /^Fecha/i) : 'F6', awayAddr = sec.sh ? afterLabel(ws, /^Visitante/i, 3) : 'AA6';
  const m = { sheet: sheetName, date: sheetDate(ws, SSF, dateAddr || 'F6'), rival: titleCase(rival), kind: sec.sh ? (afterLabel(ws, /^Partido/i, 3) ? text(ws, afterLabel(ws, /^Partido/i, 3)) : '') : text(ws, 'Q6'), away: !!(awayAddr && text(ws, awayAddr)), players, keepers };
  m.people = [...new Map([...players, ...keepers].map((p) => [p.num, p])).values()].map((p) => {
    const parts = p.name.split(' ');
    return { num: p.num, name: titleCase(parts[0]), surname: titleCase(parts.slice(1).join(' ')), gk: keepers.some((k) => k.num === p.num) };
  }).sort((a, b) => a.num - b.num);
  // marcador (suma de eventos): goles a favor y en contra
  const rows = toEvents(m);
  m.events = rows.length;
  m.gf = rows.filter((e) => e.Evento === 'gol').length;
  m.ga = rows.filter((e) => e.Evento === 'gol_en_contra').length;
  return m;
}

export function parseInpescaWorkbook(wb, SSF) {
  return wb.SheetNames.filter((n) => n.trim().toUpperCase() !== 'TOTALES')
    .map((n) => parseInpescaSheet(wb.Sheets[n], n, SSF)).filter(Boolean);
}

// Eventos del partido en el formato de «Estadísticas avanzadas» (sin equipo ni fecha)
function toEvents(m) {
  const rows = [];
  const add = (part, Evento, f = {}) => rows.push({ Parte: part, Evento, ...f });
  for (const p of m.players) {
    for (const part of [0, 1]) {
      const P = part + 1, J = p.num;
      const rep = (k, evento, f) => { for (let i = 0; i < p[k][part]; i++) add(P, evento, { Jugador: J, ...f }); };
      rep('gol', 'gol');
      rep('cgol', 'gol', { Fase: 'contraataque' });
      rep('fuera', 'lanzamiento_fallado', { Resultado: 'fuera' });
      rep('parada', 'lanzamiento_fallado', { Resultado: 'parada' });
      rep('cfallo', 'lanzamiento_fallado', { Fase: 'contraataque' });
      rep('pases', 'perdida', { Detalle: 'pase' });
      rep('pisando', 'perdida', { Detalle: 'pisando' });
      rep('fataque', 'perdida', { Detalle: 'falta_ataque' });
      rep('pasos', 'perdida', { Detalle: 'pasos' });
      rep('robos', 'recuperacion', { Detalle: 'robo' });
      rep('chapas', 'recuperacion', { Detalle: 'chapa' });
      rep('dos', 'amonestacion', { Detalle: '2' });
    }
  }
  for (const k of m.keepers) {
    for (const part of [0, 1]) {
      const P = part + 1, G = k.num;
      const rep = (key, evento, f) => { for (let i = 0; i < k[key][part]; i++) add(P, evento, { Portero: G, ...f }); };
      rep('paradas', 'parada');
      rep('goles', 'gol_en_contra');
      rep('fuera', 'lanzamiento_contrario_fallado', { Resultado: 'fuera' });
      rep('pen_par', 'parada', { Zona: '7M', Fase: 'penalti' });
      rep('pen_gol', 'gol_en_contra', { Zona: '7M', Fase: 'penalti' });
      rep('pen_fuera', 'lanzamiento_contrario_fallado', { Zona: '7M', Resultado: 'fuera', Fase: 'penalti' });
      rep('cp_ok', 'contrapase', { Detalle: 'ok' });
      rep('cp_fallo', 'contrapase', { Detalle: 'fallo' });
    }
  }
  return rows;
}

// Filas listas para /api/import/matches (kind advanced)
export function inpescaRows(m, team, date) {
  return toEvents(m).map((e) => ({ Equipo: team, Fecha: date, Rival: m.rival, 'Condición': m.away ? 'fuera' : 'casa', ...e }));
}

// Filas listas para /api/import/players
export function inpescaPlayerRows(people, team) {
  return people.map((p) => ({ Equipo: team, Nombre: p.name, Apellidos: p.surname, Dorsal: p.num, Posición: p.gk ? 'Portero' : '', Portero: p.gk ? 'sí' : 'no' }));
}
