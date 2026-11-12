// Resumen y corrección del partido: totales, porcentajes con color, eventos editables, jugadores, porteros y mapas.
import { h, toast, sheet, confirmDialog, fmtDate, fmtPct, today, clear } from '../dom.js';
import { t } from '../i18n.js';
import { state, getMatch, setLive, enqueue, playersOf, rivalName, playerLabel } from '../store.js';
import {
  totalCounters, percentages, gradeAll, isPending, playerStats, goalkeeperStats, zoneStats, cellStats, unassignedPlayers, unassignedGoalkeepers,
  EVENT_TYPES, SHOT_TYPES_ALL, ZONES, ratio, SUBTYPES, OWN_SHOT_TYPES,
} from '../stats.js';
import { countersGrid, percentBlock, warningsBox, pill, segmented, field, backBar, errMsg } from '../ui.js';
import { openDetailSheet, openPlayerPick } from '../shot-sheet.js';
import { playersTable, keepersTable, mapsBlock } from './tables.js';

const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const PLAYER_TYPES = ['possession', 'loss', 'goal', 'shot_miss', 'recovery', 'sanction'];
const KEEPER_TYPES = ['goal_against', 'save', 'shot_against_miss', 'counter_pass'];

// Cambia el tipo de un evento limpiando lo que ya no tiene sentido
function retype(ev, type) {
  const shot = SHOT_TYPES_ALL.includes(type);
  const subs = SUBTYPES[type];
  return {
    type,
    zone: shot ? ev.zone : null,
    goal_cell: ['goal', 'goal_against', 'save'].includes(type) ? ev.goal_cell : null,
    result: null,
    player_id: PLAYER_TYPES.includes(type) ? ev.player_id : null,
    goalkeeper_id: KEEPER_TYPES.includes(type) ? ev.goalkeeper_id : null,
    shot_type: shot ? ev.shot_type : null, trajectory: shot ? ev.trajectory : null, pressure: shot ? ev.pressure : null,
    phase: shot ? ev.phase : null,
    subtype: subs ? (subs.includes(ev.subtype) ? ev.subtype : subs[0]) : null,
  };
}

export async function summaryView(root, { id }) {
  let data;
  try { data = await getMatch(id); }
  catch (e) { root.append(h('div', { class: 'page' }, h('p', { class: 'warn' }, e.code === 'not_cached' ? t('err.not_cached') : errMsg(e)), h('a', { class: 'btn', href: '#/' }, t('back')))); return; }
  setLive(data);
  const m = data.match;
  const people = playersOf(m.team_id);
  const goalkeepers = people.filter((p) => p.is_goalkeeper);
  const nameOf = (pid) => playerLabel(people.find((p) => p.id === pid)) || '';
  const screen = h('div', { class: 'page summary' });
  root.append(screen);

  function describe(ev) {
    const bits = [];
    if (ev.player_id) bits.push(nameOf(ev.player_id));
    if (ev.goalkeeper_id) bits.push('🧤 ' + nameOf(ev.goalkeeper_id));
    if (ev.subtype) bits.push(t(`sub.${ev.subtype}`));
    if (ev.phase === 'penalti' || ev.phase === 'contraataque') bits.push(t(`phase.${ev.phase}`));
    if (ev.zone) bits.push(t(`zone.${ev.zone}`));
    if (ev.goal_cell) bits.push(`${t('goal.cell')} ${ev.goal_cell}`);
    if (ev.result) bits.push(t(`result.${ev.result}`));
    return bits.join(' · ');
  }

  function editEvent(ev) {
    const isShot = SHOT_TYPES_ALL.includes(ev.type);
    const s = sheet({
      title: t('ev.edit'),
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted' }, `${hhmm(ev.created_at)} · ${describe(ev) || t('no_detail')}`),
        h('h3', null, t('ev.type')),
        h('div', { class: 'chips' }, EVENT_TYPES.map((tp) => h('button', { type: 'button', class: `chip${tp === ev.type ? ' on' : ''}`, onclick: () => {
          if (tp !== ev.type) enqueue({ op: 'event.update', id: ev.id, match_id: id, fields: retype(ev, tp) });
          s.close(); render();
        } }, t(`ev.${tp}`)))),
        SUBTYPES[ev.type] && SUBTYPES[ev.type].length > 1 ? h('div', null, h('h3', null, t('ev.subtype')),
          h('div', { class: 'chips' }, SUBTYPES[ev.type].map((k) => h('button', { type: 'button', class: `chip${k === ev.subtype ? ' on' : ''}`, onclick: () => {
            if (k !== ev.subtype) enqueue({ op: 'event.update', id: ev.id, match_id: id, fields: { subtype: k } });
            s.close(); render();
          } }, t(`sub.${k}`))))) : null,
        h('h3', null, t('part')),
        segmented([{ value: 0, label: '–' }, { value: 1, label: '1ª' }, { value: 2, label: '2ª' }], ev.part || 0, (v) => { enqueue({ op: 'event.update', id: ev.id, match_id: id, fields: { part: v || null } }); s.close(); render(); }),
        isShot
          ? h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); openDetail(ev); } }, isPending(ev) ? t('complete') : t('ev.detail'))
          : h('button', { class: 'btn', type: 'button', onclick: () => {
            s.close();
            const keeperEv = KEEPER_TYPES.includes(ev.type), f = keeperEv ? 'goalkeeper_id' : 'player_id';
            openPlayerPick({ title: t(`ev.${ev.type}`), players: keeperEv ? goalkeepers : people, current: ev[f], onPick: (pid) => { enqueue({ op: 'event.update', id: ev.id, match_id: id, fields: { [f]: pid } }); render(); } });
          } }, t('ev.who')),
        h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          s.close();
          if (await confirmDialog(t('ev.delete_q'), { yes: t('delete'), no: t('cancel'), danger: true })) { enqueue({ op: 'event.delete', id: ev.id, match_id: id }); toast(t('deleted')); render(); }
        } }, t('delete'))),
    });
  }

  function openDetail(ev) {
    openDetailSheet({
      event: ev, title: t(`ev.${ev.type}`), people, keepers: goalkeepers,
      onSave: (fields) => { enqueue({ op: 'event.update', id: ev.id, match_id: id, fields }); toast(t('saved')); render(); },
    });
  }

  function editMatch() {
    let date = m.date, rivalId = m.rival_id, ha = m.home_away;
    const rivalSel = h('select', { onchange: (e) => { rivalId = e.target.value; } }, state.rivals.map((r) => h('option', { value: r.id, selected: r.id === rivalId }, r.name)));
    const s = sheet({
      title: t('match.edit'),
      body: h('div', { class: 'stack' },
        field(t('date'), h('input', { type: 'date', value: date, onchange: (e) => { date = e.target.value; } })),
        field(t('rival'), rivalSel),
        segmented([{ value: 'home', label: t('home') }, { value: 'away', label: t('away') }], ha, (v) => { ha = v; }),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn danger', type: 'button', onclick: async () => {
            s.close();
            if (await confirmDialog(t('match.delete_q'), { yes: t('delete'), no: t('cancel'), danger: true, detail: t('match.delete_hint') })) {
              enqueue({ op: 'match.delete', id }); toast(t('deleted')); location.hash = '#/';
            }
          } }, t('match.delete')),
          h('button', { class: 'btn primary', type: 'button', onclick: () => {
            enqueue({ op: 'match.update', id, fields: { date, rival_id: rivalId, home_away: ha } });
            s.close(); toast(t('saved')); render();
          } }, t('save')))),
    });
  }

  function render() {
    const ev = data.events;
    const c = totalCounters(ev, data.adjustments);
    const adjusted = Object.fromEntries(data.adjustments.map((a) => [a.stat, true]));
    const pend = ev.filter(isPending).length;
    const rival = m.rival || rivalName(m.rival_id);
    screen.replaceChildren(
      backBar(`${rival} · ${fmtDate(m.date)}`, () => (location.hash = '#/'), h('button', { class: 'btn small', type: 'button', onclick: editMatch }, t('edit'))),
      h('div', { class: 'row-actions' },
        h('a', { class: 'btn primary', href: `#/match/${id}` }, t('go_annotate')),
        h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, t('export.pdf'))),
      h('div', { class: 'score big-score' }, h('b', null, c.goals), ' – ', h('b', null, c.goals_against), h('span', { class: 'muted small' }, ` ${t('score.legend')}`)),
      countersGrid(c, { adjusted }),
      data.adjustments.length ? h('p', { class: 'muted small' }, '* ', t('adj.legend')) : null,
      warningsBox(c),
      percentBlock(c, state.thresholds),
      h('h2', null, t('events.title', { n: ev.length }), pend ? h('span', { class: 'badge' }, t('pending.badge', { n: pend })) : null),
      ev.length ? h('div', { class: 'ev-list' }, [...ev].reverse().map((e) =>
        h('button', { type: 'button', class: `ev-row${isPending(e) ? ' pending' : ''}`, onclick: () => editEvent(e) },
          h('span', { class: 'ev-time' }, hhmm(e.created_at), e.part ? ` · ${e.part}ª` : ''),
          h('span', { class: 'ev-type' }, t(`ev.${e.type}`)),
          h('span', { class: 'ev-desc muted small' }, isPending(e) ? t('pending.badge1') : describe(e)),
          h('span', { class: 'chev' }, '›')))) : h('p', { class: 'muted' }, t('events.none')),
      playersTable({ rows: playerStats(ev).filter((r) => r.player_id), unassigned: unassignedPlayers(c, playerStats(ev)) }, nameOf),
      keepersTable({ rows: goalkeeperStats(ev).filter((r) => r.player_id), unassigned: unassignedGoalkeepers(c, goalkeeperStats(ev)) }, nameOf),
      h('h2', null, t('maps.title')), mapsBlock(zoneStats(ev), cellStats(ev), ev.some((e) => e.zone || e.goal_cell)));
  }
  render();
}
