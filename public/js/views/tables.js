// Tablas y mapas compartidos por el resumen de partido y los informes.
import { h, fmtPct } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../store.js';
import { ZONES, ratio, gradeAll, groupStats } from '../stats.js';
import { pill } from '../ui.js';
import { courtSVG, goalGrid } from '../court.js';

const dash = (v) => (v == null ? '–' : v);

export function playersTable({ rows, unassigned }, nameOf) {
  const has = rows.length || unassigned.goals || unassigned.losses || unassigned.possessions || unassigned.shots;
  if (!has) return null;
  const row = (r, label) => h('tr', { class: r.player_id ? '' : 'unassigned' },
    h('th', { scope: 'row' }, label), h('td', null, r.goals), h('td', null, r.shots), h('td', null, r.shots ? fmtPct(r.goals / r.shots) : '–'), h('td', null, r.losses),
    h('td', null, dash(r.steals)), h('td', null, dash(r.blocks)), h('td', null, dash(r.two_min)), h('td', null, r.possessions));
  const main = h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
    h('caption', null, t('tbl.players')),
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, t('stat.goals')), h('th', null, t('col.shots')), h('th', null, t('col.eff')), h('th', null, t('col.losses')),
      h('th', null, t('sub.robo')), h('th', null, t('sub.chapa')), h('th', null, t('sub.dos_min')), h('th', null, t('col.poss')))),
    h('tbody', null, rows.map((r) => row(r, nameOf(r.player_id) || '?')), row(unassigned, t('unassigned')))));
  // Detalle como en el Excel: contragol, fuera/poste, parada, contrafallo y tipos de pérdida
  if (!rows.some((r) => r.goals_fast || r.miss_out || r.miss_saved || r.miss_fast || r.loss_pase || r.loss_pisando || r.loss_falta_ataque || r.loss_pasos)) return main;
  const drow = (r) => h('tr', null, h('th', { scope: 'row' }, nameOf(r.player_id) || '?'), ['goals_fast', 'miss_out', 'miss_saved', 'miss_fast', 'loss_pase', 'loss_pisando', 'loss_falta_ataque', 'loss_pasos'].map((k) => h('td', null, r[k])));
  const detail = h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
    h('caption', null, t('tbl.players_detail')),
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, t('adv.b.fast_goal')), h('th', null, t('adv.b.out')), h('th', null, t('adv.b.saved')), h('th', null, t('adv.b.fast_miss')),
      h('th', null, t('sub.pase')), h('th', null, t('sub.pisando')), h('th', null, t('sub.falta_ataque')), h('th', null, t('sub.pasos')))),
    h('tbody', null, rows.map(drow))));
  return h('div', null, main, detail);
}

export function keepersTable({ rows, unassigned }, nameOf) {
  if (!rows.length && !(unassigned.saves || unassigned.goals_against)) return null;
  const level = (r) => (r.saves + r.goals_against
    ? gradeAll({ possessions: 0, losses: 0, shots: 0, goals: 0, goals_against: r.goals_against, shots_against: 0, saves: r.saves }, state.thresholds).save_pct : 'none');
  const pen = (r) => (r.pen_saves == null ? '–' : `${r.pen_saves}/${r.pen_goals}/${r.pen_out}`);
  const cp = (r) => (r.cp_ok == null ? '–' : `${r.cp_ok}/${r.cp_fail}`);
  const row = (r, label) => h('tr', { class: r.player_id ? '' : 'unassigned' }, h('th', { scope: 'row' }, label), h('td', null, r.saves), h('td', null, r.goals_against), h('td', null, dash(r.out)),
    h('td', null, fmtPct(ratio(r.saves, r.saves + r.goals_against)), ' ', pill('save_pct', level(r))), h('td', null, pen(r)), h('td', null, cp(r)));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
    h('caption', null, t('tbl.keepers')),
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, t('stat.saves')), h('th', null, t('stat.goals_against')), h('th', null, t('adv.b.g_out')), h('th', null, t('pct.save_pct')), h('th', null, t('col.pen')), h('th', null, t('col.cp')))),
    h('tbody', null, rows.map((r) => row(r, nameOf(r.player_id) || '?')), row(unassigned, t('unassigned')))),
    h('p', { class: 'muted small' }, t('col.keeper_legend')));
}

export function mapsBlock(zones, cells, any = true) {
  if (!any) return h('p', { class: 'muted' }, t('maps.none'));
  const heat = (obj) => { const max = Math.max(1, ...Object.values(obj).map((v) => v.shots)); return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.shots / max])); };
  const ownCourt = courtSVG({ counts: Object.fromEntries(ZONES.map((k) => [k, zones.own[k].shots ? `${zones.own[k].goals}/${zones.own[k].shots}` : ''])), heat: heat(zones.own) });
  const agCourt = courtSVG({ counts: Object.fromEntries(ZONES.map((k) => [k, zones.against[k].shots ? `${zones.against[k].goals_against}/${zones.against[k].shots}` : ''])), heat: heat(zones.against) });
  const cellCounts = (o, a, b) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v[a] || v[b] ? `${v[a]}/${v[b]}` : '']));
  const cellHeat = (o, a, b) => { const max = Math.max(1, ...Object.values(o).map((v) => v[a] + v[b])); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, (v[a] + v[b]) / max])); };
  const own = goalGrid({ hideOuts: true, counts: cellCounts(cells.own, 'goals', 'saves'), heat: cellHeat(cells.own, 'goals', 'saves') });
  const ag = goalGrid({ hideOuts: true, counts: cellCounts(cells.against, 'goals_against', 'saves'), heat: cellHeat(cells.against, 'goals_against', 'saves') });
  const G = groupStats(zones);
  const pc = (n, d) => (d > 0 ? fmtPct(n / d) : '–');
  const groupTable = (rows, cols) => h('div', { class: 'table-wrap zg-table' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, t('zg.zone')), h('th', null, cols), h('th', null, '%'))),
    h('tbody', null, rows.filter((r) => r.shots > 0).map((r) => h('tr', null, h('th', { scope: 'row' }, t(`zg.${r.g}`)), h('td', null, `${r.a}/${r.shots}`), h('td', null, pc(r.pct, r.shots)))))));
  const ownRows = Object.entries(G.own).map(([g, v]) => ({ g, a: v.goals, shots: v.shots, pct: v.goals }));
  const agRows = Object.entries(G.against).map(([g, v]) => ({ g, a: v.goals_against, shots: v.shots, pct: v.goals_against }));
  return h('div', { class: 'maps' },
    h('div', null, h('h3', null, t('maps.own')), ownCourt, groupTable(ownRows, t('zg.own_cols')), h('p', { class: 'muted small' }, t('maps.legend_own')), own, h('p', { class: 'muted small' }, t('maps.goal_legend_own'))),
    h('div', null, h('h3', null, t('maps.against')), agCourt, groupTable(agRows, t('zg.against_cols')), h('p', { class: 'muted small' }, t('maps.legend_against')), ag, h('p', { class: 'muted small' }, t('maps.goal_legend_against'))));
}
