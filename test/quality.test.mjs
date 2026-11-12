// Mejoras de uso: convocados por partido, copia de seguridad y comparación de datos
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './helpers.mjs';
import { squadPlayers } from '../public/js/stats.js';


test('convocados: se guardan al crear, se actualizan y vuelven en bootstrap y detalle', async () => {
  const s = await scenario();
  const boot = (await s.admin('GET', '/api/bootstrap')).data;
  const sync = await s.admin('POST', '/api/sync', { ops: [{ op: 'rival.create', id: s.newId('r'), name: 'Rival X' }] });
  assert.ok(sync.data.results[0].ok);
  const rival = (await s.admin('GET', '/api/bootstrap')).data.rivals[0].id;
  const p1 = s.newId('p'), p2 = s.newId('p'), m = s.newId('m');
  const res = await s.admin('POST', '/api/sync', { ops: [
    { op: 'player.create', id: p1, team_id: s.A.id, name: 'Ana', number: 1 },
    { op: 'player.create', id: p2, team_id: s.A.id, name: 'Eva', number: 2 },
    { op: 'match.create', id: m, team_id: s.A.id, rival_id: rival, date: '2026-11-07', squad: [p1, 'x'.repeat(200)] },
  ] });
  assert.ok(res.data.results.every((r) => r.ok), JSON.stringify(res.data));
  let b = (await s.admin('GET', '/api/bootstrap')).data;
  assert.deepEqual(b.matches.find((x) => x.id === m).squad, [p1]);
  assert.deepEqual((await s.admin('GET', `/api/matches/${m}`)).data.match.squad, [p1]);
  await s.admin('POST', '/api/sync', { ops: [{ op: 'match.update', id: m, fields: { squad: [p1, p2] } }] });
  assert.deepEqual((await s.admin('GET', `/api/matches/${m}`)).data.match.squad, [p1, p2]);
  // editar otra cosa no borra los convocados
  await s.admin('POST', '/api/sync', { ops: [{ op: 'match.update', id: m, fields: { date: '2026-11-08' } }] });
  assert.deepEqual((await s.admin('GET', `/api/matches/${m}`)).data.match.squad, [p1, p2]);
  // lista vacía = toda la plantilla
  await s.admin('POST', '/api/sync', { ops: [{ op: 'match.update', id: m, fields: { squad: null } }] });
  assert.equal((await s.admin('GET', `/api/matches/${m}`)).data.match.squad, null);
});

test('squadPlayers: filtra por convocados y, si no hay, devuelve toda la plantilla', () => {
  const all = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(squadPlayers(all, ['b']).map((p) => p.id), ['b']);
  assert.deepEqual(squadPlayers(all, null).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(squadPlayers(all, ['zz']).map((p) => p.id), ['a', 'b']); // convocados que ya no existen
});

test('copia de seguridad: solo administración, incluye los datos y recuerda la fecha', async () => {
  const s = await scenario();
  assert.equal((await s.onlyA('GET', '/api/backup')).status, 403);
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.last_backup, null);
  const r = await s.admin('GET', '/api/backup');
  assert.equal(r.status, 200);
  assert.equal(r.data.app, 'urdaibai-stats');
  for (const k of ['teams', 'players', 'seasons', 'matches', 'events', 'adjustments']) assert.ok(Array.isArray(r.data[k]), k);
  assert.ok(r.data.teams.length >= 2);
  assert.ok(!JSON.stringify(r.data).includes('pass_hash'));
  const boot = (await s.admin('GET', '/api/bootstrap')).data;
  assert.equal(boot.last_backup, r.data.created_at);
  assert.equal((await s.onlyA('GET', '/api/bootstrap')).data.last_backup, undefined); // los demás usuarios no lo ven
});
