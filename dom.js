// Utilidades mínimas de interfaz (sin librerías)
const SVGNS = 'http://www.w3.org/2000/svg';

// Los métodos nativos convierten arrays y null en texto ("null", "[object HTMLDivElement]").
// Se aplanan aquí una sola vez para que todas las vistas puedan pasar listas y condicionales.
const flatten = (items) => items.flat(Infinity).filter((c) => c != null && c !== false);
for (const name of ['replaceChildren', 'append', 'prepend']) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...items) { return orig.apply(this, flatten(items)); };
}

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'multiple']);

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function svg(tag, props, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export const uid = (p = 'x') => `${p}-${crypto.randomUUID()}`;

export const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
export const fmtPct = (v) => `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`;
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- Avisos breves ----------
let toastTimer;
export function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.className = `toast ${kind} show`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 4500 : 1600);
}

export const vibrate = (ms = 25) => { try { navigator.vibrate?.(ms); } catch { /* sin vibración */ } };

// ---------- Hoja inferior (diálogos) ----------
export function sheet({ title, body, onClose, full = false }) {
  const prevFocus = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    back.remove();
    document.body.classList.remove('has-sheet');
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const bodyEl = h('div', { class: 'sheet-body' }, body);
  const box = h('div', { class: `sheet${full ? ' full' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '✕', onclick: close }, '✕')),
    bodyEl);
  const back = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  document.body.classList.add('has-sheet');
  document.addEventListener('keydown', onKey);
  box.querySelector('button,input,select')?.focus?.();
  return { el: box, body: bodyEl, close };
}

export function confirmDialog(message, { yes, no, danger = false, detail } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; s.close(); resolve(v); } };
    const s = sheet({
      title: message,
      onClose: () => { if (!done) { done = true; resolve(false); } },
      body: [
        detail ? h('p', { class: 'muted' }, detail) : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, no),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => finish(true) }, yes)),
      ],
    });
  });
}

// Texto de elección única: devuelve la opción elegida o null
export function choiceDialog(title, options, { detail } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; s.close(); resolve(v); } };
    const s = sheet({
      title,
      onClose: () => { if (!done) { done = true; resolve(null); } },
      body: [detail ? h('p', { class: 'muted' }, detail) : null,
        h('div', { class: 'stack' }, options.map((o) => h('button', { class: `btn ${o.primary ? 'primary' : ''}`, type: 'button', onclick: () => finish(o.value) }, o.label)))],
    });
  });
}
