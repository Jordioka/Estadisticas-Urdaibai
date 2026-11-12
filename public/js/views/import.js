// Importar jugadores y estadísticas desde CSV o Excel: informe previo, decisión sobre duplicados y guardado.
import { h, toast, fmtDate } from '../dom.js';
import { t } from '../i18n.js';
import { state, api, loadBootstrap } from '../store.js';
import { segmented, field, backBar, errMsg, dropZone } from '../ui.js';
import { readFileRows, downloadXlsx, downloadCsv } from '../files.js';
import { playersTemplate, simpleTemplate, advancedTemplate } from '../templates.js';
import { currentTeamId } from './home.js';
import { inpescaPanel } from './import-inpesca.js';

const KINDS = ['inpesca', 'players', 'simple', 'advanced'];

export function importView(root, params = {}) {
  const page = h('div', { class: 'page' });
  root.append(page);
  const S = { kind: KINDS.includes(params.kind) ? params.kind : 'inpesca', panel: null, rows: null, fileName: '', report: null, busy: false, error: '',
    defaultTeam: '', ignoreErrors: false, dup: '', createTeams: false, done: null };
  const teamNames = () => state.teams.map((x) => x.name);
  const firstTeam = () => state.teams.find((x) => x.id === currentTeamId())?.name || state.teams[0]?.name || '';

  const tpl = () => (S.kind === 'players' ? playersTemplate : S.kind === 'simple' ? simpleTemplate : advancedTemplate)(firstTeam());
  const fileBase = () => ({ players: 'plantilla-jugadores', simple: 'plantilla-estadisticas', advanced: 'plantilla-eventos' }[S.kind]);

  // Las filas sin equipo usan el equipo elegido (útil con el Excel antiguo del club)
  const withTeam = () => S.rows.map((r) => {
    const k = Object.keys(r).find((x) => /^(equipo|team|taldea?)$/i.test(x.trim()));
    if (k && String(r[k]).trim() !== '') return r;
    return S.defaultTeam ? { ...r, Equipo: S.defaultTeam } : r;
  });

  async function call(dry, extra = {}) {
    S.busy = true; S.error = ''; render();
    try {
      const url = S.kind === 'players' ? '/api/import/players' : '/api/import/matches';
      const body = { rows: withTeam(), dry_run: dry, ...(S.kind === 'players' ? {} : { kind: S.kind }), ...extra };
      const rep = await api('POST', url, body);
      S.report = rep;
      if (!dry && rep.committed) { S.done = rep; S.rows = null; await loadBootstrap(); toast(t('imp.done')); }
    } catch (e) { S.error = errMsg(e); }
    S.busy = false; render();
  }

  async function onFile(file) {
    if (!file) return;
    S.fileName = file.name; S.report = null; S.done = null; S.error = ''; S.dup = ''; S.ignoreErrors = false; S.createTeams = false;
    try { S.rows = await readFileRows(file); } catch (e) { S.rows = null; S.error = e.code === 'no_headers' ? t('imp.no_headers') : t('imp.read_error'); render(); return; }
    if (!S.rows.length) { S.error = t('imp.empty'); render(); return; }
    await call(true);
  }

  const errText = (e) => {
    const base = t(`imp.err.${e.error}`);
    const text = base === `imp.err.${e.error}` ? e.error : base;
    return `${t('imp.row')} ${e.row}: ${text}${e.name ? ` (${e.name})` : ''}${e.number != null ? ` (${e.number})` : ''}${e.field ? ` (${e.field})` : ''}`;
  };

  function reportBox() {
    const r = S.report;
    if (!r) return null;
    const isPlayers = S.kind === 'players';
    const dupCount = isPlayers ? r.update.length : r.duplicates;
    const good = isPlayers ? r.create.length + r.update.length + r.unchanged.length : r.matches.filter((m) => !m.invalid).length;
    const needsDecision = dupCount > 0;
    const decisions = isPlayers ? ['update', 'skip'] : ['replace', 'add', 'skip'];
    if (needsDecision && !S.dup) S.dup = decisions[decisions.length - 1]; // por defecto lo más seguro: saltar
    const unknown = r.unknown_teams || [];
    const canCreateTeams = state.user.role === 'admin' && unknown.length > 0;
    return h('div', { class: 'report' },
      h('h2', null, t('imp.report')),
      h('ul', { class: 'summary-list' },
        h('li', null, t('imp.rows', { n: r.total })),
        isPlayers ? [h('li', null, t('imp.new_players', { n: r.create.length })), r.update.length ? h('li', null, t('imp.changed_players', { n: r.update.length })) : null, r.unchanged.length ? h('li', null, t('imp.unchanged', { n: r.unchanged.length })) : null]
          : [h('li', null, t('imp.matches', { n: r.matches.length })), r.duplicates ? h('li', { class: 'warn-li' }, t('imp.dup_matches', { n: r.duplicates })) : null,
            r.new_rivals?.length ? h('li', null, t('imp.new_rivals', { list: r.new_rivals.join(', ') })) : null],
        r.new_teams?.length ? h('li', null, t('imp.new_teams', { list: r.new_teams.join(', ') })) : null),
      !isPlayers && r.matches.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, t('date')), h('th', null, t('rival')), h('th', null, S.kind === 'simple' ? t('imp.score') : t('imp.events')), h('th', null, ''))),
        h('tbody', null, r.matches.map((m) => h('tr', null, h('td', null, fmtDate(m.date)), h('td', null, m.rival),
          h('td', null, S.kind === 'simple' ? `${m.counters.goals}–${m.counters.goals_against}` : m.events), h('td', null, m.duplicate ? '⚠ ' + t('imp.duplicate') : '')))))) : null,
      r.errors.length ? h('div', { class: 'warn' }, h('strong', null, t('imp.errors', { n: r.errors.length })),
        h('ul', null, r.errors.slice(0, 30).map((e) => h('li', null, errText(e))), r.errors.length > 30 ? h('li', null, `… +${r.errors.length - 30}`) : null)) : null,
      r.warnings?.length ? h('div', { class: 'warn' }, h('ul', null, r.warnings.slice(0, 10).map((w) => h('li', null, `${t('imp.row')} ${w.row}: ${t(`warn.${w.warning}`)}`)))) : null,
      canCreateTeams ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.createTeams, onchange: (e) => { S.createTeams = e.target.checked; call(true, { create_teams: S.createTeams }); } }), t('imp.create_teams', { list: unknown.join(', ') })) : null,
      r.errors.length && good > 0 ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.ignoreErrors, onchange: (e) => { S.ignoreErrors = e.target.checked; render(); } }), t('imp.ignore_errors')) : null,
      needsDecision ? h('div', { class: 'stack' }, h('h3', null, t('imp.dup_title')),
        segmented(decisions.map((d) => ({ value: d, label: t(`imp.dup.${d}`) })), S.dup, (v) => { S.dup = v; render(); })) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => { S.rows = null; S.report = null; S.fileName = ''; render(); } }, t('cancel')),
        h('button', { class: 'btn primary', type: 'button', disabled: S.busy || good === 0 || (r.errors.length && !S.ignoreErrors) || (unknown.length && !S.createTeams && r.errors.length === 0 && false),
          onclick: () => call(false, { on_duplicate: needsDecision ? S.dup : undefined, ignore_errors: S.ignoreErrors, create_teams: S.createTeams }) }, t('imp.go'))));
  }

  function render() {
    if (S.kind === 'inpesca') {
      S.panel = S.panel || inpescaPanel();
      page.replaceChildren(
        backBar(t('imp.title'), () => history.back()),
        segmented(KINDS.map((k) => ({ value: k, label: t(`imp.kind.${k}`) })), S.kind, (v) => { S.kind = v; S.rows = null; S.report = null; S.done = null; S.error = ''; S.fileName = ''; render(); }, t('imp.kind')),
        h('p', { class: 'muted' }, t('imp.help.inpesca')), S.panel);
      return;
    }
    page.replaceChildren(
      backBar(t('imp.title'), () => history.back()),
      segmented(KINDS.map((k) => ({ value: k, label: t(`imp.kind.${k}`) })), S.kind, (v) => { S.kind = v; S.panel = null; S.rows = null; S.report = null; S.done = null; S.error = ''; S.fileName = ''; render(); }, t('imp.kind')),
      h('p', { class: 'muted' }, t(`imp.help.${S.kind}`)),
      h('div', { class: 'btn-row wrap' },
        h('button', { class: 'btn', type: 'button', onclick: () => downloadXlsx(`${fileBase()}.xlsx`, tpl()) }, '⬇ ', t('imp.tpl_xlsx')),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadCsv(`${fileBase()}.csv`, tpl()[0].aoa) }, '⬇ ', t('imp.tpl_csv'))),
      state.teams.length > 1 ? field(t('imp.default_team'),
        h('select', { onchange: (e) => { S.defaultTeam = e.target.value; if (S.rows) call(true); } },
          h('option', { value: '' }, t('imp.default_none')), ...teamNames().map((n) => h('option', { value: n, selected: n === S.defaultTeam }, n))), t('imp.default_team_hint')) : null,
      dropZone(h('label', { class: 'file-pick' }, h('span', { class: 'btn primary big' }, S.fileName ? `📄 ${S.fileName}` : t('imp.choose')),
        h('span', { class: 'muted small drop-hint' }, t('imp.drop')),
        h('input', { type: 'file', accept: '.csv,.xlsx,.xls,.txt', class: 'sr-only', onchange: (e) => onFile(e.target.files[0]) })), onFile),
      S.busy ? h('p', { class: 'muted center' }, t('loading')) : null,
      S.error ? h('p', { class: 'warn', role: 'alert' }, S.error) : null,
      S.done ? h('div', { class: 'ok-box' }, '✓ ', t('imp.done'), S.done.created != null ? ` — ${t('imp.created', { n: S.done.created })}` : '') : null,
      !S.done ? reportBox() : null);
  }
  render();
}
