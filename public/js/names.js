// Normaliza nombres para comparar sin tildes ni mayúsculas
export const normName = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
