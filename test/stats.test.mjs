import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventsToCounters, totalCounters, percentages, grade, gradeAll, seasonForDate, validateEvent, isPending, counterWarnings,
  DEFAULT_THRESHOLDS, goalkeeperStats, playerStats,
} from '../public/js/stats.js';

const ev = (type, extra = {}) => ({ type, ...extra });

test('relaciones automáticas: gol→lanzamiento, parada/gol en contra→lanzamiento contrario; posesión nunca automática', () => {
  const c = eventsToCounters([
    ev('goal'), ev('goal'), ev('shot_miss'), ev('loss'), ev('possession'),
    ev('goal_against'), ev('save'), ev('save'), ev('shot_against_miss'),
  ]);
  assert.deepEqual(c, { possessions: 1, losses: 1, shots: 3, goals: 2, goals_against: 1, shots_against: 4, saves: 2 });
});

test('eventos borrados no cuentan; ajustes suman sobre eventos', () => {
  const c = totalCounters([ev('goal'), ev('goal', { deleted_at: 'x' })], [{ stat: 'possessions', delta: 40 }, { stat: 'goals', delta: 2 }]);
  assert.equal(c.goals, 3);
  assert.equal(c.shots, 1);
  assert.equal(c.possessions, 40);
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

test('pendientes de completar: lanzamientos sin zona', () => {
  assert.equal(isPending({ type: 'goal', zone: null }), true);
  assert.equal(isPending({ type: 'goal', zone: 'EI' }), false);
  assert.equal(isPending({ type: 'loss', zone: null }), false);
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
