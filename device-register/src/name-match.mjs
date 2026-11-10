/* Deciding whether two names are the same person typed two ways.
 *
 * This is the only copy. It used to live three times over — once in the
 * register, once in the dashboard, once inside the shared HTML copy — and
 * the three drifted: a fix made here in 4.2.0 left the dashboard still
 * missing "Darly joice Cabel" against "Daryl Joyce Cabel" until somebody
 * noticed by eye. The browser copies are generated from this file now, so
 * there is one place to change and no way for them to disagree.
 *
 * Plain functions, no imports, no platform assumptions: the build strips
 * the `export` keywords and inlines what is left.
 */

export const words = (name) => String(name ?? '')
  .toLowerCase()
  .replace(/[^a-z\s]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

export const norm = (name) => words(name).join(' ');

/* How alike two strings are, 0 to 1 — the same measure a person uses
   squinting at two names: how much of one appears in the other, in order. */
export const likeness = (a, b) => {
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

const sorted = (word) => [...word].sort().join('');

/* Two words that are the same word typed wrong: the same letters in a
   different order, or one letter out. "Darly" against "Daryl" is the first;
   "joice" against "joyce" is the second. The run-of-letters measure above
   scores that pair 0.53 and walks past it. */
export const nearlyTheSameWord = (a, b) => {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.length === b.length && sorted(a) === sorted(b)) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  /* one insertion, deletion or substitution apart */
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
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

/* The same name typed wrong word for word, which letter-by-letter likeness
   misses when letters are transposed. */
export const typedWrong = (wa, wb) => wa.length === wb.length
  && wa.length > 1
  && wa.every((word, at) => nearlyTheSameWord(word, wb[at]))
  && wa.some((word, at) => word !== wb[at]);

/* Whether a pair is worth putting in front of a person at all, and why.
   Rank 1 is the most certain. */
export const whyTheyMatch = (nameA, nameB) => {
  const wa = words(nameA);
  const wb = words(nameB);
  if (!wa.length || !wb.length) return null;

  const sa = new Set(wa);
  const sb = new Set(wb);
  const shared = wa.filter((word) => sb.has(word));
  const sameWords = wa.length === wb.length && shared.length === wa.length;
  const subset = shared.length >= 2 && (shared.length === sa.size || shared.length === sb.size);
  const score = likeness(norm(nameA), norm(nameB));
  const close = score >= 0.86 && (wa[wa.length - 1] === wb[wb.length - 1] || wa[0] === wb[0]);
  const mistyped = typedWrong(wa, wb);
  if (!sameWords && !subset && !close && !mistyped) return null;

  if (norm(nameA) === norm(nameB)) return { why: 'The same name twice.', rank: 1 };
  if (sameWords) {
    return {
      why: 'The same words in a different order — a name entered surname first.',
      rank: 1,
    };
  }
  if (subset) {
    const longer = wa.length > wb.length ? nameA : nameB;
    const shorter = wa.length > wb.length ? nameB : nameA;
    return { why: `"${shorter}" is "${longer}" without the middle name.`, rank: 2 };
  }
  if (mistyped) {
    const off = wa.map((word, at) => (word === wb[at] ? null : `"${word}" against "${wb[at]}"`))
      .filter(Boolean);
    return {
      why: `The same name typed two ways — ${off.join(', ')}. `
        + 'Same letters in a different order, or one letter out.',
      rank: 2,
    };
  }
  return {
    why: `The two spellings are ${Math.round(score * 100)}% alike`
      + `${wa[wa.length - 1] === wb[wb.length - 1] ? ' and the surname matches' : ''}.`
      + ' It may be a typo, or they may be two people.',
    rank: 3,
  };
};
