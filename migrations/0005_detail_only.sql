-- Detalle de portería (cuadrado de la portería) de un partido que ya tiene totales: el evento guarda la información
-- (portero, cuadrado, penalti) pero NO suma a los totales del partido, para no contar dos veces.
ALTER TABLE events ADD COLUMN detail_only INTEGER NOT NULL DEFAULT 0;
