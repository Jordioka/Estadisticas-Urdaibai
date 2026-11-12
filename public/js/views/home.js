// Lista de partidos y asistente de partido nuevo (3 pasos).
import { h, toast, fmtDate, today, uid } from '../dom.js';
import { t } from '../i18n.js';
import { state, enqueue, rivalName, teamName } from '../store.js';
import { segmented, field, searchBox } from '../ui.js';
import { normName } from '../names.js';
import { backupAge, BACKUP_WARN_DAYS } from './misc.js';

const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* nada */ } };

export function currentTeamId() {
  const saved = lsGet('urd.team', '');
  return state.teams.find((x) => x.id === saved)?.id || state.teams[0]?.id || null;
}

export function teamSelect(onChange) {
  if (state.teams.length < 2) return null;
  const cur = currentTeamId();
  return h('label', { class: 'team-select' }, h('span', { class: 'sr-only' }, t('team')),
    h('select', { onchange: (e) => { lsSet('urd.team', e.target.value); onChange?.(e.target.value); } },
      state.teams.map((x) => h('option', { value: x.id, selected: x.id === cur }, x.name))));
}

export function homeView(root) {
  const page = h('div', { class: 'page' });
  root.append(page);
  let q = '';
  const render = () => {
    const team = currentTeamId();
    if (!state.teams.length) {
      page.replaceChildren(h('div', { class: 'empty' }, h('h1', null, t('home.title')), h('p', null, t('home.no_teams'))));
      return;
    }
    const matches = state.matches.filter((m) => m.team_id === team);
    const listBox = h('div');
    const fill = () => {
      const shown = matches.filter((m) => !q || normName(rivalName(m.rival_id)).includes(normName(q)));
      listBox.replaceChildren(matches.length
        ? (shown.length ? h('div', { class: 'cards' }, shown.map((m) =>
          h('a', { class: 'match-card', href: `#/match/${m.id}` },
            h('div', { class: 'mc-date' }, fmtDate(m.date).slice(0, 5), h('span', { class: 'muted small' }, fmtDate(m.date).slice(6))),
            h('div', { class: 'mc-main' }, h('strong', null, `${m.home_away === 'away' ? '@ ' : ''}${rivalName(m.rival_id)}`),
              h('span', { class: 'muted small' }, m.is_practice ? t('practice') : (m.home_away === 'away' ? t('away') : t('home')))),
            h('div', { class: 'mc-score' }, m.counters.goals, '–', m.counters.goals_against),
            h('span', { class: 'chev' }, '›')))) : h('p', { class: 'muted center' }, t('search.none')))
        : h('p', { class: 'muted center' }, t('home.empty')));
    };
    fill();
    const age = backupAge();
    const dismissed = (() => { try { return sessionStorage.getItem('urd.backup.dismiss') === '1'; } catch { return false; } })();
    const backupBanner = state.user.role === 'admin' && state.matches.length && (age == null || age > BACKUP_WARN_DAYS) && !dismissed
      ? h('div', { class: 'banner' }, h('span', null, age == null ? t('backup.banner_never') : t('backup.banner', { n: age })),
        h('a', { class: 'btn small', href: '#/more' }, t('backup.btn')),
        h('button', { class: 'icon-btn small', type: 'button', 'aria-label': '✕', onclick: () => { try { sessionStorage.setItem('urd.backup.dismiss', '1'); } catch { /* nada */ } render(); } }, '✕')) : null;
    page.replaceChildren(
      backupBanner,
      h('div', { class: 'page-head' }, h('h1', null, t('home.title')), teamSelect(render)),
      h('a', { class: 'btn primary big', href: '#/new' }, '+ ', t('home.new')),
      matches.length > 3 ? searchBox(t('search.rival'), q, (v) => { q = v; fill(); }) : null,
      listBox);
  };
  render();
}

// Asistente de partido nuevo: equipo → rival → fecha
export function newMatchView(root, params = {}) {
  const page = h('div', { class: 'page' });
  root.append(page);
  const practice = !!params.practice;
  const form = { team: currentTeamId(), rival: '', date: today(), ha: 'home', newRival: '', squad: null };
  const repeat = (src) => { form.team = src.team_id; form.rival = src.rival_id; form.ha = src.home_away; form.squad = src.squad || null; form.newRival = ''; };
  const src0 = params.from && state.matches.find((x) => x.id === params.from);
  if (src0) repeat(src0);
  // Atajo: repetir rival, local/visitante y convocados de un partido reciente
  const repeatBox = () => {
    const recent = state.matches.filter((x) => x.team_id === form.team && !x.is_practice).slice(0, 3);
    if (!recent.length || practice) return null;
    return h('section', { class: 'step repeat' }, h('h2', null, t('new.repeat')),
      h('div', { class: 'chips' }, recent.map((x) => h('button', { type: 'button', class: `chip${form.rival === x.rival_id && form.date === today() && src0?.id === x.id ? ' on' : ''}`,
        onclick: () => { repeat(x); toast(t('new.repeated')); render(); } }, `${x.home_away === 'away' ? '@ ' : ''}${rivalName(x.rival_id)} · ${fmtDate(x.date).slice(0, 5)}`))),
      form.squad ? h('p', { class: 'muted small' }, t('new.squad_kept', { n: form.squad.length })) : null);
  };
  const rivalSel = h('select', { 'aria-label': t('rival'), onchange: (e) => { form.rival = e.target.value; render(); } });
  const render = () => {
    rivalSel.replaceChildren(h('option', { value: '' }, t('new.pick_rival')), ...state.rivals.map((r) => h('option', { value: r.id, selected: r.id === form.rival }, r.name)));
    const ready = form.team && (form.rival || form.newRival.trim());
    page.replaceChildren(
      h('div', { class: 'subbar' }, h('a', { class: 'icon-btn', href: '#/', 'aria-label': t('back') }, '←'), h('h1', null, practice ? t('new.title_practice') : t('new.title')), h('span')),
      repeatBox(),
      h('section', { class: 'step' }, h('h2', null, h('span', { class: 'num' }, 1), t('new.team')),
        state.teams.length > 1
          ? h('select', { onchange: (e) => { form.team = e.target.value; } }, state.teams.map((x) => h('option', { value: x.id, selected: x.id === form.team }, x.name)))
          : h('p', { class: 'static' }, teamName(form.team))),
      h('section', { class: 'step' }, h('h2', null, h('span', { class: 'num' }, 2), t('new.rival')), rivalSel,
        h('div', { class: 'or' }, t('new.or_new')),
        h('input', { type: 'text', placeholder: t('new.rival_name'), value: form.newRival, maxlength: 80, autocomplete: 'off',
          oninput: (e) => { form.newRival = e.target.value; if (e.target.value) { form.rival = ''; rivalSel.value = ''; } btn.disabled = !(form.team && (form.rival || e.target.value.trim())); } })),
      h('section', { class: 'step' }, h('h2', null, h('span', { class: 'num' }, 3), t('new.date')),
        h('input', { type: 'date', value: form.date, onchange: (e) => { form.date = e.target.value; } }),
        segmented([{ value: 'home', label: t('home') }, { value: 'away', label: t('away') }], form.ha, (v) => { form.ha = v; render(); })),
      btn);
    btn.disabled = !ready;
  };
  const btn = h('button', { class: 'btn primary big', type: 'button', onclick: () => {
    if (!form.team || !form.date) return;
    let rivalId = form.rival;
    if (!rivalId) {
      const name = form.newRival.trim();
      const found = state.rivals.find((r) => normName(r.name) === normName(name)); // no se crean rivales repetidos
      rivalId = found?.id || uid('rival');
      if (!found) enqueue({ op: 'rival.create', id: rivalId, name });
    }
    const id = uid('match');
    enqueue({ op: 'match.create', id, team_id: form.team, rival_id: rivalId, date: form.date, home_away: form.ha, is_practice: practice, squad: form.squad });
    location.hash = `#/match/${id}`;
  } }, t('new.go'));
  render();
}
