// Jugadores de cada equipo: se guardan una vez y se reutilizan en todos los partidos.
import { h, toast, sheet, confirmDialog, uid } from '../dom.js';
import { t } from '../i18n.js';
import { state, enqueue, playersOf, teamName } from '../store.js';
import { field, errMsg, searchBox } from '../ui.js';
import { normName } from '../names.js';
import { currentTeamId, teamSelect } from './home.js';
import { downloadXlsx, downloadCsv } from '../files.js';
import { PLAYER_HEADERS } from '../templates.js';
import { flush } from '../store.js';

const POSITIONS = ['Portero', 'Extremo', 'Lateral', 'Central', 'Pivote'];

export function playersView(root, params = {}) {
  const page = h('div', { class: 'page' });
  root.append(page);
  let q = '';

  function editor(p) {
    const team = currentTeamId();
    const f = { name: p?.name || '', surname: p?.surname || '', number: p?.number ?? '', position: p?.position || '', is_goalkeeper: !!p?.is_goalkeeper };
    const err = h('p', { class: 'warn', hidden: true });
    const s = sheet({
      title: p ? t('pl.edit') : t('pl.add'),
      body: h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        const number = f.number === '' ? null : Number(f.number);
        if (!f.name.trim()) return;
        if (number != null && playersOf(team).some((x) => x.number === number && x.id !== p?.id)) { err.hidden = false; err.textContent = t('err.duplicate_number'); return; }
        const fields = { name: f.name.trim(), surname: f.surname.trim(), number, position: f.position.trim(), is_goalkeeper: f.is_goalkeeper };
        if (p) enqueue({ op: 'player.update', id: p.id, fields });
        else enqueue({ op: 'player.create', id: uid('pl'), team_id: team, ...fields });
        s.close(); toast(t('saved')); render();
      } },
      field(t('pl.name'), h('input', { type: 'text', required: true, maxlength: 60, value: f.name, autocomplete: 'off', oninput: (e) => { f.name = e.target.value; } })),
      field(t('pl.surname'), h('input', { type: 'text', maxlength: 60, value: f.surname, autocomplete: 'off', oninput: (e) => { f.surname = e.target.value; } })),
      field(t('pl.number'), h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 99, value: f.number, oninput: (e) => { f.number = e.target.value; } })),
      field(t('pl.position'), h('input', { type: 'text', list: 'positions', maxlength: 30, value: f.position, oninput: (e) => { f.position = e.target.value; } })),
      h('datalist', { id: 'positions' }, POSITIONS.map((x) => h('option', { value: t(`pos.${x}`) }))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.is_goalkeeper, onchange: (e) => { f.is_goalkeeper = e.target.checked; } }), t('pl.goalkeeper')),
      err,
      h('div', { class: 'btn-row' },
        p ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          s.close();
          if (await confirmDialog(t('pl.delete_q', { name: p.name }), { yes: t('delete'), no: t('cancel'), danger: true, detail: t('pl.delete_hint') })) { enqueue({ op: 'player.delete', id: p.id }); toast(t('deleted')); render(); }
        } }, t('delete')) : null,
        h('button', { class: 'btn primary', type: 'submit' }, t('save')))),
    });
  }

  const rows = (list) => [PLAYER_HEADERS, ...list.map((p) => [teamName(p.team_id), p.name, p.surname, p.number ?? '', p.position, p.is_goalkeeper ? 'sí' : 'no'])];

  function render() {
    const team = currentTeamId();
    if (!state.teams.length) { page.replaceChildren(h('p', { class: 'muted' }, t('home.no_teams'))); return; }
    const list = playersOf(team);
    const listBox = h('div');
    page.replaceChildren(
      h('div', { class: 'page-head' }, h('h1', null, t('pl.title')), teamSelect(render)),
      h('div', { class: 'btn-row wrap' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => editor(null) }, '+ ', t('pl.add')),
        h('a', { class: 'btn', href: '#/import?kind=players' }, t('pl.import')),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadXlsx(`jugadores-${teamName(team)}.xlsx`, [{ name: 'Jugadores', aoa: rows(list) }]) }, t('export.xlsx')),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadCsv(`jugadores-${teamName(team)}.csv`, rows(list)) }, t('export.csv'))),
      list.length > 5 ? searchBox(t('search.player'), q, (v) => { q = v; fill(); }) : null,
      listBox);
    function fill() {
      const shown = list.filter((p) => !q || normName(`${p.number ?? ''} ${p.name} ${p.surname || ''}`).includes(normName(q)));
      listBox.replaceChildren(list.length
        ? (shown.length ? h('div', { class: 'cards' }, shown.map((p) => h('a', { class: 'player-card', href: `#/player/${p.id}` },
          h('span', { class: 'dorsal' }, p.number ?? '·'),
          h('span', { class: 'pc-main' }, h('strong', null, `${p.name}${p.surname ? ' ' + p.surname : ''}`), h('span', { class: 'muted small' }, p.position || '')),
          p.is_goalkeeper ? h('span', { class: 'badge' }, '🧤 ', t('pl.gk')) : null,
          h('button', { type: 'button', class: 'btn small', 'aria-label': t('edit'), onclick: (e) => { e.preventDefault(); e.stopPropagation(); editor(p); } }, '✎'),
          h('span', { class: 'chev' }, '›')))) : h('p', { class: 'muted center' }, t('search.none')))
        : h('p', { class: 'muted center' }, t('pl.empty')));
    }
    fill();
  }
  render();
  if (params.edit) { const ep = state.players.find((x) => x.id === params.edit); if (ep) { history.replaceState(null, '', '#/players'); editor(ep); } }
}
