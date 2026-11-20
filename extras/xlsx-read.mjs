/* A small .xlsx reader: enough to get a sheet out as rows of strings.
 *
 * No dependency, on purpose -- the register itself has none beyond express,
 * and the point of these extras is that they run wherever the app runs. It
 * reads stored and deflated entries, which is all a spreadsheet uses. It does
 * NOT handle ZIP64 (files over 4GB or 65535 entries), encryption, or dates:
 * a date cell comes back as the underlying serial number, not a date.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* --- the zip container --- */

function entries(buf) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a .xlsx file (no zip end-of-directory record).');

  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localAt + 26);
    const localExtraLen = buf.readUInt16LE(localAt + 28);
    const from = localAt + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(from, from + size);
    out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));

    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* --- the spreadsheet --- */

const unesc = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&');

const colOf = (ref) => {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Every sheet in the workbook, by the name shown on its tab. */
export function readXlsx(path) {
  const files = entries(fs.readFileSync(path));
  const text = (name) => (files.has(name) ? files.get(name).toString('utf8') : '');

  const strings = [];
  for (const si of text('xl/sharedStrings.xml').split('<si>').slice(1)) {
    let value = '';
    for (const t of si.split('</si>')[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) value += t[1];
    strings.push(unesc(value));
  }

  /* Tab name -> relationship id -> file, because sheet order in the zip is
     not the order on screen and the names live in a different file again. */
  const rels = new Map();
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = (m[1].match(/Id="([^"]+)"/) || [])[1];
    const target = (m[1].match(/Target="([^"]+)"/) || [])[1];
    if (id && target) rels.set(id, `xl/${target.replace(/^\/?xl\//, '')}`);
  }

  const sheets = new Map();
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = unesc((m[1].match(/name="([^"]+)"/) || [])[1] || '');
    const rid = (m[1].match(/r:id="([^"]+)"/) || [])[1];
    const file = rels.get(rid);
    if (!name || !file || !files.has(file)) continue;

    const rows = [];
    for (const rm of files.get(file).toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [, ref, attrs, body = ''] = cm;
        const type = (attrs.match(/t="([^"]+)"/) || [])[1];
        let value = '';
        if (type === 'inlineStr') {
          for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) value += t[1];
          value = unesc(value);
        } else {
          const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (v !== undefined) value = type === 's' ? (strings[+v] ?? '') : unesc(v);
        }
        cells[colOf(ref)] = value;
      }
      rows.push(cells);
    }
    sheets.set(name, rows);
  }
  return sheets;
}

/* Only when run directly. Testing process.argv alone fired this on import,
   because the script importing it has an .xlsx path in argv too. */
const runDirectly = process.argv[1]
  && import.meta.filename === path.resolve(process.argv[1]);
if (runDirectly && process.argv[2]) {
  for (const [name, rows] of readXlsx(process.argv[2])) {
    console.log(`\n=== ${name} — ${Math.max(0, rows.length - 1)} data rows ===`);
    console.log('headers:', JSON.stringify(rows[0] ?? []));
    if (rows[1]) console.log('first:  ', JSON.stringify(rows[1]));
  }
}
