// Browse / query builder. The cross-module payoff: ask one question across synteny,
// phylostratigraphy, expression and annotation at once, then keep the answer as a gene set.
//
// Filtering runs over data/index/facets.json (274 KB gzipped, one fetch) rather than the gene
// shards -- a filter that had to read 39 MB of shards plus 208 MB of expression buckets would
// not be a filter anyone waits for.
import { CATEGORY, CATEGORY_ORDER } from './relationship.js';
import { el, clear, fmt } from './dom.js';
import { loadFacets, facetRow, loadGeneIndex, loadDescIndex, loadStructure, dataVersion } from './data.js';
import { query, setQuery } from './router.js';
import { onDispose } from './lifecycle.js';
import {
  saveSet, allSets, removeSet, subscribe, exportSets, importSets, storageStatus,
  MAX_GENESET_IMPORT_BYTES,
} from './geneset.js';

const PAGE = 100;

// Each filter is {id, label, kind, options?, test(row, value)}. Kept here rather than
// collected from the modules so that a filter's data source (the facet index) and its
// definition stay in one place -- the module `filters` arrays operate on full gene records
// and are for the gene page, not for this.
// Exported so the home page can count its question links with these EXACT predicates --
// a second implementation would be a second set of numbers, and they would drift.
export const FILTERS = [
  { id: 'hap', label: 'Haplotype', kind: 'select', options: ['hap1', 'hap2'],
    test: (r, v) => r.hap === v },
  { id: 'cls', label: 'Synteny class', kind: 'select',
    options: ['core_syntenic', 'dispensable_syntenic', 'non_syntenic_ortholog',
              'private_no_ortholog', 'tandem_array_member'],
    test: (r, v) => r.cls === v },
  // The final lineage-specific gene set of the dissertation (583 HAP1 / 621 HAP2), and the
  // candidates that were excluded from it. Phylostratum alone is NOT the set.
  { id: 'lsg', label: 'Lineage-specific gene (LSG)', kind: 'select',
    options: ['final_set', 'candidate_excluded', 'not_a_candidate'],
    test: (r, v) => ['not_a_candidate', 'final_set', 'candidate_excluded'][r.lsg] === v },
  // Cross-checks run after the dissertation's analysis, on its candidates only. They never
  // change the set above; a filter on them selects candidates, not a different set.
  { id: 'xage', label: 'Other gene-age methods', kind: 'select',
    options: ['agree', 'search_sensitive', 'disagree'],
    test: (r, v) => r.xa >= 0 && ['agree', 'search_sensitive', 'disagree'][r.xa] === v },
  { id: 'ps_min', label: 'Phylostratum ≥', kind: 'number', placeholder: '18',
    test: (r, v) => r.ps != null && r.ps >= +v },
  // Cross-check against three published tandem callers; never part of the dissertation's set.
  { id: 'xtandem', label: 'Published tandem tools', kind: 'select',
    options: ['all_three', 'some', 'nearby_copy_only', 'none', 'tools_only'],
    test: (r, v) => r.xt >= 0 && ['all_three', 'some', 'nearby_copy_only', 'none', 'tools_only'][r.xt] === v },
  // exact, not >=: a stratum bar on the phylostratigraphy page means THAT stratum
  { id: 'ps', label: 'Phylostratum =', kind: 'number', placeholder: '18',
    test: (r, v) => r.ps === +v },
  { id: 'tau_min', label: 'τ ≥', kind: 'number', placeholder: '0.85', step: '0.05',
    test: (r, v) => r.tau != null && r.tau >= +v },
  { id: 'tok', label: 'Mean TPM ≥ 5 (reference panel)', kind: 'select', options: ['yes', 'no'],
    test: (r, v) => (r.tok ? 'yes' : 'no') === v },
  // Peak-tissue categories are release data, not a UI-owned list. browseView() fills this
  // control from facets.vocab.top so a new or split tissue appears without a source edit.
  { id: 'top', label: 'Peak tissue', kind: 'select',
    test: (r, v) => r.top === v },
  { id: 'chr', label: 'Chromosome', kind: 'select',
    options: Array.from({ length: 19 }, (_, i) => 'Chr' + String(i + 1).padStart(2, '0')).concat('scaffolds'),
    test: (r, v) => r.chr === v },
  { id: 'allele', label: 'Has allele', kind: 'select', options: ['yes', 'no'],
    test: (r, v) => (r.allele ? 'yes' : 'no') === v },
  { id: 'qc', label: 'Flagged by quality control', kind: 'select', options: ['no', 'yes'],
    test: (r, v) => (r.qc ? 'yes' : 'no') === v },
  { id: 'rel', label: 'Relationship to the other haplotype', kind: 'select',
    options: [...CATEGORY_ORDER, 'not_classified'],
    test: (r, v) => (r.rel || 'not_classified') === v },
  { id: 'at', label: 'Has Arabidopsis hit', kind: 'select', options: ['yes', 'no'],
    test: (r, v) => (r.at ? 'yes' : 'no') === v },
  // The CURATED union set (13,048 genes), the same one the Duplication card and the class
  // figures use. GENESPACE's looser tandem placement is the Synteny class filter's
  // `tandem_array_member` option, and the two are not interchangeable.
  { id: 'tandem', label: 'In curated tandem array', kind: 'select', options: ['yes', 'no'],
    test: (r, v) => (r.tandem ? 'yes' : 'no') === v },
  // Events are not exclusive: a gene retained from both aWGT and sWGD matches either choice.
  // ONE call: the adopted one, which the dissertation uses. `wgd` is the same column under the
  // name older links used (until 0.18.0 it was an exploratory re-check); it is not shown in the
  // sidebar, but a saved link with ?wgd= still resolves, to the adopted call.
  { id: 'wgd9', label: 'WGD event', kind: 'select',
    options: ['salicoid', 'gamma', 'both', 'either', 'neither'],
    test: (r, v) => ({ salicoid: (r.wgd9 & 1) > 0, gamma: (r.wgd9 & 2) > 0, both: r.wgd9 === 3,
                       either: r.wgd9 > 0, neither: r.wgd9 === 0 })[v] },
  { id: 'wgd', label: 'WGD event (older links)', kind: 'select',
    options: ['salicoid', 'gamma', 'both', 'either', 'neither'],
    test: (r, v) => ({ salicoid: (r.wgd9 & 1) > 0, gamma: (r.wgd9 & 2) > 0, both: r.wgd9 === 3,
                       either: r.wgd9 > 0, neither: r.wgd9 === 0 })[v] },
  // The full class code, one per gene (A, AD, ADS, ADST, ADT, C, D, DS, DST, DT, S, T).
  { id: 'dup', label: 'Duplication class code', kind: 'select',
    options: ['DS', 'D', 'DT', 'C', 'ADS', 'AD', 'DST', 'ADT', 'ADST', 'T', 'A', 'S'],
    test: (r, v) => r.dup === v },
  // Exploratory (route C). A gamma copy number is a rank WITHIN one ancestral chromosome, so the
  // choice is a chromosome or one chromosome's copy; a bare "gamma copy 2" across all seven would
  // pool unrelated copies. "not placed" includes the HAP1 unplaced-scaffold genes, never assessed.
  { id: 'aek', label: 'Ancestral chromosome (exploratory)', kind: 'select',
    options: [1, 2, 3, 4, 5, 6, 7].flatMap((c) => [`AEK${c}`,
      ...[1, 2, 3].flatMap((k) => [`AEK${c}_gamma_copy_${k}`,
        ...[1, 2].map((t) => `AEK${c}_gamma_copy_${k}_salicoid_copy_${t}`)])]).concat('not_placed'),
    test: (r, v) => {
      if (v === 'not_placed') return r.aek < 0;
      // salicoid copy added so every cell of the #/karyotype grid is a real, shareable query
      const m = /^AEK([1-7])(?:_gamma_copy_([1-3])(?:_salicoid_copy_([12]))?)?$/.exec(v);
      return !!m && r.aek >= 0 && Math.floor(r.aek / 100) === +m[1]
        && (!m[2] || Math.floor(r.aek / 10) % 10 === +m[2])
        && (!m[3] || r.aek % 10 === +m[3]);
    } },
  // w is stored as an integer per-mille. -1 means no reciprocal-best P. trichocarpa ortholog
  // and -2 means a pair exists but omega could not be estimated; both are real states, so a
  // threshold filter must exclude them rather than treat them as 0.
  { id: 'w_min', label: 'ω ≥', kind: 'number', placeholder: '1.0', step: '0.1',
    test: (r, v) => r.w >= 0 && r.w / 1000 >= +v },
  { id: 'w_max', label: 'ω ≤', kind: 'number', placeholder: '0.1', step: '0.1',
    test: (r, v) => r.w >= 0 && r.w / 1000 <= +v },
  { id: 'ms', label: 'Peptide match', kind: 'select', options: ['yes', 'no'],
    test: (r, v) => (r.ms > 0 ? 'yes' : 'no') === v },
  // The threshold is in the label on purpose: "expressed" is not an absolute property, and a
  // filter that hides its cutoff invites reading it as one.
  { id: 'xin', label: 'Expressed in (>1 TPM)', kind: 'select',
    options: ['leaf_young', 'leaf', 'leaf_old', 'xylem', 'bark', 'root', 'stem', 'bud',
              'catkin', 'callus'],
    test: (r, v) => r.xin.includes(v) },
];


// Where each filter sits in the sidebar, and the one-line hint shown under its label. Kept
// beside FILTERS rather than inside it so the predicates above stay exactly what the home page
// counts with. `adv` filters live in the folded "Disputed and exploratory" group, which opens by
// itself when a deep link sets one of them.
// Display names for option values. The values themselves stay as they are, because they are
// URL parameters and saved links depend on them; only the label follows the dissertation's
// names for the two whole-genome events (aWGT, sWGD).
const OPTION_LABEL = { search_sensitive: 'search-sensitive', all_three: 'all three call it tandem', some: 'one or two call it tandem',
  nearby_copy_only: 'a nearby copy only (proximal)', none: 'none calls it tandem or nearby', tools_only: 'tools tandem, not in the dissertation\u2019s set', salicoid: 'sWGD', gamma: 'aWGT', aWGD_era: 'aWGT era', not_classified: 'not classified (quality-flagged)',
  final_set: 'in the final LSG set', candidate_excluded: 'candidate, excluded from the final set', not_a_candidate: 'not a candidate',
  C: 'C (singleton)', D: 'D (dispersed only)',
  ...Object.fromEntries(Object.entries(CATEGORY).map(([k, c]) => [k, c.name])) };
const optLabel = (v) => OPTION_LABEL[v]
  || String(v).replace(/gamma_copy/g, 'aWGT_copy').replace(/salicoid_copy/g, 'sWGD_copy').replace(/_/g, ' ');

export const FILTER_GROUPS = [
  { id: 'where', label: 'Genome', ids: ['hap', 'chr', 'allele', 'rel', 'qc'] },
  { id: 'age', label: 'Age and conservation', ids: ['lsg', 'xage', 'ps_min', 'cls'] },
  { id: 'dup', label: 'Duplication', ids: ['tandem', 'xtandem', 'wgd9', 'dup'] },
  { id: 'expr', label: 'Expression', ids: ['top', 'tau_min', 'tok', 'xin'] },
  { id: 'func', label: 'Function and protein', ids: ['at', 'ms'] },
  { id: 'sel', label: 'Selection against P. trichocarpa', ids: ['w_min', 'w_max'] },
  { id: 'adv', label: 'More filters', ids: ['ps', 'aek', 'wgd'], adv: true },
];
const HINTS = {
  hap: 'HAP1 is the tremula haplotype, HAP2 alba',
  cls: 'GENESPACE class across the 12-genome panel, which lacks P. alba',
  lsg: 'the dissertation\u2019s final set, 583 HAP1 / 621 HAP2, out of 776 / 835 candidates',
  xage: 'cross-checks on candidates, run after the dissertation\u2019s analysis; they never change its set',
  xtandem: 'DupGen_finder, MCScanX and doubletrouble on the same annotation; a cross-check, not part of the dissertation\u2019s tandem set',
  qc: 'gene models set aside as pseudogene-like or degenerate; choose "no" to match the dissertation\u2019s counts',
  dup: 'S sWGD, A aWGT, T tandem, D dispersed, C singleton',
  tok: 'the dissertation counts tissue-specific genes among these only',
  ps_min: '18 and 19 are the lineage-specific candidate strata; PS19 genes reassigned to PS18 count as 18',
  ps: 'one stratum exactly',
  tau_min: 'tissue specificity as in the dissertation: 222-sample reference panel, 9 tissue groups; 0.85 is its cutoff',
  top: 'tissue group with the highest mean TPM in the reference panel',
  xin: 'a different statistic: median above 1 TPM over the wild-type control samples of that tissue',
  allele: 'a syntenic partner on the other haplotype',
  rel: 'counted per gene; tandem genes take their array\u2019s category',
  at: 'a best hit in Arabidopsis',
  tandem: 'the curated union set, 13,048 genes',
  wgd: 'the same call as "WGD event" above, kept for links made before version 0.18',
  wgd9: 'retained from a whole-genome duplication (the adopted call: Ks and karyotype topology)',
  aek: 'ancestral eudicot chromosome and copy',
  w_min: 'Ka/Ks to the reciprocal-best ortholog',
  w_max: 'Ka/Ks to the reciprocal-best ortholog',
  ms: 'a matching peptide in any of 5 public datasets, often shared or cross-species',
};
// Fast value extraction for the per-option counts; a filter absent here shows no counts.
const KEYS = {
  hap: (r) => [r.hap], cls: (r) => [r.cls], top: (r) => [r.top], chr: (r) => [r.chr],
  allele: (r) => [r.allele ? 'yes' : 'no'], at: (r) => [r.at ? 'yes' : 'no'],
  tandem: (r) => [r.tandem ? 'yes' : 'no'], ms: (r) => [r.ms > 0 ? 'yes' : 'no'],
  xin: (r) => r.xin, qc: (r) => [r.qc ? 'yes' : 'no'], tok: (r) => [r.tok ? 'yes' : 'no'], dup: (r) => [r.dup],
  lsg: (r) => [['not_a_candidate', 'final_set', 'candidate_excluded'][r.lsg]],
  xage: (r) => (r.xa >= 0 ? [['agree', 'search_sensitive', 'disagree'][r.xa]] : []),
  xtandem: (r) => (r.xt >= 0 ? [['all_three', 'some', 'nearby_copy_only', 'none', 'tools_only'][r.xt]] : []),
  wgd: (r) => wgdKeys(r.wgd), wgd9: (r) => wgdKeys(r.wgd9), rel: (r) => [r.rel || 'not_classified'],
};
function wgdKeys(w) {
  const k = [];
  if (w & 1) k.push('salicoid');
  if (w & 2) k.push('gamma');
  if (w === 3) k.push('both');
  k.push(w > 0 ? 'either' : 'neither');
  return k;
}

function filterOptions(filter, facets) {
  const values = filter.id === 'top' ? facets.vocab?.top : filter.options;
  // Preserve the vocabulary's data order: it is the release's declared category order.
  return [...new Set(Array.isArray(values) ? values : [])];
}

function valuesFromQuery(options) {
  const values = {};
  const params = query();
  for (const filter of FILTERS) {
    const value = params[filter.id];
    if (value == null || value === '') continue;
    if (filter.kind === 'select') {
      if (options.get(filter.id)?.includes(value)) values[filter.id] = value;
    } else if (Number.isFinite(Number(value))) {
      values[filter.id] = value;
    }
  }
  return values;
}

function applyFilters(state, navigation) {
  // A stale Browse request must not replace the query string for a newer route while its
  // facets fetch finishes in the background.
  if (navigation && !navigation.isCurrent()) return false;
  const active = FILTERS.filter((f) => state.values[f.id] !== undefined
    && state.values[f.id] !== '' && state.values[f.id] !== null);
  // Record the active filters in the URL so the view is shareable. setQuery uses
  // replaceState, so this does NOT re-enter the router and rebuild the page.
  try {
    setQuery(Object.fromEntries(active.map((f) => [f.id, state.values[f.id]])));
  } catch { /* URL bookkeeping is cosmetic; never let it break filtering */ }
  const out = [];
  for (let i = 0; i < state.rows.length; i++) {
    if (state.idset && !state.idset.has(i)) continue;
    const r = state.rows[i];
    let ok = true;
    for (const f of active) {
      if (!f.test(r, state.values[f.id])) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  state.matches = out;
  state.page = 0;
  return true;
}

// Sortable columns. `key` is what a click sorts by; nulls always sink to the bottom whichever
// way the column runs, because "no ortholog" is not the smallest omega.
const COLUMNS = [
  { id: 'gene', label: 'Gene', key: (r, i) => i },
  { id: 'desc', label: 'Description', key: null },
  { id: 'chr', label: 'Chr', key: (r) => r.chr },
  { id: 'dup', label: 'Class', key: (r) => r.dup, title: 'duplication class code: S sWGD, A aWGT, T tandem, D dispersed, C singleton' },
  { id: 'cls', label: 'Synteny class', key: (r) => r.cls },
  { id: 'ps', label: 'PS', num: true, key: (r) => r.ps, title: 'phylostratum as used in the dissertation (genEra rank; PS19 genes reassigned to PS18 count as 18)' },
  { id: 'tau', label: '\u03c4', num: true, greek: true, key: (r) => r.tau, title: 'tissue specificity as in the dissertation (222-sample reference panel, 9 tissue groups)' },
  { id: 'top', label: 'Peak tissue', key: (r) => r.top },
  { id: 'npres', label: 'Genomes', num: true, key: (r) => r.npres || null,
    title: 'genomes in the orthogroup, of 12 (the panel lacks P. alba)' },
  { id: 'w', label: '\u03c9', num: true, greek: true, key: (r) => (r.w >= 0 ? r.w : null),
    title: 'Ka/Ks against the best P. trichocarpa ortholog' },
  { id: 'ms', label: 'MS', num: true, key: (r) => (r.ms > 0 ? r.ms : null),
    title: 'mass-spec datasets with a matching peptide, of 5; most such peptides are shared with other genes or species' },
];

function sortMatches(state) {
  const col = COLUMNS.find((c) => c.id === state.sort.col);
  if (!col || !col.key) return;
  const dir = state.sort.dir;
  const k = state.matches.map((i) => [i, col.key(state.rows[i], i)]);
  k.sort((x, y) => {
    const a = x[1]; const b = y[1];
    if (a == null && b == null) return x[0] - y[0];
    if (a == null) return 1;
    if (b == null) return -1;
    if (a < b) return -dir;
    if (a > b) return dir;
    return x[0] - y[0];
  });
  state.matches = k.map((x) => x[0]);
}

function resultsTable(state, onSort) {
  const start = state.page * PAGE;
  const slice = state.matches.slice(start, start + PAGE);
  const body = slice.map((i) => {
    const r = state.rows[i];
    const d = state.desc ? state.desc[i] : '';
    return el('tr', {},
      el('td', {}, el('a', { href: `#/gene/${state.ids[i]}`, class: 'mono' }, state.ids[i])),
      el('td', { class: 'bz-desc', title: d || '' }, d ? d.toLowerCase() : el('span', { class: 'muted' }, '\u2013')),
      el('td', {}, r.chr || '\u2013'),
      el('td', { class: 'mono' }, r.dup || '\u2013'),
      el('td', {}, r.cls ? r.cls.replace(/_/g, ' ') : '\u2013'),
      el('td', { class: 'num' }, r.ps == null ? '\u2013' : 'PS' + r.ps),
      el('td', { class: 'num' }, r.tau == null ? '\u2013' : r.tau.toFixed(2)),
      el('td', {}, r.top || '\u2013'),
      el('td', { class: 'num' }, r.npres === 0
        ? el('span', { class: 'muted', title: 'OrthoFinder assigned no orthogroup' }, 'none')
        : r.npres + '/12'),
      el('td', { class: 'num' }, r.w >= 0
        ? (r.w / 1000).toFixed(3)
        : el('span', { class: 'muted',
            title: r.w === -1 ? 'no reciprocal-best P. trichocarpa ortholog'
                              : 'ortholog found, but omega could not be estimated' },
            r.w === -1 ? 'no ortholog' : 'n/e')),
      el('td', { class: 'num' }, r.ms > 0
        ? `${r.ms}/5`
        : el('span', { class: 'muted' }, '\u2013')));
  });
  const head = COLUMNS.map((c) => {
    const on = state.sort.col === c.id;
    const arrow = on ? (state.sort.dir > 0 ? ' \u2191' : ' \u2193') : '';
    const cls = [c.num ? 'num' : '', c.key ? 'sortable' : '', on ? 'on' : '', c.greek ? 'greek' : ''].join(' ').trim();
    return el('th', { class: cls || null, title: c.title || null, scope: 'col',
      'aria-sort': on ? (state.sort.dir > 0 ? 'ascending' : 'descending') : null },
      c.key ? el('button', { type: 'button', class: 'bz-sort', onclick: () => onSort(c.id) }, c.label + arrow)
        : c.label);
  });
  return el('div', { class: 'scroll-x bz-tablewrap' }, el('table', { class: 'data compare bz-table' },
    el('thead', {}, el('tr', {}, ...head)),
    el('tbody', {}, ...body)));
}

function download(name, text, type = 'text/tab-separated-values;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser a task to start the download before releasing its blob URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFileStem(name) {
  const stem = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return stem || '717atlas_gene_set';
}

function exportTSV(state) {
  // Columns carry the adopted calls only, under the names the pages use. The first lines are
  // comments (#) stating the release, so a file found later can be traced to its version.
  const head = ['gene_id', 'haplotype', 'chr', 'description', 'duplication_class_code', 'sWGD', 'aWGT',
                'in_tandem_array', 'relationship_category', 'has_allele', 'quality_flagged',
                'phylostratum_used', 'phylostratum_genEra', 'LSG_status', 'other_gene_age_methods',
                'tau_reference_panel', 'peak_tissue_reference_panel', 'mean_TPM_ge_5_reference_panel',
                'synteny_class_GENESPACE', 'genomes_in_orthogroup', 'omega_vs_ptrichocarpa',
                'ms_datasets_detected_of_5', 'ancestral_chromosome', 'aWGT_copy', 'sWGD_copy'];
  const lines = [
    `# Poplar 717 gene atlas, data v${dataVersion()}, exported ${new Date().toISOString().slice(0, 10)}`,
    '# sWGD / aWGT: the adopted whole-genome duplication call (anchor-pair Ks and karyotype topology), as in the dissertation',
    '# tau and peak tissue: mean TPM in 9 tissue groups of the 222-sample reference panel; empty where no group mean reaches 5 TPM',
    '# The dissertation counts quality-filtered genes only: keep quality_flagged = no to reproduce its numbers',
    '# other_gene_age_methods: independent cross-checks on candidates, run after the dissertation’s analysis; never part of its call',
    head.join('\t')];
  const LSG = ['not_a_candidate', 'final_set', 'candidate_excluded'];
  for (const i of state.matches) {
    const r = state.rows[i];
    // named states rather than blanks: "not placed" and "no copy assigned" are results
    const copy = (d) => (r.aek < 0 ? '' : (d || 'not_assigned'));
    const d = state.desc ? (state.desc[i] || '').replace(/[\t\n]/g, ' ') : '';
    lines.push([state.ids[i], r.hap.toUpperCase(), r.chr ?? '', d, r.dup ?? '',
      r.wgd9 & 1 ? 'yes' : 'no', r.wgd9 & 2 ? 'yes' : 'no', r.tandem ? 'yes' : 'no',
      r.rel ? (CATEGORY[r.rel] ? CATEGORY[r.rel].name : r.rel) : 'not classified (quality-flagged)',
      r.allele ? 'yes' : 'no', r.qc ? 'yes' : 'no',
      r.ps ?? '', r.psg ?? '', LSG[r.lsg], r.xa >= 0 ? ['agree', 'search_sensitive', 'disagree'][r.xa] : '',
      r.tau == null ? '' : r.tau.toFixed(3), r.top ?? '', r.tok ? 'yes' : 'no',
      r.cls ?? '', r.npres ?? '',
      // an empty cell would read as "not measured"; these are measured absences
      r.w >= 0 ? (r.w / 1000).toFixed(4) : (r.w === -1 ? 'no_ortholog' : 'not_estimable'),
      r.ms >= 0 ? r.ms : '',
      r.aek >= 0 ? `AEK${Math.floor(r.aek / 100)}` : 'not_placed',
      copy(Math.floor(r.aek / 10) % 10), copy(r.aek % 10)].join('\t'));
  }
  download(`717atlas_v${dataVersion()}_selection_${state.matches.length}genes.tsv`, lines.join('\n') + '\n');
}

/** Build a Browse URL with filters pre-applied, for an overview chart to link to.
 *  Exported so a module can say "these genes" without knowing how Browse stores state. */
export function browseHref(params) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return '#/browse' + (qs ? '?' + qs : '');
}

export async function browseView(navigation) {
  // State belongs to one rendered Browse view. A module-level singleton made a stale URL
  // retain filters from a previous visit and let overlapping loads rewrite each other's state.
  const state = { values: {}, page: 0, rows: null, ids: null, desc: null, matches: [],
    sort: { col: 'gene', dir: 1 } };
  const root = el('div', { class: 'bz' },
    el('div', { class: 'page-head' },
      el('div', { class: 'kicker' }, 'Query builder'),
      el('h1', {}, 'Browse'),
      el('p', { class: 'sub' },
        'Filter all 63,960 genes across every layer at once, then export the selection or keep '
        + 'it as a named set. Each option shows how many genes it would leave.')));
  navigation?.track?.(root);

  const summary = el('div', { class: 'stat-row bz-count' });
  const tableHolder = el('div', {});
  const pager = el('div', { class: 'bz-pager' });
  const setsHolder = el('div', {});
  const savedSetStatus = el('p', {
    class: 'muted', role: 'status', 'aria-live': 'polite',
    style: 'min-height:18px;margin:8px 0 0;font-size:12px',
  });

  const onSort = (col) => {
    if (state.sort.col === col) state.sort.dir = -state.sort.dir;
    else state.sort = { col, dir: 1 };
    sortMatches(state);
    state.page = 0;
    render();
  };

  // Per-option counts: for filter f, count rows that pass every OTHER active filter. One pass
  // over the rows: a row failing no filter counts for every f, a row failing exactly one
  // filter counts only for that one, anything else counts for nothing.
  const drawCounts = () => {
    const active = FILTERS.filter((f) => state.values[f.id] !== undefined && state.values[f.id] !== '');
    const counted = FILTERS.filter((f) => KEYS[f.id] && inputs.has(f.id));
    const tally = new Map(counted.map((f) => [f.id, new Map()]));
    const add = (f, r) => {
      const t = tally.get(f.id);
      for (const k of KEYS[f.id](r)) t.set(k, (t.get(k) || 0) + 1);
    };
    const totals = new Map(counted.map((f) => [f.id, 0]));
    for (let ri = 0; ri < state.rows.length; ri++) {
      if (state.idset && !state.idset.has(ri)) continue;
      const r = state.rows[ri];
      let failed = null; let nfail = 0;
      for (const f of active) {
        if (!f.test(r, state.values[f.id])) { failed = f; if (++nfail > 1) break; }
      }
      if (nfail === 0) { for (const f of counted) { add(f, r); totals.set(f.id, totals.get(f.id) + 1); } }
      else if (nfail === 1 && tally.has(failed.id)) { add(failed, r); totals.set(failed.id, totals.get(failed.id) + 1); }
    }
    for (const f of counted) {
      const t = tally.get(f.id);
      const sel = inputs.get(f.id);
      for (const o of sel.options) {
        const base = o.dataset.label ?? (o.dataset.label = o.textContent);
        const n = o.value === '' ? totals.get(f.id) : (t.get(o.value) || 0);
        o.textContent = `${base}  (${fmt(n)})`;
        o.disabled = n === 0 && o.value !== '' && o.value !== sel.value;
      }
    }
  };

  const render = () => {
    if (navigation && !navigation.isCurrent()) return;
    drawChips();
    drawCounts();
    for (const g of groupNodes) {
      const n = g.ids.filter((id) => state.values[id] !== undefined && state.values[id] !== '').length;
      g.badge.textContent = n ? String(n) : '';
      if (n) g.node.open = true;
    }
    const nActive = Object.keys(state.values).length;
    sideToggle.textContent = nActive ? `Filters (${nActive} active)` : 'Filters';
    clear(summary).append(
      el('div', { class: 'stat' },
        el('div', { class: 'n' }, fmt(state.matches.length)),
        el('div', { class: 'l' }, `of ${fmt(state.rows.length)} genes match`)));
    clear(tableHolder).append(state.matches.length ? resultsTable(state, onSort)
      : el('p', { class: 'muted', style: 'padding:14px 0' }, 'No gene matches every filter.'));
    const pages = Math.ceil(state.matches.length / PAGE);
    clear(pager);
    if (pages > 1) {
      const btn = (label, to, on) => el('button', {
        type: 'button', class: 'btn', disabled: on ? null : 'disabled',
        onclick: () => { state.page = to; render(); tableHolder.scrollIntoView({ block: 'nearest' }); },
      }, label);
      pager.append(
        btn('← Prev', state.page - 1, state.page > 0),
        el('span', { class: 'muted', style: 'font-size:12.5px' },
          `${fmt(state.page * PAGE + 1)}–${fmt(Math.min((state.page + 1) * PAGE, state.matches.length))} of ${fmt(state.matches.length)}`),
        btn('Next →', state.page + 1, state.page < pages - 1));
    }
  };

  const inputs = new Map();
  const byId = new Map(FILTERS.map((f) => [f.id, f]));
  const onchangeFor = (f) => (e) => {
    const v = e.target.value;
    if (v === '') delete state.values[f.id]; else state.values[f.id] = v;
    if (!applyFilters(state, navigation)) return;
    sortMatches(state);
    render();
  };
  const makeInput = (f) => {
    const input = f.kind === 'select'
      ? el('select', { onchange: onchangeFor(f) },
          el('option', { value: '' }, 'any'),
          ...((f.id === 'top' ? [] : f.options) || [])
            .map((o) => el('option', { value: o }, optLabel(o))))
      : el('input', { type: 'number', step: f.step || '1', placeholder: f.placeholder || '',
          inputmode: 'decimal', oninput: onchangeFor(f) });
    inputs.set(f.id, input);
    // The label's FIRST text node is the filter's name: check.mjs finds controls by it.
    return el('label', { class: 'bz-field', 'data-filter': f.id },
      f.label,
      input,
      HINTS[f.id] ? el('span', { class: 'bz-hint' }, HINTS[f.id]) : null);
  };
  const groupNodes = [];
  const controls = el('div', { class: 'bz-groups' });
  // A pasted list of gene IDs, the "bulk lookup" every genome portal has. It narrows the table
  // like any other filter but is NOT written to the URL: a list of hundreds of IDs does not
  // belong in a link. Unknown IDs are reported by name rather than silently dropped.
  const idBox = el('textarea', { rows: '4', spellcheck: 'false', 'aria-label': 'Gene IDs, one per line',
    placeholder: 'PtXaTreH.05G120200\nPtXaAlbH.05G122300' });
  const idNote = el('span', { class: 'bz-hint', role: 'status', 'aria-live': 'polite' },
    'paste IDs separated by spaces, commas or lines');
  const applyIds = () => {
    const toks = [...new Set(idBox.value.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean))];
    if (!toks.length) {
      state.idset = null;
      idNote.textContent = 'paste IDs separated by spaces, commas or lines';
    } else {
      const found = new Set(); const missing = [];
      for (const t of toks) {
        const i = state.idIndex.get(t) ?? state.idIndex.get(t.replace(/\.\d+$/, ''));
        if (i == null) missing.push(t); else found.add(i);
      }
      state.idset = found;
      idNote.textContent = `${fmt(found.size)} of ${fmt(toks.length)} IDs found`
        + (missing.length ? `; not in this release: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}` : '');
    }
    if (!applyFilters(state, navigation)) return;
    sortMatches(state);
    render();
  };
  const idGroup = el('details', { class: 'bz-group', 'data-group': 'ids' },
    el('summary', {}, el('span', {}, 'Gene list'), el('span', { class: 'bz-badge' })),
    el('label', { class: 'bz-field', 'data-filter': 'ids' }, 'Paste gene IDs', idBox, idNote),
    el('div', { class: 'bz-field' },
      el('button', { type: 'button', class: 'btn', onclick: applyIds }, 'Apply list'), ' ',
      el('button', { type: 'button', class: 'btn ghost', onclick: () => { idBox.value = ''; applyIds(); } }, 'Clear')));
  controls.append(idGroup);
  for (const g of FILTER_GROUPS) {
    const badge = el('span', { class: 'bz-badge' });
    const node = el('details', { class: 'bz-group' + (g.adv ? ' adv' : ''), open: g.adv ? null : 'open' },
      el('summary', {}, el('span', {}, g.label), badge),
      ...g.ids.map((id) => makeInput(byId.get(id))));
    groupNodes.push({ node, badge, ids: g.ids });
    controls.append(node);
  }
  // Any filter a later edit adds to FILTERS but forgets to place still appears, in its own group.
  const unplaced = FILTERS.filter((f) => !inputs.has(f.id));
  if (unplaced.length) controls.append(el('details', { class: 'bz-group', open: 'open' },
    el('summary', {}, 'Other'), ...unplaced.map(makeInput)));
  const sideToggle = el('summary', { class: 'bz-sidetoggle' }, 'Filters');

  /** Active filters as removable chips. Without these, what is being filtered lives only in
   *  a grid of 15 inputs and a reader arriving from a chart link (or a pasted URL) cannot see
   *  why the count is 902 instead of 63,960. Removing a chip has to clear the widget too, not
   *  just the state, or the two disagree. */
  const chipRow = el('div', { class: 'bz-chips' });
  const drawChips = () => {
    clear(chipRow);
    const active = FILTERS.filter((f) => state.values[f.id] !== undefined
      && state.values[f.id] !== '' && state.values[f.id] !== null);
    if (state.idset) {
      chipRow.append(el('button', { class: 'chip', type: 'button', title: 'Remove the gene list',
        onclick: () => { idBox.value = ''; applyIds(); } }, `Gene list: ${fmt(state.idset.size)} IDs  \u00d7`));
    }
    if (!active.length) return;
    for (const f of active) {
      const chip = el('button', {
        class: 'chip', type: 'button',
        title: 'Remove this filter',
        onclick: () => {
          delete state.values[f.id];
          const w = inputs.get(f.id);
          if (w) w.value = '';
          if (!applyFilters(state, navigation)) return;
          render();
        },
      }, `${f.label} ${optLabel(state.values[f.id])}  \u00d7`);
      chipRow.append(chip);
    }
    chipRow.append(el('button', {
      class: 'chip clear', type: 'button',
      onclick: () => {
        for (const f of FILTERS) {
          delete state.values[f.id];
          const w = inputs.get(f.id);
          if (w) w.value = '';
        }
        if (!applyFilters(state, navigation)) return;
        render();
      },
    }, `Clear all ${active.length}`));
  };

  // Filled after facets load; saved filters are accepted only if this release still exposes
  // their select value. That lets a JSON export survive a release vocabulary change without
  // inventing a query the current data cannot answer.
  let options = new Map();
  const setSavedSetStatus = (message) => clear(savedSetStatus).append(message);
  const savedFilterMeta = (set) => {
    const filters = set.meta && typeof set.meta.filters === 'object' && !Array.isArray(set.meta.filters)
      ? set.meta.filters : null;
    const details = [];
    if (typeof set.meta?.data_version === 'string' && set.meta.data_version) {
      details.push(`data ${set.meta.data_version}`);
    }
    if (filters) {
      const count = Object.keys(filters).length;
      details.push(`${count} saved filter${count === 1 ? '' : 's'}`);
    }
    return { filters, detail: details.join(' · ') };
  };

  const restoreFilters = (set) => {
    const { filters } = savedFilterMeta(set);
    if (!filters) {
      setSavedSetStatus(`“${set.name}” has gene IDs but no saved filters.`);
      return;
    }
    const restored = {};
    for (const filter of FILTERS) {
      const value = filters[filter.id];
      if (value == null || value === '') continue;
      if (filter.kind === 'select') {
        const option = String(value);
        if (options.get(filter.id)?.includes(option)) restored[filter.id] = option;
      } else if ((typeof value === 'string' || typeof value === 'number')
          && Number.isFinite(Number(value))) {
        restored[filter.id] = String(value);
      }
    }
    state.values = restored;
    for (const filter of FILTERS) {
      const input = inputs.get(filter.id);
      if (input) input.value = restored[filter.id] || '';
    }
    if (!applyFilters(state, navigation)) return;
    sortMatches(state);
    render();
    const count = Object.keys(restored).length;
    setSavedSetStatus(`Restored ${count} filter${count === 1 ? '' : 's'} from “${set.name}”.`);
  };

  const renderSets = () => {
    clear(setsHolder);
    const sets = allSets();
    const persistence = storageStatus();
    setsHolder.append(el('p', { class: 'muted', style: 'margin:0 0 8px;font-size:12.5px' },
      persistence.persistent
        ? 'Saved sets persist in this browser. Download JSON to move them or keep a copy.'
        : persistence.message));
    if (!sets.length) {
      setsHolder.append(el('p', { class: 'muted', style: 'margin:0;font-size:12.5px' },
        'No saved sets yet. Save a filtered selection, or import a versioned JSON export.'));
      return;
    }
    const rows = sets.map((set) => {
      const meta = savedFilterMeta(set);
      return el('tr', {},
        el('td', {},
          el('div', {}, set.name),
          meta.detail ? el('div', { class: 'muted', style: 'font-size:11.5px' }, meta.detail) : null),
        el('td', { class: 'num' }, fmt(set.ids.length)),
        el('td', { style: 'white-space:nowrap' },
          el('button', {
            type: 'button',
            onclick: () => download(`${safeFileStem(set.name)}.tsv`, ['gene_id', ...set.ids].join('\n')),
            style: 'font-size:11.5px;padding:3px 7px;margin-right:5px',
            'aria-label': `Export ${set.name} as TSV`,
          }, 'TSV'),
          meta.filters ? el('button', {
            type: 'button', onclick: () => restoreFilters(set),
            style: 'font-size:11.5px;padding:3px 7px;margin-right:5px',
            'aria-label': `Restore filters from ${set.name}`,
          }, 'Filters') : null,
          el('button', {
            type: 'button',
            onclick: () => {
              removeSet(set.name);
              renderSets();
              setSavedSetStatus(`Removed “${set.name}”.`);
            },
            style: 'font-size:11.5px;padding:3px 7px',
            'aria-label': `Remove ${set.name}`,
          }, 'Remove')));
    });
    setsHolder.append(
      el('div', { class: 'scroll-x' },
        el('table', { class: 'data' },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Set'),
            el('th', { scope: 'col', class: 'num' }, 'Genes'),
            el('th', { scope: 'col' }, 'Actions'))),
          el('tbody', {}, ...rows))));
  };

  // Keep an open Browse view current when another atlas tab imports, saves, or removes a set.
  // onDispose prevents a detached route from keeping a live store listener.
  const unsubscribeSets = subscribe(() => {
    if (!navigation || navigation.isCurrent()) renderSets();
  });
  onDispose(root, unsubscribeSets);

  // Protein FASTA for the current selection, from the structure buckets (ESMFold input
  // sequences, 40,685 genes). Capped: each bucket is a separate fetch, and a whole-genome click
  // should not pull most of 94 MB. Genes without a model are listed in the file's last line.
  const actStatus = el('p', { class: 'muted bz-actstatus', role: 'status', 'aria-live': 'polite', 'data-browse-action-status': '' });
  const FASTA_MAX = 300;
  const faBtn = el('button', { type: 'button', class: 'btn', 'data-browse-fasta': '' }, 'Protein FASTA');
  faBtn.addEventListener('click', async () => {
    const ids = state.matches.map((i) => state.ids[i]);
    if (ids.length > FASTA_MAX) {
      actStatus.textContent = (`Protein FASTA is limited to ${FASTA_MAX} genes; this selection has ${fmt(ids.length)}. Narrow the filters or paste a gene list.`);
      return;
    }
    faBtn.disabled = true;
    const out = []; const missing = [];
    let done = 0;
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const s = await loadStructure(id);
          if (s && s.seq) out.push([id, s.seq]); else missing.push(id);
        } catch { missing.push(id); }
        done += 1;
        faBtn.textContent = `Fetching ${done}/${ids.length}…`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const order = new Map(ids.map((id, i) => [id, i]));
    out.sort((a, b) => order.get(a[0]) - order.get(b[0]));
    const text = out.map(([id, seq]) => `>${id} len=${seq.length} source=ESMFold input sequence, 717 atlas v${dataVersion()}\n`
      + seq.replace(/(.{60})/g, '$1\n').replace(/\n$/, '')).join('\n') + '\n'
      + (missing.length ? `; no protein model for ${missing.length} gene(s): ${missing.join(' ')}\n` : '');
    download(`717atlas_selection_${out.length}proteins.faa`, text, 'text/plain;charset=utf-8');
    actStatus.textContent = (`Downloaded ${fmt(out.length)} protein sequences`
      + (missing.length ? `; ${fmt(missing.length)} gene(s) have no model and are listed at the end of the file.` : '.'));
    faBtn.textContent = 'Protein FASTA';
    faBtn.disabled = false;
  });

  const actions = el('div', { class: 'bz-actions' },
    el('button', {
      type: 'button',
      class: 'btn primary',
      onclick: () => exportTSV(state),
    }, 'Export TSV'),
    el('button', {
      type: 'button',
      onclick: () => {
        try {
          const active = Object.entries(state.values).map(([k, v]) => `${k}=${v}`).join(' ');
          const name = active || 'all genes';
          const set = saveSet(name, state.matches.map((i) => state.ids[i]), {
            filters: { ...state.values }, data_version: dataVersion(), source: 'Browse',
          });
          renderSets();
          const persistence = storageStatus();
          setSavedSetStatus(`Saved “${set.name}” (${fmt(set.ids.length)} genes). ${persistence.message}`);
        } catch (error) {
          setSavedSetStatus(error?.message || 'Could not save this gene set.');
        }
      },
      class: 'btn',
    }, 'Save as set'),
    faBtn,
    el('button', {
      type: 'button',
      onclick: () => {
        state.values = {};
        controls.querySelectorAll('select,input').forEach((n) => { n.value = ''; });
        if (!applyFilters(state, navigation)) return;
        sortMatches(state);
        render();
      },
      class: 'btn ghost',
    }, 'Reset'));

  const importInput = el('input', {
    id: 'saved-sets-import', type: 'file', accept: 'application/json,.json', tabindex: '-1',
    'aria-hidden': 'true',
    style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap',
    onchange: async (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > MAX_GENESET_IMPORT_BYTES) {
          throw new Error(`This file is larger than the ${MAX_GENESET_IMPORT_BYTES.toLocaleString('en-US')}-byte saved-set import limit.`);
        }
        const text = await file.text();
        if (navigation && !navigation.isCurrent()) return;
        const report = importSets(JSON.parse(text));
        renderSets();
        const replacement = report.replaced ? ` Updated ${report.replaced} matching name${report.replaced === 1 ? '' : 's'}.` : '';
        setSavedSetStatus(`Imported ${report.imported} saved set${report.imported === 1 ? '' : 's'}.${replacement} ${storageStatus().message}`);
      } catch (error) {
        if (!navigation || navigation.isCurrent()) {
          setSavedSetStatus(error?.message || 'Could not import saved sets from that file.');
        }
      } finally {
        input.value = '';
      }
    },
  });
  const savedSetActions = el('div', {
    style: 'display:flex;gap:9px;flex-wrap:wrap;margin:10px 0 0', 'aria-label': 'Saved set import and export',
  },
  el('button', {
    type: 'button',
    onclick: () => {
      download('717atlas_saved_sets.json', `${JSON.stringify(exportSets({ data_version: dataVersion() }), null, 2)}\n`,
        'application/json;charset=utf-8');
      setSavedSetStatus(`Downloaded ${allSets().length} saved set${allSets().length === 1 ? '' : 's'} as JSON.`);
    },
    class: 'btn',
  }, 'Export sets JSON'),
  el('button', {
    type: 'button', onclick: () => importInput.click(),
    class: 'btn',
  }, 'Import sets JSON'),
  importInput);

  // The column notes are the two readings easiest to get wrong, so they sit under the table
  // rather than only on the provenance page.
  const notes = el('div', { class: 'bz-notes' },
    el('p', {}, el('strong', {}, 'MS is indirect. '),
      'It counts public Populus mass-spec datasets with a peptide matching this gene, not '
      + 'observations of this gene’s own protein: 94% of those peptides are also in the '
      + 'P. trichocarpa proteome and only 12% match exactly one 717 gene. Open a gene to see '
      + 'which kind of evidence it has.'),
    el('p', {}, el('strong', {}, 'ω is Nei–Gojobori against P. trichocarpa'),
      ', blank where no reciprocal-best ortholog was found. That can mean a real absence, '
      + 'a gene the P. trichocarpa annotation misses, or a failed search.'));
  const side = el('details', { class: 'bz-side', open: 'open' },
    sideToggle,
    el('div', { class: 'bz-sidebody' }, el('h2', { class: 'bz-sidehead' }, 'Filters'), controls));
  // A phone gets the filters folded behind one button; a wide screen keeps them open beside
  // the table. The <details> is the same element in both, so its state never forks.
  const mq = window.matchMedia('(max-width: 860px)');
  const syncSide = () => { side.open = !mq.matches; };
  syncSide();
  mq.addEventListener?.('change', syncSide);
  onDispose(root, () => mq.removeEventListener?.('change', syncSide));
  root.append(el('div', { class: 'bz-layout' },
    side,
    el('div', { class: 'bz-main' },
      el('div', { class: 'bz-bar' }, summary, actions),
      chipRow,
      actStatus,
      el('div', { class: 'card bz-results' }, tableHolder, pager),
      notes,
      el('details', { class: 'card-fold bz-sets' },
        el('summary', {}, el('span', { class: 'fold-title' }, 'Saved sets'),
          el('span', { class: 'fold-why' }, 'gene IDs, filters and data version, kept in this browser')),
        el('div', { class: 'card' },
          savedSetActions, savedSetStatus, setsHolder)))));

  const [facets, ids] = await Promise.all([loadFacets(), loadGeneIndex()]);
  if (navigation && !navigation.isCurrent()) return root;
  state.rows = facets.rows.map((_, i) => facetRow(facets, i));
  state.ids = ids;
  state.idIndex = new Map(ids.map((id, i) => [id, i]));

  // Build every select from its declared options after the facet vocabulary arrives. Peak
  // tissue deliberately comes from the release index, which includes leaf_young and leaf_old.
  options = new Map(FILTERS.filter((f) => f.kind === 'select')
    .map((f) => [f.id, filterOptions(f, facets)]));
  for (const filter of FILTERS.filter((f) => f.kind === 'select')) {
    const input = inputs.get(filter.id);
    clear(input).append(
      el('option', { value: '' }, 'any'),
      ...options.get(filter.id).map((value) =>
        el('option', { value }, optLabel(value))));
  }

  // The URL is the whole truth about the filter set. Values are seeded only after widgets
  // and dynamic options exist, so a deep link both filters the data and visibly selects it.
  state.values = valuesFromQuery(options);
  state.page = 0;
  for (const [id, value] of Object.entries(state.values)) {
    const input = inputs.get(id);
    if (input) input.value = value;
  }
  if (!applyFilters(state, navigation)) return root;
  sortMatches(state);
  render();
  renderSets();
  // Descriptions are a separate, larger file; the table is usable before it lands.
  loadDescIndex().then((d) => {
    if (navigation && !navigation.isCurrent()) return;
    if (Array.isArray(d) && d.length === state.ids.length) { state.desc = d; render(); }
  }).catch(() => { /* the column stays as dashes */ });
  return root;
}
