// Mapa de portería enlazado: cuadrícula 3×3 + campo. Cada cuadrado y cada zona muestra «paradas/lanzamientos» con color.
// Al elegir una zona, los cuadrados enseñan solo lo de esa zona; al elegir un cuadrado, las zonas enseñan solo lo de ese cuadrado.
import { h } from './dom.js';
import { t } from './i18n.js';
import { courtSVG } from './court.js';
import { GOAL_CELLS, ZONES, keeperAgg, effClass } from './stats.js';
import { fmtPct } from './dom.js';

const label = (x) => (x.s + x.g ? `${x.s}/${x.s + x.g}` : '');

// opts: { events, mine, cell, zone, onCell(c), onZone(z) }
export function keeperMap(opts) {
  const a = keeperAgg(opts.events, opts.mine, opts);
  const grid = h('div', { class: 'gk-goal', role: 'group', 'aria-label': t('shot.goal') },
    GOAL_CELLS.map((c) => h('button', { type: 'button', class: `gk-cell${opts.cell === c ? ' pick' : ''}`, 'data-eff': effClass(a.cells[c]), 'data-cell': c, 'aria-pressed': opts.cell === c ? 'true' : 'false',
      'aria-label': `${t('goal.cell')} ${c}: ${label(a.cells[c]) || '–'}`, onclick: () => opts.onCell?.(c) }, label(a.cells[c]))));
  const counts = {}, eff = {};
  for (const z of ZONES) { counts[z] = label(a.zones[z]); eff[z] = effClass(a.zones[z]); }
  const court = courtSVG({ counts, eff, pick: opts.zone, onSelect: opts.onZone });
  court.classList.add('gk-court');
  const n = a.tot.s + a.tot.g;
  const foot = h('p', { class: 'gk-eff', 'aria-live': 'polite' }, t('gk.eff'), ': ', h('b', null, n ? fmtPct(a.tot.s / n) : '–'), ` · ${a.tot.s}/${n}`);
  return h('div', { class: 'gk-map' }, grid, court, foot);
}
