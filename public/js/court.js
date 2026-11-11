// Medio campo de balonmano y portería, para pulsar (anotar) o para ver mapas de resultados.
import { h, svg } from './dom.js';
import { t } from './i18n.js';

const deg = (a) => (a * Math.PI) / 180;
const pt = (r, a) => [+(r * Math.cos(deg(a))).toFixed(3), +(r * Math.sin(deg(a))).toFixed(3)];

// Sectores alrededor del centro de la portería (el eje y baja desde la línea de gol)
// Agrupación: Extremos (EI, ED) · 9 m (9I, 9C, 9D, desde la línea de 6 m hacia fuera) · 6 m (dentro del área, se dibuja encima)
const SECTORS = [
  { z: 'EI', r1: 0, r2: 15, a1: 152, a2: 180, label: 'EI', at: [-8.9, 3] },
  { z: 'ED', r1: 0, r2: 15, a1: 0, a2: 28, label: 'ED', at: [8.9, 3] },
  { z: '9D', r1: 0, r2: 15, a1: 28, a2: 68, label: '9D', at: [6.6, 10.4] },
  { z: '9C', r1: 0, r2: 15, a1: 68, a2: 112, label: '9C', at: [0, 11.6] },
  { z: '9I', r1: 0, r2: 15, a1: 112, a2: 152, label: '9I', at: [-6.6, 10.4] },
];
const AREA6 = 'M-7.5 0 A6 6 0 0 0 -1.5 6 L1.5 6 A6 6 0 0 0 7.5 0 Z';

function sectorPath({ r1, r2, a1, a2 }) {
  const [x1, y1] = pt(r2, a1), [x2, y2] = pt(r2, a2);
  if (r1 === 0) return `M0 0 L${x1} ${y1} A${r2} ${r2} 0 0 1 ${x2} ${y2} Z`;
  const [x3, y3] = pt(r1, a2), [x4, y4] = pt(r1, a1);
  return `M${x4} ${y4} L${x1} ${y1} A${r2} ${r2} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${r1} ${r1} 0 0 0 ${x4} ${y4} Z`;
}

const centroid = ({ r1, r2, a1, a2 }) => {
  const r = r1 === 0 ? r2 * 0.55 : (r1 + r2) / 2;
  return pt(r, (a1 + a2) / 2);
};

// opts: { selected, onSelect(zone), counts: {zona: texto|número}, heat: {zona: 0..1} }
export function courtSVG(opts = {}) {
  const root = svg('svg', { viewBox: '-10.4 -1.6 20.8 14.6', class: 'court', role: 'group', 'aria-label': t('court.label') });
  const clip = svg('clipPath', { id: `clip-${Math.random().toString(36).slice(2, 7)}` }, svg('rect', { x: -10, y: 0, width: 20, height: 13 }));
  const clipId = clip.getAttribute('id');
  root.append(svg('defs', null, clip));
  root.append(svg('rect', { x: -10, y: 0, width: 20, height: 13, class: 'court-floor' }));
  const zones = {};
  const g = svg('g', { 'clip-path': `url(#${clipId})` });
  const mkZone = (z, d, label, cxy) => {
    const p = svg('path', { d, class: 'zone', 'data-zone': z, role: 'button', tabindex: 0, 'aria-label': t(`zone.${z}`) });
    const txt = svg('text', { x: cxy[0], y: cxy[1], class: 'zone-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, label);
    const sub = svg('text', { x: cxy[0], y: cxy[1] + 1.35, class: 'zone-count', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    zones[z] = { p, sub };
    if (opts.onSelect) {
      p.addEventListener('click', () => opts.onSelect(z));
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onSelect(z); } });
    }
    return [p, txt, sub];
  };
  for (const s of SECTORS) g.append(...mkZone(s.z, sectorPath(s), s.label, s.at));
  g.append(svg('path', { d: AREA6, fill: '#fff', 'pointer-events': 'none' }));
  g.append(...mkZone('6M', AREA6, '6 m', [0, 2.3]));
  root.append(g);
  // líneas de 6 m (continua) y 9 m (discontinua)
  const line6 = 'M-7.5 0 A6 6 0 0 0 -1.5 6 L1.5 6 A6 6 0 0 0 7.5 0';
  const line9 = 'M-10.5 0 A9 9 0 0 0 -1.5 9 L1.5 9 A9 9 0 0 0 10.5 0';
  root.append(svg('g', { 'clip-path': `url(#${clipId})`, 'pointer-events': 'none' },
    svg('path', { d: line6, class: 'court-line' }), svg('path', { d: line9, class: 'court-line dashed' })));
  root.append(svg('rect', { x: -10, y: 0, width: 20, height: 13, class: 'court-border', 'pointer-events': 'none' }));
  root.append(svg('rect', { x: -1.5, y: -1.1, width: 3, height: 1.1, class: 'court-goal', 'pointer-events': 'none' }));
  // 7 m: punto pulsable
  const seven = svg('circle', { cx: 0, cy: 7, r: 1.25, class: 'zone seven', 'data-zone': '7M', role: 'button', tabindex: 0, 'aria-label': t('zone.7M') });
  const sevenTxt = svg('text', { x: 0, y: 7, class: 'zone-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'pointer-events': 'none' }, '7m');
  const sevenSub = svg('text', { x: 0, y: 8.7, class: 'zone-count', 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'pointer-events': 'none' });
  zones['7M'] = { p: seven, sub: sevenSub };
  if (opts.onSelect) {
    seven.addEventListener('click', () => opts.onSelect('7M'));
    seven.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onSelect('7M'); } });
  }
  root.append(seven, sevenTxt, sevenSub);

  const wrap = h('div', { class: 'court-wrap' }, root);
  const update = ({ selected, counts, heat } = {}) => {
    for (const [z, { p, sub }] of Object.entries(zones)) {
      p.classList.toggle('selected', selected === z);
      p.setAttribute('aria-pressed', selected === z ? 'true' : 'false');
      sub.textContent = counts && counts[z] != null && counts[z] !== '' ? counts[z] : '';
      const v = heat?.[z] ?? 0;
      p.style.fillOpacity = heat ? String(0.12 + 0.75 * v) : '';
      if (heat) p.classList.toggle('heat', v > 0);
    }
  };
  update(opts);
  wrap.update = update;
  return wrap;
}

// Portería: cuadrícula 3×3 + fuera / poste / bloqueo.
// opts: { cell, out, onCell(n), onOut(kind), counts: {1..9: texto}, outLabels }
export function goalGrid(opts = {}) {
  const cells = [];
  const grid = h('div', { class: 'goal-grid', role: 'group', 'aria-label': t('goal.label') });
  for (let i = 1; i <= 9; i++) {
    const b = h('button', { type: 'button', class: 'goal-cell', 'data-cell': i, 'aria-label': `${t('goal.cell')} ${i}`, disabled: !opts.onCell, onclick: () => opts.onCell?.(i) });
    cells[i] = b;
    grid.append(b);
  }
  const outs = {};
  const outRow = h('div', { class: 'goal-outs' });
  for (const k of ['out', 'post', 'block']) {
    outs[k] = h('button', { type: 'button', class: 'goal-out', disabled: !opts.onOut, onclick: () => opts.onOut?.(k) }, t(`result.${k}`));
    outRow.append(outs[k]);
  }
  const wrap = h('div', { class: 'goal-wrap' }, h('div', { class: 'goal-frame' }, grid), opts.hideOuts ? null : outRow);
  wrap.update = ({ cell, out, counts, outCounts, heat } = {}) => {
    for (let i = 1; i <= 9; i++) {
      cells[i].classList.toggle('selected', cell === i);
      cells[i].setAttribute('aria-pressed', cell === i ? 'true' : 'false');
      cells[i].textContent = counts && counts[i] != null && counts[i] !== '' ? counts[i] : '';
      cells[i].style.background = heat && heat[i] ? `rgba(232,20,12,${0.1 + 0.6 * heat[i]})` : '';
    }
    for (const k of Object.keys(outs)) {
      outs[k].classList.toggle('selected', out === k);
      outs[k].setAttribute('aria-pressed', out === k ? 'true' : 'false');
      outs[k].textContent = outCounts && outCounts[k] != null ? `${t(`result.${k}`)} ${outCounts[k]}` : t(`result.${k}`);
    }
  };
  wrap.update(opts);
  return wrap;
}
