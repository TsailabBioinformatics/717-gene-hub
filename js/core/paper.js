// One place for the words and values the site shares with the dissertation, so a page cannot
// drift from another page on a name, a boundary or an address.
import { el, fmt } from './dom.js';

export const SITE_URL = 'https://tsailabbioinformatics.github.io/poplar-717-atlas/';
export const REPO_URL = 'https://github.com/TsailabBioinformatics/poplar-717-atlas';
export const CONTACT = 'Chen.Hsieh@uga.edu';
export const GENOME = 'Populus tremula × P. alba INRA 717-1B4, genome and annotation v5.1 (Phytozome)';

/* ---------- tandem-array age bins ---------- */
// Keys are the stored values; the names and Ks limits are the dissertation's (Figure 2.2).
// Limits are closed on the right.
export const AGE_BINS = [
  ['aWGD_era', 'aWGT era', 'Ks > 1.07'],
  ['sWGD_era', 'sWGD era', '0.16 < Ks ≤ 1.07'],
  ['pre_divergence', 'before the species split', '0.02 < Ks ≤ 0.16'],
  ['post_divergence', 'after the species split', 'Ks ≤ 0.02'],
  ['not datable', 'not datable', 'no pair with a usable Ks'],
];
const AGE = Object.fromEntries(AGE_BINS.map(([k, n, ks]) => [k, { name: n, ks }]));
/** "before the species split (0.02 < Ks ≤ 0.16)" for a stored age-bin value. */
export function ageBinName(v, withKs = true) {
  const a = AGE[v] || AGE[String(v).replace(/ /g, '_')];
  if (!a) return String(v).replace(/_/g, ' ');
  return withKs && v !== 'not datable' ? `${a.name} (${a.ks})` : a.name;
}

/* ---------- tissue specificity, as in the dissertation ---------- */
export const TAU_SPECIFIC = 0.85;
export const PAPER_TAU_HOW = 'τ over mean TPM in 9 tissue groups of the 222-sample reference panel, '
  + 'computed where at least one group mean reaches 5 TPM; a gene is counted tissue-specific at '
  + 'τ ≥ 0.85 with mean TPM ≥ 5';
/** The dissertation's expression summary on a gene record, or null. */
export const paperExpr = (g) => (g && g.x && g.x.p) || null;
export const paperTau = (g) => { const p = paperExpr(g); return p && p.tau != null ? p.tau : null; };
export const paperTop = (g) => { const p = paperExpr(g); return (p && p.top) || null; };
/** The tissue group with the highest mean and that mean, also where no group reaches the 5 TPM
 *  floor (then it is the highest group, not a called peak tissue). null without expression. */
export function paperHighest(g) {
  const p = paperExpr(g);
  if (!p || !p.t) return null;
  const tissue = p.top || Object.keys(p.t).sort().reduce((a, b) => (p.t[b] > p.t[a] ? b : a));
  return { tissue, v: p.t[tissue], called: !!p.top };
}

/* ---------- lineage-specific genes ---------- */
export const LSG_REASON = {
  gene_model_quality: 'gene-model quality',
  homology_detection_failure: 'homolog absence is a plausible detection failure (abSENSE)',
  homolog_in_outgroup_syntenic_window: 'a homolog lies in an outgroup syntenic window',
  split_gene_model: 'split gene model (spliced to the neighbouring conserved gene)',
};
/** "LSG (final set)" / "LSG candidate, excluded: <reason>" / null for a gene record. */
export function lsgStatus(g) {
  const f = g && g.ps && g.ps.fin;
  if (!f) return null;
  return f.s ? { final: true, text: 'lineage-specific gene (final set)' }
    : { final: false, text: `LSG candidate, excluded: ${LSG_REASON[f.r] || f.r}` };
}

/* ---------- quality-flagged gene models ---------- */
export const isQcFlagged = (g) => !!(g && g.rel && g.rel.qc);
export function qcBanner(g) {
  if (!isQcFlagged(g)) return null;
  return el('div', { class: 'warn', 'data-qc-banner': '' },
    el('strong', {}, 'Gene model flagged by quality control. '),
    'This model is one of 553 (318 HAP1, 235 HAP2) set aside as pseudogene-like tandem copies or '
    + 'short degenerate fragments. It is not counted in the dissertation’s duplication classes, '
    + 'tandem arrays or cross-haplotype categories, and it is not treated as a syntelog of '
    + 'another gene. Its record is shown for completeness.');
}

/** Footer line: version, build date, genome. */
export function releaseLine(man) {
  const built = (man.built || '').slice(0, 10);
  return `data v${man.data_version}${built ? ` · built ${built}` : ''} · genome and annotation v5.1`;
}
export { fmt };
