-- Vista completa "como el Excel": recuperaciones (robos/chapas), amonestaciones, contrapases del portero
-- y subtipo (tipo de pérdida, etc.). SQLite no permite cambiar un CHECK: se reconstruye la tabla conservando todos los datos.
CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id),
  type TEXT NOT NULL CHECK (type IN
    ('possession','loss','goal','shot_miss','goal_against','save','shot_against_miss','recovery','sanction','counter_pass')),
  part INTEGER,
  minute INTEGER,
  player_id TEXT REFERENCES players(id),
  goalkeeper_id TEXT REFERENCES players(id),
  zone TEXT,
  goal_cell INTEGER,
  result TEXT,
  shot_type TEXT,
  trajectory TEXT,
  pressure TEXT,
  phase TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  subtype TEXT                         -- pérdida: pase|pisando|falta_ataque|pasos · recuperación: robo|chapa · amonestación: dos_min · contrapase: ok|fallo
);
INSERT INTO events_new (id, match_id, type, part, minute, player_id, goalkeeper_id, zone, goal_cell, result, shot_type, trajectory, pressure, phase, created_by, created_at, updated_at, deleted_at)
  SELECT id, match_id, type, part, minute, player_id, goalkeeper_id, zone, goal_cell, result, shot_type, trajectory, pressure, phase, created_by, created_at, updated_at, deleted_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX idx_events_match ON events(match_id);
