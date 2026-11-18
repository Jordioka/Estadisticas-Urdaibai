// Pantalla de anotación: lo mínimo en pantalla (botones, contadores y deshacer).
import { h, toast, vibrate, uid, fmtDate, sheet, confirmDialog, choiceDialog } from '../dom.js';
import { t } from '../i18n.js';
import { state, getMatch, setLive, enqueue, rivalName, playersOf, squadOf, flush } from '../store.js';
import { keepAwake } from '../prefs.js';
import { totalCounters, eventsToCounters, isPending, keeperCoverage, GOAL_CELLS, SHOT_TYPES_ALL, LOSS_KINDS, REC_KINDS } from '../stats.js';
import { countersGrid, warningsBox, segmented, errMsg } from '../ui.js';
import { openDetailSheet } from '../shot-sheet.js';
import { keeperMap, keeperPanel } from '../keeper-map.js';
import { createClock, fmt as fmtClock } from '../clock.js';

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
const clocks = new Map(); // cronómetro de cada partido abierto: cada botón pulsado se asocia a su minuto
export function addEventOp(matchId, type, extra = {}, part = null) {
  const st = clocks.get(matchId)?.stamp() || null;
  const op = { op: 'event.create', id: uid('ev'), match_id: matchId, type, part: st ? st.part : part, minute: st ? st.minute : null, ts: new Date().toISOString(), ...extra };
  if (extra.minute == null) op.minute = st ? st.minute : null; // el detalle puede traer minute:null y no debe borrar el del reloj
  if (extra.part == null) op.part = st ? st.part : part;
  enqueue(op);
  return op;
}

export async function matchView(root, { id }) {
  let data;
  try { data = await getMatch(id); }
  catch (e) { root.append(h('div', { class: 'page' }, h('p', { class: 'warn' }, e.code === 'not_cached' ? t('err.not_cached') : errMsg(e)), h('a', { class: 'btn', href: '#/' }, t('back')))); return; }
  setLive(data);
  const m = data.match;
  let teamPlayers = squadOf(m); // solo los convocados (o toda la plantilla si no se ha marcado a nadie)
  let goalkeepers = teamPlayers.filter((p) => p.is_goalkeeper);
  const refreshSquad = () => { teamPlayers = squadOf(m); goalkeepers = teamPlayers.filter((p) => p.is_goalkeeper); };
  const rival = m.rival || rivalName(m.rival_id);
  let mode = lsGet('urd.mode', 'simple');
  let part = Number(lsGet(`urd.part.${id}`, '0')) || null;
  let last = { type: null, at: 0 };
  const valid = (v, list) => (v === NONE || list.some((p) => p.id === v) ? v : null);
  let selPlayer = valid(lsGet(`urd.pl.${id}`, null), teamPlayers);
  let selKeeper = valid(lsGet(`urd.gk.${id}`, null), goalkeepers) || (goalkeepers.length === 1 ? goalkeepers[0].id : null);
  let goalDetail = lsGet('urd.gd', '1') === '1'; // pedir el punto de la portería al anotar
  let gkRemove = false, gkAddAll = false, gkZone = null, gkCell = null; // pestaña Portería: cuadrado y zona son obligatorios

  const screen = h('div', { class: 'page match' });
  root.append(screen);
  const release = keepAwake(); // la pantalla no se apaga mientras se anota
  const onHash = () => { if (location.hash !== `#/match/${id}`) { release(); clearInterval(clockTimer); clocks.delete(id); window.removeEventListener('hashchange', onHash); } };
  window.addEventListener('hashchange', onHash);

  const events = () => data.events;

  // ---- Cronómetro (arriba del todo): parar / reanudar; los eventos guardan su minuto y parte ----
  const clock = createClock(id); clocks.set(id, clock);
  const timeEl = h('button', { type: 'button', class: 'clock-time', 'aria-label': t('clock.edit'), onclick: () => editClock() });
  const playBtn = h('button', { type: 'button', class: 'btn primary clock-btn', onclick: () => { clock.toggle(); vibrate(); paintClock(); if (clock.used()) syncPart(true); } });
  const clockBar = h('div', { class: 'clockbar' }, timeEl, playBtn);
  let lastDerived = clock.used() ? clock.part() : null;
  const STEP = { start: 'clock.start', half2: 'clock.half2', ot: 'clock.ot', resume: 'clock.resume' };
  function paintClock() {
    const e = clock.elapsed();
    timeEl.textContent = fmtClock(e);
    timeEl.classList.toggle('ot', e > 3600);
    timeEl.classList.toggle('run', clock.running());
    const step = clock.nextStep();
    playBtn.textContent = step ? `▶ ${t(STEP[step])}` : `⏸ ${t('clock.pause')}`;
    playBtn.classList.toggle('on', !step);
  }
  // La parte (1ª/2ª) sigue al reloj; se puede corregir a mano y no se pisa hasta que el reloj cambie de parte
  function syncPart(force) {
    if (!clock.used()) return;
    const p = clock.part();
    if (force || p !== lastDerived) { lastDerived = p; if (part !== p) { part = p; lsSet(`urd.part.${id}`, String(p)); render(); } }
  }
  const clockTimer = setInterval(() => {
    const hit = clock.tick();
    paintClock();
    if (hit != null) { vibrate(200); toast(t(hit === 1800 ? 'clock.end_half' : hit === 3600 ? 'clock.end_full' : 'clock.end_ot')); }
    syncPart(false);
  }, 250);
  function editClock() {
    const e = Math.round(clock.elapsed());
    const mm = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 90, value: Math.floor(e / 60) });
    const ss = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 59, value: e % 60 });
    const s = sheet({ title: t('clock.edit'), body: h('div', { class: 'stack' },
      h('div', { class: 'btn-row' }, h('label', { class: 'field' }, h('span', { class: 'field-l' }, t('clock.min')), mm), h('label', { class: 'field' }, h('span', { class: 'field-l' }, t('clock.sec')), ss)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn danger', type: 'button', onclick: async () => { s.close(); if (await confirmDialog(t('clock.reset_q'), { yes: t('clock.reset'), no: t('cancel'), danger: true })) { clock.reset(); lastDerived = null; paintClock(); } } }, t('clock.reset')),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { clock.set((Number(mm.value) || 0) * 60 + Math.min(59, Number(ss.value) || 0)); lastDerived = clock.part(); s.close(); paintClock(); syncPart(true); } }, t('save')))) });
  }
  paintClock();
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
    toast(t('noted', { what: t(`ev.${type}`) }), 'ok', { label: t('undo.short'), run: undo });
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
    vibrate(); toast(t('noted', { what: d.subtype ? t(`sub.${d.subtype}`) : t(`ev.${d.type}`) }), 'ok', { label: t('undo.short'), run: undo }); render();
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

  // Convocados: quién juega hoy (los chips de anotación solo muestran a esos)
  function editSquad() {
    const all = playersOf(m.team_id);
    const cur = new Set((Array.isArray(m.squad) && m.squad.length ? m.squad : all.map((p) => p.id)));
    const list = h('div', { class: 'squad-list' });
    const count = h('p', { class: 'muted small' });
    const draw = () => {
      list.replaceChildren(all.map((p) => h('label', { class: 'check squad-row' },
        h('input', { type: 'checkbox', checked: cur.has(p.id), onchange: (e) => { if (e.target.checked) cur.add(p.id); else cur.delete(p.id); draw(); } }),
        h('b', null, p.number ?? '·'), ' ', `${p.name}${p.surname ? ' ' + p.surname : ''}`, p.is_goalkeeper ? ' 🧤' : '')));
      count.textContent = t('squad.count', { n: cur.size, total: all.length });
    };
    draw();
    const s = sheet({
      title: t('squad.title'),
      body: [h('p', { class: 'muted' }, t('squad.hint')), count,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => { all.forEach((p) => cur.add(p.id)); draw(); } }, t('squad.all')),
          h('button', { class: 'btn', type: 'button', onclick: () => { cur.clear(); draw(); } }, t('squad.none'))),
        list,
        h('div', { class: 'btn-row sticky-save' }, h('button', { class: 'btn primary big', type: 'button', onclick: () => {
          const ids = all.filter((p) => cur.has(p.id)).map((p) => p.id);
          const squad = ids.length && ids.length < all.length ? ids : null; // todos o ninguno = toda la plantilla
          enqueue({ op: 'match.update', id, fields: { squad } });
          m.squad = squad; refreshSquad();
          if (selPlayer && selPlayer !== NONE && !teamPlayers.some((p) => p.id === selPlayer)) selPlayer = null;
          if (selKeeper && !goalkeepers.some((p) => p.id === selKeeper)) selKeeper = goalkeepers.length === 1 ? goalkeepers[0].id : null;
          s.close(); toast(t('saved')); render();
        } }, t('save')))],
    });
  }

  // Pestaña Portería: 1) cuadrado, 2) zona, 3) parada o gol. Hasta que no están los dos no hay botones.
  // Si el partido ya traía esos totales (Excel simple…) el detalle NO se suma otra vez; si te pasas, pregunta antes de sumarlo.
  const keeperMine = (who) => (e) => who === 'all' || (e.goalkeeper_id || null) === (who === NONE ? null : who);
  async function commit(type) {
    if (gkCell == null || !gkZone) return;
    if (goalkeepers.length && selKeeper == null) { toast(t('adv.pick_keeper')); return; }
    const gid = selKeeper && selKeeper !== NONE ? selKeeper : null;
    const cell = gkCell, zone = gkZone;
    if (gkRemove) {
      const ev = [...events()].reverse().find((e) => e.type === type && Number(e.goal_cell) === cell && e.zone === zone && (e.goalkeeper_id || null) === gid);
      if (!ev) { toast(t('gk.nothing')); return; }
      enqueue({ op: 'event.delete', id: ev.id, match_id: id });
      gkCell = null; gkZone = null; vibrate(); toast(t('gk.removed')); render(); return;
    }
    const fields = { goalkeeper_id: gid, goal_cell: cell, zone, ...(zone === '7M' ? { phase: 'penalti' } : {}) };
    const cov = keeperCoverage(events(), data.adjustments, type);
    const done = (msg) => { gkCell = null; gkZone = null; vibrate(); toast(msg, 'ok', { label: t('undo.short'), run: undo }); render(); };
    if (cov.pending > 0) { // ya estaba anotada en la vista simple: se completa, no se duplica
      const pend = events().find((e) => isPending(e) && e.type === type);
      enqueue({ op: 'event.update', id: pend.id, match_id: id, fields });
      return done(t('completed'));
    }
    if (cov.free > 0) { // ya está en los totales del partido: solo se guarda el detalle
      addEventOp(id, type, { ...fields, detail_only: 1 }, part);
      return done(t('gk.detail_saved'));
    }
    if (cov.hasBase && !gkAddAll) { // te pasas de los totales del partido
      const choice = await choiceDialog(t('gk.over', { what: t(`ev.${type}`).toLowerCase(), detail: cov.detail, total: cov.total }),
        [{ value: 'add', label: t('gk.over.add'), primary: true }, { value: 'all', label: t('gk.over.all') }], { detail: t('gk.over.hint') });
      if (!choice) return;
      if (choice === 'all') gkAddAll = true;
    }
    addEventOp(id, type, fields, part);
    done(t('noted', { what: t(`ev.${type}`) }));
  }

  // Vista rápida (en cualquier pestaña): consulta; una sola selección (cuadrado o zona)
  function openKeeperMap() {
    sheet({ title: `🧤 ${t('gk.map')}`, full: true, body: keeperPanel({ events: events(), keepers: goalkeepers, who: selKeeper && selKeeper !== NONE ? selKeeper : 'all' }) });
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

    const buildButtons = () => mode === 'simple'
      ? [
        h('h2', { class: 'grp' }, t('grp.attack')),
        h('div', { class: 'acts' }, ACTIONS.attack.map((tp) => btn(tp, null, () => tap(tp), `a-${tp}`))),
        h('h2', { class: 'grp' }, t('grp.defense')),
        h('div', { class: 'acts' }, ACTIONS.defense.map((tp) => btn(tp, null, () => tap(tp), `a-${tp}`))),
      ]
      : mode === 'keeper' ? keeperTab() : advancedButtons();

    // Botones con contador y chips de jugador/portero (comunes a «Más detalle» y «Portería»)
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

    function keeperTab() {
      const sel = selKeeper === NONE ? null : selKeeper;
      const ready = gkCell != null && !!gkZone;
      const cov = { save: keeperCoverage(events(), data.adjustments, 'save'), goal_against: keeperCoverage(events(), data.adjustments, 'goal_against') };
      const covLine = (type) => { const k = cov[type]; return h('span', { class: k.withCell > k.total ? 'warn' : '' }, t('gk.cover', { what: t(`ev.${type}`), n: k.withCell, total: k.total })); };
      const chip = (on, label, fn) => h('button', { type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label);
      const step = gkCell == null ? t('gk.step1') : !gkZone ? t('gk.step2', { cell: gkCell }) : t('gk.ready', { cell: gkCell, zone: t(`zone.${gkZone}`) });
      const act = (type, icon) => h('button', { type: 'button', class: `act a-${type}`, onclick: () => commit(type) },
        h('span', { class: 'act-l' }, `${icon} ${gkRemove ? '− ' : ''}${t(`ev.${type}`)}`));
      return [
        h('h2', { class: 'grp' }, t('adv.keeper')),
        goalkeepers.length ? chipsFor(goalkeepers, selKeeper, (v) => { selKeeper = v; }, `urd.gk.${id}`, null) : h('p', { class: 'muted small' }, t('shot.no_keepers_hint')),
        keeperMap({ events: events(), mine: keeperMine(sel ? sel : goalkeepers.length ? NONE : 'all'), cell: gkCell, zone: gkZone, filter: false,
          onCell: (c) => { gkCell = gkCell === c ? null : c; render(); }, onZone: (z) => { gkZone = gkZone === z ? null : z; render(); } }),
        h('div', { class: 'gk-dock' },
          h('p', { class: 'gk-steps', 'aria-live': 'polite' }, h('span', { class: ready ? 'ok' : '' }, step)),
          ready ? h('div', { class: 'gk-actions' }, act('save', '🧤'), act('goal_against', '⚽')) : null),
        h('div', { class: 'chips gk-modes' },
          chip(gkRemove, `− ${t('gk.remove')}`, () => { gkRemove = !gkRemove; render(); }),
          gkCell != null || gkZone ? chip(false, t('gk.clear'), () => { gkCell = null; gkZone = null; render(); }) : null),
        h('div', { class: 'gk-cover muted small' }, covLine('save'), covLine('goal_against')),
        h('h3', { class: 'sub' }, t('gk.others')),
        h('div', { class: 'acts' }, [GK_BTNS[2], GK_BTNS[3], GK_BTNS[4], PEN_BTNS[2]].map((d) => ab(d, 'keeper'))),
        pend.filter((e) => ['save', 'goal_against', 'shot_against_miss'].includes(e.type)).length ? h('div', { class: 'pending' },
          h('h2', { class: 'grp' }, t('pending.title', { n: pend.filter((e) => ['save', 'goal_against', 'shot_against_miss'].includes(e.type)).length })),
          h('p', { class: 'muted small' }, t('gk.pending_hint'))) : null,
      ];
    }

    function advancedButtons() {
      return [
        h('div', { class: 'adv-toggle' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: goalDetail, onchange: (e) => { goalDetail = e.target.checked; lsSet('urd.gd', goalDetail ? '1' : '0'); } }), ' ', t('adv.detail_goal'))),
        h('div', { class: 'grp-row' }, h('h2', { class: 'grp' }, t('adv.player')),
          h('button', { type: 'button', class: 'btn small', onclick: editSquad }, `${t('squad.btn')} (${teamPlayers.length})`)),
        chipsFor(teamPlayers, selPlayer, (v) => { selPlayer = v; }, `urd.pl.${id}`, t('shot.no_player')),
        h('h2', { class: 'grp' }, t('adv.shots')), h('div', { class: 'acts' }, SHOT_BTNS.map((d) => ab(d, 'player'))),
        h('h2', { class: 'grp' }, t('adv.losses')), h('div', { class: 'acts' }, LOSS_BTNS.map((d) => ab(d, 'player'))),
        h('h2', { class: 'grp' }, t('adv.recoveries')), h('div', { class: 'acts' }, REC_BTNS.map((d) => ab(d, 'player'))),
        h('h2', { class: 'grp' }, t('adv.sanctions')), h('div', { class: 'acts' }, SANC_BTNS.map((d) => ab(d, 'player'))),
        pend.length ? h('div', { class: 'pending' },
          h('h2', { class: 'grp' }, t('pending.title', { n: pend.length })),
          h('p', { class: 'muted small' }, t('pending.hint')),
          pend.map((ev) => h('div', { class: 'row' },
            h('span', null, t(`ev.${ev.type}`), ev.part ? ` · ${ev.part}ª` : ''),
            h('button', { class: 'btn small', type: 'button', onclick: () => completePending(ev) }, t('complete'))))) : null,
      ];
    }

    const buttons = buildButtons();
    screen.replaceChildren(
      clockBar,
      h('div', { class: 'subbar' },
        h('a', { class: 'icon-btn', href: '#/', 'aria-label': t('back') }, '←'),
        h('div', { class: 'title-block' }, h('h1', null, `${m.home_away === 'away' ? '@ ' : ''}${rival}`), h('span', { class: 'muted small' }, `${fmtDate(m.date)}${m.is_practice ? ' · ' + t('practice') : ''}`)),
        h('a', { class: 'btn small', href: `#/summary/${id}` }, t('summary'))),
      h('div', { class: 'scorebar' }, h('div', { class: 'score' }, h('b', null, c.goals), ' – ', h('b', null, c.goals_against)),
        segmented([{ value: 0, label: '–' }, { value: 1, label: '1ª' }, { value: 2, label: '2ª' }], part || 0, (v) => { part = v || null; lsSet(`urd.part.${id}`, String(v)); render(); }, t('part'))),
      mode !== 'keeper' ? countersGrid(c, { onTap: adjust, adjusted }) : null,
      mode !== 'keeper' ? warningsBox(c) : null,
      h('div', { class: 'modebar' }, segmented([{ value: 'simple', label: t('mode.simple') }, { value: 'advanced', label: t('mode.advanced') }, { value: 'keeper', label: t('mode.keeper') }], mode, (v) => { mode = v; lsSet('urd.mode', v); render(); }, t('mode.label'))),
      mode !== 'keeper' ? h('button', { class: 'btn small gk-mapbtn', type: 'button', onclick: openKeeperMap }, `🧤 ${t('gk.map')}`) : null,
      ...buttons,
      h('div', { class: 'undo-bar' },
        h('button', { class: 'btn undo', type: 'button', disabled: !lastEv, onclick: undo },
          '↶ ', lastEv ? t('undo.last', { what: t(`ev.${lastEv.type}`) }) : t('undo'))));
    if (mode === 'keeper' && gkCell != null && !gkZone) requestAnimationFrame(() => screen.querySelector('.gk-court')?.scrollIntoView({ block: 'center', behavior: 'smooth' })); // que se vea el campo para elegir la zona
  }

  render();
  flush().catch(() => {});
}
