// Hoja de detalle de un evento: portería 3×3 (igual que siempre), y opcionalmente jugador/portero, zona del campo y más datos.
//  · modo rápido (al anotar en la vista completa): solo portería + zona opcional → Guardar
//  · modo edición (corregir o completar desde el resumen): además jugador/portero, resultado, fase y más datos
import { h, sheet } from './dom.js';
import { t } from './i18n.js';
import { courtSVG, goalGrid } from './court.js';
import { SHOT_KINDS, TRAJECTORIES, PRESSURES, PHASES, SHOT_TYPES_ALL, OWN_SHOT_TYPES, MISS_RESULTS_OWN, MISS_RESULTS_AGAINST } from './stats.js';

const chips = (items, value, onPick, cls = '') =>
  h('div', { class: `chips ${cls}` }, items.map((i) =>
    h('button', { type: 'button', class: `chip${i.value === value ? ' on' : ''}`, 'aria-pressed': i.value === value ? 'true' : 'false', onclick: () => onPick(i.value) }, i.label)));

// ¿Este evento puede llevar punto de portería?
export const canHaveCell = (type, result) => ['goal', 'goal_against', 'save'].includes(type) || (type === 'shot_miss' && result === 'save');

// opts: { title, event, type, people, keepers, quick, onSave(fields) }
//   event: evento existente (edición) · type: tipo si es nuevo
export function openDetailSheet(opts) {
  const { event, quick = false, onSave } = opts;
  const type = event?.type || opts.type;
  const isOwn = OWN_SHOT_TYPES.includes(type);
  const isShot = SHOT_TYPES_ALL.includes(type);
  const sel = {
    person: (isOwn ? event?.player_id : event?.goalkeeper_id) || null,
    zone: event?.zone || opts.zone || null, cell: event?.goal_cell || null, result: event?.result || null,
    shot_type: event?.shot_type || null, trajectory: event?.trajectory || null, pressure: event?.pressure || null,
    phase: event?.phase || opts.phase || null, minute: event?.minute ?? '',
  };
  const people = isOwn ? opts.people || [] : opts.keepers || [];

  const personBox = h('div');
  const resultBox = h('div');
  const moreBox = h('div');
  const courtBox = h('div');
  const zoneName = h('p', { class: 'zone-pick', 'aria-live': 'polite' });
  const gridOn = () => canHaveCell(type, sel.result);

  const court = courtSVG({ selected: sel.zone, onSelect: (z) => { sel.zone = sel.zone === z ? null : z; refresh(); } });
  const goal = goalGrid({ hideOuts: true, cell: sel.cell, onCell: (n) => { sel.cell = sel.cell === n ? null : n; refresh(); } });
  const goalBox = h('div', null, h('h3', null, t('shot.goal')), goal);

  function refresh() {
    if (!quick) {
      personBox.replaceChildren(
        h('h3', null, isOwn ? t('shot.who') : t('shot.keeper')),
        people.length || isOwn
          ? h('div', { class: 'chips people' },
              h('button', { type: 'button', class: `chip${sel.person === null ? ' on' : ''}`, onclick: () => { sel.person = null; refresh(); } }, isOwn ? t('shot.no_player') : t('shot.no_keeper')),
              people.map((p) => h('button', { type: 'button', class: `chip${sel.person === p.id ? ' on' : ''}`, 'aria-pressed': sel.person === p.id ? 'true' : 'false', onclick: () => { sel.person = p.id; refresh(); } },
                h('b', null, p.number ?? '·'), ' ', p.name)))
          : h('p', { class: 'muted small' }, t('shot.no_keepers_hint')));
      const results = type === 'shot_miss' ? MISS_RESULTS_OWN : type === 'shot_against_miss' ? MISS_RESULTS_AGAINST : null;
      resultBox.replaceChildren(results
        ? h('div', null, h('h3', null, t('shot.result')), chips(results.map((r) => ({ value: r, label: t(`result.${r}`) })), sel.result, (v) => { sel.result = sel.result === v ? null : v; if (!canHaveCell(type, sel.result)) sel.cell = null; refresh(); }))
        : null);
    }
    court.update({ selected: sel.zone });
    goal.update({ cell: sel.cell });
    goalBox.style.display = gridOn() ? '' : 'none';
    zoneName.textContent = sel.zone ? t(`zone.${sel.zone}`) : '';
    zoneName.classList.toggle('on', !!sel.zone);
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

  function save() {
    const fields = { zone: sel.zone, goal_cell: gridOn() ? sel.cell : null };
    if (!quick) {
      Object.assign(fields, {
        result: sel.result, shot_type: sel.shot_type, trajectory: sel.trajectory, pressure: sel.pressure, phase: sel.phase,
        minute: sel.minute === '' ? null : Number(sel.minute),
        player_id: isOwn ? sel.person : null, goalkeeper_id: !isOwn ? sel.person : null,
      });
    }
    s.close();
    onSave(fields);
  }

  const zoneDetails = h('details', { class: 'more' }, h('summary', null, t('shot.zone_opt')), courtBox);
  if (sel.zone && !quick) zoneDetails.open = true;
  const s = sheet({
    title: opts.title,
    full: true,
    body: [personBox, resultBox, goalBox, zoneDetails,
      quick || !isShot ? null : h('details', { class: 'more' }, h('summary', null, t('shot.more')), moreBox),
      h('div', { class: 'btn-row sticky-save' }, h('button', { type: 'button', class: 'btn primary big', onclick: save }, t('save')))],
  });
  courtBox.append(court, zoneName);
  renderMore();
  refresh();
  return s;
}

// Elegir un jugador (o "Equipo", sin jugador) — usado al corregir eventos
export function openPlayerPick({ title, players, onPick, current }) {
  const s = sheet({
    title,
    body: h('div', { class: 'chips people' },
      h('button', { type: 'button', class: `chip wide${current == null ? ' on' : ''}`, onclick: () => { s.close(); onPick(null); } }, t('shot.team_only')),
      players.map((p) => h('button', { type: 'button', class: `chip${current === p.id ? ' on' : ''}`, onclick: () => { s.close(); onPick(p.id); } }, h('b', null, p.number ?? '·'), ' ', p.name))),
  });
  return s;
}
