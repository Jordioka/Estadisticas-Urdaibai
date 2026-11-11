// Pantalla de anotación: lo mínimo en pantalla (botones, contadores y deshacer).
import { h, toast, vibrate, uid, fmtDate, sheet, confirmDialog } from '../dom.js';
import { t } from '../i18n.js';
import { state, getMatch, setLive, enqueue, rivalName, playersOf, flush } from '../store.js';
import { totalCounters, eventsToCounters, isPending, COUNTERS } from '../stats.js';
import { countersGrid, warningsBox, segmented, errMsg } from '../ui.js';
import { openShotSheet, openPlayerPick } from '../shot-sheet.js';

const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* nada */ } };

export const ACTIONS = {
  attack: ['possession', 'goal', 'shot_miss', 'loss'],
  defense: ['goal_against', 'save', 'shot_against_miss'],
};

// Convierte en eventos una acción de equipo (vista simple)
export function addEventOp(matchId, type, extra = {}, part = null) {
  const op = { op: 'event.create', id: uid('ev'), match_id: matchId, type, part, ts: new Date().toISOString(), ...extra };
  enqueue(op);
  return op;
}

export async function matchView(root, { id }) {
  let data;
  try { data = await getMatch(id); }
  catch (e) { root.append(h('div', { class: 'page' }, h('p', { class: 'warn' }, e.code === 'not_cached' ? t('err.not_cached') : errMsg(e)), h('a', { class: 'btn', href: '#/' }, t('back')))); return; }
  setLive(data);
  const m = data.match;
  const teamPlayers = playersOf(m.team_id);
  const goalkeepers = teamPlayers.filter((p) => p.is_goalkeeper);
  const rival = m.rival || rivalName(m.rival_id);
  let mode = lsGet('urd.mode', 'simple');
  let part = Number(lsGet(`urd.part.${id}`, '0')) || null;
  let last = { type: null, at: 0 };

  const screen = h('div', { class: 'page match' });
  root.append(screen);

  const events = () => data.events;
  const counters = () => totalCounters(events(), data.adjustments);

  async function tap(type, extra = {}) {
    const now = Date.now();
    if (last.type === type && now - last.at < 1000) { // doble toque accidental
      const ok = await confirmDialog(t('double.q', { what: t(`ev.${type}`) }), { yes: t('double.yes'), no: t('double.no') });
      if (!ok) { last.at = Date.now(); return; }
    }
    last = { type, at: Date.now() };
    addEventOp(id, type, extra, part);
    vibrate();
    toast(t('noted', { what: t(`ev.${type}`) }));
    render();
  }

  function undo() {
    const ev = events().at(-1);
    if (!ev) return;
    enqueue({ op: 'event.delete', id: ev.id, match_id: id });
    toast(t('undone', { what: t(`ev.${ev.type}`) }));
    last = { type: null, at: 0 };
    render();
  }

  const pendingOfType = (type) => events().filter((e) => isPending(e) && e.type === type);

  function shotFlow(side) {
    openShotSheet({
      side, people: side === 'own' ? teamPlayers : goalkeepers, pendingOfType,
      onSave: ({ type, fields, completeId }) => {
        const { type: _t, ...rest } = fields;
        if (completeId) enqueue({ op: 'event.update', id: completeId, match_id: id, fields: { type, ...rest } });
        else addEventOp(id, type, rest, part);
        vibrate(); toast(t('noted', { what: t(`ev.${type}`) })); render();
      },
    });
  }

  function personFlow(type) {
    openPlayerPick({
      title: t(`ev.${type}`), players: teamPlayers,
      onPick: (pid) => { addEventOp(id, type, pid ? { player_id: pid } : {}, part); vibrate(); toast(t('noted', { what: t(`ev.${type}`) })); render(); },
    });
  }

  function completePending(ev) {
    const side = ['goal', 'shot_miss'].includes(ev.type) ? 'own' : 'against';
    openShotSheet({
      side, event: ev, people: side === 'own' ? teamPlayers : goalkeepers, pendingOfType: () => [],
      onSave: ({ type, fields }) => {
        const { type: _t, ...rest } = fields;
        enqueue({ op: 'event.update', id: ev.id, match_id: id, fields: { type, ...rest } });
        toast(t('completed')); render();
      },
    });
  }

  // Corregir un total directamente: se guarda como ajuste visible
  function adjust(stat) {
    const evTotal = eventsToCounters(events())[stat];
    const adj = data.adjustments.find((a) => a.stat === stat)?.delta || 0;
    let value = evTotal + adj;
    const input = h('input', { type: 'number', inputmode: 'numeric', min: 0, value, 'aria-label': t(`stat.${stat}`),
      oninput: (e) => { value = Math.max(0, parseInt(e.target.value || '0', 10) || 0); note(); } });
    const noteEl = h('p', { class: 'muted' });
    const note = () => {
      const delta = value - evTotal;
      noteEl.textContent = evTotal > 0
        ? t('adj.note_events', { n: evTotal, total: value, delta: (delta > 0 ? '+' : '') + delta })
        : t('adj.note_none', { total: value });
    };
    note();
    const step = (d) => { value = Math.max(0, (parseInt(input.value || '0', 10) || 0) + d); input.value = value; note(); };
    const s = sheet({
      title: t('adj.title', { what: t(`stat.${stat}`) }),
      body: [
        h('div', { class: 'stepper' },
          h('button', { class: 'btn', type: 'button', 'aria-label': '−1', onclick: () => step(-1) }, '−'), input,
          h('button', { class: 'btn', type: 'button', 'aria-label': '+1', onclick: () => step(1) }, '+')),
        noteEl,
        h('div', { class: 'btn-row' },
          adj ? h('button', { class: 'btn', type: 'button', onclick: () => { enqueue({ op: 'adj.set', match_id: id, stat, delta: 0 }); s.close(); render(); } }, t('adj.remove')) : null,
          h('button', { class: 'btn primary', type: 'button', onclick: () => { enqueue({ op: 'adj.set', match_id: id, stat, delta: value - evTotal }); s.close(); render(); toast(t('adj.saved')); } }, t('save'))),
      ],
    });
  }

  function render() {
    const c = counters();
    const adjusted = Object.fromEntries(data.adjustments.map((a) => [a.stat, true]));
    const lastEv = events().at(-1);
    const pend = events().filter(isPending);
    const btn = (type, hintKey, onclick, cls = '') => h('button', { type: 'button', class: `act ${cls}`, onclick },
      h('span', { class: 'act-l' }, t(`act.${type}`)), h('span', { class: 'act-h' }, t(hintKey || `act.${type}.h`)));

    const buttons = mode === 'simple'
      ? [
        h('h2', { class: 'grp' }, t('grp.attack')),
        h('div', { class: 'acts' }, ACTIONS.attack.map((tp) => btn(tp, null, () => tap(tp), `a-${tp}`))),
        h('h2', { class: 'grp' }, t('grp.defense')),
        h('div', { class: 'acts' }, ACTIONS.defense.map((tp) => btn(tp, null, () => tap(tp), `a-${tp}`))),
      ]
      : [
        h('h2', { class: 'grp' }, t('grp.attack')),
        h('div', { class: 'acts' },
          btn('shot', 'adv.shot.h', () => shotFlow('own'), 'a-goal'), btn('loss', null, () => personFlow('loss'), 'a-loss'),
          btn('possession', null, () => personFlow('possession'), 'a-possession')),
        h('h2', { class: 'grp' }, t('grp.defense')),
        h('div', { class: 'acts' }, btn('shot_against', 'adv.shot_against.h', () => shotFlow('against'), 'a-goal_against')),
        pend.length ? h('div', { class: 'pending' },
          h('h2', { class: 'grp' }, t('pending.title', { n: pend.length })),
          h('p', { class: 'muted small' }, t('pending.hint')),
          pend.map((ev) => h('div', { class: 'row' },
            h('span', null, t(`ev.${ev.type}`), ev.part ? ` · ${ev.part}ª` : ''),
            h('button', { class: 'btn small', type: 'button', onclick: () => completePending(ev) }, t('complete'))))) : null,
      ];

    screen.replaceChildren(
      h('div', { class: 'subbar' },
        h('a', { class: 'icon-btn', href: '#/', 'aria-label': t('back') }, '←'),
        h('div', { class: 'title-block' }, h('h1', null, `${m.home_away === 'away' ? '@ ' : ''}${rival}`), h('span', { class: 'muted small' }, `${fmtDate(m.date)}${m.is_practice ? ' · ' + t('practice') : ''}`)),
        h('a', { class: 'btn small', href: `#/summary/${id}` }, t('summary'))),
      h('div', { class: 'scorebar' }, h('div', { class: 'score' }, h('b', null, c.goals), ' – ', h('b', null, c.goals_against)),
        segmented([{ value: 0, label: '–' }, { value: 1, label: '1ª' }, { value: 2, label: '2ª' }], part || 0, (v) => { part = v || null; lsSet(`urd.part.${id}`, String(v)); render(); }, t('part'))),
      countersGrid(c, { onTap: adjust, adjusted }),
      warningsBox(c),
      h('div', { class: 'modebar' }, segmented([{ value: 'simple', label: t('mode.simple') }, { value: 'advanced', label: t('mode.advanced') }], mode, (v) => { mode = v; lsSet('urd.mode', v); render(); }, t('mode.label'))),
      ...buttons,
      h('div', { class: 'undo-bar' },
        h('button', { class: 'btn undo', type: 'button', disabled: !lastEv, onclick: undo },
          '↶ ', lastEv ? t('undo.last', { what: t(`ev.${lastEv.type}`) }) : t('undo'))));
  }

  render();
  flush().catch(() => {});
}
