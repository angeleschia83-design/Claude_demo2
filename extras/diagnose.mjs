/* Prints what is actually in the register and where, so a "nothing loaded"
   can be told apart from a "loaded somewhere else".

     node extras/diagnose.mjs <path-to-app>

   Reads only. It changes nothing. */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const appDir = path.resolve(process.argv[2] ?? '.');
const line = (k, v) => console.log(`  ${String(k).padEnd(22)} ${v}`);

console.log('\n  Device register — what is where');
console.log('  ================================\n');
line('Node.js', process.versions.node);
line('App folder', appDir);
line('src/server.mjs', fs.existsSync(path.join(appDir, 'src/server.mjs')) ? 'found' : 'MISSING -- wrong folder?');
line('node_modules', fs.existsSync(path.join(appDir, 'node_modules')) ? 'installed' : 'not installed yet');

/* Resolve the database exactly the way the app does: .env, else the default,
   and a relative path counts from the app folder because that is where the
   app is started. */
const envPath = path.join(appDir, '.env');
let configured = '';
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '');
  for (const l of raw.split(/\r?\n/)) {
    const m = /^\s*DATABASE_PATH\s*=\s*(.*)\s*$/.exec(l);
    if (m) configured = m[1].trim().replace(/^["']|["']$/g, '');
  }
  line('.env', 'found');
} else {
  line('.env', 'NOT found -- the app has not been set up yet');
}
line('DATABASE_PATH', configured || '(not set, so ./register.db)');

const dbPath = path.resolve(appDir, configured || 'register.db');
line('Database file', dbPath);
if (!fs.existsSync(dbPath)) {
  line('', 'DOES NOT EXIST -- nothing has been loaded into it');
} else {
  line('Size', `${(fs.statSync(dbPath).size / 1024).toFixed(0)} KB`);
}

/* More than one register.db is the usual reason for "I loaded it but the app
   is empty": the loader wrote one, the app opened another. */
console.log('');
const roots = [appDir, path.dirname(appDir), process.cwd()];
const seen = new Set();
const found = [];
for (const root of roots) {
  if (seen.has(root) || !fs.existsSync(root)) continue;
  seen.add(root);
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith('.db')) continue;
    const full = path.join(root, name);
    if (!found.some((f) => f.full === full)) {
      found.push({ full, size: fs.statSync(full).size });
    }
  }
}
if (found.length > 1) {
  console.log('  More than one database file found. The app only reads the one above:');
  for (const f of found) {
    console.log(`    ${f.full}  (${(f.size / 1024).toFixed(0)} KB)${f.full === dbPath ? '   <- the one in use' : ''}`);
  }
} else {
  line('Other .db files', 'none -- good');
}

if (!fs.existsSync(dbPath)) {
  console.log('\n  Nothing more to report: there is no database yet.\n');
  process.exit(0);
}

console.log('');
let db;
try {
  db = new DatabaseSync(dbPath);
} catch (error) {
  console.log(`  Could not open it: ${error.message}`);
  console.log('  If the app is running, close that window and try again.\n');
  process.exit(1);
}

const count = (sql) => {
  try { return db.prepare(sql).get().n; } catch (error) { return `(${error.message})`; }
};
line('People', count('SELECT COUNT(*) AS n FROM holders'));
line('  still listed', count('SELECT COUNT(*) AS n FROM holders WHERE merged_into IS NULL'));
line('Assets', count('SELECT COUNT(*) AS n FROM devices'));
line('  on the register', count('SELECT COUNT(*) AS n FROM devices WHERE removed_at IS NULL'));
line('  held by somebody', count("SELECT COUNT(*) AS n FROM devices WHERE removed_at IS NULL AND COALESCE(json_extract(overrides,'$.holder_id'), holder_id, '') <> ''"));
line('Change log entries', count('SELECT COUNT(*) AS n FROM audit'));

try {
  const lists = db.prepare('SELECT kind, COUNT(*) AS n FROM lists GROUP BY kind').all();
  line('Pick-lists', lists.length ? lists.map((r) => `${r.kind}=${r.n}`).join('  ') : 'EMPTY -- the asset page needs these');
} catch (error) {
  line('Pick-lists', `(${error.message})`);
}

try {
  const sample = db.prepare('SELECT serial, asset_type, model, status, holder FROM devices LIMIT 3').all();
  if (sample.length) {
    console.log('\n  First few assets:');
    for (const r of sample) {
      console.log(`    ${r.serial}  ${r.asset_type || '?'}  ${r.model || '?'}  ${r.status || '?'}  ${r.holder || '(nobody)'}`);
    }
  } else {
    console.log('\n  There are no assets in this database.');
  }
} catch (error) {
  console.log(`\n  Could not read the assets: ${error.message}`);
}

db.close();
console.log('');
