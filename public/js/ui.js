// Componentes compartidos: etiquetas de color, contadores, porcentajes.
import { h, fmtPct } from './dom.js';
import { t } from './i18n.js';
import { COUNTERS, percentages, gradeAll, counterWarnings } from './stats.js';

// Colores del Excel: verde fuerte, verde claro (solo % pérdidas), naranja y rojo
export function gradeClass(stat, level) {
  if (level === 'none') return 'g-none';
  if (level === 'great') return 'g-strong';
  if (level === 'good') return stat === 'loss_pct' ? 'g-light' : 'g-strong';
  return level === 'mid' ? 'g-mid' : 'g-bad';
}

// Etiqueta con borde y texto: no depende solo del color (y no se confunde con el rojo del club)
export function pill(stat, level) {
  if (level === 'none') return h('span', { class: 'pill g-none' }, '—');
  return h('span', { class: `pill ${gradeClass(stat, level)}` }, t(`lv.${level}`));
}

export const PCT_STATS = ['off_eff', 'loss_pct', 'shot_eff', 'save_pct'];

// Cuatro porcentajes con su fórmula y su color
export function percentBlock(counters, thresholds) {
  const p = percentages(counters), g = gradeAll(counters, thresholds);
  return h('div', { class: 'pct-list' }, PCT_STATS.map((k) =>
    h('div', { class: `pct-row ${gradeClass(k, g[k])}` },
      h('div', { class: 'pct-name' }, h('strong', null, t(`pct.${k}`)), h('span', { class: 'muted small' }, t(`pct.${k}.f`))),
      h('div', { class: 'pct-val' }, h('span', { class: 'big' }, fmtPct(p[k])), pill(k, g[k])))));
}

// Los 7 contadores. onTap(stat) permite corregir un total directamente.
export function countersGrid(counters, { onTap, adjusted = {} } = {}) {
  return h('div', { class: 'counters' }, COUNTERS.map((k) => {
    const attrs = { class: `counter c-${k}`, type: 'button', 'aria-label': `${t(`stat.${k}`)}: ${counters[k]}` };
    if (onTap) attrs.onclick = () => onTap(k);
    return h(onTap ? 'button' : 'div', onTap ? attrs : { class: attrs.class },
      h('span', { class: 'counter-n' }, counters[k], adjusted[k] ? h('sup', { title: t('adjusted') }, '*') : null),
      h('span', { class: 'counter-l' }, t(`stat.${k}`)));
  }));
}

export function warningsBox(counters) {
  const w = counterWarnings(counters);
  if (!w.length) return null;
  return h('div', { class: 'warn', role: 'alert' }, w.map((x) => h('p', null, '⚠ ', t(`warn.${x}`))));
}

export function segmented(options, value, onChange, label) {
  const btns = options.map((o) =>
    h('button', { type: 'button', class: `seg-btn${o.value === value ? ' on' : ''}`, 'aria-pressed': o.value === value ? 'true' : 'false',
      onclick: () => {
        btns.forEach((b, i) => { const on = options[i].value === o.value; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        onChange(o.value);
      } }, o.label));
  return h('div', { class: 'seg', role: 'group', 'aria-label': label || '' }, btns);
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-l' }, label), control, hint ? h('span', { class: 'muted small' }, hint) : null);
}

export function errMsg(e) {
  const code = e?.code || e?.message;
  const key = `err.${code}`;
  const msg = t(key);
  return msg === key ? t('err.generic') : msg;
}

export function backBar(title, onBack, right) {
  return h('div', { class: 'subbar' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('back'), onclick: onBack }, '←'),
    h('h1', null, title), right || h('span'));
}

// Caja de búsqueda (sin tildes ni mayúsculas). onInput recibe el texto ya normalizado.
export function searchBox(placeholder, value, onInput) {
  return h('input', { type: 'search', class: 'search', placeholder, value: value || '', 'aria-label': placeholder, autocomplete: 'off', enterkeyhint: 'search',
    oninput: (e) => onInput(e.target.value) });
}
