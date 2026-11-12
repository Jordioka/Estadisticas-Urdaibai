import test from 'node:test';
import assert from 'node:assert/strict';
import { scenario, makeApp } from './helpers.mjs';
import { totalCounters, sumCounters, isPending } from '../public/js/stats.js';

// ---------- helpers de escenario ----------
async function withMatch(s, client, team, date = '2026-11-08') {
  const rival = s.newId('rival');
  const match = s.newId('match');
  const r = await client.sync(
    { op: 'rival.create', id: rival, name: 'Gernika ' + rival.slice(-4) },
    { op: 'match.create', id: match, team_id: team.id, rival_id: rival, date, home_away: 'home' }
  );
  assert.ok(r.results.every((x) => x.ok), JSON.stringify(r));
  return { rival, match };
}
const detail = async (c, id) => (await c('GET', `/api/matches/${id}`)).data;
const counters = async (c, id) => { const d = await detail(c, id); return totalCounters(d.events, d.adjustments); };

test('login correcto, incorrecto y bloqueo tras 5 fallos', async () => {
  const s = await scenario();
  const c = s.client();
  assert.equal((await c.login('admin', 'mala')).status, 401);
  assert.equal((await c('GET', '/api/bootstrap')).status, 401);
  for (let i = 0; i < 4; i++) await c.login('admin', 'mala');
  assert.equal((await c.login('admin', 'admin123')).status, 429); // bloqueado temporalmente
});

test('no hay registro libre y solo el administrador gestiona usuarios', async () => {
  const s = await scenario();
  assert.equal((await s.onlyA('POST', '/api/users', { username: 'x1', password: 'secret1' })).status, 403);
  assert.equal((await s.onlyA('GET', '/api/users')).status, 403);
  assert.equal((await s.onlyA('POST', '/api/teams', { name: 'Otro' })).status, 403);
  assert.equal((await s.client()('POST', '/api/users', { username: 'x1', password: 'secret1' })).status, 401);
});

test('PERMISOS: cada usuario solo ve y anota sus equipos', async () => {
  const s = await scenario();
  const mA = await withMatch(s, s.admin, s.A);
  const mB = await withMatch(s, s.admin, s.B);
  const pA = s.newId('pl'), pB = s.newId('pl');
  await s.admin.sync({ op: 'player.create', id: pA, team_id: s.A.id, name: 'Aitor', number: 7 }, { op: 'player.create', id: pB, team_id: s.B.id, name: 'Maite', number: 5 });

  // bootstrap: solo sus equipos, partidos y jugadores
  const boot = (await s.onlyA('GET', '/api/bootstrap')).data;
  assert.deepEqual(boot.teams.map((t) => t.id), [s.A.id]);
  assert.deepEqual(boot.matches.map((m) => m.id), [mA.match]);
  assert.deepEqual(boot.players.map((p) => p.id), [pA]);
  const bootBoth = (await s.both('GET', '/api/bootstrap')).data;
  assert.equal(bootBoth.teams.length, 2);
  assert.equal((await s.all('GET', '/api/bootstrap')).data.teams.length, 2);

  // acceso directo a la API sobre el equipo B → rechazado
  assert.equal((await s.onlyA('GET', `/api/matches/${mB.match}`)).status, 403);
  assert.equal((await s.onlyA('GET', `/api/reports?team_id=${s.B.id}`)).status, 403);
  const forbidden = await s.onlyA.sync(
    { op: 'event.create', id: s.newId('ev'), match_id: mB.match, type: 'goal' },
    { op: 'match.create', id: s.newId('m'), team_id: s.B.id, rival_id: mB.rival, date: '2026-11-09' },
    { op: 'player.create', id: s.newId('pl'), team_id: s.B.id, name: 'Intruso' },
    { op: 'match.delete', id: mB.match },
    { op: 'adj.set', match_id: mB.match, stat: 'goals', delta: 5 }
  );
  assert.ok(forbidden.results.every((r) => !r.ok && r.error.startsWith('forbidden')), JSON.stringify(forbidden));
  assert.equal((await counters(s.admin, mB.match)).goals, 0);

  // importar jugadores de otro equipo → rechazado fila a fila
  const imp = (await s.onlyA('POST', '/api/import/players', { rows: [{ Equipo: 'Cadete Femenino', Nombre: 'Ana', Dorsal: 9 }], dry_run: true })).data;
  assert.equal(imp.errors[0].error, 'team_forbidden');
  const impA = (await s.onlyA('POST', '/api/import/players', { rows: [{ Equipo: 'Juvenil Masculino', Nombre: 'Ana', Dorsal: 9 }], dry_run: true })).data;
  assert.equal(impA.create.length, 1);

  // el que tiene ambos equipos sí puede
  assert.equal((await s.both('GET', `/api/matches/${mB.match}`)).status, 200);
});

test('un usuario con un solo equipo no necesita escribir el equipo al importar', async () => {
  const s = await scenario();
  const r = (await s.onlyA('POST', '/api/import/players', { rows: [{ Nombre: 'Aitor', Dorsal: 7 }], dry_run: false })).data;
  assert.equal(r.committed, true);
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.players.length, 1);
});

test('DUPLICADOS: reenviar el mismo evento/partido/jugador no duplica nada', async () => {
  const s = await scenario();
  const { match } = await withMatch(s, s.onlyA, s.A);
  const id = s.newId('ev');
  const op = { op: 'event.create', id, match_id: match, type: 'goal', ts: new Date().toISOString() };
  await s.onlyA.sync(op, op, op); // doble toque / reintento de sincronización
  assert.equal((await detail(s.onlyA, match)).events.length, 1);
  assert.deepEqual(await counters(s.onlyA, match), { possessions: 1, losses: 0, shots: 1, goals: 1, goals_against: 0, shots_against: 0, saves: 0 });
  // borrar y reintentar la creación no resucita el evento
  await s.onlyA.sync({ op: 'event.delete', id });
  await s.onlyA.sync(op);
  assert.equal((await counters(s.onlyA, match)).goals, 0);
  // mismo id de partido reenviado
  const m2 = s.newId('match');
  const mop = { op: 'match.create', id: m2, team_id: s.A.id, rival_id: (await s.onlyA('GET', '/api/bootstrap')).data.rivals[0].id, date: '2026-11-15' };
  await s.onlyA.sync(mop, mop);
  assert.equal((await s.onlyA('GET', '/api/bootstrap')).data.matches.length, 2);
  // mismo id de jugador reenviado
  const pid = s.newId('pl');
  const pop = { op: 'player.create', id: pid, team_id: s.A.id, name: 'Unai', number: 3 };
  const r = await s.onlyA.sync(pop, pop);
  assert.ok(r.results.every((x) => x.ok));
  assert.equal((await s.onlyA('GET', '/api/bootstrap')).data.players.length, 1);
});

test('MEZCLA simple + avanzado: un hecho se cuenta una sola vez y completar un pendiente no duplica', async () => {
  const s = await scenario();
  const { match } = await withMatch(s, s.onlyA, s.A);
  const gk = s.newId('pl'), pl = s.newId('pl');
  await s.onlyA.sync({ op: 'player.create', id: gk, team_id: s.A.id, name: 'Portero', number: 1, is_goalkeeper: true },
    { op: 'player.create', id: pl, team_id: s.A.id, name: 'Extremo', number: 11 });
  const g1 = s.newId('ev'), g2 = s.newId('ev');
  await s.onlyA.sync(
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'possession' },
    { op: 'event.create', id: g1, match_id: match, type: 'goal' },                   // vista simple
    { op: 'event.create', id: g2, match_id: match, type: 'goal', zone: 'EI', goal_cell: 1, player_id: pl }, // vista avanzada
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'save' },        // simple
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'goal_against', zone: '9C', goal_cell: 5, goalkeeper_id: gk }
  );
  let d = await detail(s.onlyA, match);
  assert.equal(d.events.filter(isPending).length, 2); // el gol simple y la parada
  const before = await counters(s.onlyA, match);
  assert.deepEqual(before, { possessions: 2, losses: 0, shots: 2, goals: 2, goals_against: 1, shots_against: 2, saves: 1 });
  // completar el gol pendiente sobre el MISMO evento
  const r = await s.onlyA.sync({ op: 'event.update', id: g1, fields: { zone: '6M', goal_cell: 8, player_id: pl } });
  assert.ok(r.results[0].ok);
  assert.deepEqual(await counters(s.onlyA, match), before); // mismos totales
  d = await detail(s.onlyA, match);
  assert.equal(d.events.filter(isPending).length, 1);
});

test('validaciones: eventos incoherentes, jugador de otro equipo y celdas imposibles se rechazan', async () => {
  const s = await scenario();
  const { match } = await withMatch(s, s.both, s.A);
  const pB = s.newId('pl');
  await s.both.sync({ op: 'player.create', id: pB, team_id: s.B.id, name: 'De B', number: 2 });
  const r = await s.both.sync(
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'goal', player_id: pB },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'loss', zone: 'EI' },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'goal', goal_cell: 12 },
    { op: 'event.create', id: 'x', match_id: match, type: 'goal' },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'inventado' }
  );
  assert.ok(r.results.every((x) => !x.ok), JSON.stringify(r));
  assert.equal((await detail(s.both, match)).events.length, 0);
});

test('dorsal repetido en el mismo equipo se rechaza; en otro equipo vale', async () => {
  const s = await scenario();
  const r = await s.both.sync(
    { op: 'player.create', id: s.newId('pl'), team_id: s.A.id, name: 'Uno', number: 7 },
    { op: 'player.create', id: s.newId('pl'), team_id: s.A.id, name: 'Dos', number: 7 },
    { op: 'player.create', id: s.newId('pl'), team_id: s.B.id, name: 'Tres', number: 7 }
  );
  assert.deepEqual(r.results.map((x) => x.ok), [true, false, true]);
});

test('CORRECCIÓN fácil: deshacer, editar, cambiar tipo y ajustar totales', async () => {
  const s = await scenario();
  const { match } = await withMatch(s, s.onlyA, s.A);
  const id = s.newId('ev');
  await s.onlyA.sync({ op: 'event.create', id, match_id: match, type: 'goal' });
  await s.onlyA.sync({ op: 'event.update', id, fields: { type: 'shot_miss', result: 'out' } }); // me equivoqué: era fallo
  let c = await counters(s.onlyA, match);
  assert.deepEqual([c.goals, c.shots], [0, 1]);
  // total tecleado: 52 posesiones (1 ya calculada del lanzamiento) → ajuste visible de +51
  await s.onlyA.sync({ op: 'adj.set', match_id: match, stat: 'possessions', delta: 51 });
  assert.equal((await counters(s.onlyA, match)).possessions, 52);
  assert.deepEqual((await detail(s.onlyA, match)).adjustments, [{ stat: 'possessions', delta: 51 }]);
  await s.onlyA.sync({ op: 'adj.set', match_id: match, stat: 'possessions', delta: 0 });
  assert.equal((await counters(s.onlyA, match)).possessions, 1);
  // deshacer
  await s.onlyA.sync({ op: 'event.delete', id });
  assert.equal((await counters(s.onlyA, match)).shots, 0);
});

test('papelera: borrar partido pide permiso, el administrador lo recupera y queda registro', async () => {
  const s = await scenario();
  const { match } = await withMatch(s, s.onlyA, s.A);
  await s.onlyA.sync({ op: 'event.create', id: s.newId('ev'), match_id: match, type: 'goal' });
  await s.onlyA.sync({ op: 'match.delete', id: match });
  assert.equal((await s.onlyA('GET', '/api/bootstrap')).data.matches.length, 0);
  assert.equal((await s.onlyA('GET', '/api/trash')).status, 403);
  const trash = (await s.admin('GET', '/api/trash')).data;
  assert.equal(trash.matches.length, 1);
  assert.equal((await s.onlyA('POST', '/api/trash/restore', { entity: 'match', id: match })).status, 403);
  assert.equal((await s.admin('POST', '/api/trash/restore', { entity: 'match', id: match })).status, 200);
  assert.equal((await counters(s.onlyA, match)).goals, 1);
  const log = (await s.admin('GET', '/api/audit')).data.log.map((l) => l.action);
  assert.ok(log.includes('match.delete') && log.includes('restore'));
});

test('temporada cerrada: los delegados no pueden modificar, el administrador sí', async () => {
  const s = await scenario();
  const { match } = await withMatch(s, s.onlyA, s.A, '2026-11-08');
  const seasons = (await s.admin('GET', '/api/bootstrap')).data.seasons;
  assert.equal(seasons[0].name, '2026-27');
  await s.admin('PATCH', `/api/seasons/${seasons[0].id}`, { closed: true });
  const r = await s.onlyA.sync({ op: 'event.create', id: s.newId('ev'), match_id: match, type: 'goal' });
  assert.equal(r.results[0].error, 'season_closed');
  const r2 = await s.admin.sync({ op: 'event.create', id: s.newId('ev'), match_id: match, type: 'goal' });
  assert.ok(r2.results[0].ok);
});

test('usuarios: desactivar cierra sesión; contraseña débil y duplicados se rechazan', async () => {
  const s = await scenario();
  assert.equal((await s.admin('POST', '/api/users', { username: 'nuevo', password: '123' })).status, 400);
  assert.equal((await s.admin('POST', '/api/users', { username: 'delegadoA', password: 'secret1' })).status, 409);
  const users = (await s.admin('GET', '/api/users')).data.users;
  const d = users.find((u) => u.username === 'delegadoA');
  assert.equal((await s.onlyA('GET', '/api/bootstrap')).status, 200);
  await s.admin('PATCH', `/api/users/${d.id}`, { active: false });
  assert.equal((await s.onlyA('GET', '/api/bootstrap')).status, 401);
  // cambiar los equipos de un usuario se aplica al instante
  const e = users.find((u) => u.username === 'entrenador');
  await s.admin('PATCH', `/api/users/${e.id}`, { team_ids: [s.B.id] });
  assert.deepEqual((await s.both('GET', '/api/bootstrap')).data.teams.map((t) => t.id), [s.B.id]);
  assert.equal((await s.admin('PATCH', `/api/users/${(users.find((u) => u.username === 'admin')).id}`, { active: false })).status, 400);
});

test('CSRF: peticiones de otro origen se rechazan', async () => {
  const s = await scenario();
  const r = await s.admin('POST', '/api/sync', { ops: [] }, { origin: 'https://malo.example' });
  assert.equal(r.status, 403);
});

test('los umbrales los edita el administrador y se validan', async () => {
  const s = await scenario();
  const t = (await s.admin('GET', '/api/bootstrap')).data.thresholds;
  assert.equal(t.save_pct.green_gt, 0.3);
  assert.equal((await s.onlyA('PUT', '/api/settings/thresholds', t)).status, 403);
  assert.equal((await s.admin('PUT', '/api/settings/thresholds', { ...t, save_pct: { green_gt: 0.2, orange_gte: 0.3 } })).status, 400);
  assert.equal((await s.admin('PUT', '/api/settings/thresholds', { ...t, save_pct: { green_gt: 0.35, orange_gte: 0.28 } })).status, 200);
  assert.equal((await s.onlyA('GET', '/api/bootstrap')).data.thresholds.save_pct.green_gt, 0.35);
});

test('pantalla de uso: solo el propietario, aunque haya otros administradores', async () => {
  const { makeApp } = await import('./helpers.mjs');
  const app = await makeApp();
  await app.seedUser('jefe', 'pass123', { role: 'admin', all_teams: 1, is_owner: 1 });
  await app.seedUser('otroadmin', 'pass123', { role: 'admin', all_teams: 1 });
  const owner = app.client(); await owner.login('jefe', 'pass123');
  const other = app.client(); await other.login('otroadmin', 'pass123');
  assert.equal((await other('GET', '/api/usage')).status, 403);
  const r = await owner('GET', '/api/usage');
  assert.equal(r.status, 200);
  assert.ok(r.data.today.requests >= 1, 'las peticiones se cuentan');
  assert.ok(r.data.limits.requests > 0);
  assert.equal((await owner('GET', '/api/bootstrap')).data.user.is_owner, true);
  assert.equal((await other('GET', '/api/bootstrap')).data.user.is_owner, false);
});

test('vista completa: recuperaciones, 2´, contrapases y penaltis se guardan sin tocar los contadores del equipo', async () => {
  const s = await scenario();
  const { match } = await withMatch(s, s.onlyA, s.A);
  const gk = s.newId('pl'), pl = s.newId('pl');
  await s.onlyA.sync({ op: 'player.create', id: gk, team_id: s.A.id, name: 'Portero', number: 1, is_goalkeeper: true },
    { op: 'player.create', id: pl, team_id: s.A.id, name: 'Extremo', number: 11 });
  const r = await s.onlyA.sync(
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'recovery', player_id: pl, subtype: 'robo', part: 1 },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'sanction', player_id: pl, subtype: 'dos_min' },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'loss', player_id: pl, subtype: 'pisando' },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'counter_pass', goalkeeper_id: gk, subtype: 'fallo' },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'goal_against', goalkeeper_id: gk, zone: '7M', phase: 'penalti', goal_cell: 3 },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'shot_against_miss', goalkeeper_id: gk, result: 'out' },
    // rechazados: sin subtipo, subtipo de otro tipo, portero en un contrapase de jugador
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'recovery', player_id: pl },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'loss', player_id: pl, subtype: 'robo' },
    { op: 'event.create', id: s.newId('ev'), match_id: match, type: 'counter_pass', player_id: pl, subtype: 'ok' });
  assert.deepEqual(r.results.map((x) => !!x.ok), [true, true, true, true, true, true, false, false, false]);
  const d = await detail(s.onlyA, match);
  assert.equal(d.events.length, 6);
  assert.deepEqual(await counters(s.onlyA, match), { possessions: 1, losses: 1, shots: 0, goals: 0, goals_against: 1, shots_against: 2, saves: 0 });
  assert.equal(d.events.find((e) => e.type === 'recovery').subtype, 'robo');
  // corregir el subtipo sobre el mismo evento
  const loss = d.events.find((e) => e.type === 'loss');
  assert.ok((await s.onlyA.sync({ op: 'event.update', id: loss.id, fields: { subtype: 'pasos' } })).results[0].ok);
  assert.equal((await detail(s.onlyA, match)).events.find((e) => e.id === loss.id).subtype, 'pasos');
  // informe de temporada: aparecen en jugadores y porteros
  const rep = (await s.admin('GET', `/api/reports?team_id=${s.A.id}`)).data;
  const pr = rep.players.rows.find((x) => x.player_id === pl);
  assert.deepEqual([pr.steals, pr.two_min, pr.loss_pasos], [1, 1, 1]);
  const gr = rep.goalkeepers.rows.find((x) => x.player_id === gk);
  assert.deepEqual([gr.cp_fail, gr.pen_goals, gr.out], [1, 1, 1]);
});
