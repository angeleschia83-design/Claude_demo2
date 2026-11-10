/* Writing an .xlsx, without a library.
 *
 * The register only ever writes spreadsheets — it never opens one; the
 * workbook is read by Python at import time. The library that used to do
 * this carried two standing advisories, both about parsing a hostile
 * workbook, neither reachable here. "Not reachable" is a tedious thing to
 * have to argue in every security review, so the dependency is gone and
 * this writes the file instead.
 *
 * An .xlsx is a zip of XML parts. What a flat table needs is five of them,
 * and strings go inline so there is no shared-string table to keep.
 */
import zlib from 'node:zlib';

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPE[c])
  /* The XML spec allows none of these, and a stray one makes the file
     unopenable rather than merely odd. */
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** A1, B1 … Z1, AA1 … for a zero-based column. */
export const cellName = (column, row) => {
  let name = '';
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return `${name}${row + 1}`;
};

const cell = (value, column, row) => {
  const at = cellName(column, row);
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${at}"><v>${value}</v></c>`;
  }
  return `<c r="${at}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
};

/** One sheet: an array of objects, keyed by the headings in order. */
const sheetXml = ({ rows, headings, widths, filter }) => {
  const lines = [`<row r="1">${headings.map((h, i) => cell(h, i, 0)).join('')}</row>`];
  rows.forEach((row, index) => {
    const cells = headings.map((heading, column) => cell(row[heading], column, index + 1)).join('');
    lines.push(`<row r="${index + 2}">${cells}</row>`);
  });

  const cols = widths && widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const last = `${cellName(Math.max(headings.length - 1, 0), rows.length)}`;
  const auto = filter && headings.length ? `<autoFilter ref="A1:${last}"/>` : '';

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<dimension ref="A1:${last}"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + cols
    + `<sheetData>${lines.join('')}</sheetData>`
    + auto
    + '</worksheet>';
};

/* ---------- the zip around it ---------- */

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buffer) => {
    let c = -1;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const zip = (files) => {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of files) {
    const body = Buffer.from(text, 'utf8');
    const packed = zlib.deflateRawSync(body);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = CRC(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt32LE(0, 10);            // time and date: fixed, so the
    local.writeUInt32LE(crc, 14);          //   same data gives the same file
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
};

/**
 * sheets: [{ name, rows, headings, widths, filter }]
 * Returns a Buffer holding the .xlsx.
 */
export function writeWorkbook(sheets) {
  const used = new Set();
  const safe = sheets.map((sheet, index) => {
    /* Excel's rules: 31 characters, none of : \ / ? * [ ], and no two the
       same. */
    let name = String(sheet.name || `Sheet${index + 1}`).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim()
      || `Sheet${index + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${index + 1}`;
    used.add(name.toLowerCase());
    return { ...sheet, name };
  });

  const files = [
    ['[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'],
    ['_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + safe.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + '</Relationships>'],
    ...safe.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)]),
  ];

  return zip(files);
}
