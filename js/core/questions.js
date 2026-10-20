// Question-shaped entry points. The home page offered a search box and one example gene,
// which asks the reader to already know what they are looking for. These are the questions
// the shipped layers can actually answer, each one a real Browse query.
//
// TWO RULES, both learned the hard way in this repo:
//
//   1. Counts are computed IN THE BROWSER from the facet index, never written into the
//      manifest. A count baked into an aggregate that a build stage owns goes stale the
//      moment a patcher runs without it -- TODO 25 documents exactly that failure, and the
//      home page has already shipped a withdrawn number once (0.3.11, the 1,725 LSG pool).
//      Computing here means the number cannot disagree with the Browse page it links to,
//      because it IS the Browse page's own filter function.
//
//   2. Every cutoff appears in the question text. "Expressed" and "tissue-specific" are not
//      absolute properties, and a question that hides its threshold invites reading it as
//      one. If you cannot state the cutoff in the sentence, the question is wrong.
//
// `params` are literally Browse's own FILTER ids, so browseHref(params) round-trips into a
// working, shareable, deep-linked view with the widgets pre-filled.
export const QUESTIONS = [
  {
    id: 'young-and-duplicated',
    q: 'Which tandem-array genes are xylem-specific?',
    sub: 'in a curated tandem array, peak tissue xylem, τ ≥ 0.85 and mean TPM ≥ 5 on the 222-sample reference panel',
    params: { tandem: 'yes', top: 'xylem', tau_min: '0.85', tok: 'yes', qc: 'no' },
    byHap: true,
  },
  {
    id: 'lsg-with-protein',
    q: 'Which lineage-specific genes have a peptide match in public Populus mass spectra?',
    sub: 'the final LSG set, a peptide in at least one of 5 public datasets; mostly single, shared or cross-species (P. tomentosa, P. × canescens) peptides',
    params: { lsg: 'final_set', ms: 'yes' },
    byHap: true,
  },
  {
    id: 'hemizygous',
    q: 'Which genes have no protein-level counterpart on the other haplotype?',
    sub: 'Strict PAV: no syntelog and no protein-level match on the other haplotype; partial DNA at the syntenic position is tolerated',
    params: { rel: 'hemizygous_strict_PAV' },
    byHap: true,
  },
  {
    id: 'three-layers',
    q: 'Which tandem-array genes are also called for both whole-genome events?',
    sub: 'a curated tandem array plus sWGD and aWGT anchors',
    params: { tandem: 'yes', wgd9: 'both' },
    byHap: true,
  },
  {
    id: 'never-expressed',
    q: 'Which genes have a median WT-control TPM of 1 or less in every tissue?',
    sub: 'per-tissue medians over WT-control samples only, 10 tissues; single samples may exceed it',
    params: { xin: '' },     // handled specially below: xin is a tissue mask, not a value
    test: (r) => !r.xin || r.xin.length === 0,
  },
  {
    id: 'fast-evolving',
    q: 'Which genes look fast-evolving against P. trichocarpa?',
    sub: 'ω ≥ 1 compared with the reciprocal-best ortholog, a flag to inspect, not a selection claim',
    params: { w_min: '1.0' },
  },
  {
    id: 'private',
    q: 'Which genes are classed private (no ortholog in the panel)?',
    sub: 'synteny class across the 12-genome panel, which omits the parent P. alba',
    params: { cls: 'private_no_ortholog' },
  },
  {
    id: 'lsg-final',
    q: 'Which genes are in the final lineage-specific gene set?',
    sub: 'PS18 or PS19 candidates that pass all four exclusion criteria',
    params: { lsg: 'final_set' },
    byHap: true,
  },
];

/** Count matches for a question over the facet rows, using Browse's OWN filter functions so
 *  the number here and the number on the linked page cannot drift apart. */
export function countQuestion(q, rows, FILTERS, hap = null) {
  if (hap) rows = rows.filter((r) => r.hap === hap);
  if (q.test) return rows.reduce((n, r) => n + (q.test(r) ? 1 : 0), 0);
  const active = FILTERS.filter((f) => q.params[f.id] !== undefined && q.params[f.id] !== '');
  if (!active.length) return null;
  let n = 0;
  for (const r of rows) {
    let ok = true;
    for (const f of active) {
      if (!f.test(r, q.params[f.id])) { ok = false; break; }
    }
    if (ok) n += 1;
  }
  return n;
}
