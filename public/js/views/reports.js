// Informes: por partidos (como el Excel del club), de temporada y de un partido. Exportables a PDF, Excel y CSV.
import { h, svg, fmtDate, fmtPct, today, toast } from '../dom.js';
import { t } from '../i18n.js';
import { state, api, playerLabel, teamName } from '../store.js';
import { segmented, field, percentBlock, countersGrid, warningsBox, pill, gradeClass, errMsg } from '../ui.js';
import { COUNTERS, percentages, gradeAll, sumCounters } from '../stats.js';
import { currentTeamId, teamSelect } from './home.js';
import { playersTable, keepersTable, mapsBlock } from './tables.js';
import { downloadXlsx, downloadCsv } from '../files.js';

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* nada */ } };

const COLS = ['possessions', 'losses', 'shots', 'goals', 'goals_against', 'shots_against', 'saves'];
const PCTS = ['off_eff', 'loss_pct', 'shot_eff', 'save_pct'];
const SHORT = { possessions: 'Pos', losses: 'Pér', shots: 'Lan', goals: 'Gol', goals_against: 'GC', shots_against: 'LC', saves: 'Par' };

function defaultSeason() {
  const d = today();
  return state.seasons.find((s) => s.start_date <= d && s.end_date >= d)?.id || state.seasons[0]?.id || '';
}

function lineChart(matches, thresholds) {
  const W = 340, H = 220, L = 36, R = 12, T = 12, B = 60;
  const series = [
    { key: 'off_eff', color: '#1B6B4F', dash: '', label: t('pct.off_eff') },
    { key: 'loss_pct', color: '#9A5B00', dash: '5 3', label: t('pct.loss_pct') },
    { key: 'save_pct', color: '#2457C5', dash: '1.5 3', label: t('pct.save_pct') },
  ];
  const n = matches.length;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - Math.min(1, v)) * (H - T - B);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': t('rep.chart') });
  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    root.append(svg('line', { x1: L, x2: W - R, y1: y(g), y2: y(g), class: 'grid' }), svg('text', { x: L - 5, y: y(g) + 3, class: 'axis', 'text-anchor': 'end' }, `${g * 100}`));
  }
  matches.forEach((m, i) => {
    if (n <= 12 || i % Math.ceil(n / 12) === 0) {
      const name = m.rival.length > 11 ? `${m.rival.slice(0, 10)}…` : m.rival; // nombre del rival (no la fecha)
      root.append(svg('text', { x: x(i), y: H - B + 12, class: 'axis', 'text-anchor': 'end', transform: `rotate(-35 ${x(i)} ${H - B + 12})` }, name));
    }
  });
  for (const s of series) {
    const pts = matches.map((m, i) => [x(i), y(percentages(m.counters)[s.key])]);
    root.append(svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2.2, 'stroke-dasharray': s.dash }));
    pts.forEach(([px, py]) => root.append(svg('circle', { cx: px, cy: py, r: 3, fill: s.color })));
  }
  const legend = h('div', { class: 'legend' }, series.map((s) => h('span', null, svg('svg', { width: 28, height: 10, viewBox: '0 0 28 10' }, svg('line', { x1: 1, x2: 27, y1: 5, y2: 5, stroke: s.color, 'stroke-width': 2.5, 'stroke-dasharray': s.dash })), ' ', s.label)));
  return h('div', { class: 'chart-box' }, root, legend);
}

export function reportsView(root) {
  const page = h('div', { class: 'page reports' });
  root.append(page);
  const S = Object.assign({ tab: 'matches', season: defaultSeason(), rival: '', from: '', to: '', ha: '' }, lsGet('urd.rep', {}));
  if (!state.seasons.some((s) => s.id === S.season)) S.season = defaultSeason();
  let report = null, busy = false, error = '';
  let playerSel = lsGet('urd.rep.player', '');

  async function load() {
    busy = true; error = ''; render();
    const team = currentTeamId();
    const q = new URLSearchParams({ team_id: team });
    if (S.season) q.set('season_id', S.season);
    if (S.rival) q.set('rival_id', S.rival);
    if (S.from) q.set('from', S.from);
    if (S.to) q.set('to', S.to);
    if (S.ha) q.set('home_away', S.ha);
    lsSet('urd.rep', S);
    try { report = await api('GET', `/api/reports?${q}`); } catch (e) { report = null; error = e.network ? t('rep.offline') : errMsg(e); }
    busy = false; render();
  }

  const nameOf = (id) => playerLabel(report?.players_info.find((p) => p.id === id)) || '';

  // ---- exportación ----
  function matchRows() {
    const head = [t('date'), t('rival'), ...COLS.map((c) => t(`stat.${c}`)), ...PCTS.map((p) => t(`pct.${p}`))];
    const pc = (c) => PCTS.map((p) => Number((percentages(c)[p] * 100).toFixed(1)));
    const rows = report.matches.map((m) => [fmtDate(m.date), m.rival, ...COLS.map((c) => m.counters[c]), ...pc(m.counters)]);
    rows.push([t('rep.total'), '', ...COLS.map((c) => report.totals[c]), ...pc(report.totals)]);
    return [head, ...rows];
  }
  const fileName = (ext) => `informe-${teamName(currentTeamId()).replace(/\s+/g, '-')}.${ext}`;
  async function exportXlsx() {
    const sheets = [{ name: t('rep.tab.matches'), aoa: matchRows(), widths: [12, 22, ...COLS.map(() => 11), ...PCTS.map(() => 16)] }];
    if (report.players.rows.length) {
      const ks = ['goals', 'goals_fast', 'miss_out', 'miss_saved', 'miss_fast', 'shots', 'loss_pase', 'loss_pisando', 'loss_falta_ataque', 'loss_pasos', 'losses', 'steals', 'blocks', 'two_min', 'possessions'];
      const heads = [t('pl.title'), t('stat.goals'), t('adv.b.fast_goal'), t('adv.b.out'), t('adv.b.saved'), t('adv.b.fast_miss'), t('col.shots'),
        t('sub.pase'), t('sub.pisando'), t('sub.falta_ataque'), t('sub.pasos'), t('col.losses'), t('sub.robo'), t('sub.chapa'), t('sub.dos_min'), t('col.poss')];
      sheets.push({ name: t('tbl.players'), aoa: [heads,
        ...report.players.rows.map((r) => [nameOf(r.player_id), ...ks.map((k) => r[k] ?? 0)]),
        [t('unassigned'), ...['goals', 'shots', 'losses', 'possessions'].map((k) => report.players.unassigned[k])]].map((row, i) => (i === 0 || row.length === heads.length ? row : [row[0], row[1], '', '', '', '', row[2], '', '', '', '', row[3], '', '', '', row[4]])),
        widths: [26, 8, 10, 12, 10, 12, 10, 8, 9, 10, 8, 10, 8, 8, 6, 10] });
    }
    if (report.goalkeepers.rows.length) sheets.push({ name: t('tbl.keepers'), aoa: [[t('pl.gk'), t('stat.saves'), t('stat.goals_against'), t('adv.b.g_out'), t('pct.save_pct'), `${t('col.pen')} ${t('adv.b.g_save')}`, `${t('col.pen')} ${t('adv.b.g_goal')}`, `${t('col.pen')} ${t('adv.b.g_out')}`, t('sub.ok'), t('sub.fallo')],
      ...[...report.goalkeepers.rows, { ...report.goalkeepers.unassigned, player_id: null }].map((r) => [r.player_id ? nameOf(r.player_id) : t('unassigned'), r.saves, r.goals_against, r.out ?? '', Number((r.save_pct * 100).toFixed(1)), r.pen_saves ?? '', r.pen_goals ?? '', r.pen_out ?? '', r.cp_ok ?? '', r.cp_fail ?? ''])], widths: [26, 10, 16, 12, 14, 12, 12, 12, 14, 14] });
    await downloadXlsx(fileName('xlsx'), sheets);
  }

  // ---- tablas ----
  function matchesTable() {
    if (!report.matches.length) return h('p', { class: 'muted center' }, t('rep.none'));
    const th = report.thresholds || state.thresholds;
    const cell = (stat, level, text) => h('td', { class: `cnum ${gradeClass(stat, level)}`, title: level === 'none' ? '' : t(`lv.${level}`) }, text, level !== 'none' ? h('span', { class: 'sr-only' }, ` (${t(`lv.${level}`)})`) : null);
    const row = (label, rival, c, total) => {
      const p = percentages(c), g = gradeAll(c, th, { perMatch: !total });
      return h('tr', { class: total ? 'total' : '' },
        h('th', { scope: 'row' }, label), h('td', null, rival),
        ...COLS.map((k) => (k === 'possessions' ? cell('possessions', g.possessions, c[k]) : h('td', { class: 'cnum' }, c[k]))),
        cell('off_eff', g.off_eff, fmtPct(p.off_eff)), cell('loss_pct', g.loss_pct, fmtPct(p.loss_pct)), h('td', { class: 'cnum' }, fmtPct(p.shot_eff)), cell('save_pct', g.save_pct, fmtPct(p.save_pct)));
    };
    return h('div', { class: 'table-wrap wide' }, h('table', { class: 'tbl matches' },
      h('thead', null, h('tr', null, h('th', null, t('date')), h('th', null, t('rival')), ...COLS.map((c) => h('th', { title: t(`stat.${c}`) }, SHORT[c])), ...PCTS.map((p) => h('th', null, t(`pct.${p}.short`))))),
      h('tbody', null, report.matches.map((m) => row(fmtDate(m.date).slice(0, 5), m.rival, m.counters, false)), row(t('rep.total'), '', report.totals, true))));
  }

  // Pestaña «Jugadores»: todos juntos o uno elegido partido a partido
  function playersTab() {
    const info = report.players_info.filter((p) => report.players.rows.some((r) => r.player_id === p.id) || report.goalkeepers.rows.some((r) => r.player_id === p.id));
    if (!info.length) return h('p', { class: 'muted center' }, t('rep.player_none'));
    if (!info.some((p) => p.id === playerSel)) playerSel = '';
    const pick = h('div', { class: 'chips people no-print' },
      h('button', { type: 'button', class: `chip${playerSel === '' ? ' on' : ''}`, onclick: () => { playerSel = ''; lsSet('urd.rep.player', ''); render(); } }, t('rep.all_players')),
      info.map((p) => h('button', { type: 'button', class: `chip${playerSel === p.id ? ' on' : ''}`, onclick: () => { playerSel = p.id; lsSet('urd.rep.player', p.id); render(); } }, h('b', null, p.number ?? '·'), ' ', p.name)));
    if (!playerSel) return [pick, playersTable(report.players, nameOf), keepersTable(report.goalkeepers, nameOf)];
    const label = (m) => `${m.rival} ${fmtDate(m.date).slice(0, 5)}`;
    const mById = new Map(report.matches.map((m) => [m.id, m]));
    const rowsP = [], rowsK = [];
    for (const bm of report.by_match) {
      const m = mById.get(bm.match_id);
      const p = bm.players.find((r) => r.player_id === playerSel), k = bm.keepers.find((r) => r.player_id === playerSel);
      if (p) rowsP.push({ ...p, player_id: bm.match_id });
      if (k) rowsK.push({ ...k, player_id: bm.match_id });
    }
    const totP = report.players.rows.find((r) => r.player_id === playerSel), totK = report.goalkeepers.rows.find((r) => r.player_id === playerSel);
    if (totP) rowsP.push({ ...totP, player_id: '__total' });
    if (totK) rowsK.push({ ...totK, player_id: '__total' });
    const name = (id) => (id === '__total' ? t('rep.total') : label(mById.get(id)));
    return [pick,
      playersTable({ rows: rowsP, caption: `${nameOf(playerSel)} · ${t('tbl.players')}` }, name),
      keepersTable({ rows: rowsK, caption: `${nameOf(playerSel)} · ${t('tbl.keepers')}` }, name)];
  }

  function bestWorst() {
    const ms = report.matches;
    const defs = [['off_eff', true, (c) => c.possessions > 0], ['loss_pct', false, (c) => c.possessions > 0], ['shot_eff', true, (c) => c.shots > 0], ['save_pct', true, (c) => c.saves + c.goals_against > 0]];
    const items = defs.map(([k, high, ok]) => {
      const list = ms.filter((m) => ok(m.counters));
      if (list.length < 2) return null;
      const val = (m) => percentages(m.counters)[k];
      const sorted = [...list].sort((a, b) => (high ? val(b) - val(a) : val(a) - val(b)));
      const b = sorted[0], w = sorted.at(-1);
      return h('div', { class: 'bw-row' }, h('strong', null, t(`pct.${k}`)),
        h('span', null, '▲ ', `${b.rival} ${fmtDate(b.date).slice(0, 5)} · ${fmtPct(val(b))}`), h('span', null, '▼ ', `${w.rival} ${fmtDate(w.date).slice(0, 5)} · ${fmtPct(val(w))}`));
    }).filter(Boolean);
    return items.length ? h('div', { class: 'bw' }, h('h2', null, t('rep.best_worst')), items) : null;
  }

  function body() {
    if (busy) return h('p', { class: 'muted center' }, t('loading'));
    if (error) return h('p', { class: 'warn' }, error);
    if (!report) return null;
    if (S.tab === 'matches') {
      return [matchesTable(), report.matches.length ? lineChart(report.matches, state.thresholds) : null, report.matches.length ? h('p', { class: 'muted small' }, t('rep.legend')) : null];
    }
    if (S.tab === 'season') {
      const c = report.totals, n = report.matches.length;
      return n ? [
        h('div', { class: 'score big-score' }, t('rep.matches_n', { n }), h('span', { class: 'muted small' }, ` · ${t('rep.avg_poss', { n: (c.possessions / n).toFixed(1) })}`)),
        countersGrid(c), warningsBox(c), percentBlock(c, state.thresholds), bestWorst(),
        playersTable(report.players, nameOf), keepersTable(report.goalkeepers, nameOf),
        h('h2', null, t('maps.title')), mapsBlock(report.zones, report.cells, true),
      ] : h('p', { class: 'muted center' }, t('rep.none'));
    }
    if (S.tab === 'players') return report.matches.length ? playersTab() : h('p', { class: 'muted center' }, t('rep.none'));
    return report.matches.length
      ? h('div', { class: 'cards' }, [...report.matches].reverse().map((m) => h('a', { class: 'match-card', href: `#/summary/${m.id}` },
        h('div', { class: 'mc-date' }, fmtDate(m.date).slice(0, 5)), h('div', { class: 'mc-main' }, h('strong', null, m.rival)),
        h('div', { class: 'mc-score' }, m.counters.goals, '–', m.counters.goals_against), h('span', { class: 'chev' }, '›'))))
      : h('p', { class: 'muted center' }, t('rep.none'));
  }

  function render() {
    if (!state.teams.length) { page.replaceChildren(h('p', { class: 'muted' }, t('home.no_teams'))); return; }
    const season = state.seasons.find((s) => s.id === S.season);
    page.replaceChildren(
      h('div', { class: 'print-only print-head' }, h('img', { src: '/icons/logo.png', alt: '', height: 48 }), h('div', null, h('strong', null, `Urdaibai E.T. · ${teamName(currentTeamId())}`), h('div', null, `${season?.name || ''} ${S.from ? fmtDate(S.from) : ''} ${S.to ? '– ' + fmtDate(S.to) : ''}`))),
      h('div', { class: 'page-head no-print' }, h('h1', null, t('rep.title')), teamSelect(load)),
      h('div', { class: 'filters no-print' },
        field(t('rep.season'), h('select', { onchange: (e) => { S.season = e.target.value; load(); } }, h('option', { value: '' }, t('rep.all_seasons')), ...state.seasons.map((s) => h('option', { value: s.id, selected: s.id === S.season }, s.name)))),
        h('details', { class: 'more' }, h('summary', null, t('rep.filters')),
          h('div', { class: 'stack' },
            field(t('rival'), h('select', { onchange: (e) => { S.rival = e.target.value; load(); } }, h('option', { value: '' }, t('rep.any')), ...state.rivals.map((r) => h('option', { value: r.id, selected: r.id === S.rival }, r.name)))),
            h('div', { class: 'two' }, field(t('rep.from'), h('input', { type: 'date', value: S.from, onchange: (e) => { S.from = e.target.value; load(); } })), field(t('rep.to'), h('input', { type: 'date', value: S.to, onchange: (e) => { S.to = e.target.value; load(); } }))),
            segmented([{ value: '', label: t('rep.any') }, { value: 'home', label: t('home') }, { value: 'away', label: t('away') }], S.ha, (v) => { S.ha = v; load(); })))),
      segmented(['matches', 'season', 'players', 'match'].map((k) => ({ value: k, label: t(`rep.tab.${k}`) })), S.tab, (v) => { S.tab = v; lsSet('urd.rep', S); render(); }, t('rep.title')),
      body(),
      report && report.matches.length ? h('div', { class: 'btn-row wrap no-print' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => window.print() }, t('export.pdf')),
        h('button', { class: 'btn', type: 'button', onclick: exportXlsx }, t('export.xlsx')),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadCsv(fileName('csv'), matchRows()) }, t('export.csv'))) : null);
  }
  render();
  load();
}
