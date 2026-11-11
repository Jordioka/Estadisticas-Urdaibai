// Panel del administrador: usuarios y permisos por equipo, equipos, temporadas, umbrales, papelera y registro.
import { h, toast, sheet, confirmDialog, fmtDate } from '../dom.js';
import { t } from '../i18n.js';
import { state, api, loadBootstrap } from '../store.js';
import { backBar, field, errMsg, segmented } from '../ui.js';
import { DEFAULT_THRESHOLDS } from '../stats.js';

const SECTIONS = ['users', 'teams', 'seasons', 'thresholds', 'trash', 'audit'];

export function adminView(root, { section } = {}) {
  const page = h('div', { class: 'page' });
  root.append(page);
  if (state.user.role !== 'admin') { page.append(h('p', { class: 'warn' }, t('err.forbidden'))); return; }

  const guard = async (fn) => { try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return null; } };

  if (!section) {
    page.append(backBar(t('admin.title'), () => (location.hash = '#/more')),
      h('div', { class: 'menu' }, SECTIONS.map((s) => h('a', { class: 'menu-item', href: `#/admin/${s}` }, t(`admin.${s}`), h('span', { class: 'chev' }, '›')))));
    return;
  }
  const back = () => (location.hash = '#/admin');
  const body = h('div');
  page.append(backBar(t(`admin.${section}`), back), body);
  const refresh = async () => { await loadBootstrap(); };

  const sections = {
    // ---------- Usuarios ----------
    async users() {
      const { users } = await api('GET', '/api/users');
      const teams = state.teams;
      const editor = (u) => {
        const f = { username: u?.username || '', name: u?.name || '', password: '', role: u?.role || 'scorer', all_teams: !!u?.all_teams, active: u ? u.active : true, team_ids: new Set(u?.team_ids || []) };
        const err = h('p', { class: 'warn', hidden: true });
        const teamBox = h('div', { class: 'stack' });
        const drawTeams = () => teamBox.replaceChildren(...(f.all_teams || f.role === 'admin' ? [h('p', { class: 'muted small' }, t('admin.all_teams_hint'))]
          : teams.map((tm) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.team_ids.has(tm.id), onchange: (e) => { e.target.checked ? f.team_ids.add(tm.id) : f.team_ids.delete(tm.id); } }), tm.name))));
        const s = sheet({
          title: u ? u.username : t('admin.user_add'),
          body: h('form', { class: 'stack', onsubmit: async (e) => {
            e.preventDefault();
            const body = { name: f.name, role: f.role, all_teams: f.all_teams, team_ids: [...f.team_ids] };
            if (u) { body.active = f.active; if (f.password) body.password = f.password; } else { body.username = f.username; body.password = f.password; }
            try { await api(u ? 'PATCH' : 'POST', u ? `/api/users/${u.id}` : '/api/users', body); s.close(); toast(t('saved')); sections.users_reload(); }
            catch (er) { err.hidden = false; err.textContent = errMsg(er); }
          } },
          u ? null : field(t('login.user'), h('input', { type: 'text', required: true, maxlength: 40, autocapitalize: 'none', autocomplete: 'off', value: f.username, oninput: (e) => { f.username = e.target.value; } })),
          field(t('pl.name'), h('input', { type: 'text', maxlength: 80, value: f.name, oninput: (e) => { f.name = e.target.value; } })),
          field(u ? t('admin.new_password') : t('login.password'), h('input', { type: 'text', autocomplete: 'off', required: !u, minlength: 6, value: f.password, oninput: (e) => { f.password = e.target.value; } }), u ? t('admin.password_hint') : t('admin.password_min')),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.role === 'admin', onchange: (e) => { f.role = e.target.checked ? 'admin' : 'scorer'; drawTeams(); } }), t('admin.is_admin')),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.all_teams, onchange: (e) => { f.all_teams = e.target.checked; drawTeams(); } }), t('admin.all_teams')),
          h('h3', null, t('admin.teams_of_user')), teamBox,
          u ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.active, onchange: (e) => { f.active = e.target.checked; } }), t('admin.active')) : null,
          err, h('button', { class: 'btn primary', type: 'submit' }, t('save'))),
        });
        drawTeams();
      };
      sections.users_reload = () => guard(sections.users);
      body.replaceChildren(
        h('button', { class: 'btn primary', type: 'button', onclick: () => editor(null) }, '+ ', t('admin.user_add')),
        h('div', { class: 'cards' }, users.map((u) => h('button', { type: 'button', class: 'player-card', onclick: () => editor(u) },
          h('span', { class: 'pc-main' }, h('strong', null, u.username, u.name && u.name !== u.username ? ` · ${u.name}` : ''),
            h('span', { class: 'muted small' }, u.role === 'admin' || u.all_teams ? t('admin.all_teams_short') : u.team_ids.map((id) => teams.find((x) => x.id === id)?.name).filter(Boolean).join(', ') || t('admin.no_teams'))),
          u.role === 'admin' ? h('span', { class: 'badge' }, 'Admin') : null, !u.active ? h('span', { class: 'badge off' }, t('admin.inactive')) : null, h('span', { class: 'chev' }, '›')))));
    },

    // ---------- Equipos ----------
    async teams() {
      const ask = (title, initial, onOk) => {
        let v = initial;
        const s = sheet({ title, body: h('form', { class: 'stack', onsubmit: async (e) => { e.preventDefault(); if (await guard(() => onOk(v.trim()))) { s.close(); await refresh(); sections.teams(); } } },
          h('input', { type: 'text', required: true, maxlength: 80, value: v, oninput: (e) => { v = e.target.value; } }), h('button', { class: 'btn primary', type: 'submit' }, t('save'))) });
      };
      body.replaceChildren(
        h('button', { class: 'btn primary', type: 'button', onclick: () => ask(t('admin.team_add'), '', (n) => api('POST', '/api/teams', { name: n }).then(() => true)) }, '+ ', t('admin.team_add')),
        h('h2', null, t('admin.own_teams')),
        h('div', { class: 'cards' }, state.teams.map((tm) => h('div', { class: 'player-card' }, h('span', { class: 'pc-main' }, h('strong', null, tm.name)),
          h('button', { class: 'btn small', type: 'button', onclick: () => ask(t('admin.rename'), tm.name, (n) => api('PATCH', `/api/teams/${tm.id}`, { name: n }).then(() => true)) }, t('edit')),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
            if (await confirmDialog(t('admin.team_delete_q', { name: tm.name }), { yes: t('delete'), no: t('cancel'), danger: true, detail: t('admin.trash_hint') })) { await guard(() => api('DELETE', `/api/teams/${tm.id}`)); await refresh(); sections.teams(); }
          } }, t('delete'))))),
        h('h2', null, t('admin.rivals')), h('p', { class: 'muted small' }, t('admin.rivals_hint')),
        h('div', { class: 'cards' }, state.rivals.map((r) => h('div', { class: 'player-card' }, h('span', { class: 'pc-main' }, h('strong', null, r.name)),
          h('button', { class: 'btn small', type: 'button', onclick: () => ask(t('admin.rename'), r.name, (n) => api('PATCH', `/api/teams/${r.id}`, { name: n }).then(() => true)) }, t('edit'))))));
    },

    // ---------- Temporadas ----------
    async seasons() {
      const editor = (s0) => {
        const f = { name: s0?.name || '', start_date: s0?.start_date || '', end_date: s0?.end_date || '', closed: !!s0?.closed };
        const err = h('p', { class: 'warn', hidden: true });
        const s = sheet({ title: s0 ? s0.name : t('admin.season_add'), body: h('form', { class: 'stack', onsubmit: async (e) => {
          e.preventDefault();
          try { await api(s0 ? 'PATCH' : 'POST', s0 ? `/api/seasons/${s0.id}` : '/api/seasons', f); s.close(); toast(t('saved')); await refresh(); sections.seasons(); }
          catch (er) { err.hidden = false; err.textContent = errMsg(er); }
        } },
        field(t('admin.season_name'), h('input', { type: 'text', required: true, maxlength: 20, placeholder: '2026-27', value: f.name, oninput: (e) => { f.name = e.target.value; } })),
        field(t('admin.season_start'), h('input', { type: 'date', required: true, value: f.start_date, onchange: (e) => { f.start_date = e.target.value; } })),
        field(t('admin.season_end'), h('input', { type: 'date', required: true, value: f.end_date, onchange: (e) => { f.end_date = e.target.value; } })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.closed, onchange: (e) => { f.closed = e.target.checked; } }), t('admin.season_closed')),
        h('p', { class: 'muted small' }, t('admin.season_hint')), err, h('button', { class: 'btn primary', type: 'submit' }, t('save'))) });
      };
      body.replaceChildren(h('button', { class: 'btn primary', type: 'button', onclick: () => editor(null) }, '+ ', t('admin.season_add')),
        h('div', { class: 'cards' }, state.seasons.map((s) => h('button', { type: 'button', class: 'player-card', onclick: () => editor(s) },
          h('span', { class: 'pc-main' }, h('strong', null, s.name), h('span', { class: 'muted small' }, `${fmtDate(s.start_date)} – ${fmtDate(s.end_date)}`)),
          s.closed ? h('span', { class: 'badge off' }, t('admin.closed')) : null, h('span', { class: 'chev' }, '›')))));
    },

    // ---------- Umbrales de color ----------
    async thresholds() {
      const th = JSON.parse(JSON.stringify(state.thresholds || DEFAULT_THRESHOLDS));
      const pct = (v) => Math.round(v * 1000) / 10;
      const num = (obj, key, scale = 1) => h('input', { type: 'number', step: scale === 1 ? 1 : 0.5, inputmode: 'decimal', value: scale === 1 ? obj[key] : pct(obj[key]),
        oninput: (e) => { obj[key] = scale === 1 ? Number(e.target.value) : Number(e.target.value) / 100; } });
      const err = h('p', { class: 'warn', hidden: true });
      body.replaceChildren(
        h('p', { class: 'muted' }, t('admin.th_hint')),
        h('section', { class: 'th-box' }, h('h2', null, t('stat.possessions')),
          field(t('admin.th_green_gt'), num(th.possessions, 'green_gt')), field(t('admin.th_orange_gte'), num(th.possessions, 'orange_gte'))),
        h('section', { class: 'th-box' }, h('h2', null, t('pct.off_eff')),
          field(`${t('admin.th_green_gt')} (%)`, num(th.off_eff, 'green_gt', 100)), field(`${t('admin.th_orange_gte')} (%)`, num(th.off_eff, 'orange_gte', 100))),
        h('section', { class: 'th-box' }, h('h2', null, t('pct.save_pct')),
          field(`${t('admin.th_green_gt')} (%)`, num(th.save_pct, 'green_gt', 100)), field(`${t('admin.th_orange_gte')} (%)`, num(th.save_pct, 'orange_gte', 100))),
        h('section', { class: 'th-box' }, h('h2', null, t('pct.loss_pct')), h('p', { class: 'muted small' }, t('admin.th_loss_hint')),
          field(`${t('admin.th_great_lt')} (%)`, num(th.loss_pct, 'great_lt', 100)), field(`${t('admin.th_good_lt')} (%)`, num(th.loss_pct, 'good_lt', 100)), field(`${t('admin.th_orange_lt')} (%)`, num(th.loss_pct, 'orange_lt', 100))),
        err,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: async () => { if (await guard(() => api('PUT', '/api/settings/thresholds', DEFAULT_THRESHOLDS))) { await refresh(); toast(t('saved')); sections.thresholds(); } } }, t('admin.th_reset')),
          h('button', { class: 'btn primary', type: 'button', onclick: async () => {
            try { await api('PUT', '/api/settings/thresholds', th); await refresh(); toast(t('saved')); err.hidden = true; } catch (e) { err.hidden = false; err.textContent = errMsg(e); }
          } }, t('save'))));
    },

    // ---------- Papelera ----------
    async trash() {
      const d = await api('GET', '/api/trash');
      const restore = async (entity, id) => { if (await guard(() => api('POST', '/api/trash/restore', { entity, id }))) { toast(t('restored')); await refresh(); sections.trash(); } };
      const group = (title, items, label) => items.length ? [h('h2', null, title), h('div', { class: 'cards' }, items.map((it) => h('div', { class: 'player-card' },
        h('span', { class: 'pc-main' }, h('strong', null, label(it)), h('span', { class: 'muted small' }, (it.deleted_at || '').replace('T', ' ').slice(0, 16))),
        h('button', { class: 'btn small', type: 'button', onclick: () => restore(it.__e, it.id) }, t('restore')))))] : [];
      const tag = (arr, e) => arr.map((x) => ({ ...x, __e: e }));
      const all = d.matches.length + d.players.length + d.teams.length + d.events.length;
      body.replaceChildren(all ? [
        ...group(t('admin.trash_matches'), tag(d.matches, 'match'), (m) => `${m.team} · ${m.rival} · ${fmtDate(m.date)}`),
        ...group(t('admin.trash_players'), tag(d.players, 'player'), (p) => `${p.team} · ${p.number ?? ''} ${p.name} ${p.surname}`),
        ...group(t('admin.trash_teams'), tag(d.teams, 'team'), (x) => x.name),
        ...group(t('admin.trash_events'), tag(d.events, 'event'), (e) => `${e.team} · ${e.rival} · ${fmtDate(e.date)} · ${t(`ev.${e.type}`)}`),
      ] : h('p', { class: 'muted center' }, t('admin.trash_empty')));
    },

    // ---------- Registro de cambios ----------
    async audit() {
      const { log } = await api('GET', '/api/audit');
      body.replaceChildren(h('div', { class: 'table-wrap wide' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, t('admin.when')), h('th', null, t('admin.who')), h('th', null, t('admin.what')))),
        h('tbody', null, log.map((l) => h('tr', null, h('td', null, l.at.replace('T', ' ').slice(5, 16)), h('td', null, l.username || '—'), h('td', null, l.action, l.detail ? h('span', { class: 'muted small' }, ' ', l.detail.slice(0, 80)) : null)))))));
    },
  };
  guard(() => sections[section]());
}
