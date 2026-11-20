/* Takes a dated copy of the register's database before anything is loaded.
     node extras/backup-database.mjs <path-to-app>

   It finds the database the way the app does: DATABASE_PATH from the
   environment, then from .env, then register.db in the app folder. The copy is
   made with SQLite's own VACUUM INTO, so it is complete and consistent even
   while the register is running and writing. It lands beside the original as
   register-backup-YYYY-MM-DD-HHMM.db. */
import fs from 'node:fs';
import path from 'node:path';

const appDir = path.resolve(process.argv[2] ?? '.');

const fromEnvFile = () => {
  const envPath = path.join(appDir, '.env');
  if (!fs.existsSync(envPath)) return '';
  for (const line of fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*DATABASE_PATH\s*=\s*(.*)\s*$/.exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
};

const configured = process.env.DATABASE_PATH || fromEnvFile() || 'register.db';
const dbPath = path.resolve(appDir, configured);

if (!fs.existsSync(dbPath)) {
  console.log(`  No register yet at ${dbPath}, so there is nothing to back up.`);
  process.exit(0);
}

/* The server's own clock, so the name matches the time somebody remembers. */
const now = new Date();
const two = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
const target = path.join(path.dirname(dbPath), `register-backup-${stamp}.db`);
if (fs.existsSync(target)) {
  console.error(`  A backup called ${path.basename(target)} already exists. Wait a minute and try again.`);
  process.exit(1);
}

const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
console.log(`  Backed up to ${target}`);
