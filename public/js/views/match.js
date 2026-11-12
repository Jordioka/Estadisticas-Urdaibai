// Pantalla de anotación: lo mínimo en pantalla (botones, contadores y deshacer).
import { h, toast, vibrate, uid, fmtDate, sheet, confirmDialog, choiceDialog } from '../dom.js';
import { t } from '../i18n.js';
import { state, getMatch, setLive, enqueue, rivalName, playersOf, flush } from '../store.js';
import { totalCounters, eventsToCounters, isPending, SHOT_TYPES_ALL, LOSS_KINDS, REC_KINDS } from '../stats.js';
import { countersGrid, warningsBox, segmented, errMsg } from '../ui.js';
import { openDetailSheet } from '../shot-sheet.js';

const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* nada */ } };

export const ACTIONS = {
  attack: ['goal', 'shot_miss', 'loss'],
  defense: ['goal_against', 'save', 'shot_against_miss'],
};

// Vista completa = columnas del Excel del club. grid: pide el punto de la portería (opcional).
const SHOT_BTNS = [ // LANZAMIENTOS
  { k: 'goal', label: 'adv.b.goal', type: 'goal', grid: true },
  { k: 'fast_goal', label: 'adv.b.fast_goal', type: 'goal', phase: 'contraataque', grid: true },
  { k: 'out', label: 'adv.b.out', type: 'shot_miss', result: 'out' },
  { k: 'saved', label: 'adv.b.saved', type: 'shot_miss', result: 'save', grid: true },
  { k: 'fast_miss', label: 'adv.b.fast_miss', type: 'shot_miss', phase: 'contraataque' },
];
const LOSS_BTNS = LOSS_KINDS.map((k) => ({ k: `loss_${k}`, label: `sub.${k}`, type: 'loss', subtype: k })); // PÉRDIDAS
const REC_BTNS = REC_KINDS.map((k) => ({ k: `rec_${k}`, label: `sub.${k}`, type: 'recovery', subtype: k })); // RECUPERACIONES
const SANC_BTNS = [{ k: 'dos_min', label: 'sub.dos_min', type: 'sanction', subtype: 'dos_min' }]; // AMONESTACIONES
const GK_BTNS = [ // PORTERO · DURANTE EL JUEGO
  { k: 'g_save', label: 'adv.b.g_save', type: 'save', grid: true },
  { k: 'g_goal', label: 'adv.b.g_goal', type: 'goal_against', grid: true },
  { k: 'g_out', label: 'adv.b.g_out', type: 'shot_against_miss', result: 'out' },
  { k: 'cp_ok', label: 'sub.ok', type: 'counter_pass', subtype: 'ok' },
  { k: 'cp_fallo', label: 'sub.fallo', type: 'counter_pass', subtype: 'fallo' },
];
const PEN_BTNS = [ // PORTERO · PENALTIS
  { k: 'p_save', label: 'adv.b.g_save', type: 'save', phase: 'penalti', zone: '7M', grid: true },
  { k: 'p_goal', label: 'adv.b.g_goal', type: 'goal_against', phase: 'penalti', zone: '7M', grid: true },
  { k: 'p_out', label: 'adv.b.g_out', type: 'shot_against_miss', result: 'out', phase: 'penalti', zone: '7M' },
];
// ¿Este evento cuenta para este botón? (misma clasificación que las tablas de jugadores)
function matchesBtn(e, d) {
  if (e.type !== d.type) return false;
  if (d.subtype && e.subtype !== d.subtype) return false;
  const fast = e.phase === 'contraataque', pen = e.phase === 'penalti';
  if (d.type === 'goal') return fast === (d.phase === 'contraataque');
  if (d.type === 'shot_miss') {
    if (d.phase === 'contraataque') return fast;
    return !fast && (d.result === 'save' ? e.result === 'save' : e.result !== 'save');
  }
  if (['save', 'goal_against', 'shot_against_miss'].includes(d.type)) return pen === (d.phase === 'penalti');
  return true;
}
const NONE = 'none'; // "Sin jugador"

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
  const valid = (v, list) => (v === NONE || list.some((p) => p.id === v) ? v : null);
  let selPlayer = valid(lsGet(`urd.pl.${id}`, null), teamPlayers);
  let selKeeper = valid(lsGet(`urd.gk.${id}`, null), goalkeepers) || (goalkeepers.length === 1 ? goalkeepers[0].id : null);
  let goalDetail = lsGet('urd.gd', '1') === '1'; // pedir el punto de la portería al anotar

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

  // Anota (o completa uno "pendiente" de la vista sencilla, sin duplicar)
  async function commitEvent(d, base, extra = {}) {
    const fields = { ...base, ...extra };
    if (SHOT_TYPES_ALL.includes(d.type)) {
      const pend = pendingOfType(d.type);
      if (pend.length) {
        const choice = await choiceDialog(t('shot.is_pending', { n: pend.length, what: t(`ev.${d.type}`).toLowerCase() }),
          [...pend.slice(0, 6).map((p, i) => ({ value: p.id, label: `${t('shot.yes_pending')} #${i + 1} · ${t(`ev.${p.type}`)}${p.part ? ' · ' + p.part + 'ª' : ''}`, primary: i === 0 })),
            { value: 'new', label: t('shot.no_new') }], { detail: t('shot.pending_hint') });
        if (choice === null) return;
        if (choice !== 'new') {
          enqueue({ op: 'event.update', id: choice, match_id: id, fields: { type: d.type, ...fields } });
          vibrate(); toast(t('completed')); render(); return;
        }
      }
    }
    addEventOp(id, d.type, fields, part);
    vibrate(); toast(t('noted', { what: d.subtype ? t(`sub.${d.subtype}`) : t(`ev.${d.type}`) })); render();
  }

  // d = botón; kind = 'player' | 'keeper'
  async function advTap(d, kind) {
    const who = kind === 'player' ? selPlayer : selKeeper;
    const needs = kind === 'player' || goalkeepers.length > 0;
    if (who == null && needs) { toast(t(kind === 'player' ? 'adv.pick_player' : 'adv.pick_keeper')); return; }
    const now = Date.now(), key = `${d.k}|${who}`;
    if (last.type === key && now - last.at < 800) {
      const ok = await confirmDialog(t('double.q', { what: t(d.label) }), { yes: t('double.yes'), no: t('double.no') });
      if (!ok) { last.at = Date.now(); return; }
    }
    last = { type: key, at: Date.now() };
    const base = { result: d.result || null, phase: d.phase || null, subtype: d.subtype || null, zone: d.zone || null };
    const pid = who === NONE ? null : who;
    if (kind === 'player') base.player_id = pid; else base.goalkeeper_id = pid;
    if (d.grid && goalDetail) {
      openDetailSheet({ quick: true, type: d.type, zone: d.zone, title: t(d.label), onSave: (f) => commitEvent(d, base, f) });
    } else commitEvent(d, base);
  }

  function completePending(ev) {
    openDetailSheet({
      event: ev, title: t(`ev.${ev.type}`), people: teamPlayers, keepers: goalkeepers,
      onSave: (fields) => { enqueue({ op: 'event.update', id: ev.id, match_id: id, fields }); toast(t('completed')); render(); },
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
      : advancedButtons();

    function advancedButtons() {
      const count = (d, kind) => {
        const who = kind === 'player' ? selPlayer : selKeeper;
        if (who == null) return 0;
        const f = kind === 'player' ? 'player_id' : 'goalkeeper_id';
        return events().filter((e) => matchesBtn(e, d) && (who === NONE ? !e[f] : e[f] === who)).length;
      };
      const ab = (d, kind) => {
        const n = count(d, kind);
        return h('button', { type: 'button', class: `act sm${n ? ' has' : ''}`, onclick: () => advTap(d, kind) },
          h('span', { class: 'act-l' }, t(d.label)), h('span', { class: 'act-n', 'aria-label': String(n) }, n || ''));
      };
      const chipsFor = (list, cur, set, key, noneLabel) => h('div', { class: 'chips people' },
        list.map((p) => h('button', { type: 'button', class: `chip${cur === p.id ? ' on' : ''}`, 'aria-pressed': cur === p.id ? 'true' : 'false', onclick: () => { set(p.id); lsSet(key, p.id); render(); } }, h('b', null, p.number ?? '·'), ' ', p.name, p.surname ? ' ' + p.surname : '')),
        noneLabel ? h('button', { type: 'button', class: `chip${cur === NONE ? ' on' : ''}`, 'aria-pressed': cur === NONE ? 'true' : 'false', onclick: () => { set(NONE); lsSet(key, NONE); render(); } }, noneLabel) : null);
      return [
        h('div', { class: 'adv-toggle' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: goalDetail, onchange: (e) => { goalDetail = e.target.checked; lsSet('urd.gd', goalDetail ? '1' : '0'); } }), ' ', t('adv.detail_goal'))),
        h('h2', { class: 'grp' }, t('adv.player')),
        chipsFor(teamPlayers, selPlayer, (v) => { selPlayer = v; }, `urd.pl.${id}`, t('shot.no_player')),
        h('h2', { class: 'grp' }, t('adv.shots')), h('div', { class: 'acts' }, SHOT_BTNS.map((d) => ab(d, 'player'))),
        h('h2', { class: 'grp' }, t('adv.losses')), h('div', { class: 'acts' }, LOSS_BTNS.map((d) => ab(d, 'player'))),
        h('h2', { class: 'grp' }, t('adv.recoveries')), h('div', { class: 'acts' }, REC_BTNS.map((d) => ab(d, 'player'))),
        h('h2', { class: 'grp' }, t('adv.sanctions')), h('div', { class: 'acts' }, SANC_BTNS.map((d) => ab(d, 'player'))),
        h('h2', { class: 'grp' }, t('adv.keeper')),
        goalkeepers.length ? chipsFor(goalkeepers, selKeeper, (v) => { selKeeper = v; }, `urd.gk.${id}`, null) : h('p', { class: 'muted small' }, t('shot.no_keepers_hint')),
        h('h3', { class: 'sub' }, t('adv.game')), h('div', { class: 'acts' }, GK_BTNS.map((d) => ab(d, 'keeper'))),
        h('h3', { class: 'sub' }, t('adv.penalties')), h('div', { class: 'acts' }, PEN_BTNS.map((d) => ab(d, 'keeper'))),
        pend.length ? h('div', { class: 'pending' },
          h('h2', { class: 'grp' }, t('pending.title', { n: pend.length })),
          h('p', { class: 'muted small' }, t('pending.hint')),
          pend.map((ev) => h('div', { class: 'row' },
            h('span', null, t(`ev.${ev.type}`), ev.part ? ` · ${ev.part}ª` : ''),
            h('button', { class: 'btn small', type: 'button', onclick: () => completePending(ev) }, t('complete'))))) : null,
      ];
    }

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
