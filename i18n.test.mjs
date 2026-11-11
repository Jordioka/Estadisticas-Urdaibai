import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { D } from '../public/js/strings.js';
import { COUNTERS, EVENT_TYPES, ZONES, SHOT_KINDS, TRAJECTORIES, PRESSURES, PHASES } from '../public/js/stats.js';

const root = new URL('../public/js/', import.meta.url).pathname;
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : f.name.endsWith('.js') && files.push(path.join(d, f.name)); })(root);
const src = files.filter((f) => !f.endsWith('strings.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

test('no hay claves duplicadas en strings.js', () => {
  const text = fs.readFileSync(root + 'strings.js', 'utf8');
  const keys = [...text.matchAll(/^\s*'([^']+)':\s*\[|[ ,{]'([^']+)':\s*\[/gm)].map((m) => m[1] || m[2]);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual([...new Set(dup)], []);
});

test('todas las entradas tienen castellano y euskera con los mismos {marcadores}', () => {
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [k, v] of Object.entries(D)) {
    assert.ok(Array.isArray(v) && v.length === 2 && v[0] && v[1], `faltan textos en ${k}`);
    assert.equal(ph(v[0]), ph(v[1]), `marcadores distintos en ${k}`);
  }
});

test('todas las claves literales usadas en la interfaz existen', () => {
  const used = new Set([...src.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]));
  const missing = [...used].filter((k) => !(k in D));
  assert.deepEqual(missing, []);
});

test('familias de claves dinámicas completas', () => {
  const need = [];
  for (const e of EVENT_TYPES) need.push(`ev.${e}`);
  for (const c of COUNTERS) need.push(`stat.${c}`);
  for (const z of ZONES) need.push(`zone.${z}`);
  for (const k of SHOT_KINDS) need.push(`kind.${k}`);
  for (const k of TRAJECTORIES) need.push(`traj.${k}`);
  for (const k of PRESSURES) need.push(`press.${k}`);
  for (const k of PHASES) need.push(`phase.${k}`);
  for (const p of ['off_eff', 'loss_pct', 'shot_eff', 'save_pct']) need.push(`pct.${p}`, `pct.${p}.short`);
  for (const l of ['great', 'good', 'mid', 'bad']) need.push(`lv.${l}`);
  for (const r of ['out', 'post', 'block', 'save']) need.push(`result.${r}`);
  for (const w of ['negative', 'goals_gt_shots', 'against_gt_shots']) need.push(`warn.${w}`);
  for (const k of ['players', 'simple', 'advanced']) need.push(`imp.kind.${k}`, `imp.help.${k}`);
  for (const k of ['matches', 'season', 'match']) need.push(`rep.tab.${k}`);
  for (const k of ['update', 'skip']) need.push(`imp.dup.${k}`);
  for (const k of ['replace', 'add', 'skip']) need.push(`imp.dup.${k}`);
  assert.deepEqual(need.filter((k) => !(k in D)), []);
});

test('cada código de error del servidor tiene mensaje en la interfaz', () => {
  const server = ['core.js', 'ops.js', 'api.js', 'imports.js', 'reports.js'].map((f) => fs.readFileSync(new URL('../server/' + f, import.meta.url), 'utf8')).join('\n');
  const codes = new Set([...server.matchAll(/HttpError\(\s*\d+\s*,\s*'([a-z_]+)'/g)].map((m) => m[1]));
  const missing = [...codes].filter((c) => !(`err.${c}` in D));
  assert.deepEqual(missing, []);
  const imp = new Set([...fs.readFileSync(new URL('../server/imports.js', import.meta.url), 'utf8').matchAll(/error:\s*'([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...imp].filter((c) => !(`imp.err.${c}` in D)), []);
});
