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

import { words, whyTheyMatch } from './name-match.mjs';

/* Comparing every holder against every other is millions of calls at a few
   thousand people, each re-tokenising both names — measured at 16 seconds for
   3000 holders, on the single thread that is also serving pages. So only
   pairs that could possibly match are compared.
 *
 * whyTheyMatch accepts a pair by one of four routes. Three of them (the same
 * words, one name a subset of the other, and the 86% likeness rule, which
 * also demands a matching first or last word) require at least one word to be
 * shared exactly. The fourth, a name typed wrong, requires every word to be
 * within one letter or a reordering of its opposite number.
 *
 * Indexing each word under itself, under its letters sorted, and under the
 * word with any single letter removed covers all four: two words one edit
 * apart always share a removal, and two anagrams always share the sorted
 * form. Words shorter than four letters only ever match exactly, which the
 * first key already covers. So nothing whyTheyMatch would have accepted can
 * fall outside these buckets — this is faster, not looser. */
const keysFor = (name) => {
  const keys = new Set();
  for (const word of words(name)) {
    keys.add(word);
    if (word.length < 4) continue;
    keys.add(`=${[...word].sort().join('')}`);
    /* The word itself belongs in the removal keyspace too, not just the plain
       one: where one name simply drops a letter, the longer word's removal IS
       the shorter word, and the two only meet if both are spelled the same
       way here. */
    keys.add(`-${word}`);
    for (let at = 0; at < word.length; at += 1) {
      keys.add(`-${word.slice(0, at)}${word.slice(at + 1)}`);
    }
  }
  return keys;
};

/* Pairs worth a person's attention, most likely first. */
export const findDuplicates = (holders) => {
  const rows = holders.filter((row) => row && row.name);
  const pairs = [];

  const buckets = new Map();
  rows.forEach((row, at) => {
    for (const key of keysFor(row.name)) {
      const list = buckets.get(key);
      if (list) list.push(at);
      else buckets.set(key, [at]);
    }
  });

  /* Packed as one number so the pair is deduplicated across buckets. Indexes
     go in ascending order, so the lower-numbered row stays first and the
     `key` below is the same string it has always been — the settled
     "not duplicates" decisions are stored against it. */
  const candidates = new Set();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        candidates.add(list[i] * rows.length + list[j]);
      }
    }
  }

  for (const packed of [...candidates].sort((x, y) => x - y)) {
    {
      const a = rows[Math.floor(packed / rows.length)];
      const b = rows[packed % rows.length];
      const verdict = whyTheyMatch(a.name, b.name);
      if (!verdict) continue;

      pairs.push({
        key: `${a.id}:${b.id}`,
        rank: verdict.rank,
        why: verdict.why,
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
          createdHere: Boolean(row.createdHere),
          changed: row.changed || [],
          /* How this name matched HR's own list. It is what decides which
             record to keep, so it travels with the pair rather than being
             looked up again by whoever shows it. */
          src: row.src || row.label_source || '',
        })),
      });
    }
  }

  return pairs.sort((a, b) => a.rank - b.rank
    || b.people[0].n + b.people[1].n - (a.people[0].n + a.people[1].n)
    || a.people[0].name.localeCompare(b.people[0].name));
};
