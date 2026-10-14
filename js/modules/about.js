// Provenance page. Renders what the build actually recorded -- every source file with its
// sha256 and mtime -- rather than a hand-maintained prose list that drifts from the data.
import { el, fmt, pct } from '../core/dom.js';
import { SITE_URL, REPO_URL, CONTACT, GENOME, PAPER_TAU_HOW, CITE_NOTE, AI_ACK } from '../core/paper.js';

// What each upstream table is, in a reader's words; the file names are in the build manifest.
const SOURCE_LABEL = [
  ['master_per_gene', 'per-gene table of the dissertation (under Downloads)'],
  ['wgd_pair_classes', 'whole-genome duplication anchor-pair calls'],
  ['v4_panel', 'sample list of the 222-sample reference panel'],
  ['combined_tpm', 'TPM matrix, 652 samples'],
  ['Table_3', 'lineage-specific gene table (dissertation Tables 3.S1 to 3.S3)'],
];

function overview(man) {
  const a = man.annotation || {};
  const e = man.expression || {};
  const br = (man.phylostrat || {}).by_rank || {};
  const unplaced = { hap1: (br.hap1 || {}).NA || 0, hap2: (br.hap2 || {}).NA || 0 };
  const tw = e.tissue_wt_control_n || {};
  return el('div', {},
    el('h1', {}, 'About & provenance'),
    el('p', { class: 'sub' },
      `Data version ${man.data_version || '–'}, built ${(man.built || '').slice(0, 10)}. ${GENOME}. `
      + 'Duplication classes, whole-genome duplication pairs, relationship categories, tissue specificity and the '
      + 'lineage-specific gene set are those of the accompanying dissertation.'),

    el('div', { class: 'card', 'data-contact': '' },
      el('h2', {}, 'Contact and feedback'),
      el('p', { style: 'margin:0;font-size:13.5px' },
        'Questions, corrections and requests: ', el('a', { href: `mailto:${CONTACT}?subject=Poplar%20717%20gene%20atlas` }, CONTACT),
        ' (Tsai lab, University of Georgia). Site code and released data: ',
        el('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, REPO_URL.replace('https://', '')),
        '. Terms are defined in the ', el('a', { href: '#/glossary' }, 'glossary'),
        '; the tables behind the dissertation are under ', el('a', { href: '#/downloads' }, 'Downloads'), '.')),

    el('div', { class: 'card' },
      el('h2', {}, 'What this is'),
      el('p', { style: 'margin:0 0 10px;font-size:14px;color:var(--ink-2)' },
        'A browsable atlas of the 63,960 gene models in the two phased haplotypes of hybrid '
        + 'poplar clone INRA 717-1B4 (Populus tremula × P. alba), genome and annotation v5.1 (Phytozome). '
        + 'HAP1 is the maternal P. tremula haplotype and HAP2 the paternal P. alba haplotype. It is the '
        + 'data supplement of a dissertation on gene duplication and lineage-specific genes in this clone, '
        + 'and a general-purpose resource for anyone working in it.'),
      el('dl', { class: 'kv' },
        el('dt', {}, 'Genes'), el('dd', {}, `${fmt(man.n_genes)}: HAP1 32,137 (PtXaTreH), HAP2 31,823 (PtXaAlbH)`),
        el('dt', {}, 'Synteny'), el('dd', {}, 'GENESPACE over a 12-genome panel (10 syntenic + O. sativa / P. patens as orthogroup-only outgroups)'),
        el('dt', {}, 'Phylostratigraphy'), el('dd', {}, 'genEra, 19 strata'),
        el('dt', {}, 'Annotation'), el('dd', {}, `${fmt(a.n_annotated)} genes; ${fmt(a.go_terms)} GO terms`),
        el('dt', {}, 'Alleles'), el('dd', {}, `${fmt(Math.round((a.n_allele || 0) / 2))} HAP1↔HAP2 pairs `
          + `(${fmt(a.n_allele)} genes), syntelog partners between the two haplotypes`),
        el('dt', {}, 'Expression'), el('dd', {}, `${fmt(e.n_samples)} samples, ${e.n_studies} studies, ${e.n_bioprojects} BioProjects, kallisto k21`))),

    // TODO 45: the structured home for genome-wide numbers. Chen's review asked whether the
    // stat-only module pages should fold in here. They earned their place instead, by becoming
    // launchers into Browse -- so this is the one place that states every layer's COVERAGE,
    // which is the number a reader actually needs and which no single module page showed.
    el('div', { class: 'card' },
      el('h2', {}, 'What each layer covers', el('span', { class: 'tag' }, 'genome-wide')),
      el('p', { class: 'muted', style: 'font-size:12.5px;margin:0 0 10px' },
        'Coverage is not uniform, and an absent value usually means a layer does not reach '
        + 'that gene rather than that the gene lacks the property. Every figure below is out '
        + 'of ' + fmt(man.n_genes) + ' genes.'),
      el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Layer'), el('th', { class: 'num' }, 'Genes'),
          el('th', { class: 'num' }, 'Share'), el('th', {}, 'What absence means'))),
        el('tbody', {}, ...[
          ['Synteny class', man.n_genes, 'Every gene is classified.'],
          // Was `n_genes - (by_rank ? 0 : 0)`, which is always n_genes, beside a hand-typed "50".
          // Both now come from by_rank, which is the pool's call, the rerun that added Idesia (C5).
          ['Phylostratum', man.n_genes - unplaced.hap1 - unplaced.hap2,
            `genEra returned no rank for ${fmt(unplaced.hap1)} HAP1 and ${fmt(unplaced.hap2)} HAP2 `
            + 'genes in the current call; they are excluded from the pool, not defaulted.'],
          ['Expression baseline', (man.expression || {}).n_genes_with_baseline || null,
            'A gene with an all-zero baseline has no tissue profile. \u03c4 needs a tissue-group mean of at least 5 TPM.'],
          ['Ka/Ks vs P. trichocarpa', (man.kaks || {}).n_genes,
            'No reciprocal-best ortholog. Expected for PS19, where only 1 of 681 genes has one.'],
          ['Peptide evidence', ((man.proteomics || {}).genes_with_a_hit
            ? man.proteomics.genes_with_a_hit.hap1 + man.proteomics.genes_with_a_hit.hap2 : null),
            'Not detected, or undetectable: no tryptic peptide in the searchable mass range. '
            + 'Presence rests on public mass spectra, often from other Populus species and on '
            + 'peptides shared with other genes.'],
          ['ESMFold structure', ((man.layers || {}).coverage || {})['ESMFold structure'],
            'No model was built. Coverage, not a structural claim.'],
          ['Ortholog chromatin', (man.chromatin || {}).n_genes,
            'No reciprocal 1:1 P. trichocarpa ortholog, or the ortholog call is ambiguous. '
            + 'Where present, the marks are the P. trichocarpa ortholog\'s (leaf), not measured on 717.'],
          ['Promoter motif scan', ((man.cre || {}) && man.n_genes),
            'Every gene is scanned; family counts can legitimately be zero.'],
        ].filter(([, n]) => n != null).map(([label, n, note]) => el('tr', {},
          el('td', {}, label),
          el('td', { class: 'num' }, fmt(n)),
          el('td', { class: 'num' }, pct(n, man.n_genes)),
          el('td', { class: 'muted', style: 'font-size:12px' }, note)))))),
      el('p', { class: 'muted', style: 'font-size:11.5px;margin:10px 0 0' },
        'Each module page carries its own distribution and links into Browse from it, so a '
        + 'count here can always be turned into the actual gene list.')),

    el('div', { class: 'card' },
      el('h2', {}, 'Known limitations', el('span', { class: 'tag' }, 'read before citing')),
      el('ul', { style: 'margin:0;padding-left:18px;font-size:13.5px;color:var(--ink-2);line-height:1.6' },
        el('li', {}, el('strong', {}, 'HAP2 domain annotation is thin. '),
          'The v5.1 release left HAP2\'s Pfam/PANTHER/GO columns empty for all 65,212 rows. '
          + 'GO was recovered from a lab-built file; Pfam only partly, from the defline '
          + `(${fmt(3222)} HAP2 genes vs ${fmt(26132)} on HAP1). An absent domain on a HAP2 gene is `
          + 'usually a release gap, not biology.'),
        el('li', {}, el('strong', {}, 'Private calls are panel-dependent. '),
          'P. alba, a parent species of this hybrid, is deliberately not in the synteny panel. '
          + '41% of genes called private have a detectable P. alba homolog, against 98.8% of core '
          + 'genes, so the call is conditional on the panel.'),
        el('li', {}, el('strong', {}, 'ω is undefined for 785 syntelog pairs '),
          'whose Ks is 0. The aligner reports 99.0 there; the atlas shows "identical at '
          + 'synonymous sites" instead, never a selection claim.'),
        el('li', {}, el('strong', {}, 'Expression is raw TPM by default. '),
          'Use it for tissue specificity and per-gene magnitude. A ComBat-seq batch-corrected '
          + `profile is a separate, opt-in view on the gene page, for the `
          + `${fmt((man.expression || {}).combat_eligible_genes)} genes that passed the upstream `
          + 'low-count filter; tissue values and τ are always computed on raw TPM.'),
        el('li', {}, el('strong', {}, 'Curation notes are summarised, not quoted. '),
          'Tandem-array genes carry a curation flag (hand-rejected, pseudogene-like, or '
          + 'disagreeing with the automatic filter). The curator\'s identity and verbatim wording '
          + 'are deliberately not published.'),
        el('li', { 'data-one-tau': '' }, el('strong', {}, 'Tissue specificity is the dissertation\u2019s. '),
          `The τ and peak tissue on every page, in Browse, on the genome map and in every export: ${PAPER_TAU_HOW}. `
          + 'No other tissue-specificity value is shown.'),
        el('li', {}, el('strong', {}, 'The lineage-specific gene set is the final one. '),
          'Gene pages, Browse and the counts use the dissertation’s final set, 583 HAP1 and 621 HAP2 genes. '
          + 'The 776 HAP1 and 835 HAP2 candidates at PS18 or PS19 stay visible, and an excluded candidate says why it was excluded.'),
        el('li', {}, el('strong', {}, 'Stress responsiveness uses an earlier contrast set. '),
          'The responsiveness value on gene pages is a median over 117 contrasts with a control group; '
          + 'the dissertation’s perturbation statistics use its 149 curated perturbation contrasts. The value is labelled accordingly.'),
        el('li', {}, el('strong', {}, 'Presence/absence is the strict, protein-level set. '),
          'A gene is Strict PAV when it is hemizygous, is not a tandem duplicate, has no protein-level '
          + 'match on the other haplotype and no near-full-length match at the syntenic position: '
          + '528 HAP1 and 605 HAP2 genes. Partial DNA at the syntenic position is tolerated, so the call '
          + 'does not mean the DNA is absent. Genes without a syntelog whose sequence '
          + 'is present on the other haplotype are Non-PAV hemizygous, and tandem arrays with no '
          + 'syntelog for any member are Hemizygous TD arrays (not PAV: most of their members '
          + 'still have a protein-level match on the other haplotype).'),
        el('li', {}, el('strong', {}, 'Chromatin and protein evidence is borrowed. '),
          'Chromatin accessibility and histone marks were measured in P. trichocarpa leaf '
          + '(GEO GSE128434) and are shown on each gene\'s 1:1 P. trichocarpa ortholog; nothing '
          + 'was measured on 717. Peptide matches come from five public Populus mass-spec '
          + 'datasets, including P. tomentosa and P. × canescens; most matches rest on peptides '
          + 'shared with other genes or species, often a single spectrum.'),
        el('li', {}, el('strong', {}, 'Three layers are derived here, not imported. '),
          'Exon/intron counts and TE distance are computed from the v5.1 GFF3 and repeatmasked '
          + 'annotation that ship with the genome, and genomic order from the atlas\'s own '
          + 'coordinates, because no reviewed upstream table offered them.'),
        el('li', {}, el('strong', {}, 'Duplication and relationship calls match the dissertation. '),
          'The per-gene duplication class, the allele (syntelog) partners, strict PAV and the '
          + 'relationship categories are the same tables the dissertation uses. The tandem '
          + 'component is the curated union set. Whole-genome-duplication assignments are '
          + 'inferences from synteny and Ks, not observations.'),
        // Read from the manifest: the hand-typed "77 leaf" was the pooled count from before the
        // 2026-09-05 leaf regrouping (manifest.corrections), and nothing checked it.
        el('li', {}, el('strong', {}, 'Thin per-tissue medians. '),
          `The per-tissue tables on the array and allele-pair pages show median TPM over WT-control samples, which rests on ${fmt(tw.leaf)} leaf (plus ${fmt(tw.leaf_young)} `
          + `young-leaf and ${fmt(tw.leaf_old)} old-leaf) and ${fmt(tw.xylem)} xylem WT-control `
          + `samples but only ${fmt(tw.bud)} bud, ${fmt(tw.catkin)} catkin, ${fmt(tw.stem)} stem `
          + `and ${fmt(tw.callus)} callus. Every column carries its n. τ and peak tissue do not use these medians.`))),

    el('div', { class: 'card' },
      el('h2', {}, 'Sources', el('span', { class: 'tag' }, 'checksummed at build')),
      el('p', { style: 'margin:0;font-size:13.5px' },
        `${fmt(Object.keys(man.sources || {}).length)} source files went into this build. Each is recorded `
        + 'with its size, sha256 and date in the ',
        el('a', { href: 'data/meta/manifest.json' }, 'build manifest'),
        ', and each data layer ships a provenance record in the build files.'),
      el('p', { style: 'margin:10px 0 0;font-size:13px' },
        'The duplication, relationship, tissue-specificity and LSG layers come from the dissertation\u2019s tables '
        + `(analysis repository commit ${((man.dissertation || {}).analysis_repository_commit) || '–'}):`),
      el('ul', { class: 'mono', style: 'margin:4px 0 0;padding-left:18px;font-size:11.5px', 'data-source-tables': '' },
        ...Object.entries((man.dissertation || {}).source_tables || {}).map(([f, h]) =>
          el('li', {}, `${SOURCE_LABEL.find(([k]) => f.startsWith(k))?.[1] || 'analysis table'}  sha256 ${h.slice(0, 16)}…`))),
      el('p', { class: 'muted', style: 'margin:10px 0 0;font-size:12px' },
        'The master tables, their data dictionary and the dissertation\u2019s supplementary tables are under ',
        el('a', { href: '#/downloads' }, 'Downloads'), '. The raw expression matrix is not distributed with the site.'),
      // The page claims the data is validated; this is where the claim can be checked.
      el('p', { style: 'margin:10px 0 0;font-size:13px' },
        el('a', { href: '#/status' }, 'See the consistency checks run on this data →'))),


    el('div', { class: 'card' },
      el('h2', {}, 'Citation & licence'),
      el('p', { style: 'margin:0 0 8px;font-size:13.5px', 'data-cite-note': '' }, CITE_NOTE),
      el('p', { style: 'margin:0 0 6px;font-size:13.5px' }, 'Until then, cite this atlas as:'),
      el('p', { class: 'cite-line', 'data-cite': '', style: 'margin:0 0 10px;font-size:13.5px;padding:8px 10px;border-left:3px solid var(--accent)' },
        `Hsieh et al., unpublished. Poplar 717 gene atlas, version ${man.data_version || ''}. `,
        el('a', { href: SITE_URL }, SITE_URL),
        `. Accessed ${new Date().toISOString().slice(0, 10)}.`),
      el('p', { style: 'margin:0 0 8px;font-size:13px;color:var(--ink-2)' },
        'Also cite the underlying study for any expression data you use; each study page carries its own DOI. '
        + 'A machine-readable record is in ', el('a', { href: 'CITATION.cff' }, 'CITATION.cff'), '.'),
      el('p', { class: 'muted', style: 'margin:0;font-size:12.5px' },
        'Code is MIT (', el('a', { href: `${REPO_URL}/blob/main/LICENSE`, target: '_blank', rel: 'noopener' }, 'LICENSE'),
        '). Data are provided for research use; please cite the atlas as above. A formal open data licence '
        + 'has not been set yet; CC BY 4.0 is intended at publication.'),
      el('p', { class: 'muted', style: 'margin:8px 0 0;font-size:12.5px', 'data-ai-ack': '' }, AI_ACK)),
  );
}

export default { id: 'about', label: 'About', overview };
