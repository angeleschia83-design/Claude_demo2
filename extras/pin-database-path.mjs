/* Pins DATABASE_PATH to an absolute path in .env.
     node extras/pin-database-path.mjs <path-to-app>

   The app writes register.db relative to whatever directory it was started
   from. Started by hand that is the app folder and all is well; started by a
   service it is somewhere else entirely, and you get a second, empty register
   while the real one sits untouched. Pinning it removes the question. */
import fs from 'node:fs';
import path from 'node:path';

const appDir = path.resolve(process.argv[2] ?? '.');
const envPath = path.join(appDir, '.env');
if (!fs.existsSync(envPath)) {
  console.error(`  No .env in ${appDir} yet -- start the register once first.`);
  process.exit(1);
}

/* Forward slashes: they resolve correctly on Windows and cannot be mistaken
   for an escape sequence by anything reading the file later. */
const wanted = path.join(appDir, 'register.db').replace(/\\/g, '/');

const raw = fs.readFileSync(envPath, 'utf8');
const bom = raw.startsWith('﻿') ? '﻿' : '';
const body = bom ? raw.slice(1) : raw;
const eol = body.includes('\r\n') ? '\r\n' : '\n';

let already = null;
let replaced = false;
const lines = body.split(/\r?\n/).map((line) => {
  const match = /^\s*#?\s*DATABASE_PATH\s*=\s*(.*)\s*$/.exec(line);
  if (!match) return line;
  if (!/^\s*#/.test(line)) already = match[1].trim();
  replaced = true;
  return `DATABASE_PATH=${wanted}`;
});
if (!replaced) lines.push(`DATABASE_PATH=${wanted}`);

if (already === wanted) {
  console.log(`  Database path already pinned to ${wanted}`);
  process.exit(0);
}

/* If a database already exists where the app has been looking, say so --
   pinning somewhere else would look like the data vanished. */
const existing = path.resolve(appDir, already || 'register.db');
const target = path.resolve(wanted);
if (already && existing !== target && fs.existsSync(existing)) {
  console.error(`  The register in use is ${existing}`);
  console.error(`  but this would pin the app to ${target}`);
  console.error('  Move or copy the file first, so the data is not left behind.');
  process.exit(1);
}

fs.writeFileSync(envPath, bom + lines.join(eol));
console.log(`  Database pinned to ${wanted}`);
