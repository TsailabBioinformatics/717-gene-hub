// #/changes -- what changed for a reader, release by release. CHANGELOG.md is the build record
// (scripts, sources, checks); this page says what a visitor will notice, in plain words. Keep the
// newest release first, and add an entry with every release that a reader could see.
import { el } from '../core/dom.js';

const RELEASES = [
  ['0.22.1', '2026-10-17', 'Study labels, read counts and expression statistics', [
    'Pages no longer carry internal labels about how each value was produced; the Duplication page is now the Duplicated gene catalog (2026-10-20).',
    'Studies with two authors are named by both (Kins & Janz rather than Kins et al.), and every study shows its journal correctly. Five studies without a published paper now link their deposited data set instead of showing a dash.',
    'Read counts that were missing for 27 samples in two studies are filled in from the sequence archive.',
    'The Tissues view shows median, range and the number of samples and studies beside each mean, and can be ordered by the highest mean. The contrast view shows each group\u2019s mean expression and can be sorted by expression. Text in both views is larger.',
  ]],
  ['0.22.0', '2026-10-15', 'Curated comparisons', [
    'Study pages, the Expression card’s contrast view and the expression scrubber now use 165 curated comparisons instead of an older panel of 191. The 149 treatment comparisons among them are the ones behind each gene’s stress responsiveness, which the contrast view now states.',
    'In the two xylem studies, every comparison now stays within developing or within mature xylem, 4 samples against 4. The older panel had pooled the two sites in six comparisons.',
    'The contrast view can be filtered by kind of comparison, tissue, treatment comparisons only, expression level and replication, and sorted five ways; each comparison links to its study (2026-10-16).',
  ]],
  ['0.21.0', '2026-10-14', 'Sequences for every gene, and a better search', [
    'Every gene page has a Sequences card: protein, coding sequence (CDS), transcript and genomic span, from the Phytozome v5.1 annotation, each with Copy and FASTA buttons. Before this, only the 40,686 proteins with a predicted structure could be downloaded.',
    'Browse downloads FASTA of any of the four kinds for a selection of up to 2,000 genes.',
    'Search finds poplar genes by an Arabidopsis gene name such as CESA8, IRX1 or COR47, through each gene’s best Arabidopsis hit (31,032 genes can be found this way). Gene names and IDs rank above words in a description, every word must match, and a misspelled word is matched to its closest spelling, with a note saying so.',
    'The search list works from the keyboard (arrow keys, Enter, Escape) and announces how many results it found.',
    'Each page has its own title in the browser tab; after following a link, keyboard focus moves to the new page’s heading, and a “Skip to content” link is the first thing Tab reaches. Section links on a gene page move focus to the section. Scrolling is not animated when the system asks for reduced motion.',
    'Saving a Browse selection as a set now says so beside the button. This page is new.',
    'The 3D model draws helices and strands as ribbons and arrows, following the model’s own assignment, instead of a plain line through the chain (2026-10-15).',
    'The two xylem studies (drought and short days; abscisic acid) show developing and mature xylem as separate groups of 4, as deposited, instead of pooled groups of 8 (2026-10-15).',
  ]],
  ['0.20.0', '2026-10-14', 'Do other methods agree?', [
    'Gene-age and tandem-duplication cards say whether independent methods agree with the call: a second gene-age program and deeper searches for the young genes, three published tandem callers for tandem genes. These are cross-checks; no call changed.',
    'Each RNA-seq study has a page with its design drawn (tissues, treatments, time points), and any gene can be laid onto it. Time courses sit on a time axis.',
    'The tissue table on a gene page lights the reference-panel samples behind each row.',
  ]],
  ['0.19.0', '2026-10-14', 'Stress response, and search by the Arabidopsis hit', [
    'Each gene’s stress responsiveness is taken over the 149 curated treatment contrasts (was 117); 49,492 genes carry a value.',
    'The 222 reference-panel samples behind the tissue-specificity values are marked.',
    'Every gene with an Arabidopsis hit is found in search by the locus its page shows (was 39,253 of 59,534).',
  ]],
  ['0.18', '2026-10-13', 'One set of numbers', [
    'Calls and counts follow one set of final tables throughout, with one tissue-specificity score (tau).',
    'Gene pages link to their tandem array; About says how to cite the site. The old address forwards here.',
  ]],
  ['0.17', '2026-10-03', 'Final duplication, allele and presence-absence tables', [
    'Duplication classes, allele pairs, presence-absence calls and the relationship of each gene to the other haplotype come from the final tables, with wording that states what each call can and cannot show.',
  ]],
  ['0.16', '2026-09-26 to 2026-10-02', 'A redesigned site', [
    'A new look, Browse with grouped filters, faster gene pages, and one locus browser shared by every page.',
    'The set of young (lineage-specific) gene candidates was updated to 776 HAP1 and 835 HAP2.',
  ]],
  ['0.13 to 0.15', '2026-09-19 to 2026-09-21', 'Families, pairs and evidence', [
    'Pages for a gene family, an allele pair and the ancestral karyotype. A status page lists every check the published data passed.',
    'Every gene card says what kind of evidence it rests on, and copies of a gene are drawn on both haplotypes.',
    'Expression is fetched per gene, about 1 KB instead of 786 KB.',
  ]],
  ['0.9 to 0.12', '2026-09-16 to 2026-09-19', 'Duplication in depth', [
    'Which whole-genome duplication a gene belongs to and with which partner, where it sits on the ancestral eudicot karyotype, and every duplicate of a gene drawn and measured.',
    'The home page starts from questions a reader might ask.',
  ]],
  ['0.5 to 0.8', '2026-09-10 to 2026-09-12', 'Structure, chromatin and gene models', [
    'A 3D model of the predicted protein on every modelled gene, chromatin marks from the P. trichocarpa ortholog, and what RNA-seq says about each gene model.',
  ]],
  ['0.1 to 0.4', '2026-09-01 to 2026-09-10', 'First releases', [
    'Gene pages for all 63,960 genes of both haplotypes, Browse, the genome map and the expression scrubber.',
  ]],
];

export function changesView() {
  return el('div', { 'data-changes': '' },
    el('h1', {}, 'What changed'),
    el('p', { class: 'sub' },
      'Changes a reader will notice, newest first. The data version you are looking at is in About.'),
    el('ol', { class: 'changes' }, ...RELEASES.map(([v, date, title, notes]) =>
      el('li', { class: 'change' },
        el('div', { class: 'change-when' }, el('span', { class: 'mono' }, v), el('span', { class: 'muted' }, date)),
        el('div', {},
          el('h2', {}, title),
          el('ul', {}, ...notes.map((n) => el('li', {}, n))))))));
}

export const LATEST_CHANGE = RELEASES[0][0];
