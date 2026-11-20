/* What happens to somebody's hardware when they leave.
 *
 * Ticking a person resigned used to be the end of it: every laptop, iPad and
 * headset on their name then had to be found and changed one at a time. Now
 * the person ticking it says, for each piece, whether it is still to come
 * back, or is available, decommissioned or defective, and it is all saved
 * together or not at all.
 *
 * The four outcomes write words from the status list, never words of their
 * own, so a count of "Defective" means one thing everywhere. Which word each
 * outcome writes is an admin's choice; until one is made, the closest word
 * already on the list is used, and only where there is none is a new one
 * added — through the same route as any word added by hand, so it is in the
 * change log.
 */
import { db, getNote, setNote, recordChange, getHolder, updateHolder, listDevices } from './db.mjs';
import { listValues, addValue, setValueFlag, getAsset, updateAsset, returnAsset, listAssets } from './assets.mjs';
import { OUTCOMES, WORDS, pickStatus } from './resign-words.mjs';

export { OUTCOMES, WORDS, pickStatus };

const CHOSEN = 'resign_statuses';

/* A status that is no longer offered is not one to write anything new at. */
const offered = () => listValues('status').filter((row) => !row.retired).map((row) => row.value);

/** For each outcome: the status it writes, and whether an admin chose it,
    it was matched from the list, or there is none yet. */
export const resignStatuses = () => {
  const values = offered();
  const chosen = getNote(CHOSEN) || {};
  return Object.fromEntries(OUTCOMES.map((outcome) => {
    const pick = chosen[outcome];
    if (pick && values.includes(pick)) return [outcome, { value: pick, source: 'chosen' }];
    const value = pickStatus(outcome, values);
    return [outcome, value === null ? { value: null, source: 'missing' } : { value, source: 'matched' }];
  }));
};

/** The status an outcome writes, adding its plain word to the list first
    when nothing on the list means it. */
export const ensureResignStatus = db.transaction((outcome, actor) => {
  if (!OUTCOMES.includes(outcome)) throw new Error(`"${outcome}" is not one of the four choices.`);
  const found = resignStatuses()[outcome];
  if (found.value) return found.value;

  const word = WORDS[outcome];
  const shelved = listValues('status').find((row) => row.retired
    && row.value.trim().toLowerCase() === word.toLowerCase());
  if (shelved) {
    throw new Error(`"${shelved.value}" is on the status list but no longer offered. Offer it again, `
      + 'or pick another status under Settings, When someone resigns.');
  }
  addValue('status', word, actor);
  /* Hardware waiting to come back, decommissioned or defective is not
     hardware to hand out, so assigning it stops and asks for a ticket. */
  if (outcome !== 'available') setValueFlag('status', word, { assignable: false }, actor);
  return word;
});

/** An admin's choice of status for some or all of the outcomes. */
export const setResignStatuses = db.transaction((asked, actor) => {
  const values = offered();
  const before = getNote(CHOSEN) || {};
  const next = { ...before };
  for (const outcome of OUTCOMES) {
    if (!asked || !(outcome in asked)) continue;
    const value = String(asked[outcome] ?? '').trim();
    if (!values.includes(value)) throw new Error(`"${value}" is not on the status list.`);
    next[outcome] = value;
  }
  setNote(CHOSEN, next);
  const at = new Date().toISOString();
  for (const outcome of OUTCOMES) {
    if ((before[outcome] || '') === (next[outcome] || '')) continue;
    recordChange({ at, actor, field: `when someone resigns: ${outcome}`,
      was: before[outcome] || '', now: next[outcome] });
  }
  return resignStatuses();
});

/* ---------- resigning somebody ---------- */

/* A refusal is thrown inside the transaction so that everything done before
   it is rolled back, then caught outside it and handed back as an answer. */
class Refusal extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const RETRIEVE_SINCE = 'retrieve_since';
const today = () => new Date().toISOString().slice(0, 10);
const listed = (serials) => (serials.length === 1 ? serials[0]
  : `${serials.slice(0, -1).join(', ')} and ${serials[serials.length - 1]}`);

const resignInside = db.transaction((id, { choices, ticket, note, later }, actor) => {
  const holder = getHolder(id);
  if (!holder || holder.merged_into) throw new Refusal(404, 'No such person in the register.');

  const asked = new Map();
  for (const choice of choices) {
    const serial = String(choice?.serial ?? '').trim();
    if (!OUTCOMES.includes(choice?.outcome)) {
      throw new Refusal(400, `"${choice?.outcome}" is not one of the four choices.`);
    }
    if (asked.has(serial)) throw new Refusal(400, `${serial} is listed twice.`);
    asked.set(serial, choice.outcome);
  }

  /* What is on their name now, not what was on it when the pop-up opened.
     Somebody else may have taken a piece back, or handed them another, in
     between; either way the choices no longer describe their hardware. */
  const held = listDevices(id).map((device) => device.serial);
  const gone = [...asked.keys()].filter((serial) => !held.includes(serial));
  if (gone.length) {
    throw new Refusal(409, `${listed(gone)} ${gone.length === 1 ? 'is' : 'are'} no longer on `
      + `${holder.name}'s name. Somebody changed their hardware after this was opened.`);
  }
  /* Somebody already resigned has had some of it decided: a piece already
     waiting to come back is not asked about again. Everything else on their
     name still needs an answer, so a piece handed to them while the pop-up
     was open is caught here rather than left undecided. */
  const waitingWord = resignStatuses().retrieve.value;
  const statusOf = (serial) => (getAsset(serial) || {}).status;
  const settled = (serial) => holder.resigned && waitingWord && statusOf(serial) === waitingWord;
  const undecided = held.filter((serial) => !asked.has(serial) && !settled(serial));
  if (undecided.length && !later) {
    throw new Refusal(409, `${holder.name} also holds ${listed(undecided)}. `
      + 'Choose what happens to every piece, or decide later.');
  }

  /* The same save twice changes nothing the second time, and must not write
     a second note or a second set of lines saying so. */
  const changesSomething = !holder.resigned || [...asked].some(([serial, outcome]) =>
    outcome !== 'retrieve' || !waitingWord || statusOf(serial) !== waitingWord);
  if (!changesSomething) throw new Refusal(409, 'That has already been saved. Nothing has changed since.');

  const stamp = ticket || null;
  if (!holder.resigned) updateHolder(id, { resigned: true }, actor, stamp);

  const since = { ...(getNote(RETRIEVE_SINCE) || {}) };
  let waiting = false;
  for (const [serial, outcome] of asked) {
    const status = ensureResignStatus(outcome, actor);
    if (outcome === 'retrieve') {
      updateAsset(serial, { status }, actor, stamp);
      since[serial] = today();
      waiting = true;
      continue;
    }
    /* Off their name first, then the status, so the ticket is on both lines;
       returnAsset records it only on the "returned by" line. */
    const back = returnAsset(serial, { actor, ticket: stamp });
    if (back.error) throw new Refusal(409, back.error);
    updateAsset(serial, { status }, actor, stamp);
  }
  if (waiting) setNote(RETRIEVE_SINCE, since);

  if (note) {
    recordChange({ at: new Date().toISOString(), actor, holderId: id, field: 'resign note',
      was: '', now: note, ticket: stamp });
  }
  return { holder: getHolder(id), assets: listDevices(id).map((device) => getAsset(device.serial)) };
});

/** Marks somebody resigned and applies a choice to each piece of hardware on
    their name, all together or not at all. Answers { holder, assets }, or
    { error, code } when it refuses. */
export const resignHolder = (id, { choices = [], ticket = '', note = '', later = false } = {}, actor) => {
  try {
    return resignInside(id, { choices, ticket, note, later }, actor);
  } catch (err) {
    if (err instanceof Refusal) return { error: err.message, code: err.code };
    throw err;
  }
};

/* ---------- what is waiting to come back ---------- */

/** Every asset at the to-retrieve status, with who has it and the date it
    was asked for. That date exists only for pieces put there by a resign;
    one set to the status by hand has none, and sorts after the rest. Names
    only: nothing here is a contact detail, so every role may read it. */
export const listToRetrieve = () => {
  const status = resignStatuses().retrieve.value;
  if (!status) return { status: null, rows: [] };
  const since = getNote(RETRIEVE_SINCE) || {};
  const rows = listAssets()
    .filter((asset) => asset.status === status)
    .map((asset) => ({
      serial: asset.serial,
      kind: asset.kind,
      asset_type: asset.asset_type,
      model: asset.model,
      holder_id: asset.holder_id || '',
      holder: asset.holder || '',
      since: since[asset.serial] || null,
    }))
    .sort((a, b) => {
      if (a.since !== b.since) {
        if (a.since === null) return 1;
        if (b.since === null) return -1;
        return a.since < b.since ? -1 : 1;
      }
      return a.holder.localeCompare(b.holder) || a.serial.localeCompare(b.serial);
    });
  return { status, rows };
};

/* ---------- it's back ---------- */

const BACK_AS = ['available', 'decommissioned', 'defective'];

const backInside = db.transaction((serial, outcome, actor) => {
  if (!BACK_AS.includes(outcome)) {
    throw new Refusal(400, 'It comes back as available, decommissioned or defective.');
  }
  const asset = getAsset(serial);
  if (!asset) throw new Refusal(404, 'No asset with that serial.');
  const waiting = resignStatuses().retrieve.value;
  if (!waiting || asset.status !== waiting) {
    throw new Refusal(409, `${asset.serial} is not waiting to come back.`);
  }
  /* The same words the resign pop-up writes, added the same way when the
     list has none, so "Defective" is one status whichever route set it. */
  const status = ensureResignStatus(outcome, actor);
  if (asset.holder_id) {
    const back = returnAsset(asset.serial, { actor });
    if (back.error) throw new Refusal(409, back.error);
  }
  updateAsset(asset.serial, { status }, actor);
  const since = { ...(getNote(RETRIEVE_SINCE) || {}) };
  if (asset.serial in since) {
    delete since[asset.serial];
    setNote(RETRIEVE_SINCE, since);
  }
  return { asset: getAsset(asset.serial) };
});

/** Something waiting to come back has come back: off the holder's name, at
    the status for available, decommissioned or defective. */
export const bringBack = (serial, outcome, actor) => {
  try {
    return backInside(serial, outcome, actor);
  } catch (err) {
    if (err instanceof Refusal) return { error: err.message, code: err.code };
    throw err;
  }
};
