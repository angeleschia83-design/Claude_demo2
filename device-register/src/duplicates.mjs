/* People who are probably one person twice.
 *
 * The register's holders come from assignee names typed into the inventory
 * workbook, so the same person typed two ways becomes two holders, each
 * with some of their hardware. April Rose Magno-Almario and April Rose
 * Magno-Almrario are one person and four laptops between them.
 *
 * Nothing here decides anything. It proposes pairs and says why, and a
 * person says yes or no — because Shaina Brazil and Shaira Brazil might
 * well be two people, and merging them would be worse than leaving them.
 */

const words = (name) => String(name ?? '')
  .toLowerCase()
  .replace(/[^a-z\s]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

const norm = (name) => words(name).join(' ');

/* How alike two strings are, 0 to 1 — the same measure a person uses
   squinting at two names: how much of one appears in the other, in order. */
const likeness = (a, b) => {
  if (!a.length || !b.length) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  let matched = 0;
  let from = 0;
  for (const ch of shorter) {
    const at = longer.indexOf(ch, from);
    if (at >= 0) { matched += 1; from = at + 1; }
  }
  return (2 * matched) / (a.length + b.length);
};

/* Two words that are the same word typed wrong: the same letters in a
   different order, or one letter out. "Darly" against "Daryl" is the first;
   "joice" against "joyce" is the second. The run-of-letters measure above
   scores that pair 0.53 and walks past it, which is how one person stayed
   in the register twice until somebody noticed by eye. */
const sorted = (word) => [...word].sort().join('');

const nearlyTheSameWord = (a, b) => {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.length === b.length && sorted(a) === sorted(b)) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  /* one insertion, deletion or substitution apart */
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let slips = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i += 1; j += 1; continue; }
    slips += 1;
    if (slips > 1) return false;
    if (short.length === long.length) { i += 1; j += 1; } else { j += 1; }
  }
  return slips + (long.length - j) + (short.length - i) <= 1;
};

/* The same name typed wrong word for word, which letter-by-letter
   likeness misses when letters are transposed. */
const typedWrong = (wa, wb) => wa.length === wb.length
  && wa.length > 1
  && wa.every((word, at) => nearlyTheSameWord(word, wb[at]))
  && wa.some((word, at) => word !== wb[at]);

const describe = (a, b) => {
  const wa = words(a.name);
  const wb = words(b.name);
  const sa = new Set(wa);
  const sb = new Set(wb);
  const shared = wa.filter((word) => sb.has(word));

  if (norm(a.name) === norm(b.name)) return { why: 'The same name twice.', rank: 1 };
  if (wa.length === wb.length && shared.length === wa.length) {
    return { why: 'The same words in a different order — a name entered surname first.', rank: 1 };
  }
  if (shared.length >= 2 && (shared.length === sa.size || shared.length === sb.size)) {
    const longerOne = wa.length > wb.length ? a.name : b.name;
    const shorterOne = wa.length > wb.length ? b.name : a.name;
    return {
      why: `"${shorterOne}" is "${longerOne}" without the middle name.`,
      rank: 2,
    };
  }
  if (typedWrong(wa, wb)) {
    const off = wa.map((word, at) => (word === wb[at] ? null : `"${word}" against "${wb[at]}"`))
      .filter(Boolean);
    return {
      why: `The same name typed two ways \u2014 ${off.join(', ')}. `
        + 'Same letters in a different order, or one letter out.',
      rank: 2,
    };
  }
  const score = likeness(norm(a.name), norm(b.name));
  return {
    why: `The two spellings are ${Math.round(score * 100)}% alike`
      + `${wa[wa.length - 1] === wb[wb.length - 1] ? ' and the surname matches' : ''}.`
      + ' It may be a typo, or they may be two people.',
    rank: 3,
  };
};

/* Pairs worth a person's attention, most likely first. */
export const findDuplicates = (holders) => {
  const rows = holders.filter((row) => row && row.name);
  const pairs = [];

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      const wa = words(a.name);
      const wb = words(b.name);
      if (!wa.length || !wb.length) continue;
      const sa = new Set(wa);
      const sb = new Set(wb);
      const shared = wa.filter((word) => sb.has(word));

      const sameWords = wa.length === wb.length && shared.length === wa.length;
      const subset = shared.length >= 2 && (shared.length === sa.size || shared.length === sb.size);
      const close = likeness(norm(a.name), norm(b.name)) >= 0.86
        && (wa[wa.length - 1] === wb[wb.length - 1] || wa[0] === wb[0]);
      const mistyped = typedWrong(wa, wb);
      if (!sameWords && !subset && !close && !mistyped) continue;

      const { why, rank } = describe(a, b);
      pairs.push({
        key: `${a.id}:${b.id}`,
        rank,
        why,
        people: [a, b].map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          position: row.position || '',
          department: row.department || '',
          n: row.n || 0,
          nL: row.nL || 0,
          nI: row.nI || 0,
          lap: row.lap || '',
          ipd: row.ipd || '',
          hr_status: row.hr_status || '',
          /* How this name matched HR's own list. It is what decides which
             record to keep, so it travels with the pair rather than being
             looked up again by whoever shows it. */
          src: row.src || row.label_source || '',
          createdHere: Boolean(row.createdHere),
          changed: row.changed || [],
        })),
      });
    }
  }

  return pairs.sort((a, b) => a.rank - b.rank
    || b.people[0].n + b.people[1].n - (a.people[0].n + a.people[1].n)
    || a.people[0].name.localeCompare(b.people[0].name));
};
