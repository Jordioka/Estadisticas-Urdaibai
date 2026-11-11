import { createD1 } from '../scripts/d1-shim.mjs';
import { handle } from '../server/api.js';
import { hashPassword, uuid, nowIso } from '../server/core.js';

export async function makeApp() {
  const d1 = createD1();
  const env = { DB: d1 };
  const ids = { n: 0 };
  const newId = (p = 'id') => `${p}-${String(++ids.n).padStart(6, '0')}-${uuid().slice(0, 8)}`;

  async function seedUser(username, password, { role = 'scorer', all_teams = 0, is_owner = 0 } = {}) {
    const id = uuid();
    d1.raw.prepare("INSERT INTO users (id, username, name, pass_hash, role, all_teams, is_owner, active, created_at) VALUES (?,?,?,?,?,?,?,1,?)")
      .run(id, username, username, await hashPassword(password), role, all_teams, is_owner, nowIso());
    return id;
  }

  function client() {
    let cookie = '';
    const call = async (method, path, body, headers = {}) => {
      const req = new Request('http://localhost' + path, {
        method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const res = await handle(req, env);
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.startsWith('session=;') ? '' : sc.split(';')[0];
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    };
    call.login = async (u, p) => call('POST', '/api/login', { username: u, password: p });
    call.sync = async (...ops) => (await call('POST', '/api/sync', { ops })).data;
    return call;
  }
  return { d1, env, client, seedUser, newId };
}

// Escenario base: admin + equipos A y B + usuarios con distintos permisos
export async function scenario() {
  const app = await makeApp();
  await app.seedUser('admin', 'admin123', { role: 'admin', all_teams: 1 });
  const admin = app.client();
  await admin.login('admin', 'admin123');
  const A = (await admin('POST', '/api/teams', { name: 'Juvenil Masculino' })).data.team;
  const B = (await admin('POST', '/api/teams', { name: 'Cadete Femenino' })).data.team;
  const mk = async (username, opts) => {
    const r = await admin('POST', '/api/users', { username, password: 'secret1', name: username, ...opts });
    const c = app.client(); await c.login(username, 'secret1'); return { c, id: r.data.user.id };
  };
  const onlyA = await mk('delegadoA', { team_ids: [A.id] });
  const both = await mk('entrenador', { team_ids: [A.id, B.id] });
  const all = await mk('todos', { all_teams: true });
  return { ...app, admin, A, B, onlyA: onlyA.c, both: both.c, all: all.c };
}
