-- Urdaibai E.T. · Estadísticas — esquema inicial (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'scorer' CHECK (role IN ('admin','scorer')),
  all_teams INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
  username TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts ON login_attempts(username, at);

-- Equipos propios (is_own=1) y rivales (is_own=0, lista compartida)
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_own INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_teams (
  user_id TEXT NOT NULL REFERENCES users(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  PRIMARY KEY (user_id, team_id)
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  surname TEXT NOT NULL DEFAULT '',
  number INTEGER,
  position TEXT NOT NULL DEFAULT '',
  is_goalkeeper INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_players_team ON players(team_id);

CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  rival_id TEXT NOT NULL REFERENCES teams(id),
  date TEXT NOT NULL,
  home_away TEXT NOT NULL DEFAULT 'home' CHECK (home_away IN ('home','away')),
  season_id TEXT REFERENCES seasons(id),
  is_practice INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_matches_team ON matches(team_id, date);

-- Un hecho de juego = un evento. Los contadores se calculan siempre desde aquí.
CREATE TABLE events (
  id TEXT PRIMARY KEY,                -- generado en el dispositivo (idempotencia)
  match_id TEXT NOT NULL REFERENCES matches(id),
  type TEXT NOT NULL CHECK (type IN
    ('possession','loss','goal','shot_miss','goal_against','save','shot_against_miss')),
  part INTEGER,                       -- 1 o 2 (opcional)
  minute INTEGER,
  player_id TEXT REFERENCES players(id),
  goalkeeper_id TEXT REFERENCES players(id),
  zone TEXT,                          -- EI, ED, 6M, 9I, 9C, 9D, 7M, CA
  goal_cell INTEGER,                  -- 1..9 (cuadrícula de la portería)
  result TEXT,                        -- para shot_miss / shot_against_miss: save, out, post, block
  shot_type TEXT,
  trajectory TEXT,
  pressure TEXT,
  phase TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_events_match ON events(match_id);

-- Totales tecleados a mano: un ajuste (delta) por estadística y partido
CREATE TABLE adjustments (
  match_id TEXT NOT NULL REFERENCES matches(id),
  stat TEXT NOT NULL CHECK (stat IN
    ('possessions','losses','shots','goals','goals_against','shots_against','saves')),
  delta INTEGER NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (match_id, stat)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT
);
