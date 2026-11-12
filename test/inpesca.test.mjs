import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { scenario } from './helpers.mjs';
import { parseInpescaWorkbook, inpescaRows, inpescaPlayerRows } from '../public/js/inpesca.js';

// Hoja mínima con el diseño del Excel de INPESCA
function workbook() {
  const ws = {};
  const set = (a, v, t) => { ws[a] = { v, t: t || (typeof v === 'number' ? 'n' : 's') }; };
  set('F6', 46299, 'n'); set('K6', 'BARAKALDO'); set('Q6', 'Liga'); set('AA6', 'X');
  // jugador 7: gol 1ªP, contragol 2ªP, pérdida pisando 1ªP, robo 2ªP, 2´ 1ªP
  set('C10', ' 7'); set('D10', ' IBON GUEZURAGA'); set('E10', 1); set('H10', 1); set('Q10', 1); set('X10', 1); set('AA10', 1);
  // portero 1: parada 1ªP, gol encajado 2ªP, penalti parado 1ªP, contrapase ok 2ªP
  set('C26', ' 1'); set('D26', ' URAITZ RASINES'); set('E26', 1); set('H26', 1); set('O26', 1); set('L26', 1);
  ws['!ref'] = 'A1:AF30';
  return { SheetNames: ['TOTALES', '1'], Sheets: { TOTALES: { '!ref': 'A1:A1' }, 1: ws } };
}

test('INPESCA: una hoja se convierte en eventos con el mismo significado que el Excel', () => {
  const [m] = parseInpescaWorkbook(workbook(), XLSX.SSF);
  assert.equal(m.rival, 'Barakaldo');
  assert.equal(m.away, true);
  assert.match(m.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual([m.gf, m.ga, m.events], [2, 1, 9]);
  const rows = inpescaRows(m, 'U. Inpesca', '2026-10-04');
  const has = (f) => rows.some((r) => Object.entries(f).every(([k, v]) => r[k] === v));
  assert.ok(has({ Evento: 'gol', Fase: 'contraataque', Parte: 2, Jugador: 7 }));
  assert.ok(has({ Evento: 'perdida', Detalle: 'pisando', Parte: 1 }));
  assert.ok(has({ Evento: 'recuperacion', Detalle: 'robo', Parte: 2 }));
  assert.ok(has({ Evento: 'amonestacion', Detalle: '2', Parte: 1 }));
  assert.ok(has({ Evento: 'parada', Fase: 'penalti', Zona: '7M', Portero: 1 }));
  assert.ok(has({ Evento: 'contrapase', Detalle: 'ok', Parte: 2 }));
  assert.equal(inpescaPlayerRows(m.people, 'U. Inpesca').find((p) => p.Dorsal === 1).Portero, 'sí');
});

test('INPESCA importación: crea el partido (fuera), avisa de duplicado con el marcador guardado y de fechas parecidas', async () => {
  const s = await scenario();
  const [m] = parseInpescaWorkbook(workbook(), XLSX.SSF);
  const P = '/api/import/players', M = '/api/import/matches';
  await s.admin('POST', P, { rows: inpescaPlayerRows(m.people, 'Juvenil Masculino'), dry_run: false });
  const rows = inpescaRows(m, 'Juvenil Masculino', '2026-10-04');
  const first = (await s.admin('POST', M, { kind: 'advanced', rows, dry_run: true })).data;
  assert.equal(first.matches[0].duplicate, false);
  await s.admin('POST', M, { kind: 'advanced', rows, dry_run: false });
  const boot = (await s.admin('GET', '/api/bootstrap')).data;
  assert.equal(boot.matches[0].home_away, 'away');
  // mismo partido otra vez → duplicado con el marcador ya guardado, y sin reemplazo no se guarda nada
  const again = (await s.admin('POST', M, { kind: 'advanced', rows, dry_run: true })).data;
  assert.equal(again.matches[0].duplicate, true);
  assert.deepEqual(again.matches[0].existing_score, { goals: 2, goals_against: 1, events: 9 });
  assert.equal((await s.admin('POST', M, { kind: 'advanced', rows, dry_run: false })).data.blocked, 'duplicates');
  // mismo rival, fecha a 3 días → «parecido»
  const near = (await s.admin('POST', M, { kind: 'advanced', rows: inpescaRows(m, 'Juvenil Masculino', '2026-10-07'), dry_run: true })).data;
  assert.equal(near.matches[0].duplicate, false);
  assert.deepEqual(near.matches[0].similar, ['2026-10-04']);
  // reemplazar: el anterior va a la papelera (queda 1 partido activo)
  await s.admin('POST', M, { kind: 'advanced', rows, dry_run: false, on_duplicate: 'replace' });
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.matches.length, 1);
});
