-- Propietario de la instalación (el único que ve la pantalla de uso del plan gratuito)
-- y contadores diarios de uso.
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;

-- El propietario es el primer administrador que se creó.
UPDATE users SET is_owner = 1
 WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1);

CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT PRIMARY KEY,               -- AAAA-MM-DD en UTC (los límites de Cloudflare se reinician a las 00:00 UTC)
  requests INTEGER NOT NULL DEFAULT 0,
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  db_size INTEGER                     -- bytes de la base de datos tras la última escritura
);
