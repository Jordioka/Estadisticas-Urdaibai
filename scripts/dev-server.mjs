// Servidor local para probar la web en el ordenador:  node scripts/dev-server.mjs
// Usa una base SQLite local en .dev/dev.db. Primer administrador: DEV_ADMIN=usuario:contraseña
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1 } from './d1-shim.mjs';
import { handle } from '../server/api.js';
import { hashPassword, uuid, nowIso } from '../server/core.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const port = Number(process.env.PORT || 8788);
await mkdir(join(root, '.dev'), { recursive: true });
const d1 = createD1(process.env.DB_PATH || join(root, '.dev', 'dev.db'));
const env = { DB: d1 };

const admin = (process.env.DEV_ADMIN ?? 'admin:admin123');
if (admin) {
  const [u, p] = admin.split(':');
  if (!d1.raw.prepare('SELECT 1 FROM users WHERE username = ?').get(u))
    d1.raw.prepare("INSERT INTO users (id, username, name, pass_hash, role, all_teams, is_owner, active, created_at) VALUES (?,?,?,?,'admin',1,1,1,?)")
      .run(uuid(), u, u, await hashPassword(p), nowIso());
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
      const headers = {};
      r.headers.forEach((v, k) => (headers[k] = v));
      res.writeHead(r.status, headers);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p === '/' || p === '\\') p = '/index.html';
    const file = join(root, 'public', p);
    if (!file.startsWith(join(root, 'public'))) { res.writeHead(403); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('Not found'); }
    console.error(e); res.writeHead(500); res.end('Error');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
