import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventsToCounters, totalCounters, percentages, grade, gradeAll, seasonForDate, validateEvent, isPending, counterWarnings,
  DEFAULT_THRESHOLDS, goalkeeperStats, playerStats,
} from '../public/js/stats.js';

const ev = (type, extra = {}) => ({ type, ...extra });

test('relaciones automáticas: gol→lanzamiento, parada/gol en contra→lanzamiento contrario; las posesiones se calculan solas (gol + fallo + pérdida)', () => {
  const c = eventsToCounters([
    ev('goal'), ev('goal'), ev('shot_miss'), ev('loss'), ev('possession'),
    ev('goal_against'), ev('save'), ev('save'), ev('shot_against_miss'),
  ]);
  assert.deepEqual(c, { possessions: 4, losses: 1, shots: 3, goals: 2, goals_against: 1, shots_against: 4, saves: 2 });
});

test('eventos borrados no cuentan; ajustes suman sobre eventos', () => {
  const c = totalCounters([ev('goal'), ev('goal', { deleted_at: 'x' })], [{ stat: 'possessions', delta: 40 }, { stat: 'goals', delta: 2 }]);
  assert.equal(c.goals, 3);
  assert.equal(c.shots, 1);
  assert.equal(c.possessions, 41);
});

test('% de paradas = paradas ÷ (goles en contra + paradas), no ÷ lanzamientos contrarios', () => {
  const c = { possessions: 50, losses: 10, shots: 40, goals: 30, goals_against: 20, shots_against: 40, saves: 10 };
  const p = percentages(c);
  assert.equal(p.save_pct, 10 / 30);
  assert.equal(p.off_eff, 30 / 50);
  assert.equal(p.loss_pct, 10 / 50);
  assert.equal(p.shot_eff, 30 / 40);
  assert.equal(percentages({ ...c, goals_against: 0, saves: 0 }).save_pct, 0); // divisor 0 → 0
});

test('colores del Excel: efectividad ofensiva (>70 verde, 60–70 naranja, <60 rojo)', () => {
  assert.equal(grade('off_eff', 0.71), 'good');
  assert.equal(grade('off_eff', 0.7), 'mid');
  assert.equal(grade('off_eff', 0.6), 'mid');
  assert.equal(grade('off_eff', 0.5999), 'bad');
});
test('colores del Excel: % paradas (>30 verde, 25–30 naranja, <25 rojo)', () => {
  assert.equal(grade('save_pct', 0.31), 'good');
  assert.equal(grade('save_pct', 0.3), 'mid');
  assert.equal(grade('save_pct', 0.25), 'mid');
  assert.equal(grade('save_pct', 0.24), 'bad');
});
test('colores del Excel: posesiones (>47 verde, 43–47 naranja, <43 rojo)', () => {
  assert.equal(grade('possessions', 48), 'good');
  assert.equal(grade('possessions', 47), 'mid');
  assert.equal(grade('possessions', 43), 'mid');
  assert.equal(grade('possessions', 42), 'bad');
});
test('colores del Excel: % pérdidas, cuatro niveles sin huecos', () => {
  assert.equal(grade('loss_pct', 0.1), 'great');
  assert.equal(grade('loss_pct', 0.175), 'great'); // 17,5 % sin hueco entre 17 y 18
  assert.equal(grade('loss_pct', 0.18), 'good');
  assert.equal(grade('loss_pct', 0.21), 'good');
  assert.equal(grade('loss_pct', 0.22), 'mid');
  assert.equal(grade('loss_pct', 0.24), 'mid');
  assert.equal(grade('loss_pct', 0.25), 'bad');
});
test('sin datos (divisor 0) no hay color; lanzamientos no tienen color', () => {
  const g = gradeAll({ possessions: 0, losses: 0, shots: 0, goals: 0, goals_against: 0, shots_against: 0, saves: 0 });
  assert.deepEqual(Object.values(g), ['none', 'none', 'none', 'none', 'none']);
  assert.equal(gradeAll({ possessions: 40, losses: 8, shots: 30, goals: 28, goals_against: 5, shots_against: 20, saves: 5 }).shot_eff, 'none');
});
test('umbrales por defecto coinciden con el Excel', () => {
  assert.deepEqual(DEFAULT_THRESHOLDS.possessions, { green_gt: 47, orange_gte: 43 });
  assert.deepEqual(DEFAULT_THRESHOLDS.off_eff, { green_gt: 0.7, orange_gte: 0.6 });
  assert.deepEqual(DEFAULT_THRESHOLDS.save_pct, { green_gt: 0.3, orange_gte: 0.25 });
});

test('avisos de coherencia', () => {
  assert.deepEqual(counterWarnings({ possessions: 1, losses: 0, shots: 2, goals: 3, goals_against: 0, shots_against: 0, saves: 0 }), ['goals_gt_shots']);
  assert.deepEqual(counterWarnings({ possessions: 1, losses: 0, shots: 2, goals: 1, goals_against: 2, shots_against: 3, saves: 2 }), ['against_gt_shots']);
});

test('temporada septiembre → agosto', () => {
  assert.equal(seasonForDate('2026-11-11').name, '2026-27');
  assert.equal(seasonForDate('2027-03-01').name, '2026-27');
  assert.equal(seasonForDate('2027-09-01').name, '2027-28');
  assert.equal(seasonForDate('2027-08-31').start_date, '2026-09-01');
});

test('validación de eventos', () => {
  assert.equal(validateEvent({ type: 'goal', zone: '9C', goal_cell: 5 }), null);
  assert.equal(validateEvent({ type: 'shot_miss', result: 'save', goal_cell: 3 }), null);
  assert.equal(validateEvent({ type: 'shot_miss', result: 'out', goal_cell: 3 }), 'goal_cell');
  assert.equal(validateEvent({ type: 'loss', zone: 'EI' }), 'not_a_shot');
  assert.equal(validateEvent({ type: 'goal', zone: 'XX' }), 'zone');
  assert.equal(validateEvent({ type: 'goal', player_id: 'p', goalkeeper_id: 'g' }), 'goalkeeper');
  assert.equal(validateEvent({ type: 'save', player_id: 'p' }), 'player');
  assert.equal(validateEvent({ type: 'xxx' }), 'type');
  assert.equal(validateEvent({ type: 'shot_against_miss', result: 'save' }), 'result');
});

test('pendientes de completar: lanzamientos propios sin jugador / en contra sin portero', () => {
  assert.equal(isPending({ type: 'goal', player_id: null }), true);
  assert.equal(isPending({ type: 'goal', player_id: 'a' }), false);
  assert.equal(isPending({ type: 'goal', player_id: 'a', zone: null }), false); // la zona ya no hace falta
  assert.equal(isPending({ type: 'save', goalkeeper_id: null }), true);
  assert.equal(isPending({ type: 'save', goalkeeper_id: 'g' }), false);
  assert.equal(isPending({ type: 'loss', player_id: null }), false);
});

test('vista completa (Excel): subtipos, recuperaciones, 2´, contrapases y penaltis', () => {
  assert.equal(validateEvent({ type: 'loss', player_id: 'a', subtype: 'pisando' }), null);
  assert.equal(validateEvent({ type: 'loss', subtype: 'robo' }), 'subtype');
  assert.equal(validateEvent({ type: 'recovery', player_id: 'a', subtype: 'chapa' }), null);
  assert.equal(validateEvent({ type: 'recovery', player_id: 'a' }), 'subtype'); // el subtipo es obligatorio
  assert.equal(validateEvent({ type: 'sanction', player_id: 'a', subtype: 'dos_min' }), null);
  assert.equal(validateEvent({ type: 'counter_pass', goalkeeper_id: 'g', subtype: 'ok' }), null);
  assert.equal(validateEvent({ type: 'counter_pass', player_id: 'a', subtype: 'ok' }), 'player');
  assert.equal(validateEvent({ type: 'goal', subtype: 'ok' }), 'subtype');
  assert.equal(validateEvent({ type: 'shot_against_miss', goalkeeper_id: 'g', result: 'out', phase: 'penalti', zone: '7M' }), null);
  // ni las recuperaciones, ni los 2´, ni los contrapases tocan los contadores del equipo
  const evs = [ev('recovery', { player_id: 'a', subtype: 'robo' }), ev('sanction', { player_id: 'a', subtype: 'dos_min' }), ev('counter_pass', { goalkeeper_id: 'g', subtype: 'ok' })];
  assert.deepEqual(eventsToCounters(evs), { possessions: 0, losses: 0, shots: 0, goals: 0, goals_against: 0, shots_against: 0, saves: 0 });
});

test('estadística por jugador y portero como el Excel', () => {
  const evs = [
    ev('goal', { player_id: 'a' }), ev('goal', { player_id: 'a', phase: 'contraataque' }),
    ev('shot_miss', { player_id: 'a', result: 'out' }), ev('shot_miss', { player_id: 'a', result: 'save' }), ev('shot_miss', { player_id: 'a', phase: 'contraataque' }),
    ev('loss', { player_id: 'a', subtype: 'pase' }), ev('loss', { player_id: 'a', subtype: 'pasos' }), ev('loss', { player_id: 'a' }),
    ev('recovery', { player_id: 'a', subtype: 'robo' }), ev('recovery', { player_id: 'a', subtype: 'chapa' }), ev('recovery', { player_id: 'a', subtype: 'chapa' }),
    ev('sanction', { player_id: 'a', subtype: 'dos_min' }),
    ev('save', { goalkeeper_id: 'g' }), ev('save', { goalkeeper_id: 'g', phase: 'penalti' }), ev('goal_against', { goalkeeper_id: 'g' }),
    ev('goal_against', { goalkeeper_id: 'g', phase: 'penalti' }), ev('shot_against_miss', { goalkeeper_id: 'g', result: 'out' }), ev('shot_against_miss', { goalkeeper_id: 'g', result: 'out', phase: 'penalti' }),
    ev('counter_pass', { goalkeeper_id: 'g', subtype: 'ok' }), ev('counter_pass', { goalkeeper_id: 'g', subtype: 'fallo' }),
  ];
  const p = playerStats(evs).find((r) => r.player_id === 'a');
  assert.deepEqual([p.goals, p.goals_fast, p.shots, p.miss_out, p.miss_saved, p.miss_fast], [2, 1, 5, 1, 1, 1]);
  assert.deepEqual([p.losses, p.loss_pase, p.loss_pasos, p.steals, p.blocks, p.two_min], [3, 1, 1, 1, 2, 1]);
  const g = goalkeeperStats(evs).find((r) => r.player_id === 'g');
  assert.deepEqual([g.saves, g.pen_saves, g.goals_against, g.pen_goals, g.out, g.pen_out, g.cp_ok, g.cp_fail], [2, 1, 2, 1, 2, 1, 1, 1]);
});

test('estadística por jugador y portero (% de paradas del portero = paradas ÷ (paradas + encajados))', () => {
  const evs = [
    ev('goal', { player_id: 'a' }), ev('shot_miss', { player_id: 'a' }), ev('goal', { player_id: null }),
    ev('save', { goalkeeper_id: 'g1' }), ev('save', { goalkeeper_id: 'g1' }), ev('goal_against', { goalkeeper_id: 'g1' }), ev('goal_against', {}),
  ];
  const p = playerStats(evs).find((r) => r.player_id === 'a');
  assert.deepEqual([p.goals, p.shots], [1, 2]);
  const g = goalkeeperStats(evs).find((r) => r.player_id === 'g1');
  assert.equal(g.save_pct, 2 / 3);
  assert.equal(goalkeeperStats(evs).find((r) => r.player_id === null).goals_against, 1);
});
