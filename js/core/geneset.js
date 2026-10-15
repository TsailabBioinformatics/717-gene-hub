// Shared gene-set store -- the only channel through which modules interact.
//
// Saved sets are deliberately browser-local: GitHub Pages has no account or database layer,
// and the atlas must still work when it is opened from an archival mirror. A versioned,
// bounded document in localStorage gives readers persistence without making the public site
// depend on a service. JSON export is the durable hand-off between browsers and releases.

const STORAGE_KEY = 'poplar-717-atlas.gene-sets.v1';
const SCHEMA_VERSION = 1;
const DOCUMENT_KIND = 'poplar-717-atlas-gene-sets';

// A complete current atlas selection is 63,960 IDs. Leave room for it, but bound imported
// JSON before a pasted or corrupted file can monopolise memory or exceed localStorage quota.
const MAX_SETS = 40;
const MAX_IDS_PER_SET = 70_000;
const MAX_TOTAL_IDS = 100_000;
const MAX_NAME_CHARS = 512;
const MAX_META_CHARS = 16_000;
const MAX_PERSISTED_CHARS = 2_300_000;
export const MAX_GENESET_IMPORT_BYTES = 3_000_000;

const GENE_ID_RE = /^PtXa(?:TreH|AlbH)\.(?:\d{2}G\d+|T\d+)$/;
const sets = new Map();
const listeners = new Set();
let active = null;
let storageState = {
  available: false,
  persistent: false,
  message: 'Browser storage is unavailable; saved sets will remain for this session.',
};

function geneSetError(message) {
  const error = new Error(message);
  error.name = 'GeneSetError';
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cloneJSON(value, depth = 0) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw geneSetError('Set metadata contains a non-finite number.');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_META_CHARS) throw geneSetError('Set metadata contains a value that is too long.');
    return value;
  }
  if (depth >= 4) throw geneSetError('Set metadata is nested too deeply.');
  if (Array.isArray(value)) {
    if (value.length > 100) throw geneSetError('Set metadata contains too many values.');
    return value.map((item) => cloneJSON(item, depth + 1));
  }
  if (!isPlainObject(value)) throw geneSetError('Set metadata must be plain JSON.');
  const keys = Object.keys(value);
  if (keys.length > 100) throw geneSetError('Set metadata contains too many fields.');
  const out = {};
  for (const key of keys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw geneSetError('Set metadata contains a reserved field.');
    }
    out[key] = cloneJSON(value[key], depth + 1);
  }
  return out;
}

function normaliseMeta(meta) {
  if (meta == null) return {};
  if (!isPlainObject(meta)) throw geneSetError('Set metadata must be a JSON object.');
  const out = cloneJSON(meta);
  if (JSON.stringify(out).length > MAX_META_CHARS) {
    throw geneSetError(`Set metadata exceeds the ${MAX_META_CHARS.toLocaleString('en-US')}-character limit.`);
  }
  return out;
}

function normaliseName(name) {
  if (typeof name !== 'string') throw geneSetError('A saved set needs a text name.');
  const clean = name.trim();
  if (!clean) throw geneSetError('A saved set needs a name.');
  if (clean.length > MAX_NAME_CHARS) {
    throw geneSetError(`Set names can be at most ${MAX_NAME_CHARS} characters.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(clean)) throw geneSetError('Set names cannot contain control characters.');
  return clean;
}

function normaliseIds(ids) {
  if (!ids || typeof ids === 'string' || typeof ids[Symbol.iterator] !== 'function') {
    throw geneSetError('A saved set needs a list of atlas gene IDs.');
  }
  const seen = new Set();
  const out = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') throw geneSetError('Every saved-set entry must be a text gene ID.');
    const id = raw.trim();
    if (!GENE_ID_RE.test(id)) throw geneSetError(`"${id || raw}" is not a 717 atlas gene ID.`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length > MAX_IDS_PER_SET) {
      throw geneSetError(`A saved set can contain at most ${MAX_IDS_PER_SET.toLocaleString('en-US')} genes.`);
    }
  }
  return out;
}

function normaliseSet(value) {
  if (!isPlainObject(value)) throw geneSetError('Each imported saved set must be an object.');
  const created = value.created == null ? Date.now() : Number(value.created);
  if (!Number.isSafeInteger(created) || created <= 0) {
    throw geneSetError('Each imported saved set needs a valid creation time.');
  }
  return {
    name: normaliseName(value.name),
    ids: normaliseIds(value.ids),
    meta: normaliseMeta(value.meta),
    created,
  };
}

function cloneSet(set) {
  return {
    name: set.name,
    ids: [...set.ids],
    meta: cloneJSON(set.meta),
    created: set.created,
  };
}

function checkCollection(next) {
  if (next.size > MAX_SETS) {
    throw geneSetError(`Keep at most ${MAX_SETS} saved sets in this browser.`);
  }
  let total = 0;
  for (const set of next.values()) {
    total += set.ids.length;
    if (total > MAX_TOTAL_IDS) {
      throw geneSetError(`Saved sets can contain at most ${MAX_TOTAL_IDS.toLocaleString('en-US')} genes in total.`);
    }
  }
}

function documentFor(setMap = sets, activeName = active) {
  return {
    kind: DOCUMENT_KIND,
    schema_version: SCHEMA_VERSION,
    saved_at: Date.now(),
    active: activeName || null,
    sets: [...setMap.values()].map(cloneSet),
  };
}

function normaliseDocument(value) {
  if (!isPlainObject(value)) throw geneSetError('The selected file is not a saved-set JSON document.');
  if (value.kind != null && value.kind !== DOCUMENT_KIND) {
    throw geneSetError('The selected JSON belongs to a different kind of document.');
  }
  if (value.schema_version == null) {
    throw geneSetError('The selected file is not a saved-sets export from this atlas (use “Export sets JSON” to make one).');
  }
  if (value.schema_version !== SCHEMA_VERSION) {
    throw geneSetError(`This file uses saved-set schema ${String(value.schema_version)}; version ${SCHEMA_VERSION} is required.`);
  }
  if (!Array.isArray(value.sets)) throw geneSetError('The selected JSON has no saved-set list.');
  if (value.sets.length > MAX_SETS) {
    throw geneSetError(`The selected JSON contains more than ${MAX_SETS} sets.`);
  }
  const out = new Map();
  for (const raw of value.sets) {
    const set = normaliseSet(raw);
    if (out.has(set.name)) throw geneSetError(`The selected JSON repeats the set name "${set.name}".`);
    out.set(set.name, set);
  }
  checkCollection(out);
  let activeName = null;
  if (value.active != null) {
    const candidate = normaliseName(value.active);
    if (out.has(candidate)) activeName = candidate;
  }
  return { sets: out, active: activeName };
}

function browserStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function updateStorageState(available, persistent, message) {
  storageState = { available, persistent, message };
}

function persist() {
  const storage = browserStorage();
  if (!storage) {
    updateStorageState(false, false, 'Browser storage is unavailable; saved sets will remain for this session.');
    return false;
  }
  let serialized;
  try {
    serialized = JSON.stringify(documentFor());
  } catch {
    updateStorageState(true, false, 'Saved sets could not be prepared for browser storage; they remain for this session.');
    return false;
  }
  if (serialized.length > MAX_PERSISTED_CHARS) {
    updateStorageState(true, false,
      'Saved sets are too large for reliable browser storage; they remain for this session. Download JSON to keep them.');
    return false;
  }
  try {
    storage.setItem(STORAGE_KEY, serialized);
    updateStorageState(true, true, 'Saved sets are stored in this browser.');
    return true;
  } catch {
    updateStorageState(true, false,
      'Browser storage is full or blocked; saved sets remain for this session. Download JSON to keep them.');
    return false;
  }
}

function replaceState(next, activeName) {
  sets.clear();
  for (const [name, set] of next) sets.set(name, set);
  active = activeName && sets.has(activeName) ? activeName : null;
}

function loadPersistedSets() {
  const storage = browserStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      updateStorageState(true, true, 'Saved sets are stored in this browser.');
      return;
    }
    if (raw.length > MAX_PERSISTED_CHARS) throw geneSetError('Stored saved sets exceed the supported size.');
    const parsed = normaliseDocument(JSON.parse(raw));
    replaceState(parsed.sets, parsed.active);
    updateStorageState(true, true, 'Saved sets are stored in this browser.');
  } catch {
    // Do not erase an unreadable value: a newer atlas might understand it. The current page
    // simply starts a fresh session and reports why it cannot promise persistence.
    updateStorageState(true, false,
      'Previously stored saved sets could not be read; this browser session starts empty.');
  }
}

function emit() {
  for (const listener of listeners) {
    try { listener(); } catch { /* A view callback must not break the shared store. */ }
  }
}

loadPersistedSets();

// A second open atlas tab should reflect saves and removals made in the first. Invalid external
// values are ignored rather than replacing the live in-memory session.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    try {
      if (event.newValue == null) {
        replaceState(new Map(), null);
      } else {
        if (event.newValue.length > MAX_PERSISTED_CHARS) throw geneSetError('Stored saved sets exceed the supported size.');
        const parsed = normaliseDocument(JSON.parse(event.newValue));
        replaceState(parsed.sets, parsed.active);
      }
      updateStorageState(true, true, 'Saved sets are stored in this browser.');
      emit();
    } catch {
      updateStorageState(true, false,
        'A saved-set update from another tab could not be read; this tab kept its current sets.');
      emit();
    }
  });
}

export function saveSet(name, ids, meta = {}) {
  const set = {
    name: normaliseName(name),
    ids: normaliseIds(ids),
    meta: normaliseMeta(meta),
    created: Date.now(),
  };
  const next = new Map(sets);
  next.set(set.name, set);
  checkCollection(next);
  replaceState(next, active);
  persist();
  emit();
  return cloneSet(set);
}

export const getSet = (name) => {
  const set = sets.get(name);
  return set ? cloneSet(set) : null;
};
export const allSets = () => [...sets.values()].map(cloneSet);

export function removeSet(name) {
  if (!sets.has(name)) return false;
  const next = new Map(sets);
  next.delete(name);
  replaceState(next, active === name ? null : active);
  persist();
  emit();
  return true;
}

export function setActive(name) {
  if (name == null) active = null;
  else {
    const clean = normaliseName(name);
    if (!sets.has(clean)) throw geneSetError(`No saved set is named "${clean}".`);
    active = clean;
  }
  persist();
  emit();
  return getActive();
}

export const getActive = () => (active ? getSet(active) : null);

export function subscribe(fn) {
  if (typeof fn !== 'function') throw new TypeError('Saved-set subscribers must be functions.');
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function storageStatus() {
  return { ...storageState };
}

/** JSON-safe document for download or a later import. `atlas` records the release that made it. */
export function exportSets(atlas = {}) {
  const document = documentFor();
  document.exported_at = new Date().toISOString();
  document.atlas = normaliseMeta(atlas);
  return document;
}

/** Merge a versioned export into the current session. Matching names are intentionally updated. */
export function importSets(document) {
  const incoming = normaliseDocument(document);
  const next = new Map(sets);
  let replaced = 0;
  for (const [name, set] of incoming.sets) {
    if (next.has(name)) replaced++;
    next.set(name, set);
  }
  checkCollection(next);
  const nextActive = active && next.has(active) ? active : incoming.active;
  replaceState(next, nextActive);
  const persistent = persist();
  emit();
  return { imported: incoming.sets.size, replaced, total: sets.size, persistent };
}

export function toTSV(set, columns = ['gene_id']) {
  if (!set || !Array.isArray(set.ids)) throw geneSetError('A set with gene IDs is required for TSV export.');
  return [columns.join('\t'), ...set.ids].join('\n');
}
