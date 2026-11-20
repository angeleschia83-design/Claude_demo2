/* The four things that can happen to a leaver's hardware, and how each one
 * finds its word on the status list.
 *
 * Kept apart from resign.mjs on purpose: this file touches no database, so a
 * test can import it without opening one.
 */
export const OUTCOMES = ['retrieve', 'available', 'decommissioned', 'defective'];

export const WORDS = {
  retrieve: 'To retrieve',
  available: 'Available',
  decommissioned: 'Decommissioned',
  defective: 'Defective',
};

const plain = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/* Each rule says what counts, and what only looks as if it counts. The
   lookalikes are the reason this is not one substring match: "Unavailable"
   contains "available", and "Retrieved" means the thing is already back. */
const RULES = {
  retrieve: {
    exact: 'to retrieve',
    /* Still to come back: "For retrieval", "To be retrieved". Not back
       already ("Retrieved", "Retrieval done"), and not never coming back
       ("Irretrievable", "Unretrievable"), which a word boundary keeps out. */
    fits: (v) => /\bto be retrieved\b/.test(v)
      || (/\bretriev/.test(v) && !/\bretrieved\b/.test(v) && !/\bretrieval\s+(done|complete)/.test(v)),
  },
  available: {
    exact: 'available',
    fits: (v) => /\bavailable\b/.test(v) && !/\b(not yet|no longer|not|non)[\s-]*available\b/.test(v),
  },
  decommissioned: { fits: (v) => /decommis/.test(v) },
  defective: { fits: (v) => /defect|faulty/.test(v) },
};

/** The first status on the list that means `outcome`, or null. Returns the
    value exactly as the list spells it. */
export const pickStatus = (outcome, values) => {
  const rule = RULES[outcome];
  if (!rule) return null;
  if (rule.exact) {
    const exact = values.find((value) => plain(value) === rule.exact);
    if (exact !== undefined) return exact;
  }
  const found = values.find((value) => rule.fits(plain(value)));
  return found === undefined ? null : found;
};
