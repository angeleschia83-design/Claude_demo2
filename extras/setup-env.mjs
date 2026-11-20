/* Writes the app's .env on a first run: asks for an admin password, generates
   the session secret, leaves everything else as .env.example had it.
   Called by RUN-ON-WINDOWS.bat, but it works from any shell:

     node extras/setup-env.mjs <path-to-app>

   It will not overwrite an .env that already exists. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';

const appDir = path.resolve(process.argv[2] ?? '.');
const envPath = path.join(appDir, '.env');
const examplePath = path.join(appDir, '.env.example');

if (fs.existsSync(envPath)) {
  console.log('  Settings already exist, so nothing was changed.');
  console.log(`  They are in ${envPath}`);
  process.exit(0);
}
if (!fs.existsSync(examplePath)) {
  console.error(`  Could not find ${examplePath}. Is this the right folder?`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('');
console.log('  This is the password you will sign in with. Anything long and');
console.log('  hard to guess. Everyone who has it is "the admin".');
console.log('');

let password = '';
for (let tries = 0; tries < 3 && !password; tries += 1) {
  const answer = (await rl.question('  Choose an admin password: ')).trim();
  if (answer.length < 8) {
    console.log('  Too short -- use at least 8 characters.');
  } else if (answer === 'change-me') {
    console.log('  The app refuses that one on purpose. Pick another.');
  } else {
    password = answer;
  }
}
rl.close();

if (!password) {
  console.error('\n  No password set, so nothing was written. Run this again.');
  process.exit(1);
}

const secret = crypto.randomBytes(32).toString('hex');
const written = fs.readFileSync(examplePath, 'utf8')
  .split(/\r?\n/)
  .map((line) => {
    if (line.startsWith('ADMIN_PASSWORD=')) return `ADMIN_PASSWORD=${password}`;
    if (line.startsWith('SESSION_SECRET=')) return `SESSION_SECRET=${secret}`;
    return line;
  })
  .join('\r\n');

fs.writeFileSync(envPath, written, { encoding: 'utf8' });

console.log('');
console.log(`  Written to ${envPath}`);
console.log('  The session secret was generated for you.');
console.log('');
console.log('  Keep that file private -- it holds the password and the key that');
console.log('  signs everyone\'s sign-in. It is already excluded from git and');
console.log('  from the Docker image.');
