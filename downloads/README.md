# 717 dissertation tables, release 2026-10-13

Gene duplication and cross-haplotype tables and lineage-specific gene tables for hybrid poplar 717,
from Chen Hsieh's dissertation (University of Georgia, 2026), with its supplementary tables.
A manuscript describing this resource will be submitted soon. Until it is published, please cite the
atlas website (version and access date); once the manuscript is available, please cite the manuscript.
Built by `data/138_dissertation_release_20261013/build_release.py`
(66 checks before this file was written; 113 dissertation numbers recomputed from these files alone, all equal: see
`HEADLINE_NUMBERS_CHECK.csv`).

## Genome and gene basis

- Genome: *Populus tremula* x *P. alba* INRA 717-1B4, haplotype-resolved assembly, annotation v5.1
  (Phytozome v13). HAP1 = *P. tremula* haplotype (gene IDs `PtXaTreH.*`), HAP2 = *P. alba* haplotype
  (`PtXaAlbH.*`). The two haplotypes are separate genomes: every number is given per haplotype and
  haplotypes are not summed.
- Gene basis: all 63,960 annotated genes are listed (32,137 HAP1, 31,823 HAP2). 553 gene models
  (318 HAP1, 235 HAP2) failed the gene-model quality filter and carry `quality_flagged` = True
  (Table 2.S4). Dissertation counts use the 31,819 HAP1 and 31,588 HAP2 quality-filtered genes,
  that is, rows with `quality_flagged` False. Flagged rows are kept so that every annotated gene can
  be looked up; their classification columns are empty.

## Files

| File | Rows | What it is |
|---|---:|---|
| `717_genes.csv` | 63,960 | one row per gene: duplication classes, tandem array, cross-haplotype syntelog category, strict PAV, tau and expression summaries, annotation |
| `717_gene_pairs.csv` | 47,923 | one row per gene pair: sWGD and aWGT anchor pairs (final call), within-array tandem pairs with Ks and Ka/Ks, member pairings of multi-copy syntelog groups |
| `717_tandem_arrays.csv` | 4,204 | one row per tandem array: size (retained members), detected size, median Ks, age bin, cross-haplotype status |
| `717_LSG_candidates.csv` | 1,611 | one row per lineage-specific gene candidate: phylostratum, each exclusion criterion, exclusion reason, final-set flag |
| `DATA_DICTIONARY.csv` | 109 | every column of the four tables above and of Table 2.S1: type, units, allowed values, definition |
| `HEADLINE_NUMBERS_CHECK.csv` | 113 | dissertation numbers recomputed from these files, with the dissertation value beside each |
| `supplementary_tables/` | | Tables 2.S1 to 2.S7 and 3.S1 to 3.S3 of the dissertation |
| `MD5SUMS.txt` | | md5 checksum of every file |

Supplementary tables: 2.S1 RNA-seq libraries (652; with the 222-library reference panel marked);
2.S2 read-separability exclusion; 2.S3 tandem genes per chromosome, array-intact permutation test
(calls at q < 0.05); 2.S4 quality-flagged gene models; 2.S5 array size by age; 2.S6 arrays spanning
several ages; 2.S7 sensitivity of the tandem age bins; 3.S1 LSG candidates; 3.S2 LSGs vs. controls;
3.S3 codon usage. Their legends are in the dissertation (and in the Legend sheet of each lineage-specific
gene workbook). `717_LSG_candidates.csv` is Table 3.S1 as a flat file.

Missing values are empty cells in every file. No placeholder numbers are used: a Ks or Ka/Ks that
the source stored as 99 is empty here and explained by `Ks_flag` / `Ka_Ks_flag`.

## How the dissertation numbers are obtained

Use `quality_flagged == False` in `717_genes.csv` unless stated. Per haplotype (`haplotype`).

| Dissertation item | From |
|---|---|
| Table 2.1, Figure 2.1 | counts of `sWGD_gene`, `aWGT_gene`, `tandem_gene`, `dispersed_duplicate_only`, `singleton`; classes overlap, `duplication_class_code` gives the combination |
| Tandem arrays, sizes (Figure 2.S3A, B; Table 2.S5) | `717_tandem_arrays.csv`: `array_size` |
| Tandem genes per chromosome (Figure 2.S3C, Table 2.S3) | `tandem_gene` by `chromosome`, genes on Chr01 to Chr19 |
| Ks of pairs (Figures 2.2, 2.S4) | `717_gene_pairs.csv`: `Ks` by `pair_type`; tandem pairs with `Ks_alignment_coverage_ok` True are the 16,238 dated pairs; `Ks_flag` = zero pairs are not drawn |
| Array age bins | `717_tandem_arrays.csv`: `age_bin` (from `median_Ks`; edges 0.02, 0.16, 1.07, closed on the right) |
| sWGD / aWGT anchor pairs (Figure 2.S2) | `717_gene_pairs.csv`: `pair_type` sWGD or aWGT, all pairs |
| Syntelog categories (Figures 2.3A, 2.S5A) | `has_syntelog`, `syntelog_class`, `syntelog_category`; groups counted as distinct `syntenic_group_id` |
| Hemizygous genes and strict PAV | `syntelog_class` == hemizygous; `strict_PAV`; `syntelog_category_detail` |
| Cross-haplotype status of arrays (Figures 2.8, 2.S10) | `717_tandem_arrays.csv`: `cross_haplotype_status` by `age_bin` |
| Tissue specificity (Figures 2.5, 2.6, 2.S7) | `tau_analysis_set` True is the denominator; tissue-specific = `tau` >= 0.85 within it; `peak_tissue` |
| Table 3.1, Table 3.S1 | `717_LSG_candidates.csv`: `exclusion_reason`, `final_LSG_set`, `phylostratum_used` |
| Reference panel | Table 2.S1: `Reference panel (n = 222)` |

Figure 2.6 (tau by duplication class) further excludes genes whose reads cannot be assigned uniquely
(Table 2.S2 gives the rule and counts) and splits tandem genes by array age; its per-row values are
therefore not the pooled values of `tandem_gene`. Analyses that need the expression matrix itself
(pair co-expression, perturbation contrasts; Figures 2.7 and 2.9 to 2.12) are not reproducible from
this bundle alone; expression values per gene and sample are on the atlas gene pages.

## Known caveats

- **aWGT pairs with low Ks.** 319 of 4,445 HAP1 and 342 of
  4,523 HAP2 aWGT anchor pairs (7.2% and 7.6%) have Ks <= 1.07, the
  salicoid range. They are assigned to the triplication by the ancestral-karyotype call, not by Ks.
  Conversely, where the karyotype call was unresolved (2,513 pairs), Ks alone decided the event.
- **Ks from few sites.** 467 anchor pairs rest on fewer than 10 synonymous sites
  (`fewer_than_10_synonymous_sites`); filter on `synonymous_sites` for Ks-sensitive work. Synonymous
  site counts were not recorded for tandem pairs.
- **Saturated and zero Ks.** One tandem pair has a saturated Ks (`Ks_flag` at_ceiling) and is counted
  in the aWGT era; 528 dated tandem pairs have Ks = 0. Ka/Ks is undefined for pairs with Ks = 0.
- **Class letters can differ between the two alleles.** Of 22,690 1:1 syntelog pairs with a named
  partner, 2,727 differ in `sWGD_gene` or `aWGT_gene` between the HAP1 and the HAP2 gene, because
  anchor pairs are called within each haplotype independently.
- **HAP1 / HAP2 asymmetries.** HAP1 includes 131 genes on unplaced scaffolds; HAP2 has none. More
  HAP1 gene models are quality-flagged (318 vs. 235). Strict PAV is higher in HAP2 (605 vs. 528)
  and Ks = 0 tandem pairs are about twice as frequent in HAP2 (361 vs. 167).
- **Hemizygous is assessed after quality filtering.** A gene whose only syntenic counterpart is a
  quality-flagged model is hemizygous here; `syntelog_partner_gene_id` never names a flagged gene.
- **PAV is within this genotype** (present in one haplotype of 717, absent from the other) and the
  protein search ran at DIAMOND default sensitivity with no minimum alignment coverage.
- **Array size.** `array_size` is the retained size. `array_size_detected` is given for reference
  only and exceeds it in 89 arrays.
- **Table 2.S1** was corrected on 2026-10-13: three libraries of an FT-overexpressing line that were
  labelled control are perturbation (229 control, 423 perturbation). None is in the reference panel,
  so no number in the dissertation changes.
- Naming: the ancient event is a triplication (aWGT); letter `A` in `duplication_class_code` stands
  for it.

## Availability

Gene pages and these tables: https://tsailabbioinformatics.github.io/poplar-717-atlas/ .
Analysis code is available from the author on request and will be released on publication.
