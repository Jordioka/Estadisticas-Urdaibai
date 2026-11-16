-- Convocados por partido: lista (JSON) de identificadores de jugadores. NULL = toda la plantilla.
ALTER TABLE matches ADD COLUMN squad TEXT;
