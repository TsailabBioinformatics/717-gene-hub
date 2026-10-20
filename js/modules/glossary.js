// #/glossary -- the terms the site uses, defined as the dissertation defines them. One page,
// so a first-time reader does not have to collect definitions from card footnotes.
import { el, fmt } from '../core/dom.js';
import { AGE_BINS, PAPER_TAU_HOW, LSG_REASON } from '../core/paper.js';

export function glossaryView(man) {
  const d = man.dissertation || {};
  const t = d.table_2_1 || { HAP1: {}, HAP2: {} };
  const lsg = d.lsg || { HAP1: {}, HAP2: {} };
  const tau = (d.tau || {}).per_haplotype || { HAP1: {}, HAP2: {} };
  const rc = (man.relationship || {}).counts || {};
  const pair = (k) => `${fmt(rc[`HAP1|${k}`])} HAP1 / ${fmt(rc[`HAP2|${k}`])} HAP2`;
  const hp = (k) => `${fmt(t.HAP1[k])} HAP1 / ${fmt(t.HAP2[k])} HAP2`;
  const TERMS = [
    ['Genome and gene models', [
      ['HAP1, HAP2', 'The two phased haplotypes of the hybrid: HAP1 is the Populus tremula haplotype (gene IDs PtXaTreH), HAP2 the P. alba haplotype (PtXaAlbH). Counts are always given per haplotype and never summed.'],
      ['Quality-filtered genes', `Gene models that pass gene-model quality control: ${hp('quality_filtered_genes')}. The 553 models set aside (318 HAP1, 235 HAP2) are pseudogene-like tandem copies or short degenerate fragments; they have a page here, marked as flagged, and are not in any count.`],
      ['Ks (dS)', 'Synonymous substitutions per synonymous site between two coding sequences, used as a measure of how long ago two copies diverged. The site writes Ks for arrays and age bins and dS in pair tables; they are the same quantity.'],
    ]],
    ['Duplication classes', [
      ['sWGD', `Salicoid whole-genome duplication, shared by Populus and Salix. A gene is in this class when it has an sWGD anchor pair: ${hp('sWGD')}.`],
      ['aWGT', `Ancient whole-genome triplication (gamma), shared by core eudicots. The class is defined on anchor pairs, so a triplication is observed as pairwise relationships among its surviving copies: ${hp('aWGT')}.`],
      ['Anchor pair', 'Two genes of one haplotype at matching positions of two collinear segments. Each pair is assigned to sWGD or aWGT from its Ks together with the position of the segments on the ancestral eudicot karyotype; a pair is assigned to aWGT when its dS exceeds 1.05.'],
      ['Tandem duplicate, tandem array', `Neighbouring copies of a gene on one chromosome, from a curated set that combines three callers and removes pseudogene-like copies. An array is counted when at least two members remain: ${hp('tandem')} genes.`],
      ['Dispersed duplicate', `A gene with at least one protein match elsewhere in the same haplotype (DIAMOND E-value < 1e-10, identity ≥ 30%) that is not its WGD or tandem partner. There is no coverage requirement, so the match can rest on a shared domain. "Dispersed only" means no other evidence: ${hp('dispersed_only')}.`],
      ['Singleton', `A gene with no detectable paralog under those thresholds: ${hp('singleton')}.`],
      ['Class code', 'One code per gene from the letters S (sWGD), A (aWGT), T (tandem), D (dispersed), or C (singleton). Classes overlap: DST is a dispersed, sWGD and tandem gene.'],
    ]],
    ['Tandem-array age bins', AGE_BINS.filter(([k]) => k !== 'not datable').map(([, name, ks]) =>
      [name, `Arrays whose median pair Ks is in the range ${ks}. Limits are closed on the right.`])],
    ['Relationship to the other haplotype', [
      ['Syntelog', 'A gene’s counterpart at the matching (syntenic) position on the other haplotype, from GENESPACE.'],
      ['1:1', `One gene on each haplotype in the syntenic group: ${pair('1:1')} genes.`],
      ['N:N', `The same number of copies, more than one, on both haplotypes. TD-associated N:N (${pair('N:N_TD')}) when a tandem array is involved, otherwise Non-TD N:N (${pair('N:N_nonTD')}).`],
      ['CNV (copy number variation)', `A different number of copies on the two haplotypes. TD-associated CNV (${pair('CNV_TD')}) when a tandem array is involved, otherwise Non-TD CNV (${pair('CNV_nonTD')}). A tandem gene without its own syntelog is counted here, not as hemizygous, when another member of its array has a syntelog.`],
      ['Hemizygous', 'Present on one haplotype with no syntelog on the other. For a tandem gene this requires that no member of its array has a syntelog. Three groups follow.'],
      ['Strict PAV (presence-absence variation)', `Hemizygous, not a tandem duplicate, with no protein match on the other haplotype (DIAMOND E-value < 1e-10, identity ≥ 30%, both directions) and no near-full-length match at the syntenic position: ${pair('hemizygous_strict_PAV')}. This is a protein-level call; partial DNA at the syntenic position is tolerated, so it does not mean the DNA is absent.`],
      ['Hemizygous TD arrays', `Tandem arrays none of whose members has a syntelog on the other haplotype: ${pair('hemizygous_TD_array')} genes. Most of these genes still have a protein match elsewhere on the other haplotype, so they are not PAV.`],
      ['Non-PAV hemizygous', `No syntelog, but a protein homolog elsewhere on the other haplotype or a near-full-length DNA match at the syntenic position: ${pair('hemizygous_nonPAV')}.`],
    ]],
    ['Gene age', [
      ['Phylostratum (PS)', 'The oldest of 19 nested taxonomic levels at which a homolog of the gene is detected (genEra). PS18 is Populus; PS19 is the youngest level, with no homolog detected even in the other haplotype.'],
      ['LSG (lineage-specific gene)', `A gene of the final lineage-specific set: ${fmt(lsg.HAP1.final)} HAP1 (${fmt(lsg.HAP1.final_PS18)} PS18, ${fmt(lsg.HAP1.final_PS19)} PS19) and ${fmt(lsg.HAP2.final)} HAP2 (${fmt(lsg.HAP2.final_PS18)} PS18, ${fmt(lsg.HAP2.final_PS19)} PS19).`],
      ['LSG candidate', `One of the ${fmt(lsg.HAP1.candidates)} HAP1 and ${fmt(lsg.HAP2.candidates)} HAP2 genes at PS18 or PS19. A PS19 candidate whose protein matches the other haplotype’s genome at the syntenic position where no gene is annotated is reassigned to PS18 (${fmt(lsg.HAP1.reassigned_PS19_to_PS18)} HAP1, ${fmt(lsg.HAP2.reassigned_PS19_to_PS18)} HAP2). Candidates are then excluded, in this order, for: ${Object.values(LSG_REASON).join('; ')}.`],
    ]],
    ['Expression', [
      ['TPM', 'Transcripts per million, from kallisto against the combined transcriptome of both haplotypes; raw, not batch-corrected.'],
      ['Reference panel', 'The 222 control and seasonal samples, in 9 tissue groups, used for baseline expression and tissue specificity.'],
      ['τ (tau), tissue-specific', `Tissue specificity from 0 (even across tissues) to 1 (one tissue): ${PAPER_TAU_HOW}. That gives ${fmt(tau.HAP1.tissue_specific)} of ${fmt(tau.HAP1.genes_at_mean_TPM_5_or_more)} HAP1 and ${fmt(tau.HAP2.tissue_specific)} of ${fmt(tau.HAP2.genes_at_mean_TPM_5_or_more)} HAP2 quality-filtered genes.`],
      ['Peak tissue', 'The tissue group with the highest mean TPM in the reference panel.'],
    ]],
  ];
  return el('div', { 'data-glossary': '' },
    el('h1', {}, 'Glossary'),
    el('p', { class: 'sub' },
      'Terms as used on this site. Counts are per haplotype.'),
    ...TERMS.map(([group, items]) => el('div', { class: 'card' },
      el('h2', {}, group),
      el('dl', { class: 'kv' }, ...items.flatMap(([term, def]) => [
        el('dt', {}, el('strong', {}, term)), el('dd', {}, def)])))));
}
