// Detalle de portería: no se suma a los totales del partido; avisa (cliente) si te pasas
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './helpers.mjs';
import { totalCounters, keeperCoverage, goalkeeperStats, cellStats, validateEvent } from '../public/js/stats.js';

const ev = (o) => ({ id: Math.random().toString(36), deleted_at: null, detail_only: 0, ...o });

test('detail_only no suma a los contadores pero sí cuenta para portero y mapa de portería', () => {
  const adj = [{ stat: 'saves', delta: 12 }, { stat: 'goals_against', delta: 20 }, { stat: 'shots_against', delta: 32 }];
  const events = [ev({ type: 'save', goalkeeper_id: 'k1', goal_cell: 1, detail_only: 1 }), ev({ type: 'goal_against', goalkeeper_id: 'k1', goal_cell: 5, detail_only: 1 })];
  const c = totalCounters(events, adj);
  assert.equal(c.saves, 12); assert.equal(c.goals_against, 20); assert.equal(c.shots_against, 32);
  assert.equal(goalkeeperStats(events).find((k) => k.player_id === 'k1').saves, 1);
  assert.equal(cellStats(events).against[1].saves, 1);
  assert.equal(cellStats(events).against[5].goals_against, 1);
});

test('keeperCoverage: cuánto queda por repartir y si el partido trae totales', () => {
  const adj = [{ stat: 'saves', delta: 3 }];
  let events = [];
  assert.deepEqual({ free: keeperCoverage(events, adj, 'save').free, base: keeperCoverage(events, adj, 'save').hasBase }, { free: 3, base: true });
  events = [ev({ type: 'save', goalkeeper_id: 'k', goal_cell: 2, detail_only: 1 }), ev({ type: 'save', goalkeeper_id: 'k', goal_cell: 3, detail_only: 1 }), ev({ type: 'save', goalkeeper_id: 'k', goal_cell: 4, detail_only: 1 })];
  const c = keeperCoverage(events, adj, 'save');
  assert.equal(c.free, 0); assert.equal(c.total, 3); assert.equal(c.detail, 3); assert.equal(c.withCell, 3);
  // una parada de la vista simple (sin portero) se puede completar sin duplicar
  const withPending = [ev({ type: 'save' })];
  const p = keeperCoverage(withPending, [], 'save');
  assert.equal(p.pending, 1); assert.equal(p.total, 1); assert.equal(p.hasBase, false);
});

test('validación: detail_only solo en paradas y goles en contra', () => {
  assert.equal(validateEvent({ type: 'save', detail_only: 1, goal_cell: 1 }), null);
  assert.equal(validateEvent({ type: 'goal', detail_only: 1 }), 'detail_only');
});

test('API: guardar detalle no cambia el marcador; al cambiar de tipo deja de ser «solo detalle»', async () => {
  const s = await scenario();
  const sync = async (ops) => (await s.admin('POST', '/api/sync', { ops })).data.results;
  await sync([{ op: 'rival.create', id: s.newId('r'), name: 'Rival' }]);
  const rival = (await s.admin('GET', '/api/bootstrap')).data.rivals[0].id;
  const k = s.newId('p'), m = s.newId('m'), e1 = s.newId('ev'), e2 = s.newId('ev');
  const r = await sync([
    { op: 'player.create', id: k, team_id: s.A.id, name: 'Malen', number: 1, is_goalkeeper: true },
    { op: 'match.create', id: m, team_id: s.A.id, rival_id: rival, date: '2026-11-07' },
    { op: 'adj.set', match_id: m, stat: 'saves', delta: 5 }, { op: 'adj.set', match_id: m, stat: 'shots_against', delta: 5 },
    { op: 'event.create', id: e1, match_id: m, type: 'save', goalkeeper_id: k, goal_cell: 3, detail_only: 1 },
    { op: 'event.create', id: e2, match_id: m, type: 'save', goalkeeper_id: k, goal_cell: 4, detail_only: 1 },
  ]);
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  const boot = (await s.admin('GET', '/api/bootstrap')).data;
  assert.equal(boot.matches.find((x) => x.id === m).counters.saves, 5); // listado de partidos: sigue en 5
  const det = (await s.admin('GET', `/api/matches/${m}`)).data;
  assert.equal(det.events.filter((e) => e.detail_only).length, 2);
  assert.equal(totalCounters(det.events, det.adjustments).saves, 5);
  // un evento que no es parada/gol en contra no puede ser «solo detalle»
  const bad = await sync([{ op: 'event.create', id: s.newId('ev'), match_id: m, type: 'goal', detail_only: 1 }]);
  assert.equal(bad[0].ok, false);
  // cambiar tipo a «parada de portero fuera» quita la marca
  await sync([{ op: 'event.update', id: e1, match_id: m, fields: { type: 'shot_against_miss', result: 'out', goal_cell: null } }]);
  const det2 = (await s.admin('GET', `/api/matches/${m}`)).data;
  assert.equal(det2.events.find((e) => e.id === e1).detail_only, 0);
  assert.equal(totalCounters(det2.events, det2.adjustments).saves, 5);
});

test('Importar detalle de portería: no duplica totales, completa pendientes, avisa del exceso', async () => {
  const s = await scenario();
  const sync = async (ops) => (await s.admin('POST', '/api/sync', { ops })).data.results;
  await sync([{ op: 'rival.create', id: s.newId('r'), name: 'Loyola' }]);
  const rival = (await s.admin('GET', '/api/bootstrap')).data.rivals[0].id;
  const k = s.newId('p'), m = s.newId('m');
  await sync([
    { op: 'player.create', id: k, team_id: s.A.id, name: 'Malen', surname: 'Etxe', number: 1, is_goalkeeper: true },
    { op: 'match.create', id: m, team_id: s.A.id, rival_id: rival, date: '2026-11-07' },
    { op: 'adj.set', match_id: m, stat: 'saves', delta: 2 }, { op: 'adj.set', match_id: m, stat: 'goals_against', delta: 2 },
    { op: 'adj.set', match_id: m, stat: 'shots_against', delta: 5 },
    { op: 'event.create', id: s.newId('ev'), match_id: m, type: 'save' }, // pendiente (sin portero)
  ]);
  const base = { Equipo: s.A.name, Fecha: '2026-11-07', Rival: 'Loyola', Portero: '1' };
  const rows = [
    { ...base, Tipo: 'Parada', Zona: '9C', 'Punto portería': 5, Cantidad: 2 },
    { ...base, Tipo: 'Parada', Zona: '7M', 'Punto portería': 1, Cantidad: 2 }, // 1 sobra
    { ...base, Tipo: 'Gol', Zona: 'EI', 'Punto portería': 9, Cantidad: 1 },
  ];
  const dry = (await s.admin('POST', '/api/import/keeper-detail', { rows, dry_run: true })).data;
  assert.equal(dry.errors.length, 0, JSON.stringify(dry.errors));
  assert.equal(dry.has_excess, true);
  assert.equal(dry.matches[0].types.save.over, 1);
  const go = (await s.admin('POST', '/api/import/keeper-detail', { rows, dry_run: false })).data;
  assert.equal(go.committed, true);
  const det = (await s.admin('GET', `/api/matches/${m}`)).data;
  const c = totalCounters(det.events, det.adjustments);
  assert.equal(c.saves, 3); assert.equal(c.goals_against, 2); // totales intactos
  const saves = det.events.filter((e) => e.type === 'save');
  assert.equal(saves.length, 3);
  assert.ok(saves.every((e) => e.goalkeeper_id === k));
  assert.equal(saves.filter((e) => e.phase === 'penalti').length, 1);
  assert.equal(det.events.filter((e) => e.detail_only).length, 3 - 1 + 1); // 2 paradas detalle + 1 gol
  // partido inexistente → error claro
  const bad = (await s.admin('POST', '/api/import/keeper-detail', { rows: [{ ...base, Rival: 'Nadie', Tipo: 'Parada', Zona: '9C', Cantidad: 1 }] })).data;
  assert.equal(bad.errors[0].error, 'match_not_found');
});

test('Plantilla en cuadrícula: zona × cuadrado quedan asociados al convertir a filas', async () => {
  const { parseKeeperSheet, keeperTemplate } = await import('../public/js/keeper-grid.js');
  const sheet = keeperTemplate('Urdaibai')[0].aoa;
  const rows = parseKeeperSheet(sheet);
  assert.deepEqual(rows.map((r) => [r.Tipo, r.Zona, r['Punto portería'], r.Cantidad]), [['Parada', '7M', 1, 1], ['Parada', '9C', 5, 2], ['Gol', 'EI', 9, 1]]);
  assert.equal(rows[0].Equipo, 'Urdaibai'); assert.equal(rows[0].Portero, 1); assert.equal(rows[0].Rival, 'Rival de ejemplo');
});

test('Mapa enlazado: al elegir zona los cuadrados filtran, y al elegir cuadrado las zonas filtran', async () => {
  const { keeperAgg, effClass } = await import('../public/js/stats.js');
  const e = (type, zone, goal_cell, extra = {}) => ({ type, zone, goal_cell, deleted_at: null, goalkeeper_id: 'k', ...extra });
  const evs = [e('save', '9C', 5), e('save', '9C', 5), e('goal_against', '9C', 5), e('goal_against', 'EI', 1), e('save', '6C', 5, { detail_only: 1 }), e('save', '9C', 5, { goalkeeper_id: 'otro' })];
  const mine = (x) => x.goalkeeper_id === 'k';
  const all = keeperAgg(evs, mine);
  assert.deepEqual(all.cells[5], { s: 3, g: 1 }); assert.deepEqual(all.tot, { s: 3, g: 2 });
  const z = keeperAgg(evs, mine, { zone: '9C' });
  assert.deepEqual(z.cells[5], { s: 2, g: 1 }); assert.deepEqual(z.cells[1], { s: 0, g: 0 });
  const c = keeperAgg(evs, mine, { cell: 5 });
  assert.deepEqual(c.zones['6C'], { s: 1, g: 0 }); assert.deepEqual(c.zones.EI, { s: 0, g: 0 });
  assert.equal(effClass({ s: 3, g: 1 }), 'good'); assert.equal(effClass({ s: 0, g: 2 }), 'bad'); assert.equal(effClass({ s: 0, g: 0 }), '');
});

test('Mapa enlazado: con cuadrado y zona a la vez, manda el último que se tocó', async () => {
  const { keeperAgg } = await import('../public/js/stats.js');
  const e = (type, zone, goal_cell) => ({ type, zone, goal_cell, deleted_at: null });
  const evs = [e('save', '9C', 6), e('goal_against', '6C', 6), e('save', '7M', 1)];
  const m = () => true;
  const byCell = keeperAgg(evs, m, { cell: 6, zone: '7M', focus: 'cell' }); // el cuadrado 6 manda: las zonas enseñan sus datos y el cuadrado no queda vacío
  assert.deepEqual(byCell.zones['9C'], { s: 1, g: 0 }); assert.deepEqual(byCell.cells[6], { s: 1, g: 1 }); assert.deepEqual(byCell.tot, { s: 1, g: 1 });
  const byZone = keeperAgg(evs, m, { cell: 6, zone: '7M', focus: 'zone' });
  assert.deepEqual(byZone.cells[1], { s: 1, g: 0 }); assert.deepEqual(byZone.zones['9C'], { s: 1, g: 0 });
});

test('Cronómetro: para en 30:00 y 60:00, se amplía con prórrogas, se puede parar/reanudar y sella minuto y parte', async () => {
  const { createClock, limitFor } = await import('../public/js/clock.js');
  let t0 = 1_000_000; const mem = {}; const store = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  const c = createClock('m1', store, () => t0);
  assert.equal(c.stamp(), null); assert.equal(c.nextStep(), 'start');
  c.start(); t0 += 125_000; // 2:05
  assert.deepEqual(c.stamp(), { part: 1, minute: 2 });
  c.pause(); t0 += 600_000; assert.equal(Math.round(c.elapsed()), 125); // parado: no avanza
  c.start(); t0 += 1_700_000; // pasa de 30:00
  assert.equal(c.tick(), 1800); assert.equal(c.running(), false); assert.equal(Math.round(c.elapsed()), 1800); assert.equal(c.nextStep(), 'half2');
  c.start(); t0 += 100_000; assert.deepEqual(c.stamp(), { part: 2, minute: 31 });
  c.set(3599); c.pause(); c.start(); t0 += 5_000; assert.equal(c.tick(), 3600); assert.equal(c.nextStep(), 'ot');
  c.start(); t0 += 400_000; assert.equal(c.tick(), 3900); // prórroga de 5 minutos
  assert.equal(limitFor(3900), 4200);
  // sobrevive a una recarga
  const c2 = createClock('m1', store, () => t0); assert.equal(Math.round(c2.elapsed()), 3900);
});
