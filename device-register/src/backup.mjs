/* Backups of the register, made from the page.
 *
 * register.db is the only copy of every correction, hand-out and resign, so
 * an admin can take a copy whenever they like, before a big change or at the
 * end of the day. The copy is made with SQLite's own VACUUM INTO, which is
 * complete and consistent while the register keeps running, and lands in a
 * backups folder beside the database:
 *   backups/register-backup-YYYY-MM-DD-HHMMSS.db   (the server's own clock)
 *
 * The workbook import (IMPORT-WORKBOOK.bat, extras/backup-database.mjs)
 * leaves register-backup-YYYY-MM-DD-HHMM.db beside the database itself.
 * Those are listed too, and count towards "last backup".
 *
 * Restoring is deliberately not a button: it replaces every record, so it is
 * done by hand with the register stopped. README, "Backups", says how.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, dbFile, recordChange } from './db.mjs';

const home = () => path.dirname(dbFile);
const folder = () => path.join(home(), 'backups');
const NAME = /^register-backup-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?(-\d+)?(-auto)?\.db$/;
const WEEK = 7 * 24 * 60 * 60 * 1000;

const filesIn = (dir, source) => {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((name) => NAME.test(name)).map((name) => {
    const stat = fs.statSync(path.join(dir, name));
    return { file: name, at: stat.mtime.toISOString(), size: stat.size,
      source: name.endsWith('-auto.db') ? 'auto' : source };
  });
};

/** Every backup, newest first, and the newest of them. */
export function listBackups() {
  const files = [...filesIn(folder(), 'page'), ...filesIn(home(), 'import')]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.file < b.file ? 1 : -1));
  return { last: files[0] || null, files, folder: folder() };
}

export const lastBackupAt = () => (listBackups().last || {}).at || null;

/** Takes a copy now. Two in the same second get -2, -3 rather than one
    writing over the other. */
export function makeBackup(actor, tail = '') {
  fs.mkdirSync(folder(), { recursive: true });
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
    + `-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  let file = `register-backup-${stamp}${tail}.db`;
  for (let n = 2; fs.existsSync(path.join(folder(), file)); n += 1) file = `register-backup-${stamp}-${n}${tail}.db`;
  const target = path.join(folder(), file);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  recordChange({ at: now.toISOString(), actor, field: 'backed up', was: '', now: file });
  const listed = listBackups();
  return { made: listed.files.find((f) => f.file === file && f.source !== 'import'), ...listed };
}

/** The weekly backup: made when somebody opens the register and the newest
    backup of any kind is a week old. Nothing changes while nobody opens it,
    so no timer is needed, and a backup by hand resets the week. */
export function backupIfDue() {
  const last = lastBackupAt();
  if (last && Date.now() - Date.parse(last) < WEEK) return;
  makeBackup('Automatic weekly backup', '-auto');
}

/** The path of a backup to download, or null for anything that is not one.
    Only a bare name matching a backup's, in one of the two folders. */
export function backupPath(name) {
  if (!NAME.test(String(name))) return null;
  for (const dir of [folder(), home()]) {
    const full = path.join(dir, name);
    if (path.dirname(full) === dir && fs.existsSync(full)) return full;
  }
  return null;
}
