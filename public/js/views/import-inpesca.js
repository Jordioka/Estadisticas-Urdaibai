// Importar hojas del Excel de INPESCA (una hoja = un partido) con comprobaciones y avisos de duplicados.
// Nada se guarda hasta pulsar «Importar». Los partidos que ya existen NO se tocan salvo que se elija «Reemplazar»
// (y el anterior va a la papelera, recuperable).
import { h, toast, fmtDate, today, confirmDialog } from '../dom.js';
import { t } from '../i18n.js';
import { state, api, loadBootstrap, playersOf } from '../store.js';
import { field, errMsg } from '../ui.js';
import { loadXLSX } from '../files.js';
import { normName } from '../names.js';
import { parseInpescaWorkbook, inpescaRows, inpescaPlayerRows } from '../inpesca.js';
import { currentTeamId } from './home.js';

export function inpescaPanel() {
  const S = { teamId: currentTeamId() || state.teams[0]?.id || '', fileName: '', sheets: null, busy: false, error: '', done: null };
  const box = h('div', { class: 'inpesca' });
  const team = () => state.teams.find((x) => x.id === S.teamId);

  // ---- jugadores: ¿qué falta o no coincide en la web? ----
  function peoplePlan() {
    const have = playersOf(S.teamId);
    const people = new Map();
    for (const s of S.sheets) if (s.include) for (const p of s.m.people) people.set(p.num, p.gk || people.get(p.num)?.gk ? { ...p, gk: true } : p);
    const create = [], makeGk = [], clash = [];
    for (const p of [...people.values()].sort((a, b) => a.num - b.num)) {
      const cur = have.find((x) => x.number === p.num);
      if (!cur) { create.push(p); continue; }
      if (p.gk && !cur.is_goalkeeper) makeGk.push({ p, cur });
      const a = normName(`${cur.name} ${cur.surname || ''}`), b = normName(`${p.name} ${p.surname}`);
      if (a !== b && !a.includes(normName(p.name)) && !b.includes(normName(cur.name))) clash.push({ p, cur });
    }
    return { create, makeGk, clash };
  }

  // ---- avisos propios de cada hoja ----
  function localIssues(s, i) {
    const out = { block: [], warn: [] };
    if (!s.date || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || isNaN(Date.parse(s.date))) out.block.push(t('inp.no_date'));
    else {
      if (s.date > today()) out.warn.push(t('inp.future'));
      const diff = Math.abs(Date.parse(s.date) - Date.parse(today())) / 86400000;
      if (diff > 400) out.warn.push(t('inp.far'));
    }
    const same = S.sheets.findIndex((o, j) => j !== i && o.include && s.include && o.date === s.date && normName(o.m.rival) === normName(s.m.rival));
    if (same >= 0) out.block.push(t('inp.dup_in_file', { sheet: S.sheets[same].m.sheet }));
    if (!s.m.events) out.block.push(t('inp.no_events'));
    return out;
  }

  async function check(s) {
    s.rep = null; s.err = '';
    if (!s.include || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return;
    try {
      // Si faltan jugadores, el servidor avisa «jugador no encontrado»: no bloquea, porque se crean antes de importar
      s.rep = await api('POST', '/api/import/matches', { kind: 'advanced', rows: inpescaRows(s.m, team().name, s.date), dry_run: true });
      const m = s.rep.matches[0];
      if (m && (m.duplicate || m.similar?.length) && s.action === 'import') s.action = 'skip'; // por seguridad: no tocar lo existente
      if (m && !m.duplicate && !m.similar?.length && s.action !== 'import') s.action = 'import';
    } catch (e) { s.err = errMsg(e); }
  }
  const checkAll = async () => { S.busy = true; render(); for (const s of S.sheets) await check(s); S.busy = false; render(); };

  async function onFile(file) {
    if (!file) return;
    S.fileName = file.name; S.sheets = null; S.done = null; S.error = '';
    try {
      const X = await loadXLSX();
      const wb = X.read(await file.arrayBuffer(), { type: 'array' });
      const ms = parseInpescaWorkbook(wb, X.SSF);
      if (!ms.length) { S.error = t('inp.none'); render(); return; }
      S.sheets = ms.map((m) => ({ m, include: true, date: m.date || '', action: 'import', rep: null, err: '' }));
    } catch { S.error = t('imp.read_error'); render(); return; }
    await checkAll();
  }

  const realErrors = (s) => (s.rep?.errors || []).filter((e) => e.error !== 'player_not_found');
  const statusOf = (s) => s.rep?.matches?.[0] || null;

  // acción efectiva (lo que se va a hacer con esta hoja)
  const effective = (s) => (s.include ? s.action : 'skip');
  function canGo() {
    if (S.busy || !S.sheets) return false;
    let any = false;
    S.sheets.forEach((s, i) => {
      if (effective(s) === 'skip') return;
      any = true;
      if (localIssues(s, i).block.length || realErrors(s).length || s.err) any = null;
    });
    return any === true;
  }

  async function go() {
    const plan = peoplePlan();
    const act = S.sheets.filter((s) => effective(s) !== 'skip');
    const nRep = act.filter((s) => s.action === 'replace').length;
    const lines = [t('inp.confirm_new', { n: act.length - nRep })];
    if (nRep) lines.push(t('inp.confirm_replace', { n: nRep }));
    if (plan.create.length) lines.push(t('inp.confirm_players', { n: plan.create.length }));
    if (!(await confirmDialog(lines.join(' '), { yes: t('imp.go'), no: t('cancel'), detail: nRep ? t('inp.replace_hint') : undefined }))) return;
    S.busy = true; S.error = ''; render();
    const results = [];
    try {
      const tn = team().name;
      if (plan.create.length) await api('POST', '/api/import/players', { rows: inpescaPlayerRows(plan.create, tn), dry_run: false, on_duplicate: 'skip' });
      if (plan.makeGk.length) {
        await api('POST', '/api/import/players', { dry_run: false, on_duplicate: 'update',
          rows: plan.makeGk.map(({ p, cur }) => ({ Equipo: tn, Nombre: cur.name, Apellidos: cur.surname || '', Dorsal: cur.number, Posición: cur.position || 'Portero', Portero: 'sí' })) });
      }
      for (const s of act) {
        const res = { s, ok: false, msg: '' };
        try {
          const r = await api('POST', '/api/import/matches', { kind: 'advanced', rows: inpescaRows(s.m, tn, s.date), dry_run: false, on_duplicate: s.action === 'replace' ? 'replace' : 'add' });
          res.ok = !!r.committed && r.created > 0;
          if (!res.ok) res.msg = r.errors?.length ? `${r.errors.length} ${t('imp.errors', { n: '' }).trim()}` : t(`inp.blocked.${r.blocked || 'x'}`);
        } catch (e) { res.msg = errMsg(e); }
        results.push(res);
      }
      await loadBootstrap();
      S.done = results; S.sheets = null; toast(t('imp.done'));
    } catch (e) { S.error = errMsg(e); }
    S.busy = false; render();
  }

  // ---- pantalla ----
  const pill = (cls, txt) => h('span', { class: `inp-pill ${cls}` }, txt);

  function sheetCard(s, i) {
    const st = statusOf(s), loc = localIssues(s, i), errs = realErrors(s);
    const dup = !!st?.duplicate, sim = st?.similar || [];
    const opts = dup ? ['skip', 'replace'] : ['import', 'skip'];
    return h('div', { class: `inp-card${s.include ? '' : ' off'}${dup || sim.length ? ' warn-card' : ''}` },
      h('label', { class: 'check inp-head' },
        h('input', { type: 'checkbox', checked: s.include, onchange: async (e) => { s.include = e.target.checked; await check(s); render(); } }),
        h('strong', null, ` ${s.m.away ? '@ ' : ''}${s.m.rival}`), h('span', { class: 'muted small' }, ` · ${t('inp.sheet')} ${s.m.sheet} · ${s.m.away ? t('away') : t('home')}${s.m.kind ? ' · ' + s.m.kind : ''}`)),
      h('div', { class: 'inp-score' }, h('b', null, s.m.gf), ' – ', h('b', null, s.m.ga), h('span', { class: 'muted small' }, ` · ${t('imp.events')}: ${s.m.events}`)),
      field(t('date'), h('input', { type: 'date', value: s.date, onchange: async (e) => { s.date = e.target.value; await check(s); render(); } })),
      !s.include ? null : [
        loc.block.map((x) => h('p', { class: 'warn', role: 'alert' }, '⛔ ', x)),
        loc.warn.map((x) => h('p', { class: 'warn-soft' }, '⚠ ', x)),
        s.err ? h('p', { class: 'warn' }, s.err) : null,
        errs.length ? h('div', { class: 'warn' }, errs.slice(0, 5).map((e) => h('div', null, `${t('imp.row')} ${e.row}: ${t(`imp.err.${e.error}`)}${e.name ? ` (${e.name})` : ''}`))) : null,
        dup ? h('div', { class: 'dup-box' },
          h('strong', null, '⚠ ', t('inp.exists')),
          h('div', null, t('inp.compare', { old: `${st.existing_score.goals}–${st.existing_score.goals_against}`, oldn: st.existing_score.events, nw: `${s.m.gf}–${s.m.ga}`, newn: s.m.events })),
          h('div', { class: 'muted small' }, t('inp.exists_hint'))) : null,
        sim.length ? h('div', { class: 'dup-box' }, h('strong', null, '⚠ ', t('inp.similar', { dates: sim.map(fmtDate).join(', ') })), h('div', { class: 'muted small' }, t('inp.similar_hint'))) : null,
        st && !dup && !sim.length && !errs.length ? pill('ok', t('inp.new')) : null,
        h('label', { class: 'field' }, h('span', { class: 'field-l' }, t('inp.action')),
          h('select', { onchange: (e) => { s.action = e.target.value; render(); } },
            opts.map((o) => h('option', { value: o, selected: o === s.action }, t(`inp.act.${o}${o === 'import' && sim.length ? '_sim' : ''}`))))),
      ]);
  }

  function render() {
    const plan = S.sheets ? peoplePlan() : null;
    const dups = S.sheets ? S.sheets.filter((s) => s.include && statusOf(s)?.duplicate).length : 0;
    box.replaceChildren(
      state.teams.length > 1 ? field(t('inp.team'), h('select', { onchange: async (e) => { S.teamId = e.target.value; if (S.sheets) await checkAll(); else render(); } },
        state.teams.map((x) => h('option', { value: x.id, selected: x.id === S.teamId }, x.name)))) : h('p', { class: 'muted' }, `${t('inp.team')}: `, h('strong', null, team()?.name || '')),
      h('label', { class: 'file-pick' }, h('span', { class: 'btn primary big' }, S.fileName ? `📄 ${S.fileName}` : t('inp.choose')),
        h('input', { type: 'file', accept: '.xlsx,.xls', class: 'sr-only', onchange: (e) => onFile(e.target.files[0]) })),
      S.busy ? h('p', { class: 'muted center' }, t('loading')) : null,
      S.error ? h('p', { class: 'warn', role: 'alert' }, S.error) : null,
      S.done ? h('div', { class: 'ok-box' }, h('strong', null, '✓ ', t('imp.done')),
        S.done.map((r) => h('div', null, `${r.ok ? '✓' : '⛔'} ${r.s.m.rival} ${fmtDate(r.s.date)} · ${r.s.m.gf}–${r.s.m.ga} · ${r.ok ? (r.s.action === 'replace' ? t('inp.replaced') : t('inp.created')) : r.msg}`)),
        h('a', { class: 'btn', href: '#/reports' }, t('inp.see_reports'))) : null,
      S.sheets ? [
        dups ? h('div', { class: 'warn dup-banner', role: 'alert' }, h('strong', null, '⚠ ', t('inp.dups_banner', { n: dups })), h('div', null, t('inp.dups_banner_hint'))) : null,
        plan.create.length ? h('p', { class: 'muted' }, '👤 ', t('inp.new_players', { n: plan.create.length, list: plan.create.map((p) => `#${p.num} ${p.name} ${p.surname}`.trim()).join(', ') })) : null,
        plan.makeGk.length ? h('p', { class: 'muted' }, '🧤 ', t('inp.make_gk', { list: plan.makeGk.map(({ p }) => `#${p.num} ${p.name}`).join(', ') })) : null,
        plan.clash.length ? h('div', { class: 'warn-soft' }, '⚠ ', t('inp.clash'), plan.clash.map(({ p, cur }) => h('div', null, `#${p.num}: ${cur.name} ${cur.surname || ''} ≠ ${p.name} ${p.surname}`))) : null,
        h('div', { class: 'cards' }, S.sheets.map(sheetCard)),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => { S.sheets = null; S.fileName = ''; render(); } }, t('cancel')),
          h('button', { class: 'btn primary', type: 'button', disabled: !canGo(), onclick: go }, t('imp.go'))),
        S.sheets.some((s, i) => effective(s) !== 'skip') ? null : h('p', { class: 'muted center' }, t('inp.nothing')),
      ] : null);
  }
  render();
  return box;
}
