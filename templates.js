// Plantillas de ejemplo descargables (jugadores, estadísticas simples y avanzadas).
import { t } from './i18n.js';

export const PLAYER_HEADERS = ['Equipo', 'Nombre', 'Apellidos', 'Dorsal', 'Posición', 'Portero'];
export const SIMPLE_HEADERS = ['Equipo', 'Partido', 'Fecha', 'Rival', 'Posesiones', 'Pérdidas', 'Lanzamientos', 'Goles', 'Goles en contra', 'Lanzamientos contrarios', 'Paradas'];
export const ADV_HEADERS = ['Equipo', 'Fecha', 'Rival', 'Parte', 'Minuto', 'Evento', 'Jugador', 'Portero', 'Zona', 'Punto portería', 'Resultado', 'Tipo lanzamiento', 'Trayectoria', 'Presión', 'Fase'];

export function playersTemplate(team) {
  return [{
    name: 'Jugadores',
    aoa: [PLAYER_HEADERS,
      [team, 'Aitor', 'Etxebarria', 7, 'Extremo', 'no'],
      [team, 'Unai', 'Goikoetxea', 1, 'Portero', 'sí'],
      [team, 'Mikel', 'Arrieta', 10, 'Central', 'no']],
  }, { name: t('tpl.help'), aoa: [[t('tpl.players.help1')], [t('tpl.players.help2')], [t('tpl.players.help3')]], widths: [110] }];
}

export function simpleTemplate(team) {
  return [{
    name: 'Estadísticas',
    aoa: [SIMPLE_HEADERS,
      [team, 1, '2026-10-04', 'Rival de ejemplo', 48, 9, 39, 32, 24, 50, 11],
      [team, 2, '11/10/2026', 'Otro rival de ejemplo', 44, 12, 32, 25, 28, 45, 8]],
    widths: [20, 9, 12, 22, 12, 10, 13, 8, 15, 22, 10],
  }, { name: t('tpl.help'), aoa: [[t('tpl.simple.help1')], [t('tpl.simple.help2')], [t('tpl.simple.help3')], [t('tpl.simple.help4')]], widths: [120] }];
}

export function advancedTemplate(team) {
  const b = [team, '2026-11-01', 'Rival de ejemplo'];
  return [{
    name: 'Eventos',
    aoa: [ADV_HEADERS,
      [...b, 1, 3, 'posesion', '', '', '', '', '', '', '', ''],
      [...b, 1, 3, 'gol', 7, '', 'EI', 1, '', 'salto', 'alta', 'media', 'posicional'],
      [...b, 1, 5, 'lanzamiento_fallado', 10, '', '9C', '', 'poste', '', '', '', ''],
      [...b, 1, 6, 'perdida', 7, '', '', '', '', '', '', '', ''],
      [...b, 2, 40, 'parada', '', 1, '9D', 4, '', '', '', '', ''],
      [...b, 2, 41, 'gol_en_contra', '', 1, '6M', 9, '', '', '', '', ''],
      [...b, 2, 42, 'lanzamiento_contrario_fallado', '', '', 'ED', '', 'fuera', '', '', '', '']],
    widths: [20, 12, 22, 7, 8, 30, 9, 9, 7, 14, 11, 16, 12, 10, 14],
  }, {
    name: t('tpl.help'),
    aoa: [[t('tpl.adv.help1')], [t('tpl.adv.help2')], [''],
      [t('tpl.adv.events'), 'posesion, perdida, gol, lanzamiento_fallado, gol_en_contra, parada, lanzamiento_contrario_fallado'],
      [t('tpl.adv.zones'), 'EI, 9I, 9C, 9D, ED, 6M, 7M, CA'],
      [t('tpl.adv.point'), '1-9 (3×3: 1 arriba-izquierda … 9 abajo-derecha)'],
      [t('tpl.adv.result'), 'parada, fuera, poste, bloqueo'],
      [t('tpl.adv.player'), t('tpl.adv.player_help')]],
    widths: [24, 100],
  }];
}
