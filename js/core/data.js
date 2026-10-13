// Data access. The gene ID encodes its own shard, so there is no index file to load.
//
// MIRRORS scripts/build_data.py:shard_of() EXACTLY. If you change one, change the other --
// the build asserts the Python side against the real annotation, so this side is the one
// that can drift silently.

const CHR_RE = /^PtXa(TreH|AlbH)\.(\d\d)G(\d+)$/;
const SCAF_RE = /^PtXa(TreH|AlbH)\.T\d+$/;

// Genes are numbered in steps of 100 within a chromosome, so this yields <=250 genes per
// shard (~40 KB gzipped). Whole-chromosome shards reached 3.9 MB raw for a page that renders
// one gene. MIRRORS scripts/build_data.py:BUCKET_SPAN -- change both or neither.
const BUCKET_SPAN = 25000;

export function shardOf(geneId) {
  let m = CHR_RE.exec(geneId);
  if (m) {
    return {
      hap: m[1] === 'TreH' ? 'hap1' : 'hap2',
      key: `Chr${m[2]}/${Math.floor(parseInt(m[3], 10) / BUCKET_SPAN)}`,
    };
  }
  m = SCAF_RE.exec(geneId);
  if (m) return { hap: m[1] === 'TreH' ? 'hap1' : 'hap2', key: 'scaffolds' };
  return null;
}

export const hapLabel = (h) => (h === 'hap1' ? 'HAP1 (TreH)' : 'HAP2 (AlbH)');

// 3D models (TODO 34): a Calpha trace per modelled gene, ten times finer than the gene shards
// (~15 models, ~25 KB per fetch). MIRRORS scripts/patch_structure.py:struct_key and
// validate_data.py:struct_key -- change all three or none. The file format is documented in
// patch_structure.py; this is its only reader.
const STRUCT_SPAN = 2500;
const SCAF_NUM_RE = /^PtXa(TreH|AlbH)\.T(\d+)$/;

export function structKey(geneId) {
  let m = CHR_RE.exec(geneId);
  if (m) return `${m[1] === 'TreH' ? 'hap1' : 'hap2'}/Chr${m[2]}/${Math.floor(parseInt(m[3], 10) / STRUCT_SPAN)}`;
  m = SCAF_NUM_RE.exec(geneId);
  if (m) return `${m[1] === 'TreH' ? 'hap1' : 'hap2'}/scaffolds/${Math.floor(parseInt(m[2], 10) / STRUCT_SPAN)}`;
  return null;
}

const structCache = new Map();
function fetchStructBucket(key) {
  const path = `data/struct/${key}.bin.gz`;
  const cacheKey = dataCacheKey(path);
  if (!structCache.has(cacheKey)) {
    const p = fetch(dataURL(path))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${path}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        // Inflate only if the bytes are still gzip: a server that sets Content-Encoding on
        // .gz would already have had the browser inflate them.
        const b = new Uint8Array(buf, 0, 2);
        if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
        return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      })
      .catch((e) => { structCache.delete(cacheKey); throw e; });
    structCache.set(cacheKey, p);
  }
  return structCache.get(cacheKey);
}

/** One gene's model: {n, ca: Float32Array(3n) in Angstrom, pl: Float32Array(n), seq, ss}.
 *  Null when the gene has no ESMFold model. */
export async function loadStructure(geneId) {
  await loadManifest();
  const key = structKey(geneId);
  if (!key) return null;
  const buf = await fetchStructBucket(key);
  const dv = new DataView(buf);
  const h = dv.getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, h)));
  const ent = head.genes[geneId];
  if (!ent) return null;
  const [off, n] = ent;
  const p = 4 + h + off;
  const ca = new Float32Array(3 * n);
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < n; i++) {          // residue 0 is absolute, the rest are deltas
    x += dv.getInt16(p + 6 * i, true);
    y += dv.getInt16(p + 6 * i + 2, true);
    z += dv.getInt16(p + 6 * i + 4, true);
    ca[3 * i] = x * head.unit; ca[3 * i + 1] = y * head.unit; ca[3 * i + 2] = z * head.unit;
  }
  const pl = new Float32Array(n);
  for (let i = 0; i < n; i++) pl[i] = dv.getUint16(p + 6 * n + 2 * i, true) / 100;
  const ascii = new TextDecoder('ascii');
  return {
    n, ca, pl,
    seq: ascii.decode(new Uint8Array(buf, p + 8 * n, n)),
    ss: ascii.decode(new Uint8Array(buf, p + 9 * n, n)),
  };
}

const cache = new Map();
const inflight = new Map();

// GitHub Pages serves every file with `cache-control: max-age=600` and no way to change it.
// That is fine for one file at a time and dangerous across a release: for ten minutes after a
// deploy a returning reader can hold a STALE facets.json while fetching FRESH JavaScript, and
// the two disagree silently -- a filter reads a column that moved, or one that does not exist
// yet, and returns a confidently wrong count rather than an error. That is not hypothetical:
// it is how a reader on data 0.11.2 saw 191 from a link that serves 229.
//
// The manifest is fetched with `no-store` once per page load, and every other data URL carries
// the version it reports. A new release changes those URLs, so a stale copy can never be served
// alongside a fresh manifest.
let DATA_VERSION = null;
export const dataVersion = () => DATA_VERSION;

const MANIFEST = 'data/meta/manifest.json';
let SAMPLE_COUNT = null;
let manifestPromise = null;

function dataCacheKey(path) {
  return DATA_VERSION && path.startsWith('data/') ? `${DATA_VERSION}:${path}` : path;
}

function dataURL(path) {
  if (!DATA_VERSION || !path.startsWith('data/')) return path;
  return path + (path.includes('?') ? '&' : '?') + `v=${encodeURIComponent(DATA_VERSION)}`;
}

async function fetchJSON(path, init) {
  if (path === MANIFEST) return loadManifest();
  let key = dataCacheKey(path);
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);
  // Any data fetch that races the manifest would otherwise go out unstamped and could be
  // served from a stale cache. Wait for the version first -- every caller is already async,
  // and the manifest is one fetch that everything else needs anyway.
  if (path !== MANIFEST && path.startsWith('data/') && DATA_VERSION === null) {
    await loadManifest();
    key = dataCacheKey(path);
    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);
  }
  const p = fetch(dataURL(path), init)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return r.json();
    })
    .then((j) => {
      cache.set(key, j);
      inflight.delete(key);
      return j;
    })
    .catch((e) => {
      inflight.delete(key);
      throw e;
    });
  inflight.set(key, p);
  return p;
}

export const loadShard = (hap, key) => fetchJSON(`data/genes/${hap}/${key}.json`);
export const loadManifest = async () => {
  // The manifest decides which version every other URL asks for. Fetch it fresh once per page
  // load, then share that request among concurrent callers; caching it through fetchJSON would
  // silently defeat `no-store` on later callers.
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${MANIFEST}`);
        return r.json();
      })
      .then((man) => {
        if (man && man.data_version) DATA_VERSION = man.data_version;
        SAMPLE_COUNT = man && man.expression && man.expression.n_samples || null;
        return man;
      })
      .catch((error) => {
        manifestPromise = null;
        throw error;
      });
  }
  return manifestPromise;
};

/** One gene, one fetch. Returns null for an ID that does not exist.
 *  Checks the manifest's shard list first so a malformed ID (Chr99) resolves to "not found"
 *  without firing a request that 404s -- the manifest is already cached by the shell. */
export async function getGene(geneId) {
  const s = shardOf(geneId);
  if (!s) return null;
  const man = await loadManifest();
  if (!(`${s.hap}/${s.key}` in man.shards)) return null;
  const shard = await loadShard(s.hap, s.key);
  const g = shard[geneId];
  return g ? { ...g, hap: s.hap } : null;
}

/** The syntelog partner ID in the other haplotype is NOT derivable from the ID -- gene
 *  numbering is independent per haplotype. Callers must use orthogroup/synteny data. */
export async function loadAllShards(onProgress) {
  const man = await loadManifest();
  const keys = Object.keys(man.shards);
  const out = [];
  let done = 0;
  for (const k of keys) {
    const [hap, ...parts] = k.split('/');
    const key = parts.join('/');
    const shard = await loadShard(hap, key);
    for (const id in shard) out.push({ ...shard[id], hap });
    if (onProgress) onProgress(++done, keys.length);
  }
  return out;
}

/* ---------- expression ---------- */
export const loadExprSamples = () => fetchJSON('data/expr/samples.json');
export const loadExprStudies = () => fetchJSON('data/expr/studies.json');
/** One gene's own bytes out of a concatenated blob of per-gene gzip members.
 *
 *  GitHub Pages answers a Range request with a real 206 and serves the range
 *  identity-encoded even when the client offers gzip, so the offsets on the shard record are
 *  stable. The member inflates to exactly the JSON array the old bucket held - this is a
 *  container change, not a quantisation, so nothing downstream needs to know.
 *
 *  ~1.1 KB per gene instead of the 786 KB bucket that carried 250 genes to draw one card. */
async function fetchRangeJSON(path, off, len) {
  if (DATA_VERSION === null) await loadManifest();
  const key = `${dataCacheKey(path)}#${off}+${len}`;
  if (cache.has(key)) return cache.get(key);
  const end = off + len - 1;
  const r = await fetch(dataURL(path), { headers: { Range: `bytes=${off}-${end}` } });
  // A 206 is REQUIRED, not merely preferred. A server that ignores Range answers 200 with the
  // whole blob, whose first bytes are the FIRST gene's gzip member -- which inflates cleanly
  // and returns another gene's expression profile. Wrong data that renders perfectly is worse
  // than an error, so anything other than a partial response is refused here and the caller
  // falls back to the bucket path.
  if (r.status !== 206) throw new Error(`${r.status} for a Range request on ${path}: the host `
    + 'did not honour Range, so these bytes are not this gene');
  const range = r.headers.get('Content-Range');
  const expectedRange = `bytes ${off}-${end}/`;
  if (!range || !range.startsWith(expectedRange)) {
    throw new Error(`range gave ${range || 'no Content-Range'}, expected ${expectedRange}…`);
  }
  const buf = await r.arrayBuffer();
  if (buf.byteLength !== len) throw new Error(`range gave ${buf.byteLength} B, expected ${len}`);
  const head = new Uint8Array(buf, 0, 2);
  // A host that ignored Range would hand back the whole file; a host that inflated it for us
  // would hand back plain JSON. Sniff rather than assume, exactly as loadStructure does.
  const text = (head[0] === 0x1f && head[1] === 0x8b)
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(buf);
  const j = JSON.parse(text);
  if (!Array.isArray(j) || (SAMPLE_COUNT != null && j.length !== SAMPLE_COUNT)
      || j.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error(`range payload for ${path} is not a ${SAMPLE_COUNT || 'valid'}-sample numeric vector`);
  }
  cache.set(key, j);
  return j;
}

export const loadExprBucket = (bucketKey) => fetchJSON(`data/expr/buckets/${bucketKey}.json`);

/** Full 652-sample vector for one gene, fetched on demand (the gene shard only carries the
 *  tissue-baseline summary, not the vector -- see docs/EXPRESSION_DESIGN.md). */
export async function loadExprVector(gene) {
  if (!gene.x) return null;
  // Range first, bucket second. The fallback is not politeness: a reader can hold this
  // script against a cached data tree from before the repack (Pages caches for ten minutes
  // and cannot be told otherwise), and a hard failure there would be a blank expression card
  // rather than a slow one.
  if (gene.x.o) {
    const hap = gene.id.startsWith('PtXaTreH') ? 'hap1' : 'hap2';
    try { return await fetchRangeJSON(`data/expr/raw_${hap}.gzb`, gene.x.o[0], gene.x.o[1]); }
    catch { /* fall through to the bucket */ }
  }
  if (!gene.x.b) return null;
  const bucket = await loadExprBucket(gene.x.b);
  return bucket[gene.id] || null;
}

/** ComBat-seq batch-corrected vector, same 652-sample index as loadExprVector -- but ONLY
 *  for the ~59,600 genes with enough count signal to have been batch-corrected upstream
 *  (see docs and sources/combat_tpm.provenance.json). `gene.x.cb` is absent, not null, on
 *  every gene without one; callers must check it before offering the option at all. */
export const loadCombatBucket = (bucketKey) => fetchJSON(`data/expr/combat_buckets/${bucketKey}.json`);
export async function loadCombatVector(gene) {
  if (!gene.x) return null;
  if (gene.x.co) {
    const hap = gene.id.startsWith('PtXaTreH') ? 'hap1' : 'hap2';
    try { return await fetchRangeJSON(`data/expr/cb_${hap}.gzb`, gene.x.co[0], gene.x.co[1]); }
    catch { /* fall through to the bucket */ }
  }
  if (!gene.x.cb) return null;
  const bucket = await loadCombatBucket(gene.x.cb);
  return bucket[gene.id] || null;
}

/** Homology families, id -> [gene ids]. Lives here rather than in a module because two
 *  modules now need it: #/family walks it, and the duplication figure uses it to find this
 *  gene's counterpart on the OTHER haplotype -- which is not always its allele. A tandem
 *  array can have no 1-to-1 allele at all while its family plainly spans both haplotypes
 *  (PtXaTreH.08G070200 and PtXaAlbH.08G073700 are the worked case: allele null on both,
 *  same family F10956). Cached: it is one file and both callers want all of it. */
let _families = null;
export async function loadFamilies() {
  if (!_families) _families = fetchJSON('data/index/families.json');
  return _families;
}

/* ---------- annotation, allele, search ---------- */
export const loadTerms = () => fetchJSON('data/index/terms.json');
export const loadGeneIndex = () => fetchJSON('data/index/genes.json');
/** One short description per gene, aligned with genes.json (build_facets.py). Browse only. */
export const loadDescIndex = () => fetchJSON('data/index/desc.json')
  .then((d) => (Array.isArray(d) ? d : d.idx.map((i) => d.vocab[i])));   // dictionary-encoded
/** Every gene's [start, end] in bp, aligned with genes.json (build_facets.py writes pos.json
 *  delta-encoded; decoded here). Resets the running start whenever hap or chr changes, which
 *  it reads from the facet index so the two files cannot disagree about the order. */
let _positions = null;
export function loadPositions() {
  if (!_positions) {
    _positions = Promise.all([fetchJSON('data/index/pos.json'), loadFacets()]).then(([p, f]) => {
      const n = p.ds.length;
      const start = new Int32Array(n); const end = new Int32Array(n);
      const hc = f.cols.indexOf('hap'); const cc = f.cols.indexOf('chr');
      let prevKey = null; let prev = 0;
      for (let i = 0; i < n; i++) {
        const key = f.rows[i][hc] + ':' + f.rows[i][cc];
        const s = key === prevKey ? prev + p.ds[i] : p.ds[i];
        start[i] = s; end[i] = s + p.len[i];
        prevKey = key; prev = s;
      }
      return { start, end };
    });
  }
  return _positions;
}
/** Token index is sharded by first character so typing fetches one small file. */
export const loadSearchShard = (c) => fetchJSON(`data/index/search/${c}.json`);

/** Free-text search over descriptions, Arabidopsis loci, Pfam and PANTHER accessions, PLUS
 *  a gene-ID prefix match, merged and ranked in one place so the header dropdown and the
 *  full search-results page (#/search/<query>) can never disagree about what "the results"
 *  are -- one had capped at `limit`, the other needs the true total to decide whether to
 *  offer "see all results".
 *
 *  Returns { ids: ALL matches, ranked, uncapped, total: ids.length }. Callers slice for
 *  display; nothing here silently drops a match the caller didn't ask to drop. Search
 *  shards are small (largest is ~680KB, already fetched once per query) so scanning one
 *  fully for a query is cheap -- the old implementation's `limit*8` scan-break existed only
 *  to bound dropdown latency, not because an accurate count was expensive to get.
 */
/** What a reader pastes is rarely the bare gene ID: transcript suffixes (".1"), lower case,
 *  a P. trichocarpa ID, a gene name. Returns the query as the indexes expect it. */
export function normalizeQuery(query) {
  let q = String(query || '').trim();
  if (/^ptxa(tre|alb)h\./i.test(q)) {
    q = q.replace(/\.\d+(\.p)?$/i, '');                  // transcript / peptide suffix
    q = q.replace(/^ptxa(tre|alb)h\.(.*)$/i, (_m, h, rest) =>
      `PtXa${h[0].toUpperCase()}${h.slice(1).toLowerCase()}H.${rest.toUpperCase()}`);
  }
  return q;
}

let _alias;
/** Gene names, P. trichocarpa IDs and Arabidopsis loci -> positions in index/genes.json. */
export function loadAlias() {
  if (!_alias) _alias = fetchJSON('data/index/alias.json').catch(() => ({ name: {}, potri: {}, at: {} }));
  return _alias;
}

export async function searchGenesRanked(query) {
  const q = normalizeQuery(query);
  const ql = q.toLowerCase();
  if (ql.length < 3) return { ids: [], total: 0 };

  const byIdIdx = [];               // gene-ID prefix match, e.g. "PtXaTreH.05G12"
  const isId = /^PtXa/i.test(q);

  const c = /[a-z0-9]/.test(ql[0]) ? ql[0] : '_';
  const [shard, ids, alias] = await Promise.all([
    // the description index has no shard for digits; asking for one would be a 404 in the console
    (/[a-z_]/.test(c) ? loadSearchShard(c).catch(() => ({})) : Promise.resolve({})),
    loadGeneIndex(), loadAlias()]);
  if (isId) {
    const up = q.toUpperCase();
    for (let i = 0; i < ids.length; i++) if (ids[i].toUpperCase().startsWith(up)) byIdIdx.push(i);
  }

  // Exact token first, then prefix matches, so "kinase" beats "kinase-like".
  const rank = new Map();
  const add = (idxs, r) => idxs.forEach((i) => { if (!rank.has(i)) rank.set(i, r); });
  add(byIdIdx, -3);                 // an ID match always outranks a text match
  // exact gene name, P. trichocarpa ID (with or without a version suffix) or Arabidopsis locus
  const potriKey = ql.replace(/\.v\d+(\.\d+)?$/, '').replace(/^(potri\.\d{3}g\d{6})\.\d+$/, '$1');
  const atKey = ql.replace(/^(at[1-5cm]g\d{5})\.\d+$/, '$1');
  for (const hit of [alias.name[ql], alias.potri[potriKey], alias.at[atKey]]) if (hit) add(hit, -2);
  {
    for (const k in alias.name) if (k !== ql && k.startsWith(ql)) add(alias.name[k], -1);
    if (shard[ql]) add(shard[ql], 0);
    for (const tok in shard) {
      if (tok !== ql && tok.startsWith(ql)) add(shard[tok], 1);
    }
  }
  const ranked = [...rank.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([i]) => ids[i]);
  return { ids: ranked, total: ranked.length };
}

/** Back-compat wrapper: the capped, dropdown-shaped call most callers still want. */
export async function searchGenes(query, limit = 30) {
  const { ids } = await searchGenesRanked(query);
  return ids.slice(0, limit);
}

/* ---------- facets (browse) ---------- */
export const loadFacets = () => fetchJSON('data/index/facets.json');

/** Facet rows are positional and share index/genes.json's order. This turns one row into a
 *  named object so filters read as English rather than as column offsets. */
export function facetRow(facets, i) {
  const r = facets.rows[i];
  const c = facets.cols;
  const v = facets.vocab;
  const o = {};
  for (let k = 0; k < c.length; k++) o[c[k]] = r[k];
  return {
    hap: o.hap === 0 ? 'hap1' : 'hap2',
    chr: v.chr[o.chr] ?? null,
    cls: v.cls[o.cls] ?? null,
    ps: o.ps < 0 ? null : o.ps,
    // tau and peak tissue AS IN THE DISSERTATION (222-sample reference panel); per-mille
    tau: o.tau < 0 ? null : o.tau / 1000,
    tok: !!o.tok,         // mean TPM over that panel >= 5, the dissertation's expression filter
    top: v.top[o.top] ?? null,
    allele: !!o.allele,
    at: !!o.at,
    wgd: o.wgd9 | 0,      // the adopted call (kept under this name for older links)
    wgd9: o.wgd9 | 0,     // the adopted call
    dup: (v.dup || [])[o.dup] ?? null,   // duplication class letters
    lsg: o.lsg | 0,       // 1 final LSG set, 2 candidate excluded from it, 0 neither
    qc: !!o.qc,           // gene model flagged by quality control
    psg: o.psg == null || o.psg < 0 ? null : o.psg,   // genEra's own rank
    tandem: !!o.tandem,
    npres: o.npres,   // 0 means OrthoFinder assigned no orthogroup at all
    amb: !!o.amb,
    // Kept as the raw integer per-mille, negatives included: -1 is "no reciprocal-best
    // P. trichocarpa ortholog" and -2 is "pair exists, omega not estimable". Both are real
    // states rather than missing data, so decoding them to null here would let a threshold
    // filter silently treat them as zero.
    w: o.w,
    ms: o.ms,         // datasets (of 5) with a peptide at 1% FDR; -1 if the gene has no record
    // ancestral karyotype (exploratory): chromosome*100 + gamma copy*10 + salicoid copy, a 0 digit
    // where no copy was assigned, -1 when not placed (or when an older index lacks the column)
    aek: o.aek ?? -1,
    // relationship category code (core/relationship.js), null for quality-flagged gene models
    rel: o.rel != null && o.rel >= 0 ? (v.rel || [])[o.rel] ?? null : null,
    // decoded from the file's own vocab rather than a hardcoded order, so the bit meaning
    // can never drift from what build_facets.py wrote
    xin: (v.xin || []).filter((_t, k) => (o.xin >> k) & 1),
  };
}

/* ---------- chromatin profiles (lazy, sharded by P. trichocarpa chromosome) ---------- */
const _chromShards = new Map();
/** 40 bins x 4 marks around a locus's TSS, or null. Values are HUNDREDTHS of a log ratio,
 *  strand-oriented so bin 0 is always upstream. Sharded because 23,465 loci x 160 numbers has
 *  no business in a gene shard -- same reasoning as the 3D structure buckets. */
export function loadChromatinProfile(potriId) {
  // Mirrors patch_chromatin_profiles.py's shard_key() exactly: a P. trichocarpa scaffold ID
  // (no 3-digit chromosome before the "G", e.g. Potri.T170700) falls back to "other", it is
  // not unprofiled. 29 genes live only under that fallback.
  const m = /^Potri\.(\w{3})G/.exec(potriId || '');
  const k = m ? m[1] : 'other';
  if (!_chromShards.has(k)) _chromShards.set(k, fetchJSON(`data/chromatin/${k}.json`));
  return _chromShards.get(k).then((d) => d[potriId] || null).catch(() => null);
}

/** Members of a tandem array, from the curated union set. */
export const loadArrays = () => fetchJSON('data/index/arrays.json');
/** Per counted tandem array: how it relates to the other haplotype (core/relationship.js). */
export const loadArrayStatus = () => fetchJSON('data/index/array_status.json');

let _arrayOfGene = null;
/** gene id -> curated union array id, reversed from arrays.json once per page load. */
async function arrayIndex() {
  if (!_arrayOfGene) {
    _arrayOfGene = loadArrays().then((arrays) => {
      const m = new Map();
      for (const [aid, members] of Object.entries(arrays)) for (const id of members) m.set(id, aid);
      return { arrays, m };
    });
  }
  return _arrayOfGene;
}

/** The allele a tandem gene reaches THROUGH its array when it has no 1:1 syntelog of its own.
 *  This is CJ's tandem rule (v11 `td_array_associated`, 2026-09-23): a tandem gene is not
 *  hemizygous when another member of its array has a syntelog. Returns null when the gene is
 *  in no array. Otherwise { arrayId, members: [{id, allele}], pairedArrays: [ids on the other
 *  haplotype that hold those alleles], counted } -- `counted` is false for a detected array
 *  the pseudogene screen removed entirely (no member carries dup.td), so a caller can say so
 *  instead of treating it like a counted array. Every value is read off the member records;
 *  nothing is inferred. The partners are the 25,931-pair allele map's, not the newer map's. */
export async function arrayAlleles(gene) {
  const { arrays, m } = await arrayIndex();
  const arrayId = m.get(gene.id);
  if (!arrayId) return null;
  const recs = await Promise.all(arrays[arrayId].map((id) => (id === gene.id ? gene : getGene(id))));
  const members = recs.filter(Boolean).map((r) => ({ id: r.id, allele: r.allele ? r.allele.id : null }));
  const paired = [...new Set(members.filter((x) => x.allele).map((x) => m.get(x.allele)).filter(Boolean))].sort();
  const counted = recs.some((r) => r && r.dup && r.dup.td);
  return { arrayId, members, pairedArrays: paired, counted };
}

// Locus layer. A tile is one megabase of one chromosome: gene positions, strand,
// longest-isoform exon structure, and the few fields the locus card draws. Built by
// scripts/build_locus.py. Self-sufficient on purpose -- a gene page on a phone should
// not also have to pull a chromosome index.
export const loadLocusTile = (hap, chr, mb) => fetchJSON(`data/locus/tile/${hap}/${chr}/${mb}.json`);

/** 100kb-bin whole-genome overview, both haplotypes, one fetch (~112 KB raw). For the
 *  genome map's zoomed-out view. */
export const loadLocusOverview = () => fetchJSON('data/locus/overview.json');

/** Every gene on one chromosome, position and class only (no structure) -- for the
 *  genome map's per-chromosome zoom. Sorted by start already. */
export const loadLocusIndex = (hap, chr) => fetchJSON(`data/locus/index/${hap}/${chr}.json`);

/** The 191-contrast panel, sample labels already resolved to their fixed index in
 *  samples.json / any raw expression vector. One small fetch, loaded once. */
export const loadContrasts = () => fetchJSON('data/expr/contrasts.json');

/** One copy-search locus (scripts/patch_copies.py): every copy of a tandem array on both
 *  haplotypes, found in the genome sequence. `manifest.copies.genes` says which genes have one. */
export const loadCopies = (slug) => fetchJSON(`data/copies/${slug}.json`);
