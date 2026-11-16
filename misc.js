// Pantallas pequeñas: acceso, menú "Más" y ayuda con mini tutorial.
import { h, toast, sheet, clear, fmtDate } from '../dom.js';
import { t, getLang, setLang } from '../i18n.js';
import { state, api, loadBootstrap, forgetLocal, setLastBackup } from '../store.js';
import { field, errMsg, segmented } from '../ui.js';
import { pref, prefOn, setPref } from '../prefs.js';

export function langToggle(onChange) {
  return h('div', { class: 'lang', role: 'group', 'aria-label': 'Hizkuntza / Idioma' },
    ['eu', 'es'].map((l) => h('button', { type: 'button', class: l === getLang() ? 'on' : '', 'aria-pressed': l === getLang() ? 'true' : 'false', onclick: () => { setLang(l); onChange?.(); } }, l.toUpperCase())));
}

export function loginView(root, { onLogin, rerender }) {
  const f = { username: '', password: '' };
  const err = h('p', { class: 'warn', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn primary big', type: 'submit' }, t('login.enter'));
  root.append(h('div', { class: 'login' },
    h('div', { class: 'login-lang' }, langToggle(rerender)),
    h('img', { src: '/icons/logo.png', alt: 'Urdaibai Eskubaloi Taldea', class: 'login-logo', width: 96 }),
    h('h1', null, 'Urdaibai E.T.'), h('p', { class: 'muted' }, t('app.subtitle')),
    h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.hidden = true;
      try { await api('POST', '/api/login', { username: f.username.trim(), password: f.password }); await onLogin(); }
      catch (er) { err.hidden = false; err.textContent = er.network ? t('err.network') : er.code === 'invalid_credentials' ? t('login.bad') : errMsg(er); btn.disabled = false; }
    } },
    field(t('login.user'), h('input', { type: 'text', required: true, autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', oninput: (e) => { f.username = e.target.value; } })),
    field(t('login.password'), h('input', { type: 'password', required: true, autocomplete: 'current-password', oninput: (e) => { f.password = e.target.value; } })),
    err, btn)));
}

// Días desde la última copia de seguridad (null = nunca)
export const backupAge = () => {
  const d = state.last_backup && new Date(state.last_backup);
  return d && !isNaN(d) ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
};
export const BACKUP_WARN_DAYS = 30;

async function downloadBackup() {
  const data = await api('GET', '/api/backup');
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `urdaibai-copia-${data.created_at.slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  setLastBackup(data.created_at);
  return data;
}

export function moreView(root, { logout, rerender }) {
  const toggle = (key, label, hint) => h('label', { class: 'check pref-row' },
    h('input', { type: 'checkbox', checked: prefOn(key), onchange: (e) => { setPref(key, e.target.checked ? '1' : '0'); } }),
    h('span', null, h('b', null, label), hint ? h('span', { class: 'muted small block' }, hint) : null));
  const age = backupAge();
  const backupMsg = h('p', { class: age == null || age > BACKUP_WARN_DAYS ? 'warn' : 'muted' },
    state.last_backup ? `${t('backup.last')}: ${fmtDate(state.last_backup.slice(0, 10))} · ${age === 0 ? t('backup.today') : t('backup.days_ago', { n: age })}` : t('backup.never'));
  const backupBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    backupBtn.disabled = true;
    try { const d = await downloadBackup(); toast(t('backup.done', { n: d.events.length })); rerender(); }
    catch (e) { toast(e.network ? t('err.network') : errMsg(e), 'error'); backupBtn.disabled = false; }
  } }, `⬇ ${t('backup.btn')}`);
  const item = (href, label, icon) => h('a', { class: 'menu-item', href }, h('span', null, icon, ' ', label), h('span', { class: 'chev' }, '›'));
  root.append(h('div', { class: 'page' },
    h('h1', null, t('more.title')),
    h('p', { class: 'muted' }, `${state.user.name || state.user.username}${state.user.role === 'admin' ? ' · Admin' : ''}`),
    h('div', { class: 'menu' },
      item('#/import', t('imp.title'), '⬆'),
      state.user.role === 'admin' ? item('#/admin', t('admin.title'), '⚙') : null,
      state.user.role === 'admin' ? item('#/admin/trash', t('admin.trash'), '🗑') : null,
      state.user.is_owner ? item('#/usage', t('usage.title'), '◔') : null,
      item('#/help', t('help.title'), '?')),
    h('div', { class: 'row-between' }, h('span', null, t('more.language')), langToggle(rerender)),
    h('h2', null, t('prefs.title')),
    h('div', { class: 'prefs' },
      toggle('vibrate', t('prefs.vibrate'), t('prefs.vibrate_h')), toggle('awake', t('prefs.awake'), t('prefs.awake_h')),
      toggle('big', t('prefs.big'), t('prefs.big_h')), toggle('lefty', t('prefs.lefty'), t('prefs.lefty_h')),
      h('div', { class: 'pref-row col' }, h('b', null, t('prefs.theme')),
        segmented([{ value: 'auto', label: t('prefs.theme_auto') }, { value: 'light', label: t('prefs.theme_light') }, { value: 'dark', label: t('prefs.theme_dark') }], pref('theme'), (v) => setPref('theme', v), t('prefs.theme')))),
    state.user.role === 'admin' ? [h('h2', null, t('backup.title')), h('p', { class: 'muted small' }, t('backup.hint')), backupMsg, backupBtn] : null,
    h('button', { class: 'btn', type: 'button', onclick: logout }, t('more.logout'))));
}

// Mini tutorial de 3 pantallas
export function tutorial(onDone) {
  const slides = [
    { icon: '＋', title: t('tut.1.t'), text: t('tut.1.x') },
    { icon: '👆', title: t('tut.2.t'), text: t('tut.2.x') },
    { icon: '↶', title: t('tut.3.t'), text: t('tut.3.x') },
  ];
  let i = 0;
  const box = h('div', { class: 'tutorial' });
  const s = sheet({ title: t('help.title'), body: box, onClose: () => { try { localStorage.setItem('urd.tutorial.v1', '1'); } catch { /* nada */ } onDone?.(); } });
  const draw = () => {
    const sl = slides[i];
    box.replaceChildren(
      h('div', { class: 'tut-icon', 'aria-hidden': 'true' }, sl.icon), h('h2', null, sl.title), h('p', null, sl.text),
      h('div', { class: 'dots' }, slides.map((_, k) => h('span', { class: k === i ? 'on' : '' }))),
      h('div', { class: 'btn-row' },
        i > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => { i--; draw(); } }, t('back')) : h('button', { class: 'btn', type: 'button', onclick: () => s.close() }, t('tut.skip')),
        i < slides.length - 1 ? h('button', { class: 'btn primary', type: 'button', onclick: () => { i++; draw(); } }, t('tut.next')) : h('button', { class: 'btn primary', type: 'button', onclick: () => s.close() }, t('tut.done'))));
  };
  draw();
}

export function helpView(root) {
  root.append(h('div', { class: 'page' },
    h('h1', null, t('help.title')),
    h('p', null, t('help.intro')),
    h('button', { class: 'btn big', type: 'button', onclick: () => tutorial() }, t('help.tutorial')),
    h('a', { class: 'btn big primary', href: '#/new?practice=1' }, t('help.practice')),
    h('p', { class: 'muted small' }, t('help.practice_hint')),
    h('h2', null, t('help.faq')),
    h('details', null, h('summary', null, t('faq.1.q')), h('p', null, t('faq.1.a'))),
    h('details', null, h('summary', null, t('faq.2.q')), h('p', null, t('faq.2.a'))),
    h('details', null, h('summary', null, t('faq.3.q')), h('p', null, t('faq.3.a'))),
    h('details', null, h('summary', null, t('faq.4.q')), h('p', null, t('faq.4.a')))));
}
