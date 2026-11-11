import test from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './helpers.mjs';
import { totalCounters, sumCounters } from '../public/js/stats.js';

const P = '/api/import/players', M = '/api/import/matches';

test('IMPORTAR JUGADORES: informe previo, guardar, reimportar sin duplicar, duplicados con decisión', async () => {
  const s = await scenario();
  const rows = [
    { Equipo: 'Juvenil Masculino', Nombre: 'Aitor', Apellidos: 'Etxeberria', Dorsal: 7, Posición: 'Extremo', Portero: 'no' },
    { Equipo: 'Juvenil Masculino', Nombre: 'Unai', Apellidos: 'Goikoetxea', Dorsal: 1, Posición: 'Portero', Portero: 'sí' },
    { Equipo: 'Cadete Femenino', Nombre: 'Maite', Dorsal: 5, Portero: 'x' },
  ];
  const dry = (await s.admin('POST', P, { rows, dry_run: true })).data;
  assert.equal(dry.create.length, 3);
  assert.equal(dry.committed, false);
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.players.length, 0); // dry-run no guarda nada
  const ok = (await s.admin('POST', P, { rows, dry_run: false })).data;
  assert.equal(ok.committed, true);
  const players = (await s.admin('GET', '/api/bootstrap')).data.players;
  assert.equal(players.length, 3);
  assert.equal(players.find((p) => p.name === 'Unai').is_goalkeeper, 1);
  assert.equal(players.find((p) => p.name === 'Maite').is_goalkeeper, 1); // "x" = sí
  // mismo archivo otra vez: todo "sin cambios", cero duplicados
  const again = (await s.admin('POST', P, { rows, dry_run: false })).data;
  assert.equal(again.unchanged.length, 3);
  assert.equal(again.create.length, 0);
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.players.length, 3);
  // cambio en un jugador existente → hay que decidir
  const changed = [{ ...rows[0], Dorsal: 9 }];
  const ask = (await s.admin('POST', P, { rows: changed, dry_run: false })).data;
  assert.equal(ask.blocked, 'duplicates');
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.players.find((p) => p.name === 'Aitor').number, 7);
  await s.admin('POST', P, { rows: changed, dry_run: false, on_duplicate: 'skip' });
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.players.find((p) => p.name === 'Aitor').number, 7);
  await s.admin('POST', P, { rows: changed, dry_run: false, on_duplicate: 'update' });
  const after = (await s.admin('GET', '/api/bootstrap')).data.players;
  assert.equal(after.find((p) => p.name === 'Aitor').number, 9);
  assert.equal(after.length, 3);
});

test('IMPORTAR JUGADORES: errores listados, nada se guarda hasta confirmar, equipos inexistentes', async () => {
  const s = await scenario();
  const rows = [
    { Equipo: 'Juvenil Masculino', Nombre: 'Uno', Dorsal: 4 },
    { Equipo: 'Juvenil Masculino', Nombre: 'Dos', Dorsal: 4 },     // dorsal repetido
    { Equipo: 'Juvenil Masculino', Nombre: '', Dorsal: 5 },        // sin nombre
    { Equipo: 'Equipo Fantasma', Nombre: 'Tres', Dorsal: 6 },      // equipo inexistente
    { Equipo: 'Juvenil Masculino', Nombre: 'Cuatro', Dorsal: 150 },// dorsal inválido
    { Equipo: 'Juvenil Masculino', Nombre: 'Uno', Dorsal: 8 },     // repetido en el archivo
  ];
  const r = (await s.admin('POST', P, { rows, dry_run: true })).data;
  assert.deepEqual(r.errors.map((e) => [e.row, e.error]),
    [[3, 'number_in_use'], [4, 'name_required'], [5, 'team_unknown'], [6, 'invalid_number'], [7, 'duplicate_in_file']]);
  assert.deepEqual(r.unknown_teams, ['Equipo Fantasma']);
  const blocked = (await s.admin('POST', P, { rows, dry_run: false })).data;
  assert.equal(blocked.blocked, 'errors');
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.players.length, 0);
  // solo el administrador puede crear equipos nuevos desde un archivo
  const mk = (await s.admin('POST', P, { rows: [{ Equipo: 'Infantil', Nombre: 'Peru', Dorsal: 2 }], dry_run: false, create_teams: true })).data;
  assert.equal(mk.committed, true);
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.teams.length, 3);
  const noAdmin = (await s.both('POST', P, { rows: [{ Equipo: 'Otro Nuevo', Nombre: 'Peru', Dorsal: 2 }], dry_run: true, create_teams: true })).data;
  assert.equal(noAdmin.errors[0].error, 'team_unknown');
  // guardar solo las filas correctas, si se confirma
  const part = (await s.admin('POST', P, { rows, dry_run: false, ignore_errors: true })).data;
  assert.equal(part.committed, true);
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.players.filter((p) => p.team_id === s.A.id).length, 1);
});

test('IMPORTAR ESTADÍSTICAS simple (plantilla del Excel + Goles en contra), duplicados y reemplazo', async () => {
  const s = await scenario();
  const rows = [
    { Equipo: 'Juvenil Masculino', Partido: 1, Fecha: '2026-10-04', Rival: 'Gernika', Posesiones: 48, Pérdidas: 9, Lanzamientos: 39, Goles: 32, 'Goles en contra': 24, 'Lanzamientos\ncontrarios': 50, Paradas: 11 },
    { Equipo: 'Juvenil Masculino', Partido: 2, Fecha: '11/10/2026', Rival: 'Bermeo', Posesiones: 44, Pérdidas: 12, Lanzamientos: 32, Goles: 25, 'Goles en contra': 28, 'Lanzamientos contrarios': 45, Paradas: 8 },
    { Partido: 3 }, // fila de plantilla sin rellenar: se ignora
  ];
  const dry = (await s.admin('POST', M, { kind: 'simple', rows, dry_run: true })).data;
  assert.equal(dry.total, 2);
  assert.deepEqual(dry.new_rivals.sort(), ['Bermeo', 'Gernika']);
  assert.equal(dry.errors.length, 0);
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.matches.length, 0);
  const ok = (await s.admin('POST', M, { kind: 'simple', rows, dry_run: false })).data;
  assert.equal(ok.created, 2);
  const boot = (await s.admin('GET', '/api/bootstrap')).data;
  assert.equal(boot.matches.length, 2);
  const m1 = boot.matches.find((m) => m.date === '2026-10-04');
  assert.deepEqual(m1.counters, { possessions: 48, losses: 9, shots: 39, goals: 32, goals_against: 24, shots_against: 50, saves: 11 });
  assert.equal(boot.matches.find((m) => m.date === '2026-10-11').counters.possessions, 44); // fecha dd/mm/aaaa
  // misma importación otra vez → avisa, no duplica
  const dup = (await s.admin('POST', M, { kind: 'simple', rows, dry_run: false })).data;
  assert.equal(dup.blocked, 'duplicates');
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.matches.length, 2);
  assert.equal((await s.admin('POST', M, { kind: 'simple', rows, dry_run: false, on_duplicate: 'skip' })).data.created, 0);
  assert.equal((await s.admin('GET', '/api/bootstrap')).data.matches.length, 2);
  const rep = (await s.admin('POST', M, { kind: 'simple', rows: [{ ...rows[0], Goles: 33 }], dry_run: false, on_duplicate: 'replace' })).data;
  assert.equal(rep.created, 1);
  const after = (await s.admin('GET', '/api/bootstrap')).data;
  assert.equal(after.matches.length, 2); // sustituye, no suma
  assert.equal(after.matches.find((m) => m.date === '2026-10-04').counters.goals, 33);
  // errores
  const bad = (await s.admin('POST', M, { kind: 'simple', rows: [
    { Equipo: 'Juvenil Masculino', Fecha: 'mañana', Rival: 'X', Goles: 1 },
    { Equipo: 'Juvenil Masculino', Fecha: '2026-10-20', Rival: 'X', Goles: -2 },
    { Equipo: 'Juvenil Masculino', Fecha: '2026-10-21', Goles: 2 },
  ], dry_run: true })).data;
  assert.deepEqual(bad.errors.map((e) => e.error), ['invalid_date', 'invalid_number', 'rival_required']);
});

test('IMPORTAR ESTADÍSTICAS avanzada: una fila por evento, jugadores por dorsal, relaciones automáticas', async () => {
  const s = await scenario();
  await s.admin('POST', P, { rows: [
    { Equipo: 'Juvenil Masculino', Nombre: 'Aitor', Dorsal: 7 }, { Equipo: 'Juvenil Masculino', Nombre: 'Unai', Dorsal: 1, Portero: 'sí' },
  ], dry_run: false });
  const base = { Equipo: 'Juvenil Masculino', Fecha: '2026-11-01', Rival: 'Gernika' };
  const rows = [
    { ...base, Parte: 1, Minuto: 3, Evento: 'posesion' },
    { ...base, Parte: 1, Minuto: 3, Evento: 'gol', Jugador: 7, Zona: 'EI', 'Punto portería': 1 },
    { ...base, Parte: 1, Minuto: 5, Evento: 'lanzamiento_fallado', Jugador: 'Aitor', Zona: '9C', Resultado: 'poste' },
    { ...base, Parte: 1, Minuto: 6, Evento: 'perdida', Jugador: 7 },
    { ...base, Parte: 2, Minuto: 40, Evento: 'parada', Portero: 1, Zona: '9D', 'Punto portería': 4 },
    { ...base, Parte: 2, Minuto: 41, Evento: 'gol_en_contra', Portero: 'Unai', Zona: '6M', 'Punto portería': 9 },
    { ...base, Parte: 2, Minuto: 42, Evento: 'lanzamiento_contrario_fallado', Zona: 'ED', Resultado: 'fuera' },
  ];
  const dry = (await s.admin('POST', M, { kind: 'advanced', rows, dry_run: true })).data;
  assert.equal(dry.errors.length, 0, JSON.stringify(dry.errors));
  assert.equal(dry.matches[0].events, 7);
  await s.admin('POST', M, { kind: 'advanced', rows, dry_run: false });
  const m = (await s.admin('GET', '/api/bootstrap')).data.matches[0];
  assert.deepEqual(m.counters, { possessions: 1, losses: 1, shots: 2, goals: 1, goals_against: 1, shots_against: 3, saves: 1 });
  // errores: jugador inexistente, evento incoherente
  const bad = (await s.admin('POST', M, { kind: 'advanced', rows: [
    { ...base, Evento: 'gol', Jugador: 99 }, { ...base, Evento: 'perdida', Zona: 'EI' }, { ...base, Evento: 'bailar' },
  ], dry_run: true })).data;
  assert.deepEqual(bad.errors.map((e) => e.error), ['player_not_found', 'invalid_event', 'invalid_event_type']);
  // el mismo archivo otra vez: detecta partido duplicado
  assert.equal((await s.admin('POST', M, { kind: 'advanced', rows, dry_run: false })).data.blocked, 'duplicates');
  // permisos: un delegado de A no puede importar partidos de B
  const f = (await s.onlyA('POST', M, { kind: 'simple', rows: [{ Equipo: 'Cadete Femenino', Fecha: '2026-11-01', Rival: 'X', Goles: 1 }], dry_run: true })).data;
  assert.equal(f.errors[0].error, 'team_forbidden');
});

test('INFORMES: partido, partidos y temporada coinciden; practice excluido; filtros; sin asignar; permisos', async () => {
  const s = await scenario();
  const c = s.onlyA;
  const ids = {};
  const mkMatch = async (date, rivalName, practice = false) => {
    const rival = s.newId('rival'), match = s.newId('match');
    await c.sync({ op: 'rival.create', id: rival, name: rivalName }, { op: 'match.create', id: match, team_id: s.A.id, rival_id: rival, date, is_practice: practice });
    return { rival, match };
  };
  const m1 = await mkMatch('2026-10-04', 'Gernika'), m2 = await mkMatch('2026-10-11', 'Bermeo'), prac = await mkMatch('2026-10-12', 'Prueba', true);
  const pl = s.newId('pl'), gk = s.newId('pl');
  await c.sync({ op: 'player.create', id: pl, team_id: s.A.id, name: 'Aitor', number: 7 }, { op: 'player.create', id: gk, team_id: s.A.id, name: 'Unai', number: 1, is_goalkeeper: true });
  const ev = (match, type, extra = {}) => ({ op: 'event.create', id: s.newId('ev'), match_id: match, type, ...extra });
  await c.sync(
    ev(m1.match, 'possession'), ev(m1.match, 'possession'), ev(m1.match, 'goal', { player_id: pl, zone: 'EI', goal_cell: 1 }), ev(m1.match, 'goal'),
    ev(m1.match, 'save', { goalkeeper_id: gk, zone: '9C', goal_cell: 5 }), ev(m1.match, 'goal_against', { goalkeeper_id: gk, zone: '9C', goal_cell: 2 }),
    ev(m2.match, 'possession'), ev(m2.match, 'shot_miss', { result: 'out', zone: 'ED' }), ev(m2.match, 'loss', { player_id: pl }), ev(m2.match, 'save'),
    { op: 'adj.set', match_id: m2.match, stat: 'possessions', delta: 40 },
    ev(prac.match, 'goal'), ev(prac.match, 'goal')
  );
  const rep = (await c('GET', `/api/reports?team_id=${s.A.id}`)).data;
  assert.equal(rep.matches.length, 2); // el partido de prueba no cuenta
  const sum = sumCounters(rep.matches.map((m) => m.counters));
  assert.deepEqual(rep.totals, sum); // temporada = suma de partidos
  for (const m of rep.matches) { // cada partido coincide con su informe individual
    const d = (await c('GET', `/api/matches/${m.id}`)).data;
    assert.deepEqual(m.counters, totalCounters(d.events, d.adjustments));
  }
  assert.equal(rep.totals.goals, 2);
  assert.equal(rep.totals.possessions, 2 + 1 + 40);
  assert.equal(rep.totals.saves, 2);
  // "Sin asignar": lo que está en el total del equipo y no tiene jugador/portero
  const p = rep.players;
  assert.equal(p.rows.find((r) => r.player_id === pl).goals, 1);
  assert.equal(p.unassigned.goals, 1);
  assert.equal(p.unassigned.possessions, 43);
  assert.equal(rep.goalkeepers.rows[0].saves, 1);
  assert.equal(rep.goalkeepers.unassigned.saves, 1);
  // filtros: rival, fechas, temporada
  assert.equal((await c('GET', `/api/reports?team_id=${s.A.id}&rival_id=${m2.rival}`)).data.matches.length, 1);
  assert.equal((await c('GET', `/api/reports?team_id=${s.A.id}&from=2026-10-10`)).data.matches.length, 1);
  assert.equal((await c('GET', `/api/reports?team_id=${s.A.id}&to=2026-10-05`)).data.totals.goals, 2);
  const season = (await c('GET', '/api/bootstrap')).data.seasons[0].id;
  assert.equal((await c('GET', `/api/reports?team_id=${s.A.id}&season_id=${season}`)).data.matches.length, 2);
  assert.equal((await c('GET', `/api/reports?team_id=${s.A.id}&season_id=otra`)).data.matches.length, 0);
  // mapas
  assert.equal(rep.zones.own.EI.goals, 1);
  assert.equal(rep.zones.against['9C'].saves, 1);
  assert.equal(rep.cells.against[2].goals_against, 1);
  // permisos
  assert.equal((await c('GET', `/api/reports?team_id=${s.B.id}`)).status, 403);
});
