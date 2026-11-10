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

import { words, norm, whyTheyMatch } from './name-match.mjs';

/* Pairs worth a person's attention, most likely first. */
export const findDuplicates = (holders) => {
  const rows = holders.filter((row) => row && row.name);
  const pairs = [];

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
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
