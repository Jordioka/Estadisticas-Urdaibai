// Estadísticas de un jugador/a (se abre al tocarlo en «Jugadores»): totales y partido a partido.
import { h, fmtDate, fmtPct, today } from '../dom.js';
import { t } from '../i18n.js';
import { state, api, playerLabel, teamName } from '../store.js';
import { field, errMsg, backBar } from '../ui.js';
import { ratio } from '../stats.js';
import { playersTable, keepersTable } from './tables.js';

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* nada */ } };

export async function playerView(root, { id }) {
  const p = state.players.find((x) => x.id === id);
  const page = h('div', { class: 'page player-stats' });
  root.append(page);
  if (!p) { page.append(h('p', { class: 'warn' }, t('err.not_found')), h('a', { class: 'btn', href: '#/players' }, t('back'))); return; }
  const cur = state.seasons.find((s) => s.start_date <= today() && s.end_date >= today())?.id || state.seasons[0]?.id || '';
  let season = lsGet('urd.pl.season', cur);
  if (season && !state.seasons.some((s) => s.id === season)) season = cur;
  let report = null, busy = true, error = '';

  async function load() {
    busy = true; error = ''; render();
    try {
      const q = new URLSearchParams({ team_id: p.team_id });
      if (season) q.set('season_id', season);
      report = await api('GET', `/api/reports?${q}`);
    } catch (e) { report = null; error = e.network ? t('rep.offline') : errMsg(e); }
    busy = false; render();
  }

  const tile = (label, value) => h('div', { class: 'ptile' }, h('b', null, value), h('span', null, label));

  function body() {
    if (busy) return h('p', { class: 'muted center' }, t('loading'));
    if (error) return h('p', { class: 'warn' }, error);
    const mById = new Map(report.matches.map((m) => [m.id, m]));
    const P = report.players.rows.find((r) => r.player_id === id), K = report.goalkeepers.rows.find((r) => r.player_id === id);
    if (!P && !K) return h('p', { class: 'muted center' }, t('rep.player_none'));
    const label = (m) => `${m.home_away === 'away' ? '@ ' : ''}${m.rival} ${fmtDate(m.date).slice(0, 5)}`;
    const rowsP = [], rowsK = [];
    for (const bm of report.by_match) {
      const m = mById.get(bm.match_id);
      const a = bm.players.find((r) => r.player_id === id), b = bm.keepers.find((r) => r.player_id === id);
      if (a) rowsP.push({ ...a, player_id: m.id });
      if (b) rowsK.push({ ...b, player_id: m.id });
    }
    if (P) rowsP.push({ ...P, player_id: '__total' });
    if (K) rowsK.push({ ...K, player_id: '__total' });
    const name = (mid) => (mid === '__total' ? t('rep.total') : label(mById.get(mid)));
    const played = new Set([...rowsP, ...rowsK].filter((r) => r.player_id !== '__total').map((r) => r.player_id)).size;
    return [
      h('div', { class: 'ptiles' },
        tile(t('ps.matches'), played),
        P ? [tile(t('stat.goals'), P.goals), tile(t('col.shots'), P.shots), tile(t('col.eff'), P.shots ? fmtPct(P.goals / P.shots) : '–'),
          tile(t('col.losses'), P.losses), tile(t('sub.robo'), P.steals), tile(t('sub.chapa'), P.blocks), tile(t('sub.dos_min'), P.two_min)] : null,
        K ? [tile(t('stat.saves'), K.saves), tile(t('stat.goals_against'), K.goals_against), tile(t('pct.save_pct'), fmtPct(ratio(K.saves, K.saves + K.goals_against)))] : null),
      P ? playersTable({ rows: rowsP, caption: t('ps.by_match') }, name) : null,
      K ? keepersTable({ rows: rowsK, caption: `${t('tbl.keepers')} · ${t('ps.by_match')}` }, name) : null,
    ];
  }

  function render() {
    page.replaceChildren(
      backBar(playerLabel(p), () => (location.hash = '#/players'), h('a', { class: 'btn small', href: `#/players?edit=${id}` }, t('edit'))),
      h('p', { class: 'muted' }, `${teamName(p.team_id)}${p.position ? ' · ' + p.position : ''}${p.is_goalkeeper ? ' · 🧤 ' + t('pl.gk') : ''}`),
      field(t('rep.season'), h('select', { onchange: (e) => { season = e.target.value; lsSet('urd.pl.season', season); load(); } },
        h('option', { value: '' }, t('rep.all_seasons')), ...state.seasons.map((s) => h('option', { value: s.id, selected: s.id === season }, s.name)))),
      ...[].concat(body() || []));
  }
  render();
  load();
}
