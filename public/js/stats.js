// Lógica de estadísticas compartida entre el servidor (Workers) y la interfaz.
// Regla de oro: los contadores NUNCA se guardan; se calculan siempre desde los eventos (+ ajustes).

export const COUNTERS = ['possessions', 'losses', 'shots', 'goals', 'goals_against', 'shots_against', 'saves'];

export const EVENT_TYPES = ['possession', 'loss', 'goal', 'shot_miss', 'goal_against', 'save', 'shot_against_miss'];

// Qué suma cada evento. Solo estas relaciones automáticas existen:
// gol → lanzamiento, gol en contra → lanzamiento contrario, parada → lanzamiento contrario.
// Las posesiones NUNCA se suman solas.
export const CONTRIB = {
  possession: { possessions: 1 },
  loss: { losses: 1 },
  goal: { goals: 1, shots: 1 },
  shot_miss: { shots: 1 },
  goal_against: { goals_against: 1, shots_against: 1 },
  save: { saves: 1, shots_against: 1 },
  shot_against_miss: { shots_against: 1 },
};

export const OWN_SHOT_TYPES = ['goal', 'shot_miss'];
export const AGAINST_SHOT_TYPES = ['goal_against', 'save', 'shot_against_miss'];
export const SHOT_TYPES_ALL = [...OWN_SHOT_TYPES, ...AGAINST_SHOT_TYPES];

export const ZONES = ['EI', '9I', '9C', '9D', 'ED', '6M', '7M', 'CA'];
// Grupos de zonas para los informes: 6 m, Extremos, 7 m y 9 m (+ contraataque)
export const ZONE_GROUPS = { six: ['6M'], wings: ['EI', 'ED'], seven: ['7M'], nine: ['9I', '9C', '9D'], fast: ['CA'] };
export function groupStats(zones) {
  const out = { own: {}, against: {} };
  for (const [g, list] of Object.entries(ZONE_GROUPS)) {
    out.own[g] = { shots: 0, goals: 0 };
    out.against[g] = { shots: 0, goals_against: 0, saves: 0 };
    for (const z of list) {
      out.own[g].shots += zones.own[z].shots; out.own[g].goals += zones.own[z].goals;
      out.against[g].shots += zones.against[z].shots; out.against[g].goals_against += zones.against[z].goals_against; out.against[g].saves += zones.against[z].saves;
    }
  }
  return out;
}

export const GOAL_CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // fila a fila, 1 = arriba izquierda
export const MISS_RESULTS_OWN = ['save', 'out', 'post', 'block'];
export const MISS_RESULTS_AGAINST = ['out', 'post', 'block'];
export const SHOT_KINDS = ['salto', 'apoyo', 'vaselina', 'caida', 'otro'];
export const TRAJECTORIES = ['alta', 'media', 'baja', 'pica'];
export const PRESSURES = ['sin', 'media', 'alta'];
export const PHASES = ['posicional', 'contraataque', 'superioridad', 'inferioridad', 'porteria_vacia'];

export const emptyCounters = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));

export function eventsToCounters(events) {
  const c = emptyCounters();
  for (const e of events) {
    if (e.deleted_at) continue;
    const add = CONTRIB[e.type];
    if (!add) continue;
    for (const k in add) c[k] += add[k];
  }
  return c;
}

// adjustments: [{stat, delta}] → total = eventos + delta
export function totalCounters(events, adjustments = []) {
  const c = eventsToCounters(events);
  for (const a of adjustments) if (a.stat in c) c[a.stat] += a.delta;
  return c;
}

export const ratio = (n, d) => (d > 0 ? n / d : 0);

export function percentages(c) {
  return {
    off_eff: ratio(c.goals, c.possessions), // Goles ÷ Posesiones
    loss_pct: ratio(c.losses, c.possessions), // Pérdidas ÷ Posesiones
    shot_eff: ratio(c.goals, c.shots), // Goles ÷ Lanzamientos (sin color)
    save_pct: ratio(c.saves, c.goals_against + c.saves), // Paradas ÷ (Goles en contra + Paradas)
  };
}

// Umbrales por defecto = reglas de color del Excel "Control Estadístico Balonmano".
export const DEFAULT_THRESHOLDS = {
  possessions: { green_gt: 47, orange_gte: 43 },
  off_eff: { green_gt: 0.7, orange_gte: 0.6 },
  save_pct: { green_gt: 0.3, orange_gte: 0.25 },
  loss_pct: { great_lt: 0.18, good_lt: 0.22, orange_lt: 0.25 }, // cuanto más bajo, mejor
};

const r4 = (v) => Math.round(v * 10000) / 10000;

// Devuelve 'great' | 'good' | 'mid' | 'bad' | 'none'
export function grade(key, value, th = DEFAULT_THRESHOLDS) {
  const t = th[key];
  if (!t) return 'none';
  const v = r4(value);
  if (key === 'loss_pct') {
    if (v < t.great_lt) return 'great';
    if (v < t.good_lt) return 'good';
    if (v < t.orange_lt) return 'mid';
    return 'bad';
  }
  if (v > t.green_gt) return 'good';
  if (v >= t.orange_gte) return 'mid';
  return 'bad';
}

// Colores de cada indicador de un partido. Sin datos (divisor 0) → 'none'.
export function gradeAll(c, th = DEFAULT_THRESHOLDS, { perMatch = true } = {}) {
  const p = percentages(c);
  return {
    possessions: perMatch && c.possessions > 0 ? grade('possessions', c.possessions, th) : 'none',
    off_eff: c.possessions > 0 ? grade('off_eff', p.off_eff, th) : 'none',
    loss_pct: c.possessions > 0 ? grade('loss_pct', p.loss_pct, th) : 'none',
    shot_eff: 'none',
    save_pct: c.saves + c.goals_against > 0 ? grade('save_pct', p.save_pct, th) : 'none',
  };
}

export function counterWarnings(c) {
  const w = [];
  if (COUNTERS.some((k) => c[k] < 0)) w.push('negative');
  if (c.goals > c.shots) w.push('goals_gt_shots');
  if (c.saves + c.goals_against > c.shots_against) w.push('against_gt_shots');
  return w;
}

// Temporada por fecha: septiembre → agosto
export function seasonForDate(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const start = m >= 9 ? y : y - 1;
  const yy = String((start + 1) % 100).padStart(2, '0');
  return { name: `${start}-${yy}`, start_date: `${start}-09-01`, end_date: `${start + 1}-08-31` };
}

export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

// Evento "pendiente de completar": lanzamiento sin zona (anotado en vista simple)
export const isPending = (e) =>
  !e.deleted_at && SHOT_TYPES_ALL.includes(e.type) && (e.zone == null || e.zone === '');

const inList = (v, list) => v == null || v === '' || list.includes(v);

// Valida un evento (servidor y cliente). Devuelve un texto de error o null.
export function validateEvent(e) {
  if (!EVENT_TYPES.includes(e.type)) return 'type';
  if (e.part != null && ![1, 2].includes(Number(e.part))) return 'part';
  if (e.minute != null && !(Number.isInteger(Number(e.minute)) && e.minute >= 0 && e.minute <= 90)) return 'minute';
  const isShot = SHOT_TYPES_ALL.includes(e.type);
  if (!isShot && (e.zone || e.goal_cell || e.result)) return 'not_a_shot';
  if (!inList(e.zone, ZONES)) return 'zone';
  if (e.goal_cell != null && e.goal_cell !== '' && !GOAL_CELLS.includes(Number(e.goal_cell))) return 'goal_cell';
  if (e.type === 'shot_miss' && !inList(e.result, MISS_RESULTS_OWN)) return 'result';
  if (e.type === 'shot_against_miss' && !inList(e.result, MISS_RESULTS_AGAINST)) return 'result';
  if (['goal', 'goal_against', 'save', 'possession', 'loss'].includes(e.type) && e.result) return 'result';
  // La celda de portería solo tiene sentido si el balón fue a puerta
  if (e.goal_cell != null && e.goal_cell !== '') {
    const toGoal = ['goal', 'goal_against', 'save'].includes(e.type) || (e.type === 'shot_miss' && e.result === 'save');
    if (!toGoal) return 'goal_cell';
  }
  if (e.player_id && !['possession', 'loss', 'goal', 'shot_miss'].includes(e.type)) return 'player';
  if (e.goalkeeper_id && !['goal_against', 'save'].includes(e.type)) return 'goalkeeper';
  if (!isShot && (e.shot_type || e.trajectory || e.pressure)) return 'not_a_shot';
  if (!inList(e.shot_type, SHOT_KINDS)) return 'shot_type';
  if (!inList(e.trajectory, TRAJECTORIES)) return 'trajectory';
  if (!inList(e.pressure, PRESSURES)) return 'pressure';
  if (!inList(e.phase, PHASES)) return 'phase';
  return null;
}

// ---------- Agregados (jugadores, porteros, mapas) ----------

export function playerStats(events) {
  const map = new Map(); // player_id|null → contadores del jugador
  const get = (id) => {
    const k = id || null;
    if (!map.has(k)) map.set(k, { player_id: k, possessions: 0, losses: 0, shots: 0, goals: 0 });
    return map.get(k);
  };
  for (const e of events) {
    if (e.deleted_at) continue;
    if (!['possession', 'loss', 'goal', 'shot_miss'].includes(e.type)) continue;
    const s = get(e.player_id);
    if (e.type === 'possession') s.possessions++;
    if (e.type === 'loss') s.losses++;
    if (e.type === 'goal') { s.goals++; s.shots++; }
    if (e.type === 'shot_miss') s.shots++;
  }
  return [...map.values()];
}

export function goalkeeperStats(events) {
  const map = new Map();
  const get = (id) => {
    const k = id || null;
    if (!map.has(k)) map.set(k, { player_id: k, saves: 0, goals_against: 0 });
    return map.get(k);
  };
  for (const e of events) {
    if (e.deleted_at) continue;
    if (e.type === 'save') get(e.goalkeeper_id).saves++;
    if (e.type === 'goal_against') get(e.goalkeeper_id).goals_against++;
  }
  return [...map.values()].map((s) => ({ ...s, save_pct: ratio(s.saves, s.saves + s.goals_against) }));
}

// Mapa del campo: por zona, lanzamientos propios (y goles) y lanzamientos contrarios (goles en contra y paradas)
export function zoneStats(events) {
  const own = {}, against = {};
  for (const z of ZONES) { own[z] = { shots: 0, goals: 0 }; against[z] = { shots: 0, goals_against: 0, saves: 0 }; }
  for (const e of events) {
    if (e.deleted_at || !e.zone || !ZONES.includes(e.zone)) continue;
    if (e.type === 'goal') { own[e.zone].shots++; own[e.zone].goals++; }
    else if (e.type === 'shot_miss') own[e.zone].shots++;
    else if (e.type === 'goal_against') { against[e.zone].shots++; against[e.zone].goals_against++; }
    else if (e.type === 'save') { against[e.zone].shots++; against[e.zone].saves++; }
    else if (e.type === 'shot_against_miss') against[e.zone].shots++;
  }
  return { own, against };
}

// Mapa de la portería: por celda 1..9
export function cellStats(events) {
  const own = {}, against = {};
  for (const c of GOAL_CELLS) { own[c] = { goals: 0, saves: 0 }; against[c] = { goals_against: 0, saves: 0 }; }
  for (const e of events) {
    if (e.deleted_at || !e.goal_cell) continue;
    const c = Number(e.goal_cell);
    if (!own[c]) continue;
    if (e.type === 'goal') own[c].goals++;
    else if (e.type === 'shot_miss' && e.result === 'save') own[c].saves++;
    else if (e.type === 'goal_against') against[c].goals_against++;
    else if (e.type === 'save') against[c].saves++;
  }
  return { own, against };
}

// Fila de "total" de un informe por partidos: suma de contadores, porcentajes sobre las sumas
export function sumCounters(list) {
  const t = emptyCounters();
  for (const c of list) for (const k of COUNTERS) t[k] += c[k] || 0;
  return t;
}

// "Sin asignar": lo que hay en el total del equipo pero no está atribuido a ningún jugador/portero
export function unassignedPlayers(total, rows) {
  const a = rows.filter((r) => r.player_id);
  const left = (k) => Math.max(0, total[k] - a.reduce((s, r) => s + r[k], 0));
  return { player_id: null, possessions: left('possessions'), losses: left('losses'), shots: left('shots'), goals: left('goals') };
}

export function unassignedGoalkeepers(total, rows) {
  const a = rows.filter((r) => r.player_id);
  const left = (k) => Math.max(0, total[k] - a.reduce((s, r) => s + r[k], 0));
  const saves = left('saves'), goals_against = left('goals_against');
  return { player_id: null, saves, goals_against, save_pct: ratio(saves, saves + goals_against) };
}
