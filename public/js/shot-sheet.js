// Hoja para anotar un lanzamiento con jugador, zona del campo y punto de la portería (vista avanzada).
import { h, sheet, choiceDialog, fmtDate } from './dom.js';
import { t } from './i18n.js';
import { courtSVG, goalGrid } from './court.js';
import { SHOT_KINDS, TRAJECTORIES, PRESSURES, PHASES } from './stats.js';
import { playerLabel } from './store.js';

const OUTS = ['out', 'post', 'block'];

// Resultado que ve el usuario (goal | save | out | post | block) → evento
export function outcomeToType(side, outcome) {
  if (side === 'own') return outcome === 'goal' ? { type: 'goal', result: null } : { type: 'shot_miss', result: outcome };
  if (outcome === 'goal') return { type: 'goal_against', result: null };
  if (outcome === 'save') return { type: 'save', result: null };
  return { type: 'shot_against_miss', result: outcome };
}

export function eventToOutcome(e) {
  if (!e) return null;
  if (e.type === 'goal' || e.type === 'goal_against') return 'goal';
  if (e.type === 'save') return 'save';
  return e.result || null;
}

const chips = (items, value, onPick, cls = '') =>
  h('div', { class: `chips ${cls}` }, items.map((i) =>
    h('button', { type: 'button', class: `chip${i.value === value ? ' on' : ''}`, 'aria-pressed': i.value === value ? 'true' : 'false', onclick: () => onPick(i.value) }, i.label)));

// opts: { side: 'own'|'against', event?, people: [players], pendingOfType(type) → [events], onSave({type, fields, completeId}) }
export function openShotSheet(opts) {
  const { side, event, people, onSave } = opts;
  const sel = {
    person: (side === 'own' ? event?.player_id : event?.goalkeeper_id) || null,
    zone: event?.zone || null,
    cell: event?.goal_cell || null,
    out: event && ['out', 'post', 'block'].includes(event.result) ? event.result : null,
    outcome: eventToOutcome(event),
    shot_type: event?.shot_type || null, trajectory: event?.trajectory || null, pressure: event?.pressure || null,
    phase: event?.phase || null, minute: event?.minute ?? '',
  };
  let saving = false;

  const personBox = h('div');
  const courtBox = h('div');
  const goalBox = h('div');
  const finalBox = h('div', { class: 'final-box' });
  const moreBox = h('div');

  const court = courtSVG({ selected: sel.zone, onSelect: (z) => { sel.zone = z; refresh(true); } });
  const goal = goalGrid({
    cell: sel.cell, out: sel.out,
    onCell: (n) => { sel.cell = n; sel.out = null; if (sel.outcome && OUTS.includes(sel.outcome)) sel.outcome = null; refresh(); },
    onOut: (k) => { sel.out = k; sel.cell = null; sel.outcome = k; refresh(true); },
  });
  const zoneName = h('p', { class: 'zone-pick', 'aria-live': 'polite' });

  function finish(outcome) {
    if (saving) return;
    const { type, result } = outcomeToType(side, outcome);
    const fields = {
      type, result, zone: sel.zone, goal_cell: sel.cell && !sel.out ? sel.cell : null,
      player_id: side === 'own' ? sel.person : null, goalkeeper_id: side === 'against' ? sel.person : null,
      shot_type: sel.shot_type, trajectory: sel.trajectory, pressure: sel.pressure, phase: sel.phase,
      minute: sel.minute === '' ? null : Number(sel.minute),
    };
    saving = true;
    const run = async () => {
      let completeId = event?.id || null;
      if (!event) {
        const pend = opts.pendingOfType?.(type) || [];
        if (pend.length) {
          const choice = await choiceDialog(t('shot.is_pending', { n: pend.length, what: t(`ev.${type}`).toLowerCase() }),
            [...pend.slice(0, 6).map((p, i) => ({ value: p.id, label: `${t('shot.yes_pending')} #${i + 1} · ${t(`ev.${p.type}`)}${p.part ? ' · ' + p.part + 'ª' : ''}`, primary: i === 0 })),
              { value: 'new', label: t('shot.no_new') }], { detail: t('shot.pending_hint') });
          if (choice === null) { saving = false; return; }
          if (choice !== 'new') completeId = choice;
        }
      }
      s.close();
      onSave({ type, fields, completeId });
    };
    run();
  }

  function refresh(scroll) {
    // jugador / portero
    personBox.replaceChildren(
      h('h3', null, side === 'own' ? t('shot.who') : t('shot.keeper')),
      people.length || side === 'own'
        ? h('div', { class: 'chips people' },
            h('button', { type: 'button', class: `chip${sel.person === null ? ' on' : ''}`, onclick: () => { sel.person = null; refresh(); } }, side === 'own' ? t('shot.no_player') : t('shot.no_keeper')),
            people.map((p) => h('button', { type: 'button', class: `chip${sel.person === p.id ? ' on' : ''}`, 'aria-pressed': sel.person === p.id ? 'true' : 'false', onclick: () => { sel.person = p.id; refresh(); } },
              h('b', null, p.number ?? '·'), ' ', p.name)))
        : h('p', { class: 'muted small' }, t('shot.no_keepers_hint')));
    court.update({ selected: sel.zone });
    goal.update({ cell: sel.cell, out: sel.out });
    zoneName.textContent = sel.zone ? t(`zone.${sel.zone}`) : t('shot.step_zone');
    zoneName.classList.toggle('on', !!sel.zone);

    // zona + portería completas → resultado
    finalBox.replaceChildren();
    const ready = sel.zone && (sel.cell || sel.out);
    if (ready && sel.cell) {
      finalBox.append(h('p', { class: 'muted small' }, t('shot.choose_result')),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: `btn big${sel.outcome === 'goal' ? ' primary' : ''}`, onclick: () => finish('goal') }, side === 'own' ? t('ev.goal') : t('ev.goal_against')),
          h('button', { type: 'button', class: `btn big${sel.outcome === 'save' ? ' primary' : ''}`, onclick: () => finish('save') }, side === 'own' ? t('shot.rival_save') : t('ev.save'))));
    } else if (ready && sel.out) {
      if (event) finalBox.append(h('button', { type: 'button', class: 'btn primary big', onclick: () => finish(sel.out) }, t('save')));
      else finish(sel.out); // fuera / poste / bloqueo: el resultado se asigna solo
    } else {
      finalBox.append(h('p', { class: 'muted small' }, !sel.zone ? t('shot.step_zone') : t('shot.step_goal')));
    }
    if (scroll) finalBox.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  const opt = (label, list, key, tkey) => h('div', null, h('h4', null, label),
    chips(list.map((v) => ({ value: v, label: t(`${tkey}.${v}`) })), sel[key], (v) => { sel[key] = sel[key] === v ? null : v; renderMore(); }));
  function renderMore() {
    moreBox.replaceChildren(
      opt(t('shot.kind'), SHOT_KINDS, 'shot_type', 'kind'), opt(t('shot.trajectory'), TRAJECTORIES, 'trajectory', 'traj'),
      opt(t('shot.pressure'), PRESSURES, 'pressure', 'press'), opt(t('shot.phase'), PHASES, 'phase', 'phase'),
      h('label', { class: 'field' }, h('span', { class: 'field-l' }, t('minute')),
        h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 90, value: sel.minute, oninput: (e) => { sel.minute = e.target.value; } })));
  }

  const s = sheet({
    title: side === 'own' ? t('adv.shot') : t('adv.shot_against'),
    full: true,
    body: [personBox, h('h3', null, t('shot.zone')), courtBox, h('h3', null, t('shot.goal')), goalBox, finalBox,
      h('details', { class: 'more' }, h('summary', null, t('shot.more')), moreBox)],
  });
  courtBox.append(court, zoneName);
  goalBox.append(goal);
  renderMore();
  refresh();
  return s;
}

// Elegir un jugador (o "Equipo", sin jugador) para pérdidas y posesiones en la vista avanzada
export function openPlayerPick({ title, players, onPick, current }) {
  const s = sheet({
    title,
    body: h('div', { class: 'chips people' },
      h('button', { type: 'button', class: `chip wide${current == null ? ' on' : ''}`, onclick: () => { s.close(); onPick(null); } }, t('shot.team_only')),
      players.map((p) => h('button', { type: 'button', class: `chip${current === p.id ? ' on' : ''}`, onclick: () => { s.close(); onPick(p.id); } }, h('b', null, p.number ?? '·'), ' ', p.name))),
  });
  return s;
}

export { playerLabel, fmtDate };
