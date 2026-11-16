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
