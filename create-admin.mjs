// Uso: node scripts/create-admin.mjs <usuario> <contraseña>
// Imprime el SQL para crear el primer administrador. Ver README.
import { hashPassword, uuid, nowIso } from '../server/core.js';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 6) {
  console.error('Uso: node scripts/create-admin.mjs <usuario> <contraseña de al menos 6 caracteres>');
  process.exit(1);
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const hash = await hashPassword(password);
console.log(
  `INSERT INTO users (id, username, name, pass_hash, role, all_teams, is_owner, active, created_at) VALUES (${q(uuid())}, ${q(username)}, ${q(username)}, ${q(hash)}, 'admin', 1, 1, 1, ${q(nowIso())});`
);
