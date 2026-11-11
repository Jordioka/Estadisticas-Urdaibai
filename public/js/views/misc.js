// Pantallas pequeñas: acceso, menú "Más" y ayuda con mini tutorial.
import { h, toast, sheet, clear } from '../dom.js';
import { t, getLang, setLang } from '../i18n.js';
import { state, api, loadBootstrap, forgetLocal } from '../store.js';
import { field, errMsg } from '../ui.js';

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

export function moreView(root, { logout, rerender }) {
  const item = (href, label, icon) => h('a', { class: 'menu-item', href }, h('span', null, icon, ' ', label), h('span', { class: 'chev' }, '›'));
  root.append(h('div', { class: 'page' },
    h('h1', null, t('more.title')),
    h('p', { class: 'muted' }, `${state.user.name || state.user.username}${state.user.role === 'admin' ? ' · Admin' : ''}`),
    h('div', { class: 'menu' },
      item('#/import', t('imp.title'), '⬆'),
      state.user.role === 'admin' ? item('#/admin', t('admin.title'), '⚙') : null,
      item('#/help', t('help.title'), '?')),
    h('div', { class: 'row-between' }, h('span', null, t('more.language')), langToggle(rerender)),
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
