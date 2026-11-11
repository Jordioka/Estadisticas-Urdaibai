// Uso del plan gratuito (Cloudflare y GitHub). Solo la ve el propietario de la instalación.
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { api, state } from '../store.js';
import { backBar, errMsg } from '../ui.js';

const nf = (n) => new Intl.NumberFormat('es-ES').format(Math.round(n));
const bytes = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

// Menos del 50 % usado = bien; hasta el 80 % = ojo; más = casi agotado
const level = (usedPct) => (usedPct < 50 ? 'ok' : usedPct < 80 ? 'warn' : 'bad');
const LV = { ok: ['g-strong', 'usage.lv.ok'], warn: ['g-mid', 'usage.lv.warn'], bad: ['g-bad', 'usage.lv.bad'] };

function meter(title, used, limit, fmt, hint) {
  const usedPct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const left = Math.max(0, 100 - usedPct);
  const [cls, lvKey] = LV[level(usedPct)];
  const pct = (v) => (v < 10 && v > 0 ? v.toFixed(1) : String(Math.round(v))).replace('.', ',');
  return h('section', { class: 'usage-card' },
    h('div', { class: 'row-between' }, h('h3', null, title), h('span', { class: `pill ${cls}` }, t(lvKey))),
    h('div', { class: 'usage-big' }, `${t('usage.left')}: `, h('strong', null, `${pct(left)}%`)),
    h('div', { class: 'meter', role: 'img', 'aria-label': `${t('usage.used')} ${pct(usedPct)}%` }, h('div', { class: `meter-fill ${cls}`, style: { width: `${usedPct}%` } })),
    h('p', { class: 'muted small' }, `${fmt(used)} / ${fmt(limit)} · ${t('usage.used')} ${pct(usedPct)}%`),
    hint ? h('p', { class: 'muted small' }, hint) : null);
}

export async function usageView(root) {
  const page = h('div', { class: 'page' }, backBar(t('usage.title'), () => { location.hash = '#/more'; }));
  root.append(page);
  if (!state.user?.is_owner) { page.append(h('p', { class: 'warn' }, t('err.forbidden'))); return; }
  page.append(h('p', { class: 'muted center' }, t('loading')));
  let d;
  try { d = await api('GET', '/api/usage'); } catch (e) { page.lastChild.replaceWith(h('p', { class: 'warn' }, e.network ? t('rep.offline') : errMsg(e))); return; }
  const L = d.limits;
  const cards = [
    h('p', { class: 'muted' }, t('usage.intro')),
    h('h2', null, 'Cloudflare'),
    meter(t('usage.requests'), d.today.requests, L.requests, nf, t('usage.requests_hint')),
    meter(t('usage.reads'), d.today.rows_read, L.rows_read, nf),
    meter(t('usage.writes'), d.today.rows_written, L.rows_written, nf),
    d.db_bytes != null ? meter(t('usage.db'), d.db_bytes, L.db_bytes, bytes, t('usage.db_hint')) : h('p', { class: 'muted small' }, t('usage.db_unknown')),
    h('p', { class: 'muted small' }, t('usage.reset')),
    h('h2', null, 'GitHub'),
    d.github && d.github.bytes != null
      ? meter(`${t('usage.repo')} (${d.github.repo})`, d.github.bytes, L.github_repo_bytes, bytes, t('usage.github_hint'))
      : h('p', { class: 'muted' }, d.github ? t('usage.github_error', { repo: d.github.repo }) : t('usage.github_none')),
    h('p', { class: 'muted small' }, t('usage.official')),
    h('div', { class: 'btn-row wrap' },
      h('a', { class: 'btn', href: 'https://dash.cloudflare.com/?to=/:account/workers/analytics', target: '_blank', rel: 'noopener' }, t('usage.open_cf')),
      h('a', { class: 'btn', href: 'https://github.com/settings/billing', target: '_blank', rel: 'noopener' }, t('usage.open_gh'))),
  ];
  const hist = d.days.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, t('date')), h('th', null, t('usage.requests_short')), h('th', null, t('usage.reads_short')), h('th', null, t('usage.writes_short')))),
    h('tbody', null, d.days.map((r) => h('tr', null, h('th', { scope: 'row' }, r.day.split('-').reverse().join('/')), h('td', null, nf(r.requests)), h('td', null, nf(r.rows_read)), h('td', null, nf(r.rows_written))))))) : null;
  page.lastChild.replaceWith(...cards, hist ? h('h3', null, t('usage.history')) : null, hist);
}
