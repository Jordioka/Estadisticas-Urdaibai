// Pequeño sustituto local de Cloudflare D1 sobre node:sqlite (para pruebas y desarrollo en el ordenador).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

class Stmt {
  constructor(db, sql, p = []) { this.db = db; this.sql = sql; this.p = p; }
  bind(...p) { return new Stmt(this.db, this.sql, p); }
  async first() { return this.db.prepare(this.sql).get(...this.p) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.p) }; }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.p);
    const size = this.db.prepare('SELECT page_count * page_size AS s FROM pragma_page_count, pragma_page_size').get()?.s;
    return { success: true, meta: { changes: Number(r.changes), rows_written: Number(r.changes), size_after: size } };
  }
}

export function createD1(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  const migDir = join(root, 'migrations');
  const applied = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!applied) for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(migDir, f), 'utf8'));
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
