// Enrutado, estructura general y arranque.
import { h, clear, toast } from './dom.js';
import { t, getLang, onLangChange } from './i18n.js';
import { state, api, loadBootstrap, subscribe, onUnauthorized, onSyncError, forgetLocal, flush } from './store.js';
import { errMsg } from './ui.js';
import { matchView } from './views/match.js';
import { summaryView } from './views/summary.js';
import { homeView, newMatchView } from './views/home.js';
import { playersView } from './views/players.js';
import { playerView } from './views/player.js';
import { importView } from './views/import.js';
import { reportsView } from './views/reports.js';
import { adminView } from './views/admin.js';
import { usageView } from './views/usage.js';
import { loginView, moreView, helpView, tutorial, langToggle } from './views/misc.js';

const app = document.getElementById('app');
let shell = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: Object.fromEntries(new URLSearchParams(query)) };
}

const IMMERSIVE = new Set(['match', 'new']); // sin menús durante la anotación

function buildShell() {
  const status = h('div', { id: 'status', class: 'status', role: 'status', hidden: true });
  const main = h('main', { id: 'main' });
  const nav = h('nav', { class: 'tabbar', 'aria-label': 'Menu' },
    [['#/', t('nav.matches'), '▦', ''], ['#/players', t('nav.players'), '☺', 'players'], ['#/reports', t('nav.reports'), '▤', 'reports'], ['#/more', t('nav.more'), '☰', 'more']]
      .map(([href, label, icon, key]) => h('a', { href, 'data-key': key }, h('span', { class: 'ti', 'aria-hidden': 'true' }, icon), h('span', null, label))));
  const header = h('header', { class: 'topbar' },
    h('a', { href: '#/', class: 'brand' }, h('img', { src: '/icons/logo.png', alt: '', width: 28, height: 36 }), h('span', null, 'Urdaibai E.T.')),
    langToggle(() => route()));
  clear(app).append(status, header, main, nav);
  shell = { status, main, nav, header };
}

function updateStatus() {
  if (!shell) return;
  const s = shell.status;
  if (!state.online) { s.hidden = false; s.className = 'status off'; s.textContent = `${t('status.offline')}${state.pending ? ` · ${t('status.pending', { n: state.pending })}` : ''}`; }
  else if (state.pending) { s.hidden = false; s.className = 'status sync'; s.textContent = t('status.pending', { n: state.pending }); }
  else s.hidden = true;
}

let cleanup = null;
export async function route() {
  if (!state.user) return showLogin();
  if (!shell) buildShell();
  const { parts, params } = parseHash();
  const [name, a] = parts;
  const key = name || 'home';
  shell.main.replaceChildren();
  document.body.dataset.route = IMMERSIVE.has(key) ? 'immersive' : key;
  shell.nav.querySelectorAll('a').forEach((el) => el.classList.toggle('on', el.dataset.key === (['import', 'admin', 'help', 'usage'].includes(key) ? 'more' : key === 'player' ? 'players' : key === 'home' || key === 'summary' ? '' : key)));
  shell.nav.querySelector('a[data-key=""]')?.classList.toggle('on', key === 'home' || key === 'summary');
  window.scrollTo(0, 0);
  try {
    switch (key) {
      case 'home': homeView(shell.main); break;
      case 'new': newMatchView(shell.main, { practice: params.practice === '1' }); break;
      case 'match': await matchView(shell.main, { id: a }); break;
      case 'summary': await summaryView(shell.main, { id: a }); break;
      case 'players': playersView(shell.main, params); break;
      case 'player': await playerView(shell.main, { id: a }); break;
      case 'import': importView(shell.main, params); break;
      case 'reports': reportsView(shell.main); break;
      case 'admin': adminView(shell.main, { section: a }); break;
      case 'usage': await usageView(shell.main); break;
      case 'more': moreView(shell.main, { logout, rerender: () => route() }); break;
      case 'help': helpView(shell.main); break;
      default: location.hash = '#/';
    }
  } catch (e) { console.error(e); shell.main.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'warn' }, errMsg(e)))); }
}

function showLogin() {
  shell = null;
  document.body.dataset.route = 'login';
  clear(app);
  loginView(app, { rerender: showLogin, onLogin: start });
}

async function logout() {
  try { await flush(); } catch { /* sin red */ }
  try { await api('POST', '/api/logout'); } catch { /* sin red */ }
  forgetLocal();
  state.user = null;
  showLogin();
}

async function start() {
  try {
    await loadBootstrap();
  } catch (e) {
    if (e.status === 401 || !state.user) return showLogin();
    if (e.network) { clear(app).append(h('div', { class: 'page' }, h('p', { class: 'warn' }, t('err.network')))); return; }
    throw e;
  }
  buildShell();
  updateStatus();
  await route();
  try { if (!localStorage.getItem('urd.tutorial.v1')) tutorial(); } catch { /* sin almacenamiento */ }
}

onUnauthorized(() => { if (state.ready) showLogin(); });
onSyncError((failed) => { toast(`${t('err.sync')}: ${errMsg({ code: failed[0].error })}`, 'error'); route(); });
subscribe(updateStatus);
window.addEventListener('hashchange', () => { if (state.user) route(); });
onLangChange(() => { document.documentElement.lang = getLang(); if (state.user) { buildShell(); updateStatus(); route(); } });
document.documentElement.lang = getLang();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

start();
