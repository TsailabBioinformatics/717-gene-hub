# Changelog

Data versions are stamped into `data/meta/manifest.json` as `data_version` and shown in the
site footer. A data version changes only when the *contents* of `data/` change.

So headings come in two kinds, on purpose: `## X.Y.Z — date — title` for a release that
changed `data/`, and a plain `## title` for one that changed only the site. The version
lives in the `VERSION` file, which `build_data.py` stamps into the manifest and
`scripts/check_version.py` holds equal to `CITATION.cff` and to the newest versioned
heading here. Unversioned headings are skipped by that check by design.

## 0.18.1 - 2026-10-13 - One tau, array links, how to cite; the old address forwards

No count changed. On the gene records, tau and peak tissue now hold one value.

**One tissue-specificity statistic (data).** The second view added in 0.18.0 (tau and peak tissue
over wild-type-control medians) is removed everywhere: gene page, genome map, gene record, About.
`x.tau` and `x.top` on each record are the dissertation's values, and the genome-map tiles, index
and overview were rebuilt from them. The per-tissue median tables on the array and allele-pair
pages remain and are labelled as medians over wild-type controls.

**Tandem-array chip.** In a gene page's header the array is a link to its page, in the same form
as the allele chip ("tandem array HAP1_U00280 · 5 genes"), for every gene of a counted array,
genes of hemizygous TD arrays included. The release gate requires an array page for each of the
13,048 tandem genes, and the browser suite follows the link on both haplotypes.

**Downloads.** Category names in the per-gene table are the site's and the dissertation's, word
for word (TD-associated CNV, Non-TD CNV, TD-associated N:N, Non-TD N:N, Strict PAV, Hemizygous TD
arrays, Non-PAV hemizygous, 1:1). The bundle was rebuilt by its own script, not edited; four files
changed (per-gene table, dictionary, headline check, README), no supplementary table did. Tables
are grouped and described by content, and neither the pages nor the README refer to chapters; the
retired-name scan now refuses that wording.

**How to cite.** About, the footer, the Downloads page, the README and CITATION.cff now say: a
manuscript describing this resource will be submitted soon; until it is published, cite this
website with version and access date; once the manuscript is available, cite the manuscript.

**Authors.** CITATION.cff lists the author only. Software assistance is acknowledged in one
sentence on the About page and in the README instead.

**Old address.** chenhsieh.github.io/poplar-717-atlas now publishes a redirect to the lab address
that keeps the page asked for (the part after #). The Pages workflow is shared by both
repositories; a step that runs only in the development repository swaps the validated site for
`redirect/index.html` just before upload, so the lab address is unaffected.

## 0.18.0 - 2026-10-13 - One set of calls and numbers: the dissertation's

The atlas is the data supplement of the dissertation, so every summary, label and export now
states the dissertation's call. Gene-level class letters, relationship categories, allele partners,
tandem flags and age bins already equalled the per-gene master table on all 63,960 genes and are
unchanged. A new release gate, `scripts/check_dissertation.py`, holds all of this.

**Anchor-pair events (data).** The event on each whole-genome duplication anchor pair is now the
frozen pair call (Ks with the karyotype topology, dS above 1.05 assigned to aWGT). 638 of 23,154
pairs changed label. Pair totals, HAP1 / HAP2: sWGD 7,081 / 7,105, aWGT 4,445 / 4,523 (were
7,392 / 7,360 and 4,134 / 4,268). No gene page shows "the call and the anchor table differ" any
more (1,042 did); the gate requires zero.

**Duplication page (data).** The class table and tiles were drawn from a class distribution written
by an older build stage (29,101 sWGD and 10,130 aWGT genes). They are now recomputed from the gene
records, per haplotype, on quality-filtered genes, and equal the dissertation's Table 2.1:
sWGD 14,136 / 14,170, aWGT 5,408 / 5,430, tandem 6,663 / 6,385, dispersed only 6,545 / 6,529,
singleton 3,665 / 3,715 of 31,819 / 31,588 genes. Each number links to the Browse query that returns it.

**One WGD call.** The exploratory "topology re-check" is no longer offered beside the adopted call,
in Browse, on gene pages or as a home-page question ("disputed, 1,355 genes"): the adopted call
already combines Ks and topology. A saved link with `?wgd=` resolves to the adopted call.

**Browse export.** Export TSV writes the adopted WGD call (it wrote the re-check: 14,748 / 14,747
sWGD genes where the call has 14,152 / 14,188), and now carries the class code, relationship
category, quality flag, LSG status, both phylostratum values and the dissertation's tissue
specificity, under a comment header with the data version and date.

**Tissue specificity (data).** The tau and peak tissue shown first on gene pages, in Browse, search
and exports are the dissertation's: mean TPM in 9 tissue groups of the 222-sample reference panel,
tau where a group mean reaches 5 TPM, tissue-specific at tau >= 0.85 with mean TPM >= 5
(1,372 HAP1 and 1,305 HAP2 genes). The per-tissue means are recomputed at source generation and
required to reproduce the master table's tau (largest difference 1.2e-07). The site's earlier
statistic (median over 213 wild-type controls in 10 groups) stays on the gene page as a second
view, labelled as a different statistic.

**Lineage-specific genes (data).** The final set of the dissertation, 583 HAP1 (380 PS18, 203 PS19)
and 621 HAP2 (418 PS18, 203 PS19), is on every candidate's record, in Browse (filter and column),
on the home page and on the Gene age page with the step-by-step counts. 104 HAP1 and 100 HAP2
candidates read PS18 with their genEra PS19 beside it. An excluded candidate reads "candidate,
excluded" with its reason (first criterion met). The line labelled abSENSE printed the
synteny-window search verdict; the two checks now have a line each.

**Names and wording.** Hemizygous TD arrays (was "TD-associated PAV"; committed from the pending
rename). Age bins read "after / before the species split, sWGD era, aWGT era" with their Ks limits
(0.02, 0.16, 1.07). Quality-flagged gene models carry a banner. The 28 genes in a 1:1 group with no
partner on record, and the genes whose listed allele is a quality-flagged model, say so.

**Search.** Accepts a transcript suffix (.1), lower case, P. trichocarpa IDs, gene names from the
lab annotation, and queries that start with a digit; two-letter names work.

**Arabidopsis best hit (data).** From the per-gene master table (lab annotation): 59,162 genes,
up from 43,748. 372 genes keep an older hit where the master table has none.

**New pages.** Glossary (terms as the dissertation defines them) and Downloads (master tables,
data dictionary, supplementary tables, with size and md5).

**About, citation, footer.** One address (tsailabbioinformatics.github.io), working repository and
licence links, a contact address, the build date and genome version in the footer. "Not for
redistribution" is replaced by "provided for research use; please cite"; no open licence is set yet.

Not changed, and said so on the page: stress responsiveness is still the median over the earlier
117-contrast set (the dissertation uses 149 curated perturbation contrasts); the free-text search
index still holds the older Arabidopsis hits; the stored age-bin and array-status keys keep their
table values, only their displayed names changed.

## Tandem arrays with no syntelog are hemizygous, not PAV

Site only. Follows the dissertation's renaming: the gene category is "Hemizygous TD arrays" and
the array status "Hemizygous (no syntelog)". Only a small minority of those arrays' genes lack a
protein-level match on the other haplotype, so "PAV" overstated it. Codes and counts unchanged;
`wording:no-internal-names` now also refuses the two retired labels.

## How to cite: Hsieh et al., unpublished

Site only. The About page's citation now reads "Hsieh et al., unpublished. Poplar 717 gene atlas,
version X.Y.Z" followed by the address. To be replaced by the bioRxiv preprint once posted (listed in TODO).

## 0.17.1 - 2026-10-03 - Hedged wording, and the home page's allele count

**Wording (site only).** A review of the reader-facing text for claims stretched past their
evidence. Borrowed evidence is labelled as borrowed: chromatin marks are from the P. trichocarpa
ortholog, peptide matches from public Populus datasets that are not the 717 clone ("Peptide
match", not "Peptide-detected"). PS19 genes carry a sampling caveat (the searched panel lacks
P. alba). Promoter positions are from the annotated gene start, not a mapped transcription
start; a TATA-box motif outside the core-promoter window gets no amber line. Inferred calls
(whole-genome duplication, ancestral karyotype) say they are inferences, the karyotype label is
positional ("collinear with"), and the topology re-check is called proposed, not adopted. The
glance strip calls an array-level allele an array-level link, not a 1:1 call. The synteny card
drops an unsourced "41%". Internal project, host and path names are kept out of page text, and
`wording:no-internal-names` now also scans for them.

**Data, one field.** `manifest.annotation.n_allele` still held the previous allele map's count
(51,862 genes, shown on the home page as 25,931 pairs) after 0.17.0 moved the allele partners;
the gene records carry 56,386 genes with a partner (28,193 pairs). Corrected, and
`check_aggregates.py` now recomputes it from the shards (it flagged the stale value before the
fix); `patch_syntelog_categories.py` writes it. No other data value changed.

## 0.17.0 - 2026-10-03 - The dissertation's final tables: duplication, alleles, PAV and relationship categories

Chen's decision (2026-10-03): adopt the latest tables fully, in one release. Source: ms1-dup
3a7a3cf (master v12, data/131_master_v12_20261002; array status, data/133_cj_array_status_20261003),
read through git at that commit with sha256 pins in `sources/syntelog_categories.pin.json`.
Nothing from those tables is vendored, because the per-gene table carries held columns.

**Duplication** moves from v9 to the v10 letters and anchors (`dup_type_v10`, `has_S_anchor`,
`has_A_anchor`): 1,054 genes change class. sWGD 14,152 / 14,188, aWGT 5,419 / 5,434 genes;
tandem membership is unchanged (6,663 / 6,385).

**Allele partners** are the v11/v12 syntelog partners: 5,654 genes change (5,038 gain a
partner, 514 lose one, 102 change). Divergence for the 2,543 pairs no published table carried
was computed on Sapelo2 with ms1-dup's own method (MAFFT + yn00; Slurm 48776839) into
`sources/allele_ks_added.tsv.gz`; positive control 19 of 20 known pairs within 0.001.

**Presence/absence** is the strict protein-level set, 528 HAP1 / 605 HAP2, equal to the
dissertation's gene set. The DIAMOND candidate record is removed from every gene.

**Relationship categories** (CJ Tsai's classification tree): every quality-filtered gene carries
one of 1:1; TD-associated N:N; Non-TD N:N; TD-associated CNV; Non-TD CNV; Strict PAV;
TD-associated PAV; Non-PAV hemizygous. Tandem arrays are one unit. Counts, HAP1 / HAP2:
22,704 / 22,704; 2,999 / 2,999; 68 / 68; 3,897 / 3,673; 98 / 116; 528 / 605; 159 / 141;
1,366 / 1,282; 318 / 235 quality-flagged genes are not classified. Counted tandem arrays carry a
status: N:N (same copy number) 1,229 / 1,228; CNV, arrays in both haplotypes 557 / 550; CNV,
HAP1-specific expansion 285; CNV, HAP2-specific expansion 259; CNV, array only on the side with
fewer copies 0 / 1; PAV (whole array) 48 / 47.

**Pages.** A "Relationship to the other haplotype" card on every gene page; status, matching
arrays and the syntenic group on each array page (outlined in the locus figure); a status column,
filter and per-haplotype table on the array list; a Browse filter by category. The WGD Browse
filter now uses the primary call; the topology re-check moved to the exploratory group (it now
differs from the primary call on 1,355 genes). No internal version, folder or project names
render anywhere; the About page no longer renders the provenance records or the source-file
table, which stay in the build files and the manifest.

**Gates.** `check_facts.py` asserts the v10 duplication basis and all eight category counts plus
strict PAV against the pinned category facts. `validate_data.py` gates strict PAV, category
coverage, mutual alleles, divergence coverage and array-status coverage. `check.mjs` adds
`relationship:reader-names` and `wording:no-internal-names` (with a planted positive control).

## 0.16.3 - 2026-10-02 - Genome-map LSG marks resynced; dissertation wording

**Data.** 114 genes (66 HAP1, 48 HAP2) were still marked as lineage-specific in the genome
map's per-chromosome index (`data/locus/index/`), although their gene records and the locus
tiles had left the pool when it moved to the Idesia-corrected call (776 HAP1 / 835 HAP2). The
map's LSG track and its counts read that index, so they showed 842 / 883. `patch_map_overlays.py`
now resyncs the index as well as the tiles, under the same gate (only genes whose membership
differs from the frozen call may change), and `validate_data.py` checks every index mark
against the gene record. No other value changed; the atlas stays on the v9 duplication basis.

**Wording, to match the dissertation.** The two whole-genome events are labelled aWGT (ancient
whole-genome triplication) and sWGD (salicoid whole-genome duplication) wherever a reader sees
a class, copy or partner name; URL parameter values are unchanged, so saved links still work.
"neighbor" spelling; no em-dashes in rendered text (commas in prose, en dashes in empty cells);
"compared with" or "vs." between numbers instead of "against".

## One locus browser on every page, and the link that matters is marked

Site only; no data changed. The gene page ("This locus on HAP2 too"), the array page and the
pair page now embed the genome map's own two-haplotype browser (`js/core/locusbrowser.js`,
split out of `genomemap.js`) instead of three different static figures. Drag to zoom (pan on a
phone), buttons for both, and exon structure and gene IDs appear when zoomed in; "Open in the
genome map" carries the same window across. Tiles are fetched for the window in view only.

Links are now classified, so the reader can tell which one matters: the page's genes and their
own alleles are filled and joined by a solid line; neighbouring genes used only to line the two
haplotypes up (when the page's genes have no allele) are dashed and limited to the nearest two
on each side; every other allele pair is thin and grey. The array page no longer shades every
tandem gene on the other haplotype. It names the matching array there (the one holding the
members' alleles), outlines its members in the figure, and says when no member has an allele.
The folded single-haplotype Locus strip and the SVG track figure are gone; the RNA-seq
gene-model card stays.

## 0.16.2 - 2026-09-30 - Faster pages, the allele an array reaches, and which arrays are counted

No value in any layer changed. Two index files changed form, both written by `build_facets.py`
from the committed shards and both decoded and compared with every gene record in
`validate_data.py`: `desc.json` is dictionary-encoded (837 KB -> 357 KB gzipped), and the new
`pos.json` holds every gene's start and length (292 KB), replacing the 38 locus files the
karyotype page fetched (86 -> 48 requests, 2.3 -> 1.3 MB).

**Faster.** `index.html` preloads the whole module graph (generated by `sync_preload.py`,
checked in CI). On a simulated mobile connection every page shows content 0.3-0.5 s sooner.

**The allele an array reaches.** A tandem gene with no 1:1 syntelog of its own now shows, on its
Allele card, header and glance strip, the alleles its array-mates carry and the matching array on
the other haplotype, labelled as an array-level link (CJ's tandem rule, master v11
`td_array_associated`). Checked against v11's own partner column.

**Counted arrays.** The array list and array pages say which arrays the manuscript counts
(2,119 HAP1 / 2,085 HAP2, a member that passed the pseudogene screen) and mark the 167 detected
arrays the screen removed and the members it removed from 89 others.

**Smaller things.** Study pages lead with the paper title and first author, and no longer print
the reference-formatting notes two citations carry after their link. On phones the header
scrolls away. The footer no longer names MS2_2026. Headings use the sans.

## 0.16.1 - 2026-09-29 - A redesigned site: herbarium look, grouped Browse, and deeper views

No value in any layer changed. One file was added: `data/index/desc.json`, one short
description per gene aligned with `genes.json`, written by `build_facets.py` from the committed
shards (Phytozome description, else the Arabidopsis hit's defline prefixed "similar to"), so
the Browse table can say what a gene is. 57,527 of 63,960 genes have one.

**Look.** A new visual identity chosen by Chen from three mocked directions: paper, ink and a
moss accent, a serif display face, an aspen-leaf mark. Chrome only: the CVD-validated data
palette is unchanged, and every link still clears WCAG AA in both colour schemes.

**Browse.** Filters moved into a sidebar grouped by question (genome; age and conservation;
duplication; expression; function and protein; selection), with the disputed and exploratory
calls folded away. Every option shows how many genes it would leave. The table sorts by any
column, has a description column, and a pasted list of gene IDs narrows it (unknown IDs are
named). URL parameters are unchanged, so every existing link still works.

**New and deeper views.** A search-first home page. A gene-page header with the description,
key facts and actions (compare alleles, genome map, download the record). A genome map track
browser with both haplotypes, allele links, zoom and shareable windows. Painted ancestral
chromosomes on the karyotype page. A page for every tandem array (#/array/<id>) and a list of
all 4,371 (#/arrays). A side-by-side allele pair page with both gene models and expression on
one axis.

## 0.16.0 - 2026-09-26 - The pool is the rerun that added Idesia again (776/835), and two checks flag it

ms2-lsg's corrections log, C5 (commit `8eb65b0`): "make the new canon with the idesia included run
as the canon, and only AbSENSE and synteny check are the QC steps" (Chen, 2026-09-21 evening,
reconfirmed to two sessions on 2026-09-26). C5 reverses C4, the ruling 0.15.0 implemented. The
chapter, its figures and the files with the advisor moved to 776/835 on 2026-09-21; this site
served the reversed pool for five days, with every check green, because every table it pinned was
byte-identical upstream: only the ruling on them had changed.

**The pool.** 776 HAP1 + 835 HAP2 genes (PS18/PS19: 433/343 and 497/338), rank 18 or above in
the genEra rerun that added Idesia polycarpa and first searched the full comparison panel, on
every page: gene pages, the home page, the phylostratigraphy page, Browse, the genome map and the
locus tiles. `ps` is that call; the frozen 2026-04 call sits under `ps.frz` on the 766 genes where
its rank differs, shown on the gene card as "Frozen call ... superseded as the pool", and used for
nothing else. The 66 HAP1 + 48 HAP2 genes that left the pool say so and why (a rank change, not a
failed check), and carry no QC record. `ps.rr` is gone.

**Two QC checks.** The evidence card flags abSENSE (84 HAP1 + 106 HAP2) and the synteny window
search (96 + 104); 6 + 10 carry both. "In the chapter's post-QC set (neither QC flag)" is one line
under them (602 + 635). Gone: the Idesia-rerun flag (the rerun is the pool now) and WGD-era Ks
(C5 removed it; duplication is its own card). The synteny-contest routes, short ORFs and the
DIAMOND-sensitivity note stay, listed as "Other evidence, not QC flags".

**Also fixed.**
- The locus tiles carry their own pool mark and cannot be rebuilt on the cluster. They are now
  rewritten from the shards by `patch_map_overlays.py`, gated so a mark may only change on a gene
  whose membership differs between the two calls (114 changed), and `validate_data.py` holds every
  tile mark equal to the gene's `ps.lsg`. Under 0.14.0 they disagreed with the gene pages on 114
  genes for eleven days and nothing noticed.
- The gene family (size and origin stratum) now comes from the same genEra run as the gene's
  rank. It came from the frozen run, and joined to the rerun's ranks it made a family look
  younger than its own member on 419 genes. The rerun's founder families were rolled up and
  committed to ms2-lsg for this (`data/founder_families_rerun_20260926/`, e05215e); new source
  `sources/founder_families_rerun.tsv.gz` via `make_founder_source.py`, applied by the new stage
  `patch_founder_rerun.py`. Gates: 0 families younger than a member across 15,040, and every
  gene's rank in that table equals the pool call's. Family origin cannot be shown on 45 genes,
  all with no rank in the pool's run: 6 with no family assignment, 39 whose gene age is missing
  from the run (they do have a family). The card says "family origin not shown: the current pool
  run gives this gene no rank", the reason true of all 45. The 49 pool genes whose family is older
  than the lineage (16 from cellular organisms) say they are a young member of an older family,
  not a lineage-specific family.
- The Protein page's per-stratum peptide numbers are the owning analysis's, ranked by the rerun,
  so they and the pool agree again (TODO 53 closes).

**Checks.** `patch_pool_frozen.py` became `patch_lsg_pool.py`. `check_ms2_canon.py` pins ms2-lsg
`0ddd994`, adds `pipeline/out/lsg_pool_flags_newpool.tsv` (the two C5 flags, committed upstream
today) and compares every pool gene's rank, membership, frozen call and flags with it, gene by
gene; it no longer pins the four-check `lsg_pool_qc.tsv`. New section 0 compares each pinned
table and ms2-lsg's `docs/CORRECTIONS.md` with the clone's origin/main and fails when the log has
moved: pinning tables alone is what let C5 go unnoticed. It also pins the C5 entry's own hash,
so a failure says whether the ruling the atlas follows changed or the log merely grew, and it
prints the headings added since the pin. Positive controls: a log pinned at the C4 commit fails
and names C5 as new while the ruling check passes; an altered section hash and a missing heading
each fail on the ruling. The founder table is pinned by blob AND sha256 (its first commit had
silently dropped the data file), and section 4 compares every gene's family with it.

## 0.15.0 - 2026-09-21 - The pool is the frozen genEra call again, and every check on it is a flag

Chen's ruling, 2026-09-21: "the 842/883 is the frozen but the various QC steps from Idesia to
synteny to abSENSE ... are all for flagging and will apply for individual analysis when
suitable, for most of the analysis they are applied and we plot the post QC for stronger signal
but when looking for available candidates they are used to flag because the pool is already
small". Settled with the main MS2 session before it was built, and published together with the
matching ms2-lsg documentation (ms2-lsg `13fa12f`, which records the ruling in its corrections
log; the atlas's ms2-lsg pin moves to that commit, every pinned table's blob unchanged).

**The pool.** 842 HAP1 + 883 HAP2 genes (PS18/PS19: 392/450 and 454/429), rank 18 or above in the
frozen genEra call, everywhere: gene pages, the home page, the phylostratigraphy page, Browse and
the genome map. It does not change. From 2026-09-10 until today the atlas used the ranks of the
rerun that added Idesia (776 + 835) as the pool, and kept the frozen call under `ps.frz`; that
arrangement is reversed. `ps` is the frozen call again, including its taxonomic
representativeness, which the swap had overwritten on 1,251 genes; the rerun's call sits under
`ps.rr` on the 766 genes where its rank differs, and the gene card shows it as information.

**Every check is a flag, on every pool gene.** All 1,725 pool genes now carry the evidence card;
the 114 that fall below rank 18 in the rerun had none. New on the card:
- the rerun flag: "falls below rank 18 in the rerun that added Idesia and searched the full
  comparison panel", with the rerun's rank (66 HAP1, 48 HAP2). Worded so it does not credit
  Idesia alone: that rerun was also the first to search the comparison panel at all, because the
  frozen call searched NCBI nr only;
- one line under the flags: "In the chapter's post-QC set (passes all four checks): yes/no",
  where the four checks are the rerun, tblastn against Salix, abSENSE and WGD-era Ks (589 HAP1,
  625 HAP2 yes). It is never called "clean", and it hides no flag: synteny contests, short ORFs
  and sensitivity flags are listed on every gene that has them.

The rerun and the post-QC set appear on overview pages only as pass counts, never as pools.

**What did not move.** The locus tiles already marked the frozen pool (they were never rewritten
after 2026-09-10, so for eleven days they disagreed with the gene pages on those 114 genes). The
peptide numbers on the Protein page are the owning analysis's, which ranks genes by the rerun;
they now say so, and a recompute on frozen ranks has been asked for.

**Built and checked.** New source `sources/lsg_pool_frozen.tsv.gz` (ms2-lsg's frozen pool table,
candidate labels dropped, one duplicated gene collapsed; gated against the rerun table's frozen
columns). `patch_pool_idesia.py` became `patch_pool_frozen.py`; `patch_lsg_qc.py` flags all 1,725;
the map bins (104 changed) and the Browse index were recomputed. `check_ms2_canon.py` now pins
ms2-lsg's frozen pool table too and passes gene by gene: frozen ranks, the rerun call, every flag
including the rerun flag and the post-QC set, and all 84 peptide cells.

## 0.14.0 - 2026-09-21 - NRX1's copies on both haplotypes, and every gene card says what kind of evidence it is

Two additions to the gene page.

### Copies on both haplotypes

From any of NRX1's seven HAP1 gene pages, nothing led to HAP2. None of the seven copies has an
assigned allele, and a gene table can only show annotated genes. The Duplication band now carries
a panel that is the same on every gene page in the locus. It draws each copy on both haplotypes as
the part of the 564 aa protein that stretch of genome still encodes:

- **HAP1:** 7 annotated copies covering 53-95% of the protein, plus an eighth the annotation does
  not call (73%).
- **HAP2:** no copy longer than 48%. There are three pieces within 17 kb. Two sit under a single
  gene model, `PtXaAlbH.10G043900`, 4.8 kb apart. The most complete piece is not annotated at all.

The panel also has its own page, `#/copies/nrx1`. The gene page's summary strip gains a **Both
haplotypes** row that jumps to it. The layout is drawn at the container's real width, so on a
phone the labels move above the bars instead of shrinking.

**Where the copies come from.** A search of the genome sequence: tblastn of the array's proteins
against each whole haplotype genome. It is committed as `sources/copy_search.json` by
`scripts/make_copy_search_source.py`, which runs on Sapelo2 by hand, like the other source makers.
A new build stage, `patch_copies.py`, publishes it. Nothing in it is hand-picked:

- The search region is bounded by the nearest genes with an allele on each side of the array.
- The bound that separates pieces is measured on the array itself: its longest gene model, 3.3 kb.
- The search must recover all seven annotated HAP1 copies, or it writes nothing.
- Re-running it reproduces the committed file byte for byte.

The panel cannot disagree with the gene pages it sits on. Annotated genes carry their gene
shard's own position, and peak TPM is read from each gene's record when the panel is drawn.
`validate_data.py` checks both on every build, with 6 new gates.

**What it does not claim.**
- Exact gene structures. tblastn does not model introns, so identity reads low across one; the
  reference aligned to its own gene reads 96%.
- Anything about the expression of unannotated pieces, which the expression index cannot measure.
- Anything about other loci: only NRX1 has been searched.

Tried and rejected, both recorded in `sources/copy_search.provenance.json`:
- A spliced aligner (miniprot). It chained separate HAP2 pieces into single alignments spanning
  11 and 75 kb, which is the very joining the panel exists to show.
- A piece-separating gap measured inside intact copies. It cut HAP1's unannotated copy in two.

### Evidence weight

The gene page was already ordered from the strongest evidence to the weakest, but every card
looked equally authoritative. Each card now says where its evidence comes from, in a chip: **from
the genome**, **measured here**, **measured in P. trichocarpa**, **predicted**, **by homology** or
**database-dependent**. Its left rule carries the same distinction in a form that survives
greyscale: solid, dashed, or dotted on a recessed card.

The table is `CARD_EVIDENCE` in `js/core/registry.js`. A card with no entry is a console error,
which fails the render checks, so a new card cannot arrive looking like a measurement. Cards
used to be identified by module, and a module can draw cards of different kinds, so the extra
cards now carry their own identity: allele, selection, presence variation, panel presence,
chromatin, gene model.

Two cards near the top are recessed on purpose. **Function** and **Panel presence** sit in the
Identity band, but both are inferences by homology.

Also: the home page's question list no longer overflows a 375 px phone (it did by 74 px).

## Pages publishes only the site, and only after checks pass

Chen, 2026-09-21: "merge pages-site-only and turn on the site-only deploy". Until today GitHub
Pages published the repository root, so `scripts/`, `docs/`, `TODO.md`, this file and every
`sources/*.tsv.gz` table were public beside the site, which is how unpublished candidate labels
reached the public site without ever being in its data. `.github/workflows/pages.yml` now
publishes `index.html`, `css/`, `js/`, `data/`, `sources/*.provenance.json`, `LICENSE` and
`CITATION.cff`, and nothing else; the assemble step fails if anything more reaches the artifact.
It deploys only a commit whose `checks` run succeeded, where the branch deploy published `main`
whatever CI said.

The list was measured, not guessed: a full walk of the site requested nothing outside it.
Checked on the live site after the switch: pages, Range reads, the 3D model and the provenance
records load; `scripts/`, `docs/`, `TODO.md`, `CHANGELOG.md`, `README.md` and the `.tsv.gz`
tables answer 404. **A file the site starts fetching must be added to `pages.yml` in the same
commit**, because every local check serves the repo root and would not notice.

## 0.13.2 - 2026-09-21 - The LSG layers checked against ms2-lsg, gene by gene, and nine wrong sentences

An audit of every lineage-specific-gene layer against the tables that own it (ms2-lsg main at
`2cd2b59`). **The per-gene data was right**: all 63,960 genes' corrected and frozen ranks, both
pools (776 HAP1 / 835 HAP2 corrected, 842 / 883 frozen, with the PS18/PS19 split of each), every
QC flag on all 1,611 pool genes, and all 84 dataset x haplotype x class cells of the peptide
evidence reproduce the owner's tables with zero mismatches. **The sentences around the data were
not.** Nothing in `data/genes` changed.

**Wrong on the page, now corrected**
- **QC card, 10 pool genes (4 HAP1, 6 HAP2):** "the chapter's headline result changes if this one
  gene is excluded". The field is `sens_stable`: whether the synteny call is the same in the
  default and `--ultra-sensitive` DIAMOND runs (ms2-lsg repro audit E3), which the synteny card
  on the same page already said. The wording came from the upstream sidecar and is flagged there.
- **QC card, 389 pool genes (177 HAP1, 212 HAP2):** a gene clean on the funnel's three checks
  read "No evidence-quality flag raised" and hid its other flags: 21 synteny-contested, 369 short
  ORFs, 4 sensitivity-unstable. `clean` is the AND of tblastn, abSENSE and WGD-era Ks only, so
  the card now says that, and lists the rest on every gene that carries them.
- **Protein page:** "0.12% of the lineage-specific pool", pooled over haplotypes. That was the
  published Tier 2 figure, 2 of 1,611; one of the two hits (PtXaTreH.14G041300) fails 1% FDR in
  the expanded-database re-search this layer ships and was withdrawn upstream on 2026-09-09. The
  shards never carried it. Now per haplotype: 1 of 776 HAP1 and 0 of 835 HAP2 in PXD025636, and
  the five-dataset union per stratum, all recomputed by `check_prose_numbers.py`.
- **Protein page and its provenance record:** the datasets whose samples contain no 717 protein
  were named as PXD025418 and the two P. x canescens sets. P. x canescens is 717's own cross; the
  other-species sets are PXD025636 (P. trichocarpa), PXD020099 (P. tremula x tremuloides) and
  PXD025418 (P. tomentosa), as the owning analysis says.
- **About:** "no rank for 50 genes" was the frozen call's count; the corrected call leaves 27 HAP1
  and 18 HAP2 unplaced, and the coverage row beside it computed 63,960 through a no-op expression.
  "77 leaf" baseline samples was the pre-2026-09-05 pooled count (now 55 leaf + 11 young + 11 old,
  read from the manifest). Three limitation lines were stale: the DIAMOND PAV layer does ship
  (without a quotable number, deliberately), duplication is held on v9 rather than "v6 not synced",
  and a ComBat-seq view exists.
- **Gene-model card:** "An 827-library expansion is in progress and will supersede this panel".
  The enlarged panel is 1,755 libraries on an unmerged ms2-lsg PR held for Chen's review.

**Framing, on Chen's instruction ("split + name both")**
- Home and Phylostratigraphy report the pool per haplotype and per stratum instead of one pooled
  1,611, and the ladder is two ladders on a shared log scale. The phylostratigraphy page names the
  frozen pool the chapter text reports (842 HAP1 / 883 HAP2) beside the corrected one.
- The frozen call is "the frozen genEra call", not "withdrawn" (the chapter still reports it) and
  not a "12-species panel" call (MS2 consistency audit A38 found that run searched nr only; Chen
  has not named it yet). A pool exit now says it left by a rank change rather than implying it was
  never QC-checked: it has upstream QC values, and this atlas shows QC flags for the corrected
  pool only.

**Embargo.** GitHub Pages serves the whole repo root, not just the site. The unpublished candidate
labels sat in this CHANGELOG, a build-script docstring, two docs, the validator's own embargo list
and a provenance record the About page renders, and two of those paired a label with its gene ID.
All scrubbed from the current tree (history is private). `validate_data.py` now matches the label
SCHEME rather than listing the names, and scans every tracked text file, not only the shards.

**Data (hence the version).** `manifest.proteomics.method` named the original 98,659-target
database; every shipped search used 135,843 targets. `age_gradient_pct` was a hand-typed,
haplotype-pooled copy of the pre-withdrawal Tier 2 figures; `patch_proteomics_v2.py` now computes
it per haplotype from the shards and asserts the pool union against the owner's numbers. Recorded
in `manifest.corrections`.

**New check.** `scripts/check_ms2_canon.py` compares every gene against ms2-lsg's tables, read
through git at a commit pinned with each table's blob ID (`sources/ms2_canon.pin.json`, no values),
and refuses rather than skips if it cannot. It runs in `build_all.sh` before `check_facts.py`.
`check.mjs` gains a `forbid` option and seven checks that fail if any corrected sentence returns.

**Not changed, flagged for Chen.** The expression baseline is "WT and raw `ctrl == control`", which
in study 1 includes 500 ppm CO2 and second-timepoint controls; the chapter's stress rule builds
arms from `lib/contrasts.py` instead. The atlas's tau is that baseline's tau over its own tissue
grouping, not the chapter's (Methods 2.4). Both are definitions to decide, not bugs to patch.

## Response by contrast, and a card that could be moved without breaking

The Expression card stated one number for perturbation response — `resp.v`, a median |log2FC| —
and no way to see which comparison moved the gene. **Contrasts** is now a second view of that
card: every shipped contrast scored for this gene, the ten largest drawn as diverging bars.

Nothing new is built or shipped for it. `data/expr/contrasts.json` already names each
comparison's control and perturbation sample indices and `loadExprVector` already returns the
gene's 652 values; the fold change is those two facts multiplied out in the browser. The reverse
question — *which genes respond to drought* — needs every gene's vector and is deliberately not
attempted.

**Every bar carries its sample counts**, because that is what decides whether a bar means
anything. The median contrast here is n=3 per side and 27 of the 191 have a single sample on one
side; those are drawn (hiding them would misrepresent the panel), dimmed, and counted in a
caveat. The card states that it is a descriptive ratio and not a differential-expression test:
no dispersion model, no multiple-testing correction, study not accounted for.

The numbers were computed independently in python straight off the expression blob *before* the
panel existed, and the browser reproduces them exactly — 191 contrasts, median 0.579, +6.13
chronic drought at n=3v3 on a WNK-family kinase, where annotation and measurement agree. The
check asserts those values, so it is a cross-implementation comparison rather than the panel
agreeing with itself.

### The merge was detaching cards

`mergeViewGroups()` moved a card's CHILDREN into its panel, which detaches the card element. Any
module that mutates its own card after construction then wrote into a node no longer in the
document — and the Expression card does exactly that: "Show all 652 samples →" appends a holder
to `card`. **That button silently did nothing** in the previous release. It now moves the card
element itself, so every such closure stays valid.

### Cards have identities now

Checks kept finding cards by heading text or by position, and both kept breaking: `.locus-canvas`
is a style class shared by four modules, `canvases[canvases.length - 1]` is a position, and
`.card.viewgroup` stopped being unique the moment Expression became a second merged card. Every
gene card now carries `data-card="<module id>"`, stamped in `app.js` — including the inline
Location card and the merged hosts, and carried along when a card moves into a panel. The
scrubber, mirror, dupheatmap and locus checks now key off that.

The new view was also renamed from "Response by contrast" to **Contrasts**: the scrubber card has
a button labelled "By contrast", one name contained the other, and a substring selector for
either matched both. That is a problem for a reader before it is a problem for a selector.

One check was clicking a canvas at viewport coordinates measured before `viewText()` revealed the
collapsed panels, which makes the page taller and moves the target. It clicks element-relative now.

116 render checks pass.

## Duplication: one card, two views — and the other haplotype drawn properly

The gene page ran a 645px figure called **Duplication layers** directly above a 1422px card
called **Duplication**, and the two named *exactly* the same partners — four partner ids in the
card, all four drawn by the figure, none in one and not the other. They are now one card headed
**Duplication** with a view switch: **Layers** (the figure) and **Partners & evidence** (the
class, the whole-genome duplication events, the route C re-adjudication, the anchor-pair table
with dS and expression, the ancestral karyotype slot table where this gene's syntelogs sit, the
array's history and members). The provenance tag beside the heading follows the active view, so
the card never credits one view's source while showing the other's content.

The merge is presentational: both modules still build their own complete card, and
`mergeViewGroups()` moves the contents into panels. Modules may not import one another, so
neither could host the other's view, and merging the code would have meant relocating 800 lines
of SVG rendering into a 632-line module. Any two cards can now declare themselves two views of
one answer by sharing a `data-view-group`.

**Collapsed does not mean unfindable.** The first version put the inactive panel behind
`display:none`, which browsers' find-in-page cannot search — on a site people Ctrl+F a gene id
in, that made every partner id in the tables view unreachable. Panels now use
`hidden="until-found"` with `beforematch` wired to switch the tab, so search reveals them.
Browsers without support treat the attribute as plain `hidden`, i.e. the old behaviour, so this
only ever adds.

### The other haplotype: a whole row to say a one-to-one thing

The allele had a track of its own — a full row and a long-dashed link crossing the figure, to
say "this gene also exists over there". That row is gone and its dS is stated in words instead.
Fuzzy MYB drops from four rows to three.

In its place, **Compare the other haplotype** draws the second haplotype's *architecture* as a
second block, which is the comparison actually worth making: the two haplotypes frequently carry
different numbers of copies, and the card now says so — *"Tandem copies differ between the
haplotypes: 4 on HAP1, 2 on HAP2. A count from one haplotype is not the gene's copy number."*

**The counterpart is found by family, not by allele**, and that is the whole point.
`PtXaTreH.08G070200` has **no** one-to-one allele, and neither does `PtXaAlbH.08G073700` — an
allele-driven lookup reaches neither, and a tandem array that expanded on one haplotype is
exactly the case that has no one-to-one partner. Family `F10956` contains all ten genes of the
set, so the lookup falls back to it and picks the member on the other haplotype that is the same
kind of thing: same chromosome first, then tandem, then the largest array.
`loadFamilies()` moved to `core/data.js` for this, since two modules now need it.

### Home page

Three examples with three different shapes of duplication: the original PS18 gene,
`PtXaTreH.08G070200` (all four duplication types at one locus, and a different copy number on
the other haplotype), and `PtXaTreH.10G046700` (a seven-copy nucleoredoxin array with no
one-to-one allele called — the pattern a hemizygous locus leaves, though an uncalled allele is
not by itself proof of one).

### What the checks got wrong, and one bug they hid

Four `duplayers:*` checks located this view by its `<h2>`, which the merge replaced; they key off
`.viewpanel[data-view="layers"]` now. That is the second release running in which a check turned
out to be anchored to something presentational rather than to what the thing *is* —
`.locus-canvas`, a style class shared by four modules, was the first.

Eighteen text reads went through a new `viewText()` helper that reveals collapsed panels before
reading, because `gene-array-history` asserts content from BOTH views of one card and no single
active view can satisfy it. A separate check asserts the panel really is `until-found` rather
than `display:none`, so revealing it for content assertions is not taken on trust. Scoped reads
(`h3.parentElement.innerText`) need `revealViewPanels()` explicitly — `karyotype:haplotypes-not-pooled`
was reading an empty string from a collapsed panel and failing while the page was correct, and
it reported a bare FAIL with no numbers, so it now prints what it found.

**The regex that introduced `viewText()` rewrote the helper's own body**, turning its last line
into `return viewText(page)` — unbounded recursion. The symptom was a node process at 100% CPU
for 41 minutes producing no output at all, because it never reached a log line. `node --check`
passes happily on infinite recursion. A transformation that matches its own definition is the
same failure as a `pgrep -f` waiter that matches its own command line, which also happened
today.

115 render checks pass.

## The gene page gets an order, a summary, and a way around it

A gene page carries nineteen cards. Until now their running order was **the order the modules
happened to be imported in** — so a predicted promoter motif could sit above the duplication
class, and the expression summary landed near the bottom. Nobody chose that.

**The cards are now in bands, ordered by what the evidence is.** Identity, Duplication,
Synteny & position and Expression are measured on this assembly. `Predicted & indirect` is
last — and last rather than merely lower, so a reader who stops scrolling partway has stopped
*before* the weakest evidence rather than in the middle of it. That band says why it is there:
motif and structure calls are predictions, the chromatin is measured in *P. trichocarpa* and
transferred, and a phylostratigraphic rank is a property of the database it was searched against.

**An "At a glance" strip** answers *what am I looking at* in one card: duplication class,
synteny class, peak tissue and τ, responsiveness, allele. It **computes nothing** — every value
is repeated in full, with its caveats, in the card it came from, so it cannot drift from what it
summarises. It deliberately shows no syntelog count: `syn.n` is how many of the twelve panel
genomes the orthogroup spans, and the only literal syntelog list on the record (`aek.an[].sl`)
ships marked *exploratory*, so it stays in the card carrying that caveat.

**A sticky section nav**, built from the cards that actually rendered rather than a fixed list,
so a band that produces nothing leaves no dead link.

### The two locus cards were drawing the same thing

`mirror.js` fetches the same `loadLocusTile` data as `locus.js` and draws the same genes over
the same window — its own header comment says so. Two full-width strips of the same
neighbourhood ran back to back. The Locus card now **folds shut by default**. It is folded and
not deleted because it is the only view with exon/UTR structure and the only panning control on
the page; the mirror has none, so removing it would leave no non-gesture way to move along the
chromosome (SC 2.5.1, Level A). The fold names what it adds rather than being a mystery drawer.

### The header was ten tabs in import order

Now six: `Home · Browse · Map · Karyotype · Layers ▾ · About`. Ways in stay visible, the five
per-topic overviews group under Layers **in the same order as the gene page's bands**, About is
last. A `<details>`, so keyboard operation and expanded state come from the platform; the group
marks itself when the current page is one of its children, or the header would show nothing
selected on five of the site's pages. Every one of the ten destinations is still one click away,
which is the only thing that makes grouping acceptable and is asserted in the checks. The phone
header drops from 170px to 127px.

### Latent bugs this surfaced

- `locus-desktop`, `locus-phone` and `mirror:cross-haplotype-click` all broke the moment the
  running order changed. They were reading `document.querySelector('.locus-canvas')` and
  `canvases[1]` — but `.locus-canvas` is a shared **style** class used by the locus, mirror,
  genome map and scrubber canvases. Those checks were measuring whichever canvas happened to be
  first, and passed only by accident of import order. All three are now scoped to their own card.
- The first scroll-spy compared `IntersectionObserver` rects, which are snapshots from when each
  entry last fired, so scrolling back to the top left the last band still marked.
- Its trigger line then sat *above* where `scroll-margin-top` parks a heading, so jumping to a
  band marked the band before it.
- `text-transform: uppercase` turns **τ into "T" and ω into "Ω"**.
- On a phone `header.top` wraps to three rows (170px measured, not 47), so the section nav's
  sticky offset is measured at runtime and the nav becomes one swipeable row below 640px.

`registry.js` now refuses to load if a module draws a gene card and is named in no band — that
card would otherwise simply stop being appended, with nothing failing.

114 render checks pass.

## CI was testing against a server that ignores Range

Release 0.12.0 moved per-gene expression to byte ranges and made the client refuse any response
that is not a `206`. The refusal is the substance of the design, not a nicety: a host that
ignores `Range` answers `200` with the whole blob, and a client that accepted that would inflate
its first member and draw **another gene's** expression profile — correctly, legibly, and
silently wrong.

`scripts/serve_ranges.py` was written in that same release precisely because
`python3 -m http.server` does exactly that. Local checks moved to it. **CI did not.**
`.github/workflows/checks.yml` kept serving with `python3 -m http.server`, so every expression
fetch in CI failed, and the suite died six minutes in on a locator waiting for a `.card` that
could never fill. The message named a missing card. The cause was the server.

Two changes:

- CI serves with `scripts/serve_ranges.py`, so it exercises what GitHub Pages actually does
  (verified 206, identity-encoded).
- `check.mjs` **preflights its base URL** with a real Range request and refuses to start without
  a `206`, printing the reason and the fix. A misconfigured host now fails in under a second
  under its own name instead of six minutes later under someone else's.

The second is the more important one. This bug was trivial to fix and expensive to *read*,
because the suite reported the symptom furthest from the cause — and the same class of mistake
had already been caught once here, when a gate that "passed" was iterating over zero rows. A
check that does not validate its own preconditions can fail for reasons it will never name.

Also in this release: the footer links to `#/status`, beside the build number it already states.

110 render checks pass.

## 0.13.1 — 2026-09-19 — `#/status`: the gates this build passed, published

The About page told readers the data was validated and published none of the evidence. Seventy-six
integrity gates ran on every build and their verdicts died in a terminal on the cluster.

`validate_data.py` now records each gate **as it executes** — `check()` appends the verdict, so
this is not a summary written afterwards — into `data/meta/gates.json`, and `#/status` renders
the record as a boot log:

```
tandem (TD) gene counts match the canonical union set ... [ OK ]
  {'hap1': 6663, 'hap2': 6385}
dup.ccd is set exactly where the two WGD calls differ ... [ OK ]
  904 genes disagree
```

The record is written **even when a gate fails** — a build that shipped with a known failure
should say so on the site rather than hide it — and the page warns when the record's data version
differs from the one being served.

**On the visual language.** The control-room aesthetic (a reference Chen shared) is borrowed only
where it is earned: a boot sequence with a right-aligned verdict column is what this data
literally is, and the dot leader is a real alignment device — it ties a long label to a
right-aligned value across a wide screen, which is the job it did on a teletype. What is **not**
borrowed is the decorative half of that language: no invented telemetry, no callsign columns, no
character-scatter standing in for a point cloud. On a page whose entire argument is that its
numbers are real, texture imitating data would undo the argument it is dressing up.

**The page states what the gates do not prove.** They check the committed data against itself;
they cannot tell a reader an upstream measurement was correct. And a gate passing over *zero rows*
proves nothing — this project shipped exactly that after the expression repack, when "every
pointer resolves" passed while iterating over an empty set. So where a gate asserts a count rather
than a shape, the count is in its detail line, which is the difference worth reading.

`check.mjs` asserts the page renders **every** recorded gate rather than a truncated sample, and
that the header counts agree with the lines beneath them.

## 0.13.0 — 2026-09-19 — `#/family/<gene>`: the whole descent group, walked to exhaustion

The atlas holds a homology graph and showed one node of it at a time. "What is the full
duplication family of this gene, and which relatives are only reachable *through* another
member?" took N page loads and a notebook.

**The measurement came first, and it gated the build.** Connected components over tandem
membership, WGD anchor pairs, HAP1/HAP2 alleles and paralog pairs — 160,898 directed edges —
give **16,266 families over 60,612 genes, median 3 members, largest 85**. Had those edges
chained the genome into one giant component, this view would have rendered 20,000 rows and been
useless. That was the falsifier, run before any of it was written.

On the Fuzzy MYB locus it reads as a complete history: three tandem neighbours and both WGD
partners at one step, their HAP2 counterparts at two steps *via the allele edge*, then members
at three and four steps — 10 genes across 6 chromosome/haplotype locations.

**Then the measurement changed the design.** The proposal was a radial layout with radius = dS
from the focal gene. That cannot be drawn honestly: **most members have no dS to the focal gene
at all**, because they are reached through another member, so their radius would be invented. A
force-directed layout is worse — its equilibrium encodes nothing, while a reader correctly
assumes position in a scientific figure means something.

So the page renders what the data supports: every member, the edge type that **first reached**
it, and **graph distance**, which is exact. A card titled "Why this is a table and not a
picture" says so, and points at the Duplication-layers card for the single hop where the
geometry is real.

- A gene with no homology edge gets the real explanation — 3,348 genes are in that state — and
  is deliberately **not** given a family of one, which would make "this gene has a family" true
  of every gene in the atlas.
- A component member the walk never reached is listed as `unreached` rather than dropped; a
  missing row would read as a smaller family.
- Clicking any member recentres the family on it, and `check.mjs` asserts that recentring on the
  furthest member yields the **identical membership** — a family that changed depending on where
  you entered would be a bug in the walk, not a view.
- New: `scripts/build_families.py`, `data/index/families.json` (1.45 MB), `x.fam` on each gene.

## 0.12.4 — 2026-09-19 — The numbers stated in prose are now checked too

`check_aggregates.py` recomputes every manifest aggregate and diffs it against the shards. But
the About page — the page a reader is told to consult *before citing anything* — states several
figures in sentences rather than reading them from the manifest: the per-haplotype gene counts,
the HAP1/HAP2 Pfam gap, the count of syntelog pairs whose ω is undefined. Prose was outside
every existing gate, so the one page that exists to keep the atlas honest was the one place a
number could rot unobserved. This repo has already shipped a withdrawn figure on a rendered page
for two days (0.3.11, the 1,725 LSG pool) — the same failure on a different surface.

`scripts/check_prose_numbers.py` recomputes each claim from the committed shards and asserts the
formatted string is on the page. It is a `build_all.sh` step, and it was confirmed to FAIL on a
deliberately altered digit before being trusted.

All six claims currently hold: HAP1 32,137 / HAP2 31,823, Pfam 26,132 / 3,222, 716 syntelog
pairs with Ks 0.

**It does not rewrite the prose, on purpose.** A sentence is a claim with words around it, and a
script that silently swapped the digits could leave those words false. When it fails, a human
reads the sentence and decides what it should now say.

**The first draft of the check was itself wrong, which is the point.** It counted Ks-0 *genes*
(1,432) against the page's *pairs* (716) and reported the page as broken — the page was right.
So the check now asserts the flag is symmetric across each pair first: an odd total would mean
one side of some pair carries it and the other does not, a real defect the pair count would
quietly average over.

## 0.12.3 — 2026-09-19 — The provenance records were always there, and nobody could reach them

`sources/*.provenance.json` is where this project does its most careful writing: what a layer is
FOR, the gate that had to pass before it was allowed in, what it deliberately does not claim,
and — most usefully — what was tried and rejected. **Nineteen of those files are committed,
served over HTTP, and nothing in the interface linked to any of them.** A reader wanting to know
why the ComBat matrix is still two full copies, or why a tandem member can have no dS, had no
route to the answer short of cloning the repo.

They are now one click from the About page, fetched on demand, rendered as prose.

- **Nothing is summarised.** The record's own words render as written. A summary would be a
  second thing to keep true, and the whole value of these files is that they were written by
  whoever had to defend the number.
- The route C record now states, where a reader can see it, that the call the site leads with is
  **"NOT APPLIED to the canonical tables"**, alongside its gate and its movement numbers. The
  question "why does the atlas lead with a call its own source table contradicts?" has an answer
  in the project's own voice rather than a maintainer's paraphrase.
- **Internal cluster paths are trimmed.** The records were written for a maintainer and quote
  absolute paths, including agent worktree directories (`.claude/worktrees/…`) that mean nothing
  to a reader and look like a leak on a public site. They now collapse to `ms1-dup/data/…`, the
  same convention the source table above already used. `check.mjs` asserts that no `/scratch/`,
  `/home/` or worktree path reaches a public page.
- A source with no published record says so, and says that it predates the sidecar convention
  rather than rendering an empty panel.

## 0.12.2 — 2026-09-19 — `#/karyotype`: navigate by the ancestral genome, not the modern one

The whole duplication half of this atlas is about descent — which ancestral chromosome a gene
came from, which gamma copy, which salicoid copy. That sits on 63,608 genes and was shown as a
paragraph on one card, one gene at a time. **The frame the data is organised around was the one
frame a reader could not navigate in.**

Seven ancestral eudicot chromosomes, each split into three gamma copies, each into two salicoid
copies. 42 cells, every gene already knows its own, and **every cell is a Browse query**.

- **No new data.** The grid reduces in the browser from the `aek` facet column, which packs the
  three numbers as `chromosome*100 + gamma*10 + salicoid`. Precomputing it into the manifest
  would create another aggregate a build stage owns and can leave stale (TODO 25) for a table
  that derives in milliseconds from a file Browse already fetches.
- **Each cell shows its HAP1 / HAP2 split**, so a cell where the haplotypes disagree is visible
  without opening anything.
- **The `aek` Browse filter now accepts a salicoid copy**, so every cell is a real, shareable
  query rather than a picture of one.
- `check.mjs` pins the round trip: a cell claims a count, its link must land on exactly that
  count. The grid and Browse are two code paths over one column, and this repo has already
  shipped two numbers that disagreed for precisely that reason (0.11.2, 0.11.3). It also asserts
  the counts partition the corpus — 63,608 placed + 352 not placed = 63,960 — so a cell cannot
  quietly vanish.
- Labelled **exploratory** throughout, with the two caveats that stop the obvious misreadings:
  gamma and salicoid copy numbers are completeness **ranks within one ancestral chromosome, not
  subgenomes** (they read as subgenome labels to anyone who has seen a polyploid paper), and an
  empty cell is an absence of collinear evidence, never a proven loss.

This also puts route C — the atlas's most distinctive and least visible layer, badged "proposed,
not adopted" — somewhere a reader can actually use it.

## 0.12.1 — 2026-09-19 — `#/pair/<id>`: the allele pair as the primitive

This is one of very few resources carrying both phased haplotypes of a hybrid clone, and until
now that showed up as a cross-reference: a line on the annotation card saying "the other allele
is X", which you follow, losing the first gene off the screen. Every question that is actually
about the hybrid — does one allele carry a duplication the other lost, do the two disagree about
age, is one of them silent — meant holding two pages in your head.

One page, two columns, a row per property. **The comparison is the page.**

The first pair it was tested on makes the case: HAP1 sits in a **2-member** tandem array and
HAP2 in a **5-member** one — haplotype-asymmetric expansion, visible at a glance — with leaf
expression 0.70 against 0.00.

- **Enter from either haplotype and get the same page.** HAP1 is always on the left, so two
  readers arriving from opposite alleles are not looking at mirror images of each other.
- **Rows that differ by construction are not marked.** Two alleles always have different ids and
  coordinates; flagging those buried the four rows that mean something under seven badges. A
  span difference is marked only past 10%, because 4.46 kb against 4.49 is not a finding.
- **"not measured" is never rendered as blank.** HAP2 domain annotation is thinner than HAP1 for
  release reasons, and an empty cell in a two-column layout reads as "nothing there" rather than
  "not measured".
- **The correlation says what it is not.** Pearson on log2(TPM+1) across all 652 samples,
  computed in the browser from the two profiles the page already fetched, shown beside the share
  of samples where both alleles are under 1 TPM — and an explicit statement that this is **not**
  allele-specific expression, since reads mapping equally well to both alleles are not resolved
  in this quantification. TODO 19 closed ASE deliberately; a number of this shape invites exactly
  that misreading, so the page refuses it in words.
- **A gene with no allele gets its own view**, naming the 12,098 genes in that state, rather than
  an empty table. It is a finding, not an error.

Reachable from the allele card on every gene page, and `check.mjs` asserts all three properties.

## 0.12.0 — 2026-09-19 — Expression is range-addressed: 786 KB per gene becomes 1.1 KB

A gene page fetched `data/expr/buckets/<hap>/<n>.json` — 250 genes × 652 samples, **786 KB** —
to draw ONE gene's card. The two bucket trees were 405 MB, 58% of everything the site
published. Both are gone.

Each gene's vector is now its own gzip member inside a per-haplotype blob, and the client asks
for exactly its own bytes with an HTTP Range request. **Values are byte-identical** — this is a
container change, not a quantisation, so `docs/EXPRESSION_DESIGN.md` decision 1 ("what a
visitor sees is what they download") still holds literally.

| | before | after |
|---|---|---|
| per-gene expression fetch | 786 KB | **~1.1 KB** |
| expression trees at rest | 405 MB | **144 MB** |
| `data/` (true bytes) | 670 MB | **446 MB** |
| the scrubber's contrast mode | up to 3 buckets (~2.3 MB) | **~19 KB** |

**Proven before anything was deleted.** 3,896 genes compared *elementwise* across both trees —
every one of their 652 values — zero mismatches. `validate_data.py` now seeks, inflates and
checks a sampled gene's vector against its own `x.max`, because an off-by-one in a packer
yields offsets that decode *cleanly* to another gene's data and would render as a plausible
profile for the wrong gene.

**A host that ignores Range is the dangerous case, and it is now refused.** Such a host answers
200 with the whole blob, whose first bytes are the FIRST gene's gzip member — which inflates
fine and returns someone else's expression. The client requires a 206 *and* the exact byte
length before trusting the bytes, then falls back to the bucket path. Python's `http.server`
does exactly this, so `scripts/serve_ranges.py` exists to make the checks exercise what
production actually does; GitHub Pages was verified to answer a real 206, identity-encoded, so
offsets are stable.

**Regressions and vacuities caught on the way:**
- `scrubber.js` fetched buckets directly rather than through `loadExprVector`, and 404'd after
  the repack. It is the module that gains most: a ~17-gene window went from three 786 KB
  buckets to ~19 KB.
- After the deletion, "every `x.cb` pointer resolves" passed while iterating over **nothing** —
  the same vacuous-check shape as the unowned-patcher gap in TODO 47. It now asserts on ranges
  with a real count (59,599).

**Tested and rejected:** storing ComBat as a per-study offset table instead of a second matrix
would have saved another 188 MB, but the correction is **not additive in log space** —
within-study spread of log2(combat+1) − log2(raw+1) has median 0.43, p90 1.15, max 7.38. Both
matrices are kept. The idea arrived with a cheap falsifier attached, which is why it cost
twenty minutes instead of a release.

Also repacked the object store: 417 MiB of loose objects collected, 787 MiB → 382 MiB.

## 0.11.5 — 2026-09-18 — Start from a question, and the disagreement becomes browsable

Out of a ten-lens exploration of the atlas (recovered notes:
`<scratch>/atlas_exploration_20260918/RECOVERED_IDEAS.md`), the two cheapest wins.

**The home page asks questions instead of offering a search box.** Eight of them, each a real
Browse query with its cutoff stated in the sentence — "in a curated tandem array, peak
expression in xylem, τ ≥ 0.8" — because "expressed" and "tissue-specific" are not absolute
properties, and a question that hides its threshold invites reading it as one.

Counts are computed **in the browser from the facet index, using Browse's own filter
predicates**, never precomputed into the manifest. A baked aggregate goes stale the moment a
patcher runs without its owning stage — TODO 25 documents exactly that, and this page shipped
a withdrawn LSG count for two days that way. Computing it here makes the home number and the
page it links to the same calculation rather than two that can disagree. `check.mjs` asserts
the round trip in both directions.

**A `wgd_disputed` facet, because the question that needed it exposed a trap.** "Where do the
two WGD calls disagree" was first written as `{wgd: 'salicoid', wgd9: 'gamma'}` and reported
**7,574** — a gene carrying BOTH events under BOTH calls matches that while agreeing about
everything. The real answer is **904**, and it is not derivable from the two event columns:
the disagreement is its own fact and now has its own column. It is also the provenance answer,
since the route C correction was visible only one gene page at a time, and "which 904 genes
moved" is the question anyone auditing it actually has.

**Repacked the object store.** 417 MiB of loose objects collected; 787 MiB → 382 MiB. One
command, no design decision attached.

## 0.11.4 — 2026-09-18 — A cached build can no longer show the wrong number silently

Reported by Chen: still seeing 191 from a link that serves 229, on data v0.11.2 while the site
served 0.11.3. The data was right and the deploy was right — the browser was holding part of the
previous release.

**Why this is a defect and not a user error.** GitHub Pages sends `cache-control: max-age=600`
on every file and offers no way to change it, so for ten minutes after any deploy a reader can
hold a stale `facets.json` while fetching fresh JavaScript. That state does not fail, it
**miscounts**: `facetRow` maps columns by NAME, so every lookup still resolves, just to the wrong
column. New code against an old index finds no `wgd9` (every canonical-v9 query returns 0) and
gets the old `tandem` column back (103 again). The page renders a confident wrong number.

- **Every data URL now carries the manifest's `data_version`.** The manifest is fetched
  `no-store` so it is never the stale one, and any data fetch that races it waits for the
  version first — otherwise it would go out unstamped and could still be served from cache. A
  stale copy can no longer sit beside a fresh manifest.
- **A stale build announces itself.** `index.html` carries the version its JavaScript was built
  for; when it disagrees with the manifest a banner says so and offers a reload. `check_version.py`
  holds that meta equal to `VERSION` — confirmed to FAIL when they drift, so the warning cannot
  quietly stop firing.
- `check.mjs` asserts both: that no non-manifest data URL is unstamped, and that rewriting the
  meta before boot produces the banner.

**The third side of the triangle now renders.** Gamma predates salicoid, so a gene's salicoid
sister and its gamma copy are themselves a gamma pair — and the card was drawing only the focal
gene's own links, which showed a star where the data already held a triangle. Reported by Chen
from the Fuzzy MYB slide: "there should also be links between the 10g and 17g right?" There
should, and there were, in the table but not on the page.

- **18,276 partner-to-partner links across 7,845 genes** now draw, dashed, each labelled with
  that pair's own dS. Placed on their own arc rather than above the target gene, because two
  gamma links can land on the same partner and stacked pills say nothing about which arc they
  belong to (seen on that very locus: 1.21 and 1.03 one above the other on 17G070400).
- **Nothing is inferred.** An edge is drawn only where the anchor table carries that pair. Of
  12,198 such triangles, 10,436 (86%) already have their third edge; the other 1,762 render
  without one, which is the honest state. Completing them by inference would manufacture the
  very signal the upstream audit is measuring.
- The remaining 14%, plus 248 third edges labelled salicoid where the topology predicts gamma,
  are an anchor-table question and are briefed for the WGD track owner at
  `<scratch>/wgd_triangle_audit/BRIEF.md` with the measurement scripts. The Fuzzy MYB
  locus is the worked case: HAP1 has the third edge, HAP2 has none and its Chr10 gene carries
  no gamma call at all, with gamma dS 1.21 against 3.08 for the same locus.


## 0.11.3 — 2026-09-18 — Route C becomes the default WGD call, and Browse stops accumulating filters

Reported by Chen: selecting all three duplication classes returned 229 in the figures but not
in Browse. Three distinct defects sat behind that one question; only the first was fixed in
0.11.2, which is why it still looked broken.

**1. Route C is now the default WGD call in Browse** (`wgd`), because that is what the current
class figures are drawn from — browsing on v9 while holding a route C Venn gave 191 for
"HAP1 + tandem + both" against the figure's 229, which reads as a broken filter rather than as
two different calls. The swap is clean: route C covers exactly the same 32,170 genes that carry
a v9 call, adds none, and the only movement is the 142 genes it deliberately sets aside on
split-evidence pairs. The canonical call stays selectable as **WGD event (canonical v9)**
(`wgd9`, a new facet column), so the published v8/v9 numbers remain reproducible here.
**The canonical TABLE is still v9** — the atlas now leads with route C while
`master_duplication_table_v9` does not, and the gene page says so.

**2. Browse accumulated filters across navigation.** `state` is a module-level singleton and the
URL only ever ADDED to it, so going from `?hap=hap1&tandem=yes&wgd=both` to
`?tandem=yes&wgd=both` kept `hap1` and returned 229 instead of 462 — and every filter a reader
had followed stayed active for the rest of the session. It presents exactly as a miscounting
filter. The URL is now the whole truth: the filter set is REPLACED on each navigation and the
page resets.

This one was briefly misdiagnosed. When a live spot-check returned a stale count it was written
off as the test reusing one page across hash changes; the "fresh page per query" workaround then
hid the bug from the very check written to catch it. The suite found it only once the Browse
check ran several queries in one session — which is what a reader does.

**3. A build-log defect introduced and caught in the same change.** Inserting the `wgd9` column
shifted every hard-coded index in `build_facets.py`'s summary: it reported 44 genes expressed in
at least one tissue instead of 53,704, and a karyotype coverage that was counting omega. Nothing
wrong was persisted (the manifest stores only `n_rows`/`cols`/`bytes`), but a build log that
reports confidently wrong numbers is how a real defect gets waved through. The summary now
indexes by column name.

`check.mjs` now pins eight Browse counts across both calls, run sequentially in one page so
filter bleed cannot pass.

## 0.11.2 — 2026-09-18 — Browse was filtering on a different tandem set from everything else

**Browse disagreed with the class figures, and the reason was a definition, not a count.** The
`tandem` facet was built from `syn.flags.ar` — GENESPACE's tandem PLACEMENT, 6,804 genes — while
the Venn, the Duplication card and this repo's own canonical assertion all use `dup.td`, the
curated union set of 13,048. The two overlap badly: 6,865 curated members are not flagged `ar`
and 621 `ar` genes are not curated members. Selecting **tandem + both WGDs returned 103 where the
canonical intersection is 385**. Reported by Chen from the live site.

Nothing caught it because nothing was comparing Browse's ANSWER to the canonical numbers: the
facet was internally consistent, reproduced exactly by the validator's own recompute, and wrong.
Same family as 0.3.11's stale facet index (TODO 24) — a facet can agree with itself and still
mean something the rest of the site does not.

- `build_facets.py` now reads `dup.td`. The GENESPACE placement is still reachable, as the
  Synteny class filter's `tandem_array_member` option, and the filter is relabelled
  **"In curated tandem array"** so the two cannot be read as the same thing.
- `validate_data.py` asserts the tandem facet equals the canonical 13,048, and its facet
  recompute was updated in step. The new gate was confirmed to FAIL on the old index before
  being trusted.
- `check.mjs` gains a driven check asserting five Browse counts against the class figures —
  13,048 / 385 / 1,647 / 955 / 20,959. Counting the intersection is the only thing that would
  have caught this.

**Every deep-linked Browse URL was throwing, and only that path.** The loop that seeds each
filter widget from the URL ran BEFORE `const inputs` was declared, so any `#/browse?...` with a
filter died on `Cannot access 'inputs' before initialization` and rendered nothing, while a plain
`#/browse` worked because the loop body never executed. The one path the seeding exists to serve
was the only one that failed — which is why it survived a suite that renders `#/browse` on every
run. Moved after the widgets are built; the new Browse check exercises deep links by construction.

## 0.11.1 — 2026-09-18 — The gamma dS was in the wrong place, and the route C call ships beside the canonical one

**The gamma dS bug, and it was worse than a missing number.** Every gamma anchor carries a dS
(16,804 entries, 100%), so nothing was absent from the data — it was being drawn in a place that
said the wrong thing. A dS label sat at its arc's MIDPOINT, which for a cross-row link is nowhere
near the partner it describes: on a gene with both a salicoid and a gamma partner, the gamma
value (1.50) rendered just above the SALICOID track while the salicoid value was displaced into a
row heading. A reader would have attached each number to the wrong event. A cross-row dS now sits
directly above the partner gene it belongs to; only a same-row tandem arc keeps the apex, where
its two ends are the only genes it could refer to.

**Route C re-adjudication, shown but not adopted.** The gamma-branch route C work re-scored every
WGD anchor pair against the ancestral eudicot karyotype: it takes the topology call where grape
and segment dS independently agree with it, keeps the canonical call otherwise, and sets aside
split-evidence pairs. It disagrees with the canonical v9 letters on **904 genes** (567 gain
salicoid, 173 lose it; 122 gain gamma, 485 lose it), moving HAP1 to 14,748 / 4,857 and HAP2 to
14,747 / 4,910.

- Shipped as `dup.cc` **beside** `dup.s` / `dup.a`, with `dup.ccd` flagging the disagreements —
  the treatment the withdrawn LSG pool got in 0.4.0: show the correction, never silently swap it.
  The gene page shows both under **Route C re-adjudication**, badged *proposed, not adopted*.
- **Nothing on the site computes anything from the route C call.** The canonical v9 letters remain
  the called class everywhere, because MS1's own 2026-09-16 reconciliation still lists v9 as
  canonical and marks this correction "nothing applied, for the WGD track owner" (open item (t)),
  and the manuscript quotes the v8 figures. Publishing the route C call as *the* class would put
  the atlas ahead of its own source table.
- Gated on the published figure: `make_wgd_combined_call_source.py` refuses to write unless it
  reproduces `main_dupclass_euler_combined_call_*_stats.csv` exactly, and `validate_data.py`
  re-asserts those totals plus that `ccd` is set exactly where the two calls differ.
- A drop-in patch for the canonical table is at `<scratch>/wgd_combined_call_patch/`
  (63,960 rows, 904 changed). It is a file rather than an edit because `ms1-dup` is a one-way
  mirror of OneDrive — the canonical table lives on the Mac.

## The duplication history of the array, not just of the gene

A tandem array can have gone through salicoid WGD or gamma while THIS copy retained no partner
for it. Until now that was invisible from the gene's page: the gene-level class said "not
called" and a reader had to open each array member in turn to discover the array's own history.
3,480 genes reach an event class this way that their own record does not carry (1,956 salicoid,
984 gamma, 540 both), across 2,103 multi-event arrays of the 4,371 in the union set.

No new data. Every array member's `wgd` is already on its shard, and the members are already
fetched to draw them, so this is a second read of bytes the page had in hand.

- **Duplication layers** gains second-order links: thin, dotted, paler, and drawn **from the
  array member they belong to**, never from the focal gene. Rows holding only such partners are
  labelled "salicoid WGD **of an array member** · Chr11". The caption states the distinction in
  a sentence: the event is a property of the locus, the class is a property of the gene.
- **Duplication** gains a **This array's history** line naming, per event, whether this gene
  retains a partner and which other members do, with the same caveat in words. The gene-level
  S/A call is untouched and still reads "not called" where that is what the data says.
- A WGD partner that is itself in a tandem array is flagged: the array appears to have been
  duplicated wholesale and both copies then expanded. (MS1 calls these mirrored partners;
  `data/26_array_multi_event/top_arrays_mirrored_partners.csv`.)
- Multi-event array counts here are on the **adopted TD union set**, so they are not MS1's
  802/122 figures, which were computed on the older TD call. Different set, not a correction.

Links and dS labels can be **moved out of the way**: drag one, or focus it with Tab and use the
arrow keys (Shift for bigger steps, Escape to put it back), with a **Reset the layout** button
for the whole card. A dS label slides freely; a link only **bends** — both ends stay pinned to
the genes they join. That restriction is the point: an arc that could be dragged off its
endpoints would be a drawing that lies about which genes are duplicates, and it would still
look right in a screenshot. The driven check asserts it directly — after a drag, exactly one
curve has changed and every endpoint of every curve is where it was. The keyboard route is not
decoration either: WCAG 2.2 SC 2.5.7 requires a non-dragging alternative for any dragging
movement, and this one is convenience rather than essential.

Two label defects fixed, both found by looking at a 390 px render rather than by a check: dS
pills were landing on gene bars, row headings and each other, and gene ids in a dense array
smeared into one another. Labels are now placed against real rectangular obstacles in a single
pass; a dS with nowhere to sit is printed in its row heading rather than dropped, a gene id
with nowhere to sit is omitted and **counted out loud in the caption**, and the row's span
figure yields if the heading grows into it.

## 0.11.0 — 2026-09-18 — Every duplicate of a gene, drawn and measured

Three cards on the gene page could each say *that* a gene has duplicates. None of them showed the
copies together, and none carried a divergence for a tandem pair. This release adds both, and gives
the existing tables the three columns a reader was leaving the page to find.

**Duplication layers** (new card, `js/modules/duplayers.js`). Tandem, salicoid WGD and gamma kept
apart as separate tracks on one shared kilobase scale, each partner in a few genes of its own real
neighbourhood, each link a labelled arc carrying that pair's own dS. The figure shape is the one the
manuscript uses for a family (`ms1_talk_20260918/myb_case_20260917/myb_layered_locus_*.png`). The
HAP1↔HAP2 allele is drawn too, dashed and in grey, with the card saying in words that it is the
same gene twice phased rather than a duplication.

- SVG rather than canvas, unlike every other drawn card here: the arcs carry text, the element
  count is in the tens, and every gene is a real `<a>` with a 24 px transparent hit rectangle
  (WCAG 2.2 SC 2.5.8) instead of hand-rolled pointer hit-testing.
- Each track is padded by 12 kb and drawn on the widest track's scale, so a 2 kb gene and a 90 kb
  array are not drawn the same width. Flanking genes are grey, unlabelled and marked
  "for position only" — without them a partner track holds one gene, that gene is centred by
  construction, and every arc on the card lands at the same x.

**Per-pair tandem dS** (new data, `sources/td_pair_ks.tsv.gz` → `td.pks`). 15,710 scored pairs from
the adopted TD union rebuild, covering 30,918 of 60,036 `td.mem` entries (51.5%). This is the number
`patch_duplicate_partners.py` correctly refused to fake from `td.ks`: **`td.ks` is the array MEDIAN
and stays exactly where it is.** The two are different quantities and the card says so beside the
column. Coverage is partial by construction — `td.mem` lists every other member of an array,
the source holds detected edges — so a dash reads "this pair was never scored", never "identical".
`td.pks_n` carries the count, and the card's "scored N of M" sentence is recomputed from it.

**The copies, over all 652 samples** (new card, `js/modules/dupheatmap.js`). One row per duplicate —
tandem members, the other haplotype's allele, salicoid and gamma partners — over every sample,
grouped study then tissue, with a correlation strip on the left and a tissue colour track beneath,
after `heatmap_helper.py` in the manuscript case studies. Opt-in (one fetch per row).
**The low-expression filter is off by default**, because a silent copy is the result in a duplicate
family and a view that hid quiet rows first would hide the finding; when on, the control states the
1 TPM cutoff and the number of rows removed, and the focal gene never leaves.

**The three columns the tables were missing.** Every duplicate table on the Duplication card —
tandem members, WGD anchors, paralog pairs — now carries the partner's own duplication class, its
peak TPM across the 652 samples and its peak tissue, filled in from the partner's shard after
render. The tandem table additionally gains the per-pair dS above.

**A pipeline gap found while wiring this up.** `patch_duplicate_partners.py` was not a
`build_all.sh` stage, so a full rebuild dropped `td.mem` and every `para[].r` — the array-member
table and the duplicate co-expression the Duplication card renders — and nothing failed. Both it
and the new `patch_td_pair_ks.py` are now registered stages, in dependency order after
`build_layers.py`.

**Checks.** Four new `validate_data.py` gates on `td.pks` (member membership, positivity, symmetry
between directions, and `pks_n` recomputed rather than trusted); the membership gate was confirmed
to fire on a deliberately corrupted shard before being trusted. `check.mjs` gains three render
checks and one driven check that asserts the filter starts off, actually removes rows, and keeps
the focal gene.

## 0.10.0 — 2026-09-16 — Where each gene sits in the ancestral eudicot karyotype

The duplication card could say a gene is a retained gamma or salicoid duplicate, but not which
ancestral chromosome it descends from or which copy of either event it is. It now does, in a block
marked **exploratory**: the ancestral chromosome (AEK1 to AEK7, the ancestral eudicot karyotype of
Wang et al. 2022, BMC Biology 20:216), the gamma copy (1 to 3), the salicoid copy (1 to 2), the share
of the 10 nearest collinear anchors that agree on that label, and whether the gene lies inside an
AEK collinear block or inherits its chromosome from neighbouring anchors. On a gene that is a direct
collinear anchor of an ancestral gene, a slot table lists that ancestral gene's descendants in the
same haplotype, 3 gamma copies by 2 salicoid copies.

- Source: the MS1 gamma branch, painting v3 (route C). `scripts/make_karyotype_source.py` copies
  it to `sources/karyotype_route_c.tsv.gz` and `sources/karyotype_route_c_anchors.tsv.gz` with a
  provenance sidecar; `scripts/patch_karyotype.py` writes it onto shards as `aek` and is a
  registered `build_all.sh` stage.
- Gated before anything is written: route C re-derived from its own helper columns for every gene;
  coverage equal to the owning analysis's route-agreement table; slot occupancy rebuilt from the
  anchors equal to its published both-copies table, cell for cell (10,070 / 10,046 occupied
  ancestral-gene gamma copies, 4,276 / 4,351 of them holding both salicoid copies).
- Coverage, HAP1 / HAP2: a gamma and salicoid copy on 31,496 of 32,006 / 31,217 of 31,823 genes;
  26,582 / 26,731 inside an AEK block; 5,330 / 4,965 chromosome labels inherited from neighbouring
  anchors; 410 / 479 get no copy because the AEK block and the P. trichocarpa naming name different
  ancestral chromosomes (and 6 HAP1 genes have no P. trichocarpa block to name one); 94 / 127 are
  not placed. The 131 HAP1 unplaced-scaffold genes were not assessed, and their pages say so.
  14,727 / 14,747 genes are direct anchors of 8,199 / 8,206 ancestral genes.
- Copy numbers are Wang et al.'s completeness ranks within one ancestral chromosome, not subgenomes,
  and the card says so. An empty slot reads "lost or not detected", with a note that it means no
  collinear anchor, not a proven loss.
- Browse gains an **Ancestral chromosome (exploratory)** filter, offering a chromosome or one
  chromosome's gamma copy (never a copy number pooled across chromosomes), and three export columns.
  The facet index grows by one column, 2.42 MB to 2.68 MB raw.

## 0.9.0 — 2026-09-16 — Which whole-genome duplication, and with whom

The duplication card said "salicoid WGD" or "ancient WGD" and stopped there. It now names both
events -- the **salicoid WGD** (Populus and Salix, about 60 million years ago) and **gamma** (the
core-eudicot triplication, about 120 million years ago; previously labelled "ancient WGD") --
states whether the gene is a retained duplicate from each, and lists **every** anchor partner
with its dS, synonymous sites, chromosome pair, collinear block and expression correlation.

- Source: ms1-dup `wgd_anchor_pairs_v8_reordered_20260902.csv`, copied to
  `sources/wgd_pairs.tsv.gz` by `scripts/make_wgd_pairs_source.py`, written onto shards as `wgd`
  by `scripts/patch_wgd_pairs.py`. 23,154 pairs, 32,170 genes. Inclusive: no dS window, no site
  filter, no partner cap -- the gate asserts every source pair survives.
- The event call is the curated gene-level letter (S/A), unchanged. The pair label is a later
  artifact of the same pipeline and disagrees with it on about 70 genes; the page shows both and
  says so instead of overriding either.
- Browse gains a **WGD event** filter (salicoid / gamma / both / either / neither) and two export
  columns. Counts match ms1-dup v9: 29,101 salicoid genes, 10,130 gamma, 7,061 both.
- The duplication overview gets a WGD events card that launches into Browse.
- Removed the synteny "reclassified vs old panel" row, stat and filter. The facet column that
  carried it is replaced by `wgd`; the shard field `syn.changed` is left in place, unused.
- The paralog table's source "founder" now reads "same gene family" (the upstream code meant a
  family whose oldest member arises at that stratum).

## The 3D viewer's open button was too small to tap

Rendered the model at a phone viewport for the first time -- after it had already gone public --
and the layout was fine in every respect but one: painted pixels 6.4%, canvas within its
container, no horizontal page scroll, and an opening button of **32px**, below the 44px touch
floor this site enforces everywhere else and which the `locus-phone` check has asserted for
months.

The 32px was explicit in the stylesheet, not an omission, so this overrides a deliberate value
on purpose: `.locus-btn` sets 44px, the locus check enforces it, and one control opting out is
the kind of inconsistency nobody notices from a desktop.

`model-phone` now drives 375x667 at deviceScaleFactor 2 with isMobile and hasTouch, asserting
painted pixels through the viewer's own `pngURI` (a canvas existing is not a model being drawn),
no horizontal scroll, the canvas not laid out wider than its container, and the opening control
at or above 44px. Written as its own helper so the three desktop model cases keep their exact
behaviour.

Site only -- `data/` is untouched and the data version stays 0.7.0.

## 0.8.0 — 2026-09-12 — Who shares the duplication, and what the chromatin actually looks like

Two requests about cards that were already there but understated what the atlas actually knows:
the duplication card counted partners without naming them, and the chromatin card reported four
booleans where the source data is a continuous signal.

### Duplicate partners now carry an expression correlation, and the array's other members are named

The paralog table gains an `Expr r` column: Pearson r on ComBat-corrected log2(TPM+1) across all
652 samples, the same basis the expression card already uses for neighbour co-expression. The
tandem-array block gains an "Other members" table for the same reason — a card that says "7
members" and never says which seven was withholding exactly the information a reader would open
the card to find.

**54.0% of paralog pairs and 76.9% of array-member pairs get a correlation** (1,454 of 2,692;
46,179 of 60,036); the rest sit outside the 59,599-gene ComBat-eligible set — a HAP2 annotation
gap, mostly, not a biological absence. Those cells render as `n/c`, not as a correlation of zero,
and the card says so: a partner outside the batch-corrected matrix is not comparable, which is a
different claim than uncorrelated. 327 genes' arrays are truncated at 24 listed members with a
"not listed" note rather than silently dropped.

**Deliberately not shown: a per-member Ks.** `td.ks` is the array's *median* Ks, present on
12,082 of 13,663 tandem-array genes; printing it next to one member would read as that pair's own
divergence, which it is not. Ks stays at the array level; the new correlation is the only
per-member number added.

### Chromatin gets a signal profile, not just a boolean

Four marks (ATAC-seq, H3K4me3, H3K36me3, H3K27me3), 40 bins of 100 bp, 2 kb either side of the
transcription start, reprocessed from GSE128434 and strand-oriented so bin 0 is upstream for
every gene regardless of strand. **23,465 loci, reaching 45,867 atlas genes through the existing
P. trichocarpa-ortholog boolean layer.** A "Show the signal profile" button appears wherever that
layer already showed a checkmark and draws all four tracks on demand, sharded by chromosome
(20 files, 13.1 MB) so the base gene shards do not carry 160 numbers per locus each.

The values are a log ratio, not coverage — they go negative as often as positive — so each track
is drawn diverging about a zero baseline, and each mark is scaled to its own peak rather than one
shared axis, because the four ranges differ several-fold. A representative promoter, `Potri.
017G065900`, shows H3K4me3 running flat and negative for 2 kb upstream then peaking to +1.67
immediately downstream of the transcription start — the expected shape for an active promoter,
per gene rather than only in aggregate.

**One defect found by the validator before this shipped.** Both the new validator gate and the
client's own loader keyed a gene's chromosome shard by matching `Potri.(\d{3})G` — but the
patcher that built these shards already knew that scaffold-anchored orthologs like
`Potri.T170700` don't match that pattern and correctly filed them under an `other.json` shard.
The gate and the loader did not know that: 29 genes were flagged with a profile they could not
actually fetch. Both now match the patcher's own `shard_key()` exactly. All 29 affected genes
happen to have `ex=0` (their ortholog is not expressed in the source leaf libraries), so the
card's own "nothing shown for a silent gene" rule already keeps the button from appearing for any
of them today — but the data contract is fixed regardless of whether today's data reaches it.

`data/` is now 692.5 MB of real file content (measured by summed file size, not `du`, which
inflates badly on this filesystem) — 69.2% of the GitHub Pages 1 GB cap, chromatin profiles
adding 13.1 MB of that.

## 0.7.0 — 2026-09-12 — What the RNA-seq says about the gene models themselves

Two layers from 94 public RNA-seq libraries, both flags and neither a filter. They answer a
question the atlas could not previously ask: is this gene model actually supported by reads, and
is it one gene or two?

### Introns observed, with the depth that decides whether the question was answerable

Per gene: how many annotated introns were seen as spliced reads, out of how many, and the read
count. 50,631 multi-exon genes; the other 13,329 are single-exon and have no intron to detect.

89.6% of conserved multi-exon genes have every intron observed. Lineage-specific genes: 52.6%
all, 37.2% none. **That gap is mostly depth, not gene-model quality**, and the card says so
rather than leaving the number to imply otherwise. Below 20 reads fewer than 27% of annotated
introns are detected even for models that are certainly correct; above 5,000 reads it is 98.8%.
A gene with 0 reads showing "0 of 4 introns seen" is being described by its expression, not by
its annotation, so the read count ships beside the fraction and a shallow gene gets an explicit
warning instead of a bare ratio.

The source's intron count was checked against the atlas's own `gs.in`, derived independently
from the v5.1 GFF3 longest isoform: **50,631 of 50,631 agree, 100.00%**. The patcher asserts it
per gene, because if the two ever diverge the layers are describing different gene models.

### Whether a neighbour is really the same gene

1,435 adjacent pairs carry three or more spliced reads joining an annotated exon boundary of one
gene to one of the other — 2,629 genes flagged. The readout is specific: **zero of 27,276
opposite-strand pairs clear it**, where fusion is impossible.

**This is not a lineage-specific problem, and the card says so on every flagged gene.** 1,422 of
the 1,435 pairs are two conserved genes; only 13 involve a lineage-specific one. At matched gap
and depth, lineage-specific pairs are fused *less* often than conserved ones, 0.96% against
3.61%.

**Gap coverage is shipped because without it the flag overcalls.** An intron is spliced out, so
a genuine split shows a junction with almost no coverage inside the gap; heavy gap coverage means
readthrough, where the annotation is defensible and only the transcription is untidy. The
owning analysis's own counter-example, `PtXaAlbH.17G082500`, has 9,630 exon-boundary junctions
and 121,932 reads inside the gap. No threshold is applied — the published analysis set none, so
both counts are shown.

**9,079 genes had no adjacent pair deep enough to test at all**, and they say so. Absence of a
flag must never read as "confirmed separate genes".

A dashed arc joins the two genes in the locus view when both are on screen, labelled with the
junction count. It is drawn only when both partners are visible: half an arc would imply a
location it cannot support.

### The TODO's own numbers were wrong, and were recomputed rather than quoted

It claimed "1,435 adjacent pairs (2,629 genes) carry 3+ spliced reads" and "40 pairs (79 genes)
show the exact splitter signature". Recomputed: 1,435 / 2,629 is the **exon-boundary** tier, and
the any-junction tier is 5,126 pairs / 9,200 genes — the two figures had been filed under the
wrong tiers. The owning analysis's stricter exact-gap tier is 42 pairs, not 40. Every figure
shipped here is recomputed from the tables and asserted on build.

### Panel and provenance

The 94-library panel is frozen, and an 827-library expansion was running as this shipped. Using
the frozen panel is safe rather than merely convenient: the expansion carries its own
`panel94` equivalence gate, and it passes with 0 of 16 matched cells and 0 of 20 arm rows
differing. Each haplotype was aligned to its own genome, so HAP1 and HAP2 are not independent
replicates and are never pooled.

## 0.6.2 — 2026-09-12 — The home page was contradicting every other page

`summary.ps_rank` is a third copy of the phylostrata distribution, written by `build_data.py`
— the stage that wipes `data/genes` and therefore cannot run on this machine — and the home
page computes "lineage-specific candidates (PS >= 18)" by summing it. When the LSG pool was
corrected on 2026-09-10 the patcher fixed `phylostrat.ladder` and `phylostrat.by_rank` and
missed this one, so **the live home page showed the withdrawn 1,725 while every other page in
the atlas showed 1,611**, through 0.6.0 and 0.6.1.

The staleness was not confined to the pool: every stratum was wrong, because the correction
moved 766 genes across many strata (17->16, 9->6, 18->16 and others), and five genes that had
no rank gained one. `None` went 50 -> 45.

Found by building the helper that TODO 25 has been asking for since 0.3.11, and which its own
text said would be warranted "if it happens a third time". It was the third time.
`scripts/check_aggregates.py` recomputes every shard-derivable manifest aggregate and diffs it,
because the shards are the artifact and everything else is a summary of them. It is now a step
in `build_all.sh`, and `validate_data.py` gates `ps_rank` the same way it already gates the
ladder beside it.

`check.mjs` now asserts the home page's lineage-specific **number**, not just its label. The
existing assertion checked for the words "lineage-specific candidates" and so passed happily
through three versions of a wrong count.

## 0.6.1 — 2026-09-12 — The Browse filter that was missing since v0.2

`expressed-in` was listed as pending under step 7e and had quietly never been built, because it
could not be: the facet index carried tau and the single peak tissue, and nothing per-tissue.
It has one now — a 10-bit mask, one integer per gene rather than ten columns, adding 0.25 MB raw
to a 2.42 MB index. The bit order lives in the facet file's own `vocab` so the client decodes it
from the builder's own definition and the two cannot drift.

**The threshold is in the filter's label**, "Expressed in (>1 TPM)", not hidden in a build
script: a filter that conceals its cutoff invites reading "expressed" as an absolute property of
the gene. >1 TPM over the WT-control baseline is the same convention the chromatin layer already
uses for "expressed in leaf". 53,704 genes clear it in at least one tissue and 10,256 in none.

Found by checking rather than remembering: the TODO claimed three filters were outstanding, and
two of them (`tau_min`, `top`) had in fact shipped.

## 0.6.0 — 2026-09-12 — Every page earns its place

Chen's review of the live site: several module pages were dead ends showing bars and stats with
no second layer, while Browse — "the key thing of this site" — was the page that deserved the
attention. The decision was **not** to delete those pages but to give them the missing second
layer: **every overview chart is now a launcher into Browse with its filter already applied.**

### Browse is deep-linkable, and says how indirect its columns are

`router.js` gained `query()` and `setQuery()`; Browse seeds its filters from the URL and writes
them back, so a filtered view is shareable and a chart can link straight into one. `setQuery`
uses `replaceState` on purpose: setting `location.hash` would re-enter the router and rebuild
the view, discarding the state being recorded.

Active filters now appear as **removable chips** with a "Clear all", and a URL-seeded filter
fills its own widget — previously the count could read 902 of 63,960 with nothing on screen
explaining why. An exact-stratum filter was added because a ladder bar means one stratum, not
"≥ that stratum".

The MS and ω columns are the two easiest to over-read here, so their caveats moved next to the
numbers instead of living only in a provenance sidecar.

### Protein earns its page

The 3D viewer merged from `chen-structure-viewer`, and its buckets already carried per-residue
pLDDT, DSSP state and the amino-acid sequence — so **per-residue curves needed no new data**.
pLDDT, Kyte–Doolittle hydropathy and the DSSP track now share one residue axis, which is what
makes "are the contradictory properties in the same place" answerable by looking.

There is deliberately **no disorder curve**: predicted disorder exists only as a per-gene mean
in this dataset, so drawing it per residue would be inventing data. The card says that rather
than letting the tracks look exhaustive.

### Peptide evidence now says how it was assigned

"Detected in N of 5 datasets" hid the difference between a peptide unique to this gene and
absent from every other species, and a peptide shared with *P. trichocarpa* and with dozens of
other 717 genes. Measured: **94.2% of peptides matching a 717 gene are also in the
P. trichocarpa proteome, and only 11.9% match exactly one 717 gene** (median 2, max 142).
Genome-wide, **54,264 of 59,698 (gene, dataset) pairs have no 717-specific peptide at all** and
51,585 have none unique to the gene.

So each gene now shows, per dataset, how many peptides are gene-unique and how many are
717-only, with up to three example peptides and what each one also matches. A shared peptide is
not a failed measurement — it is real evidence that the family is translated — it simply cannot
single out this gene, and the card now lets a reader tell which they have.

### The map gained three overlays, and the gate found a stale one

Mean ω, peptide-detected fraction, and ortholog open chromatin, each with its own denominator
stated on the page because a colour ramp hides that. `patch_map_overlays.py` recomputes the
100 kb bins from the gene shards — possible because `build_locus.py` needs the OneDrive tree
only for coordinates and exon structure, not for the bins.

**The gate caught that the map was colouring the withdrawn LSG pool.** 104 bins carried a stale
`lsg` count, because `build_locus.py` is an OneDrive-only stage and has not run since the
2026-09-10 pool correction. Two further per-bin differences were diagnosed rather than waved
through: `tau` differs by 0.001 in two bins (summation order), and `n` differs in two bins
because `PtXaAlbH.11G039800` starts at 7,699,999 in the shards and 7,700,000 in the GFF3 —
shards carry BED 0-based starts, the GFF3 is 1-based, so it falls either side of a bin edge.
The gate is now the per-chromosome gene total, which is the invariant that would actually catch
a reconstruction error.

### Wording and naming, where the old words misled

- **"Scrubber"** was video-editing jargon. The card is "Expression across the neighbourhood",
  the tab "Expression along the locus", and it finally has a **legend** stating the real scale
  and range of whatever was just painted — it had none at all.
- **"Mirror"** described the drawing, not the content. It is now "This locus on HAP2 too",
  which is what the review was asking whether the atlas could show; it already could.
- **"Nearest TE 0 bp"** read as missing data. It means a repeat annotation overlaps the gene,
  and now says so.
- **Contrast labels.** The review asked why so many contrasts say "not recommended" and whether
  to remove them. Measured first: **do not.** The flag is exactly "kind is treatment or
  genotype" (117) versus growth/other condition (74), and **zero** of the 74 duplicate a
  recommended contrast — they are secondary design factors, not junk. The real defect was
  different: **57 label collisions** where two genuinely different contrasts rendered as the
  same string, differing only by a nested factor the label dropped. Each colliding label now
  carries the factor that separates it, in brackets.

### Removed, because it should not have shipped

**"Synonymous divergence by phylostratum"** is gone. It binned a stratum-selected paralog
subset's dS by the gene's phylostratum — the exact misreading the same page warns about two
cards below — and its own caption conceded it was "a sanity check on the pairing, not a dating
result". A sanity check belongs in a run log. Its now-dead chart function went with it.

The **Presence / PAV** card moved from Duplication to sit beside the allele card: a gene present
on one haplotype and absent from the other is an allele fact, not a duplication mode.

### Promoter motifs now have positions, and 44 genes deliberately do not

The review asked for "sticks on the promoter region, who is closer who is farer". The shipped
CRE layer carries family counts and no positions, so this needed a rescan — and everything
required was already on the cluster: the JASPAR file, the same 1 kb promoter FASTAs the
published counts were scanned from, and the upstream scan's exact algorithm, which already
computed bp from the TSS to each motif's 5' edge internally.

**1,933,839 positions over 63,907 genes**, nine named TF families, drawn with the transcription
start at the right and upstream running left. `other` is excluded: it is 457 unrelated matrices
and not a meaningful thing to draw a per-motif tick for.

A pilot on 600 genes decided the scope before the full run: the family-size gate passed exactly,
589 of 600 genes reproduced the published counts, and every disagreement was confined to
`other`. At full scale **45 cells across 44 genes disagree on a named family, and 45 of 45 are
this scan finding MORE matches, never fewer** — the direction predicted in advance, because
upstream scanned a 3 kb window whose greedy non-overlapping pass is global over 3 kb, and only
the 1 kb FASTA exists here, so a motif near the boundary has no upstream competitor to suppress
it. **Those 44 genes ship no positions and say so on the card.** Drawing ticks that aggregate to
a different number than the bars immediately above them would put two contradictory statements
on one card.

The gate is re-asserted at ingest, not just upstream: every shipped gene's positions must sum
per family to the `cre.fam` count the atlas already serves, or nothing is written. It fired on
the first attempt and caught a real defect — `build_cre.py` deliberately renames three families
when it ingests counts (`ABRE_bZIP`→`bZIP`, `DREB_ERF`→`AP2_ERF`, `MADS_box`→`MADS`, so that
ABRE and DRE/CRT are not presented as identified cis-elements), and the scan emits the upstream
names, so three of nine lanes silently had no counterpart. Lane labels now come from the
manifest's own `family_labels` rather than from reformatting a key.

### About, and the checks

About gained the one thing no module page showed: a per-layer **coverage table** with what an
absent value means in each layer. Nothing was folded away, because the pages earned their place.

`check.mjs` gained eight cases and one fix that matters more than any of them: **a crash
mid-suite used to exit 0**, leaving 32 checks unrun while the output looked green. That is how a
rename passed while breaking them. An abort is now loud and non-zero.

## 0.5.0 — 2026-09-10 — A 3D model on every modelled gene page

Every gene with an ESMFold model (40,685 of 63,960, the same set the secondary-structure bars
already cover) now has a "Show 3D model" button on its Protein card. It opens a C-alpha trace,
one point per residue joined in chain order, coloured by the model's own per-residue confidence
in the AlphaFold DB bands (≥ 90, 70 to 90, 50 to 70, < 50). A legend under the viewer states how
many residues fall in each band, and hovering a residue gives its amino acid, pLDDT and DSSP
state.

**A trace, not the full-atom model, because of size.** The genome's full-atom models are 9.4 GB
raw and 2.3 GB gzipped, measured on a 400-model random sample. That is over GitHub Pages' 1 GB
published-site cap on its own, with `data/` already at 560 MB. Packed as a binary Cα trace with
pLDDT, sequence and DSSP (10 bytes per residue, gzipped), all 40,685 models are **94.1 MB in
2,577 files**, about 25 KB per fetch. 3Dmol.js 2.5.5 (BSD-3) is vendored and loaded only when a
reader opens a model, so no page pays for a viewer it does not use.

**The colour is the point for young genes.** 97% of the PS ≥ 18 pool has mean pLDDT below 70, so
a lineage-specific gene's model is mostly yellow and orange. The card says what that means: the
path of the chain there is not a prediction of shape. It is the visual form of the "coil tracks
model confidence" warning this card already carried.

**Gated on the numbers the page already showed, as identical strings.** `patch_structure.py`
refuses to write unless every gene's per-residue arrays replay the source table
`secondary_structure_summary.tsv` exactly: residue count, mean pLDDT, fraction below 70, and
helix, strand and coil fractions, recomputed with the producer's own float32 arithmetic and
formatted the same way. It also checks that every shard value is that table rounded to 3. Two
looser gates were tried first and both failed, correctly. Checking the arrays against the shard
at 0.00051 failed about 1,400 genes, because the shard is the 4-decimal table re-rounded to 3.
Checking against the table at half a unit then failed one gene on mean pLDDT: float64 gives
88.795005, the producer's float32 gives 88.794998. Loosening either tolerance would have passed.
Replaying the producer's arithmetic passed every field of every gene. Each bucket is also decoded
back and compared integer for integer, and a second run produced byte-identical files.

**Found by screenshot, not by a check.** 3Dmol's default cartoon draws nothing for a C-alpha-only
model. The first browser check asserted only that a canvas existed, and it passed on three blank
canvases. The viewer now uses the trace style, which draws the chain but not helix or strand
shapes, so the DSSP state moved into the hover readout. `check.mjs` now re-renders each model,
counts painted pixels, and requires a pixel of every pLDDT colour the legend reports. A negative
control (the same model under the default cartoon) reads 0.00% painted against 1.90% for the
shipped style.

Excluded: `PtXaTreH.08G115400`, whose ESMFold PDB is 0 bytes. It is also absent from the
secondary-structure table, so coverage is unchanged. Provenance: `sources/structure_ca.provenance.json`.

## 0.4.1 — 2026-09-10 — Chromatin, as a property of the ortholog

The only ATAC-seq or ChIP-seq that exists for anything in Salicaceae: GEO GSE128434 (Lu, Marand,
Schmitz and colleagues, *Nature Plants* 2019), *P. trichocarpa* leaf, reprocessed on Sapelo2.
45,869 genes (71.7%) now carry accessible-chromatin, H3K4me3, H3K36me3 and own-promoter calls.

**It is the ortholog's chromatin, and the card says so in words rather than in a footnote.** The
analysis runs entirely inside *P. trichocarpa* — peaks called on trichocarpa leaf nuclei, scored
against trichocarpa gene starts. Nothing was measured on 717, and no chromatin data exists for
this hybrid or for either parent species. This release first deferred the layer over exactly
that: carrying a promoter call across an ortholog edge asserts promoter synteny that a
reciprocal-ortholog call does not establish. Scoping the claim to the ortholog removes the
assertion instead of tolerating it.

Attached only where the ortholog call is reciprocal 1:1. An ambiguous ortholog is not a licence
to take a top hit, and the patcher asserts it never lands on one. A *P. trichocarpa* locus
reaches at most two atlas genes, one per haplotype, which is what a phased diploid should give;
22,403 loci reach both.

**Leaf expression gates every mark on the card.** The chromatin is leaf-only, so a gene silent in
leaf correctly carries no active-promoter mark, and rendering four absent marks would read as an
absence of regulation when it is an absence of relevant data. 3,857 of the attached genes are in
that state and say so instead. This is the same discipline as the proteomics detectability
column in 0.4.0, and the source analysis's own first run failed its own gate for precisely this
reason — along with a 500 bp window that had to be widened to 2 kb, because 55% of conserved
gene starts have their nearest accessible region further away than that, which is the source
paper's own headline finding about distal elements in plants. Both corrections are recorded in
the provenance rather than absorbed, since changing a criterion after a gate fails is how
gate-shopping happens.

Gated on the source's published numbers before writing: the **81.5%** conserved leaf-expressed
H3K4me3 rate that its own gate turns on, and all eight cells of its Populus-specific versus
matched-conserved effect table. All nine reproduce exactly.

Two columns are dropped at ingestion. `rank` is a *P. trichocarpa* phylostratum from a different
genEra run, and a column called `rank` sitting on a 717 gene page would be read as the 717 rank.
`is_matched_control` is an analysis-internal sampling flag.

### Also: a survey of what other public data is worth adding

`docs/DATA_AUDIT_2026-09-10.md` gains a section answering that directly, from a live census of
ProteomeXchange, SRA, BioProject and PRIDE run on 2026-09-09. In short: 50 Salicaceae proteomics
datasets exist and five are ingested, with **vendor format rather than size** the constraint —
only 14 of 25 PRIDE datasets are Thermo. That retires two datasets this atlas used to serve
through Tier 1 and had named as next targets: PXD023826 is Waters and PXD064017 is Bruker, and
neither is readable here at all. It matters beyond bookkeeping, because all three Tier 1 hits
came from PXD064017 and so cannot currently be followed up by re-search.

*Populus* **Ribo-seq was re-verified as zero**, in both *Populus* and *Salix* — which is why the
mass-spec layer is the translation evidence rather than one input to it. Population genomics is
the largest thing still missing (8,030 WGS runs across the genus, against a clone that carries no
polymorphism by construction) and pairs with 0.4.0's Ka/Ks into a polymorphism-plus-divergence
contrast; that run was submitted on 2026-09-10 and is still going.

## 0.4.0 — 2026-09-10 — The published pool was withdrawn upstream, and two new layers

A minor-version bump rather than a patch, because the first item changes a number the site has
been publishing since it went live. Sweep of every Sapelo2 job that finished 2026-09-08 to
2026-09-10 and every scratch directory touched in that window; full survey and the verdicts
that did *not* result in a layer are in `docs/DATA_AUDIT_2026-09-10.md`.

### The LSG pool moved from 842/883 to 776/835, and the site was serving the withdrawn one

Upstream withdrew the frozen 12-genome pool on 2026-09-09 (`ms2-lsg docs/CORRECTIONS.md` C2,
"Decision: ADOPTED (Chen, 2026-09-09)"). The atlas kept publishing it for four days, including
in Browse facets, the phylostratigraphy ladder and the `ps.lsg` flag on every gene.

*Idesia polycarpa* is the only Salicaceae genome available from outside Saliceae and was never
in the panel — a sampling gap sitting exactly where a *Populus*-specific call is made, because
a gene kept in *Idesia* but lost in *Salix* reads as *Populus*-specific. Adding it moves 766
genes, takes 114 out of the pool, and puts **none** in. One-directional movement is what adding
real homology signal looks like; a noisy rerun would move genes both ways.

**179 genes move PS19 → PS18 and stay in the pool, and none move the other way**, so pool
composition goes from 51.0% PS19 / 49.0% PS18 to 42.3% / 57.7%. The site labels PS19
"hybrid-only", so before this it showed a stratum name upstream no longer assigns to a fifth of
that arm. PS18 and PS19 are still never pooled.

The correction is **shown, not swapped**: a gene whose rank moved carries the withdrawn call
under `ps.frz` and its page says what changed and why. Numbers published against the frozen
pool are correct statements about that pool and are not retracted — they have to name it.

Three consequences worth stating rather than absorbing quietly:

- **The QC layer is cut against the withdrawn pool.** `sources/lsg_qc_flags.tsv.gz` has 1,725
  rows; 114 are now for genes outside the pool. The source's own scope rule settles it — "a
  non-pool gene has no young-age claim to qualify" — so those rows are dropped. Nothing is
  lost: `ps.frz` still records that those genes used to be candidates.
- **The arithmetic closes on the nose.** Restricting `qc_clean` to the corrected pool gives
  exactly **1,214**, which is the chapter's independently derived `qc_survivor`. The sidecar
  written on 2026-09-06 predicted a 13-gene gap between them; it closes. Two quantities reached
  by different routes landing on the same set is a real check on the correction.
- **`tax_rep` moved for 1,251 genes whose rank did not.** It is a percentage over the panel and
  the panel gained a genome. A re-scaling, not a re-call, and counted rather than changed
  silently.

`PtXaTreH.05G120200` (one of the two headline candidates upstream) is among the 114 that left:
rank 18 → 17, it has an *Idesia* homolog.

### The abSENSE flags now carry their calibration

`qc.hdf` and `qc.verdict` shipped with no statement of how well calibrated they are. That was
measured for the first time on 2026-09-09, over 868,127 predicted-versus-observed bitscore
pairs. Point predictions are excellent (r 0.981/0.983). The intervals are not: nominal 99%
prediction intervals contain 87–88% of true scores overall — and only **0.610 / 0.594 at
*Salix purpurea***, which is the boundary species every flag on this pool is predicted at, with
a **+19 bitscore bias in the direction that over-calls `surprising_absence`**. That is also the
optimistic bound: it is in-sample, and measured on genes that *have* a *Salix* homolog and are
therefore not LSGs.

Nothing is retracted — the pool correction does not rest on abSENSE at all. The number now
travels with the flag on the gene page.

### Proteomics: a real re-search replaces a string match

`prot.ms` held Tier-1 evidence: a 717 protein's tryptic peptides string-matched against peptide
tables a third party built by searching a **different species'** database. A negative there is
uninformative by construction — a peptide unique to 717 could never have appeared in that
database.

Replaced by the re-search: the same class of raw spectra searched against a database that does
contain the 717 proteins (98,659 targets), Sage 0.14.7, 1% peptide **and** spectrum FDR, across
**five** public *Populus* datasets. Genome-wide, so a blank now means something.

Detection is monotone with gene age — 42.28% ancient, 12.78% conserved, 6.14% rosid, 2.93%
Salicaceae, 0.12% pool — which is the shape expected if the assay tracks real protein abundance
and conservation rather than noise.

It ships with the denominator that makes an absence readable: `abl` says whether the gene has
any fully-tryptic peptide in the searchable window at all. A protein with none is invisible
however abundant it is, and that is a composition property on which young genes differ from old
ones. 54 genes are undetectable this way and say so on their own page. The control does not
move the headline (pool 0.0% either way) — which is a different statement from not running it.

Stated losses: PXD023826 and PXD064017 were covered by Tier 1 and are not covered here (one is
DIA and needs a different engine, the other a vendor format). A Sage 1% FDR is not an MSFragger
1% FDR. Three of the five datasets are other *Populus* species whose samples contain no 717
protein, so a hit there says the gene *family* is translated somewhere in *Populus*.

### New: Ka/Ks against *Populus trichocarpa*

52,232 genes (81.7%) gain an interspecific ω. The atlas's only selection-adjacent number before
was HAP1↔HAP2 dS, which compares two haplotypes of one clone.

ω rises monotonically with youth — **0.235 / 0.327 / 0.475 / 0.566 / 0.720** from most ancient
to the *Populus*-specific pool — and stays well below the neutral 1. Young genes here are
constrained, just less constrained. Pairing rate falls with youth (87.6% → 39.1%), so a young
stratum's figure is measured on its more conserved members. **PS19 has no ω at all**: 1 of 681
genes has any pair, which is structural rather than missing, and renders as a stated absence.

**The estimator was chosen by measurement.** NG86 and YN00 ω correlate at **r = 0.07 to 0.36
per gene** on these alignments while their class medians agree to within 0.06 — median dS is
about 0.04, close enough that the maximum-likelihood estimate is unstable gene by gene. Class
agreement was hiding per-gene disagreement, which matters because an atlas is a per-gene
resource. NG86 is the one with external support: r = **0.937** against the atlas's existing,
independently derived allele ω, where YN00 gives **0.083**. NG86 ships as the value; YN00 ships
only to show the spread where they disagree.

### An existing layer audited, for free

The new pipeline covers the HAP1↔HAP2 pair the allele card has served since v0.2, independently.
The two **agree on the partner gene for 100.0% of 50,656 genes** — two orthology methods, one
syntenic and one reciprocal-best, with no disagreement at all. Their ω differs by ~20% at the
median, and the evidence says the instability is on the new pipeline's YN00 side, not the
card's. Nothing retracted; the card now carries the corroboration and the number.

Separately, the reciprocal-best *Potri* orthologs behind the new layer agree with the atlas's
GENESPACE syntenic 1:1 calls for **42,858 of 43,441 genes (98.7%)**. The 583 that differ carry
a note on their card rather than being silently trusted or dropped.

### Checks

Four new data checks, and each was confirmed to **fail** on deliberately broken input before
being trusted: the manifest pool total against the shard pool, the phylostratigraphy ladder
against the shard ranks stratum by stratum, no embargoed LSG candidate label reaching any shard
(searched as text, so a rename cannot dodge it), and `ps.frz` existing only where the two
panels disagree.

`validate_data.py` also gained a width assertion on the facet comparison. It compared columns
with `zip()`, which truncates to the shorter list — so a column added to `build_facets.py`
without being added there would have been compared against nothing and passed silently. Two
columns were added this release, which is exactly when that would have bitten.

Both new source tables are **gated at generation**: each aggregates its own per-gene output
back to gene class and refuses to write unless it reproduces the owning analysis's published
summary table — 84 cells for proteomics, 11 for Ka/Ks. Where the Ka/Ks gate disagreed on 5
cells, the cause was diagnosed (that table counts each HAP1↔HAP2 pair once per partner gene, so
its n is exactly twice a per-gene-keyed count) rather than worked around.

Eight new render checks, including the two that matter most: a gene that left the pool must say
so, and a gene that *could not have been detected* must not render like one that was looked for
and missed.

## 0.3.11 — 2026-09-08 — Three silent defects in the build itself

No new layers. Everything here is a correction to data that was already shipping, found by
diffing two rebuilds against each other rather than by any check.

**The facet index was stale, and Browse disagreed with the gene page.** The
`leaf_young`/`leaf_old` tissue correction was patched into the gene shards without re-running
`build_facets.py`, so `data/index/facets.json` kept pre-fix values: **54,705 genes with the
wrong tau and 16,321 with the wrong top tissue**. Filtering by tissue specificity in Browse
returned answers that contradicted the gene page it linked to. The facet table is a pure
function of the shards, so `validate_data.py` now recomputes **every row and every column**
and compares. It previously sampled every 997th gene and only the `cls` and `ps` columns —
neither of which expression work can touch, which is why it passed throughout.

**834 PANTHER accessions were labelled with an arbitrary member gene's name.** A
single-accession defline offers a name for that accession, and `build_annotation.py` kept
whichever arrived first while iterating an unordered `set`. Those are per-gene *subfamily*
names, not the family's: PTHR13832 was shipped as "PROTEIN PHOSPHATASE 1D" or "PROTEIN
PHOSPHATASE 1K" depending on the build, and PTHR27001 had 40 candidates. 88.5% of accessions
are named consistently and keep their label; the 834 that are not now render as the bare
accession. Correct and unlabelled beats labelled and wrong.

**The build was not reproducible.** Python randomises string hashing per process, so the same
`set` iteration also reshuffled all 26 search-index shards on every build — content-identical,
but a 26-file diff that made `git status` useless as a "did the data actually change" signal.
Both iterations are now sorted; two consecutive runs are byte-identical across all 27 index
files.

**Version numbers now have a single source of truth.** `data_version` was read in three places
and written by nothing — it survived only as a hand-edit to the committed manifest, so the next
full rebuild would have dropped it silently (the footer hides the chip when the key is absent).
A `VERSION` file is now stamped into the manifest by `build_data.py` and again by
`build_facets.py`, and `scripts/check_version.py` holds it equal to `CITATION.cff` and to the
newest versioned heading here. `CITATION.cff` was four releases behind at 0.2.0.

**`build_all.sh` could not finish the build it started.** Seven stages added since it was
written were missing from it, and four of those read the OneDrive tree that is not mounted on
Sapelo2 — so running it there would have wiped `data/genes` and been unable to restore them.
It now classifies every stage by the source tree it needs and refuses to start unless it can
finish, with `--allow-partial` as the explicit opt-in for one half of a two-machine build.

## 0.3.10 — 2026-09-07 — Expression scrubber, the locus-map plan's section 2.3

Paint the same locus window Locus and Mirror already draw, but by expression instead of
duplication class: click through the 10 tissues for median TPM, or pick one of the curated
panel's 191 perturbation contrasts for a live log2 fold-change. New card on the gene page,
gated on the gene actually carrying an expression shard (`g.x`).

The plan's own framing was "pure client work," since the data is already in the two bucket
files the locus fetched. Tissue mode is literally that -- each gene's own `x.t[tissue]`
median, no new build. Contrast mode needed one bridge: MS1's canonical curated panel,
`data/50_v4_panel_20260814/v4_contrasts_20260814.csv` (191 rows), names each contrast's
control and perturbation arm as sample LABELS, not positions in this site's own 652-sample
vector order. A new script, `scripts/build_contrasts.py`, resolves each label to its fixed
index once at build time and ships a 191-entry `data/expr/contrasts.json` (index lists
only, no per-gene values) -- the fold-change itself, `log2((mean perturbation + 1) /
(mean control + 1))`, is computed live in the browser from each gene's already-fetched raw
652-sample vector against whichever contrast the reader picks. No 63,960-gene by
191-contrast table was built or shipped; the arithmetic is cheap enough per gene that
shipping the inputs and computing on demand beats shipping the outputs.

**A file that looks like exactly this precomputed table already exists on disk, and is
not used.** `data/v7_supporting/log2FC_per_gene_per_contrast_v4.csv` (225 MB) was checked,
not assumed: 47 distinct contrast ids on an underscore naming scheme
(`control_500CO2_non-recovered`) against the current panel's own comma scheme and full
191-contrast count, and a file three months older than the panel it would need to match.
Documented inline in `build_contrasts.py`'s own docstring so the next session doesn't
rediscover this by re-reading 225 MB.

**Ships one strip with a mode toggle, not two permanent strips.** The plan text describes
tissue and contrast as two simultaneous draggable strips. Both modes paint the identical
gene window on the identical x-axis, so a second permanently-visible strip would only
double the canvas, not add information -- and 191 contrasts do not fit a row of chips, so
contrast selection is a single `<select>` grouped into four optgroups by kind (treatment,
genotype, other condition, growth condition) rather than a strip. Opens on the gene's own
top-expressed tissue (`g.x.top`) rather than an arbitrary first tissue, so the default view
is already meaningful rather than blank.

**A visualization bug caught by looking at the screenshot, not the numbers.** The first
render used a linear min-max scale directly on tissue TPM; the result was a near-blank
window with only the single loudest gene visible, because TPM is heavily right-skewed.
Fixed by scaling `log2(TPM+1)` before normalizing for the tissue strip -- the same
transform the site's raw vectors are read in elsewhere -- while contrast mode's log2FC
values, already log-scaled, are used as-is.

**Three real bugs surfaced before shipping, each caught by a different check.** An edit to
the `<select>` option values corrupted the intended `|` separator into a literal SOH
control byte in two places, surfacing as a confusing silent no-op on `split('|')` rather
than an exception; found only by dumping the file with `od -c` after higher-level checks
kept passing against stale cached content, fixed with a direct byte-level
`perl -i -pe 's/\x01/|/g'` and confirmed at zero occurrences afterward. Switching to
"By contrast" without ever touching the dropdown left the previous tissue-mode caption on
screen, because a `<select>`'s browser-assigned first option does not fire its own
`change` event; fixed by hoisting the option-lookup map out of the load closure so the
mode button's own click handler can resolve and paint the implied first option exactly as
the `change` handler would. And giving the 10 tissue chips `min-width:0` to keep them
visually compact silently dropped them below the site's established 44px WCAG touch-target
floor, while nearly tripling the page's total `.locus-btn` count and breaking the
pre-existing `locus-desktop`/`locus-phone` checks, which had assumed -- correctly, until
this card reused the same class -- that the whole page has exactly 4 such buttons; fixed by
dropping the override, moving the contrast `<select>` out of `.locus-btn` entirely (it
needs its own width, not a fixed floor), rescoping those two checks to the same card as the
canvas they test rather than the whole document, and adding a dedicated
`scrubber:touch-targets` check so this specific regression can't recur silently.

**Checks.** `validate_data.py` gains three: `contrasts.json` has exactly 191 entries, every
sample index it names is in range for `samples.json`, and both arms of every contrast are
non-empty. `check.mjs` gains four: the tissue strip opens on the gene's own top tissue by
default, switching to contrast mode without touching the select still paints the implied
selection, a driven click through the canvas navigates to a real gene, and the touch-target
regression above -- 51/51 total pass, including `locus-desktop`/`locus-phone` restored to
their original page-wide count of 4. Screenshots reviewed for two tissues, one contrast,
and the phone layout (no horizontal scroll).

## Fixed — every Phytozome link on the site was broken

The constant behind both links pointed at `report-gene/` with no genome segment at all
(`https://phytozome-next.jgi.doe.gov/report-gene/<id>`), which 404s for every gene -- it was
never a valid URL on the current site. Replaced with the real pattern,
`.../report/gene/<genome-id>/<gene-id>`, and the three genome-id slugs verified by actually
navigating to each rather than guessed: `PtremulaxPopulusalbaHAP1_v5_1`,
`PtremulaxPopulusalbaHAP2_v5_1` (confirmed against Phytozome's own reported genome IDs, 717
and 716), and `Ptrichocarpa_v4_1` for the cross-species ortholog link (found via Phytozome's
own genome picker after a first guess at the slug 404'd -- not assumed from the pattern of
the other two).

**Added a second link**: "View in genome browser," to Phytozome's JBrowse instance at this
gene's own coordinates, with the track set Chen already uses day to day
(`Transcripts,Alt_Transcripts,PASA_assembly,Blatx_BasalMalvidae,Blastx_protein,RNAExpression`)
rather than a guessed-at default. Verified byte-for-byte: `URLSearchParams` reproduces the
exact percent-encoding of a known-working example URL before trusting it in the codebase.

`check.mjs` gains a check that reads the actual `href` values of all three link kinds (own
gene report, cross-species ortholog report, genome browser) on both a HAP1 and a HAP2 gene
page -- a wrong destination renders identically to a right one, so only the href itself
proves it.

## Mirror view — the locus-map plan's section 2.2, shipped 2026-09-08

The two-strand, haplotype-native view: the syntenic HAP2 locus drawn flipped to face its
HAP1 counterpart, with ribbons between allele pairs. New card on the gene page, right below
Locus, rendered only for a gene that itself has an allele partner (a gene with none has
nothing to anchor the view on).

No new data build. Reuses the same locus tiles the Locus card already fetches -- which
already carry each gene's allele-partner id -- plus the ordinary per-gene shard lookup
(`getGene`) to resolve a partner's own position, structure and Ks. Ribbon crossing (a local
inversion) and copy-number asymmetry are not detected by special-case code; they fall out
for free from mapping each side by its own true coordinate, the same "let the data draw
itself" approach as the rest of this project's figures.

**A hemizygous gene reads as a gap, honestly.** The two haplotypes are independently
assembled genomes with no shared coordinate system, so "an empty slot on the other strand"
(the plan's own phrase) is drawn as simply no ribbon reaching that gene, rather than a
fabricated shared axis pretending to align two different physical sequences. Verified
against a real case: `PtXaTreH.12G001200`'s neighbourhood runs into a confirmed HAP1-only
stretch (checked against the PAV layer's own `confirmed` flag before treating it as a good
test case), and the card correctly reports "9 with none" alongside the 8 that do have a
partner.

**Deliberately not drawn**: tandem-array brackets grouping array members into one visual
unit. The ribbon view already shows a size mismatch as an uneven ribbon count landing in a
shorter span; a dedicated bracket is a follow-up, not silently pretended here.

**A real caching trap, worth recording.** The card worked when called directly in the
console but did not appear on the actual page after a hash-only navigation, a full
`index.html` reload, and even a brand-new tab -- all three still showed the pre-existing
site with no trace of the new module. Root cause, confirmed by fetching the same URL with
and without `cache: 'no-store'`: the browser's ordinary HTTP cache was serving a stale
`registry.js` left over from earlier in this same long-lived session, and modules imported
by a stale file are never fetched at all, so the new file's own correctness was never in
question. Fixed by serving from a fresh port with no cache history, not by changing any
code -- worth remembering for the next feature added in this same browser session.

**Checks.** `check.mjs` gains three: the card renders on a gene with a fully-resolved
neighbourhood, renders on a gene whose neighbourhood has genuine hemizygous gaps and reports
them in its own count, and a driven click on the OTHER haplotype's strip actually navigates
to a real gene on that haplotype -- 44/44 total pass. Screenshots reviewed for a fully-paired
neighbourhood, a neighbourhood with real gaps, and the phone layout (no horizontal scroll,
the same reduced flank the Locus card already uses on narrow screens).

## Genome map — the locus-map plan's section 2.4, shipped 2026-09-07

Semantic zoom from all 19 chromosomes down to one chromosome's genes, then a click hands
off to the already-shipped locus card for the final resolve. New route `#/map`, new nav
link, reuses data the locus-card work (0.3.5) already built for exactly this purpose
(`data/locus/overview.json`, `data/locus/index/{hap}/{chr}.json`) -- no new data build.

**Overview tier**: one horizontal strip per chromosome, drawn to its own physical length
(a real ideogram proportion, not 19 equal bars), coloured by a selectable 100kb-bin
density -- gene count, tandem fraction, LSG-pool fraction, or mean τ. Click a chromosome
to zoom in. **Chromosome tier**: one tick per gene at its true coordinate, coloured by
duplication class with the same palette and the same convention as the locus card. Click
a gene to open its page.

**Reused, not duplicated, the locus card's canvas machinery.** The palette-resolution
helper (`fillFor`/`palette`, the fix for canvas fillStyle not resolving CSS custom
properties) moved to a new `js/core/palette.js` so the locus card and the genome map read
the exact same colours and can never drift apart -- a direct instance of the plan's own
"one renderer" principle. The DPR/ResizeObserver fitting discipline is reused as a small
`makeStage()` helper rather than copy-pasted a second time.

**WGD-block and syntenic-run overlays are NOT drawn at the chromosome tier.** The plan's
own section 1.3 flagged that data layer as unmeasured and not yet built; this ships the
two tiers the existing data supports rather than silently promising a third. The
chromosome-view caption says so explicitly and points back to the gene page's locus card,
which already carries allele and duplication-array relationships today.

**A design mistake caught by rereading my own code, not by the render suite.** A first
draft wired hover state through by directly reconstructing the canvas context and
re-invoking the draw function inline, bypassing the stage's own hit-test bookkeeping --
harmless here only because tick positions do not move with hover, so it happened not to
surface as a visible bug, but it was still wrong and would not have stayed harmless
through the next change. Rewritten so the stage exposes two real entry points,
`refresh()` for a resize and `redraw()` for a pure repaint, and both render tiers use only
those. **A second bug the render suite DID catch**: the chromosome-view check initially
asserted the word "genes" appears in the page text, which can never pass -- that count is
drawn inside the canvas, like the locus card's own captions, and canvas text is invisible
to `innerText`. Fixed the check, not the (correctly working) feature.

**Checks.** `validate_data.py` gains four: `overview.json` covers both haplotypes, every
overview chromosome has a matching per-chromosome index file, the two independently-built
files agree on gene count per chromosome, and every gene an index file names is a real
atlas gene -- 30/30 pass. `check.mjs` gains three, including one that drives the full
chain: load the overview, click a chromosome, confirm the chromosome view rendered, click
a gene tick, confirm the browser actually navigated to that gene's real page -- 39/39
pass. Screenshots reviewed for the overview (both haplotypes) and one chromosome zoom.

## 0.3.9 — 2026-09-06

**Added — LSG evidence-quality flags, per gene (TODO 23)**
The site has long carried a general-purpose prose warning that a young phylostratum is
not proof of a young gene. This makes that warning specific: a per-gene "Evidence
quality" line on the phylostratigraphy card, sourced from the ms2-lsg agent's already
Chen-approved `sources/lsg_qc_flags.tsv.gz` (1,725 rows, the LSG pool only -- the other
62,235 genes render nothing here).

A gene can carry: a Salix tblastn hit that contradicts the young call outright; an
abSENSE verdict, rendered as its own string (not collapsed into a yes/no gene-age claim),
with an explicit caution note wherever the flag is `detection_failure_plausible` -- an
ancestral homolog could exist and be undetectable at this sensitivity, which is not the
same claim as "the gene is old"; a minimum Ks in the salicoid-WGD era, meaning it may be
an ohnolog rather than a novelty; a contested orthogroup slot from an independent
12-genome OrthoFinder rerun; a short ORF, a known annotation-artifact class; or (10 genes
only) a flag that the chapter's headline result changes if this one gene is excluded.

**Three constraints enforced, not just followed, because this is a public page over
chapter-adjacent data.** (1) Flags, not filters -- nothing here changes which genes are
in the published pool (842 HAP1 + 883 HAP2), and the card has no filter control that
could. (2) Two fields must never reach the site: `qc_survivor` and
`in_idesia_corrected_pool` silently encode an Idesia polycarpa pool correction Chen has
not adopted (it would move the pool to 776/835; the chapter still cites 842/883).
`patch_lsg_qc.py` asserts both are absent from the source file's own header before
reading a row, and `validate_data.py` gains a check that searches every shard's
serialized `qc` record as text for either name -- not a fixed key list a future rename
could slip past. (3) abSENSE speaks to the reliability of the age call, not the gene;
enforced by rendering its verdict field directly rather than re-deriving a boolean.

**Checks.** `validate_data.py` gains three (no forbidden field on any shard, every `qc`
record sits on an actual pool gene, manifest count matches the shard count) -- 26/26
pass. `check.mjs` renders a flagged gene and a clean gene, then separately loads a page
and searches its full rendered text for either forbidden field by string, independent of
the two content checks -- 35/35 pass. Screenshots reviewed for both.

## 0.3.8 — 2026-09-06

**Fixed — the "missing" duplication and PAV sources were never actually missing (TODO 21)**
The 2026-09-05 audit's `docs/DATA_AUDIT.md` and this file's own `TODO.md`/`HANDOFF.md`
claimed the canonical `tier1_floor` PAV table and `master_duplication_table_v6.csv` were
absent from the ms1-dup mirror. Checked directly instead of trusted, and both are present,
under names the audit never searched for: `hemizygous_pav_diamond.csv` (PAV) and
`master_duplication_table_v9.csv` (duplication -- v6 is itself superseded by v9, so
chasing the file this TODO literally named would have imported an already-stale table).

**Duplication moved from v8 to v9 -- and 0 genes actually changed.** Checked before
assuming: the atlas's existing `dupclass_membership_v8.csv` source had already been
carrying the adopted WGD rule 5c letters (byte-identical from the v8 freeze, per that
table's own build history) and the current TD union set (6,663/6,385 tandem genes,
matching the canonical numbers exactly) despite its name. The swap is kept anyway --
provenance should point at the table that is actually canonical, not one whose own name
and this repo's own comments both claimed staleness that measurement showed was untrue.

**PAV/hemizygosity added for the first time.** Not a swap: the atlas has never shipped
this layer. `hemizygous_pav_diamond.csv` is a 6,092-gene candidate set (from an
asymmetric HAP1/HAP2 orthogroup), of which 805 HAP1 / 859 HAP2 are DIAMOND-confirmed
hemizygous -- exactly the numbers already cited elsewhere in this project as canonical.
Shown as a "Presence" card only on genes in the candidate set (no key at all for the
other ~58,000, same convention as ESMFold's coverage-limited layer): confirmed genes get
a plain verdict, unconfirmed ones name the contradicting DIAMOND hit and are captioned as
a likely detection gap in the original orthogroup call, not a confirmed absence.

**A real bug, caught by the render suite before it ever loaded a page.** The first draft
of the PAV card's nested ternary lost track of one closing parenthesis, which broke
`duplication.js`'s module parse -- and because ES modules fail atomically, every route on
the site went blank with a single `pageerror`, not just the duplication card. Rewritten
with intermediate variables instead of deep nesting specifically to make this class of
mistake harder to make, not just to fix this one instance.

**Checks.** `validate_data.py` gains three: tandem gene counts match the canonical union
totals per haplotype, PAV-confirmed counts match the canonical 805/859, and every
"not confirmed" PAV record's named target resolves to a real gene. `check.mjs` gains two,
a DIAMOND-confirmed gene and a not-confirmed one with a named contradicting hit, so a
swapped confirmed/not-confirmed branch cannot hide behind whichever case happens to
render. Screenshots reviewed for both.

## 0.3.7 — 2026-09-06

**Added — ComBat-seq batch-corrected values, opt-in per gene (TODO 18)**
TODO 18 had stood on a wrong premise: the shipped ComBat-seq matrix was believed to be an
older, incompatible gene generation and to need a fresh 63,960-gene rerun. Checked instead
of trusted, and it was wrong. Joining the two directly: **0 sample mismatches** (652 of 652,
exact 1:1 on the metadata's own `column` field, which already stores the matrix's
accession-style header verbatim) and **0 gene-naming mismatches** once the trailing
transcript-style suffix is stripped (`PtXaTreH.T003800.1` -> `PtXaTreH.T003800`). No rerun
needed; this is a local join, `scripts/build_combat.py`.

The real gap, 59,599 of 63,960 genes, is not a mismatch at all. Measured, not assumed: the
4,361 excluded genes have a median max-TPM of 0.84 across all 652 samples (91.2% never
exceed 5 TPM anywhere), against 26.73 (11.2% under 5 TPM) for the 59,599 included --
consistent with a low-count filter ahead of the original ComBat-seq run, which needs count
signal to fit its model, not with an incomplete or differently-versioned gene set.

**Offered per gene, not as a site-wide feature.** A gene without a ComBat value has nothing
to show, so the toggle is present only when the shard carries `x.cb` -- there is no
disabled state or "not available" message, since either would imply a value that does not
exist. Wired as a source toggle (Raw / ComBat-corrected) above the existing By
condition / By sample tabs, swapping which vector feeds both, rather than tripling the tab
count. Labeled explicitly as a cross-study comparison view: raw TPM stays primary
everywhere else on the site, per the existing caution that batch is confounded with tissue
for roughly 70% of the 652 samples.

**Checks.** `validate_data.py` gains three: the manifest's `combat_eligible_genes` count
matches the shards carrying `x.cb`, every `x.cb` pointer resolves to a real bucket entry,
and no ComBat-eligible gene lacks a raw baseline. `check.mjs` drives the toggle on a known
eligible gene (confirms the rendered numbers actually change, not just that the button
exists) and confirms the toggle is absent on a known ineligible one. A first draft of the
check used an unscoped `#view tbody tr` selector and silently graded the promoter card's
table instead of the expression profile's -- caught because the two source's values came
back identical, not because the selector looked wrong. Fixed by giving the profile's own
container a stable id (`#expr-profile`) rather than guessing a more specific CSS path.

## 0.3.6 — 2026-09-06

**Added — the promoter / CRE card**
Every gene page now shows its 1 kb promoter's GC content, TATA-box status, and a
transcription-factor-family motif strip, from the ms2-lsg agent's genome-wide JASPAR scan
(reviewed before ingestion: 63,960/63,960 genes matched the atlas exactly, family sums equal
the stored totals, and its `tata_core` rate over the LSG pool reproduces the dissertation
chapter's own `promoter_ness.tsv` to six decimals on both haplotypes).

Deliberately NOT a bare pass-through of the source columns:
- Two family names that read as specific cis-elements in the source (`ABRE_bZIP`,
  `DREB_ERF`) are TF-family groupings, not confirmed cis-regulatory elements, and are
  renamed at ingestion to `bZIP` / `AP2_ERF` -- the family names -- so the card cannot
  imply "this promoter has an ABRE" from a PWM hit to a bZIP-family matrix.
- Bars are normalized per matrix (hits ÷ matrices-in-that-family), not raw counts, because
  the families are built from 17 to 73 matrices each and the hit threshold is a fraction of
  each matrix's own score -- a family with more matrices racks up more hits for reasons
  that are about the matrix library, not the gene.
- `cre_LFY` is dropped entirely: identically zero for all 63,960 genes (one 19bp matrix
  that never clears the length-biased threshold anywhere in the genome).
- TATA is rendered as two DIFFERENT facts, not one: whether a canonical TATA box sits in
  the core promoter (−45..−20bp), versus a TATA-like hexamer found elsewhere in the window,
  which is not the same claim. **A bug in the first draft of this card inverted the
  distance** (reported "122 bp upstream" for a match that was actually 878bp upstream) --
  caught by checking a known tata_core=True gene against the raw data before trusting the
  rendered text, not by the render-check suite, which only asserted the text existed.

**Added — a search results page for ambiguous queries**
The header search dropdown can show an id and one line of description: enough to recognise
a gene you already know, not enough to pick the right one out of many (searching "kinase"
returns 4,351 genes; "MYB" and "dehydrin" return dozens of paralogs sharing one description).
`#/search/<query>` now shows the columns that actually distinguish paralogs -- synteny
class, duplication class, chromosome, phylostratum, peak tissue, τ -- side by side,
paginated 40 at a time. The dropdown gains a "N results — compare them all →" link when a
query has more matches than it can show; Enter on an ambiguous query (more matches than the
dropdown shows) goes to this page instead of blindly opening an arbitrary top hit.

One implementation lesson worth keeping: the comparison table's own horizontal-scroll
check (no page-level scroll) passed on the first try, and the page still looked bad on a
phone -- the table's DESCRIPTION column was wrapping every row onto 4+ lines instead of the
table scrolling sideways, turning a side-by-side comparison into a tall wall of text. A
global `white-space: nowrap` fix was tried first and broke the promoter card's family table,
which relies on its header wrapping to fit a phone. Scoped to a `.compare` modifier instead,
applied only to tables that need it. Caught by looking at the screenshot both times, not by
the scroll-width assertion, which was satisfied throughout.

**Checks**
`validate_data.py` gains three: every gene carries a `cre` record, family counts sum to the
stored total, TATA position lies inside the promoter window. `check.mjs` gains: the
promoter card on both a TATA-true and a TATA-false gene (so an inverted-branch bug like the
one above can't hide behind whichever case happens to render), and the search-refinement
flow end to end (dropdown → "compare them all" → paginated results).

## 0.3.5 — 2026-09-06

**Added — the locus card, and the data layer under it**
Every gene page now draws its neighbourhood: gene arrows with exon structure, forward strand
above the line and reverse below, coloured by duplication class, focal gene boxed. Built from
the v5.1 annotation, which lives in OneDrive rather than on Sapelo2 — so `scripts/build_locus.py`
runs off-cluster, unlike the rest of the build. Isoform choice is the annotation's own
`longest=1` flag, not a length recomputed here.

Three outputs sized for how they are fetched: per-megabase tiles (median 6.9 KB gzipped, the
locus card's only fetch), per-chromosome position indexes for the coming genome map, and a
100 kb-bin overview. Validated by merging abutting CDS/UTR segments into exons and comparing
against the exon counts the atlas derived independently on Sapelo2 from a different annotation
file: **63,960 of 63,960 agree, zero disagreements.**

**Fixed — the whole site scrolled horizontally on every phone**
Found while testing the locus card at 375 px, and it predates it: the header nav was one
unwrappable 502 px flex row, which set a 522 px minimum width for *every page on the site*.
Wrapping the nav, letting the search input flex, and giving the card grid `minmax(0, 1fr)` with
`min-width: 0` (a grid item defaults to `min-width: auto`, so the single widest card was
stretching all of them) removes it. Verified at 320, 375 and 393 px, and in landscape: no
horizontal page scroll on any route. Wide tables now scroll inside their own box, as intended.

Also fixed: the τ caption added in 0.3.4 joined tissue names with `/` and no spaces, making one
unbreakable 299 px token that overflowed a 320 px viewport. Now joined with ` / `.

**Mobile is now a designed target, not a media query**
The locus window shrinks on small screens (4 genes each side instead of 10) because genes are
tap targets and 21 of them across a 375 px phone gives 16 px each, under the WCAG 2.2 SC 2.5.8
floor — the view drops genes rather than silently clamping. Panning has always-visible 44 px
step buttons and arrow keys, since SC 2.5.1 Pointer Gestures is Level A and a gesture-only pan
would fail it. Canvas fitting follows DPR discipline: ResizeObserver on the container with the
canvas absolutely positioned inside it, `device-pixel-content-box` with the Safari try/catch
fallback, a guarded width assignment (assigning it resets all 2D context state), a synchronous
redraw, and a self-re-arming dpr watcher.

One bug the screenshots caught that the assertions did not: canvas `fillStyle` does not resolve
CSS custom properties, so `var(--c-tandem)` was silently invalid and every gene drew grey. The
palette is now read off the document and re-read when the theme changes.

**Checks**
`validate_data.py` gains four locus checks (every gene has exactly one tile entry, structure
lies inside the gene span). `check.mjs` gains two: the canvas is actually painted, the DPR
backing buffer matches, controls stay at 44 px, and a phone viewport does not scroll sideways.

## 0.3.4 — 2026-09-05

**Fixed — the expression baseline and tau pooled leaf_young + leaf_old into one "leaf" bucket**
`build_expression.py` grouped WT-control samples by the metadata's `tissue` column, which has
no finer distinction than "leaf" for 46 samples (all study 1: 23 young, 23 old). Silent, no
error, a plausible-looking mean: one manually-verified case moved from a single reported 8.12
TPM to two values 3x apart once un-pooled (leaf_young 13.74, leaf_old 4.52). The same bug
pooled the "By condition" replicate-mean drill-down and the study-1 sample table's Tissue
column, both of which grouped or displayed on the same coarse field.

Fixed by joining a new `tissue_analysis` field (`sources/sample_tissue_analysis.tsv`, derived
from MS1_2026's own curated 652-sample panel, sha256'd and dated in its sidecar) and grouping
on it everywhere the old code grouped on `tissue`: the gene-card baseline and tau, the
by-condition table, `studies.json`'s per-study tissue list, and the study-page sample table.
`TISSUE_ORDER` and the tau caption's tissue list were updated to match (9 tissues, not 8; the
caption now builds its list from the data rather than a second hand-written copy of it).

Corrected in place (no raw-source rebuild needed — the per-sample TPM vectors were never
wrong, only their aggregation): `scripts/patch_leaf_tissue_analysis.py`, verified gene-by-gene
against a hand computation before running genome-wide, patched all 63,960 gene shards'
baseline summary. `build_expression.py` is fixed at the source for the next full rebuild, with
a hard assert if any future sample lacks a `tissue_analysis` mapping — the exact failure mode
that caused this, so it is a stop, not a warning.

`validate_data.py` gained a check that every gene's baseline tissue set matches the manifest's
denominator table. `check.mjs` now asserts `leaf_young`/`leaf_old` appear on the module,
study-1, and the manually-verified gene page. Full account: `docs/DATA_AUDIT.md`.

## 0.3.3 — 2026-09-05

**Fixed — the audit removals had not actually reached the data**
The 2026-09-05 audit removed the PAV and n=202-tau layers from the build code and the UI, but
`build_layers.py` only ever ADDS keys to a shard. The values earlier runs had already written
stayed in `data/`, so the published JSON was still carrying both — invisible in the interface,
but present and downloadable. A full ordered rebuild purges them: 0 genes now carry `pav` or
`tau202`. This is exactly the failure mode `scripts/build_all.sh` now exists to prevent.

**Added**
- `scripts/build_all.sh` — all eight stages in the only order that yields a complete `data/`.
- `scripts/preflight.py` — verifies all 13 source groups before anything is written, and stops
  with an explanation on any machine that is not Sapelo2 rather than half-building.
- `docs/HANDOFF.md` — what a fresh agent on another machine cannot infer from the code.

**Verified**
- The build is deterministic: two consecutive full rebuilds produce byte-identical output for
  all 277 gene shards and every index file. Only `manifest.json` differs, by its `built`
  timestamp, which is intended.

## 0.3.2 — 2026-09-05

**Added**
- **P. trichocarpa syntenic ortholog** on every gene page, with an outbound Phytozome link —
  46,141 reciprocal 1:1 pairs, 6,329 flagged ambiguous, 11,490 genes with no syntenic hit.
  A Potri id is the key that unlocks PopGenIE and Phytozome for someone holding a 717 gene,
  which is the lookup a community visitor arrives wanting. Derived from this atlas's own
  GENESPACE run rather than an imported table, so it carries no external staleness risk.
  Ambiguous relationships keep their multiplicity instead of being resolved by a top hit.

**Fixed during development**
- Reciprocity was first computed over the pooled gene set, which counted the expected
  HAP1+HAP2 pairing of a phased diploid as ambiguity and collapsed the 1:1 set to 724 of
  52,470. Computing it within each haplotype gives 46,141.

**Deferred with a reason**
- The 377-sample P. trichocarpa xylem expression atlas is NOT joined in. Doing so would place
  TPMs from a different genome, annotation version and quantification pipeline beside this
  atlas's own values, inviting a comparison the numbers do not support. The ortholog link
  above lets a visitor make that jump deliberately, at PopGenIE, where the data belongs.

## 0.3.1 — 2026-09-05

Data audit. Chen flagged that some Sapelo2 outputs are stale; every ingested layer was
re-checked against what its source repo says about itself. Full verdicts in `docs/DATA_AUDIT.md`.

**Removed**
- **PAV / hemizygosity.** The available table is the orthogroup-based PAV call that ms1-dup
  explicitly tells readers not to use (it gives 2,356 / 2,117 and has an `n_ogs` column; the
  canonical DIAMOND `tier1_floor` figures are 805 / 859). The canonical table is not in the
  mirror, so the atlas ships no PAV layer rather than the wrong one.
- **Independent tau (n=202).** Computed on a panel the source repo records as superseded on
  2026-08-24.

**Replaced with locally derived equivalents** — each was offered by a table with no canonical
status, sitting in a case-study, calibration or "structural explorations" folder:
- Exon/intron counts, now from the v5.1 `gene_exons.gff3` (longest isoform).
- TE distance, now from the v5.1 repeatmasked GFF3, excluding simple and low-complexity repeats.
- Genomic order, now sorted from the atlas's own coordinates.

**Verified rather than repeated**
- The "coil is a pLDDT proxy" warning was checked against the table: r = −0.49 for coil vs mean
  pLDDT across 40,685 genes, against +0.16 for helix. The page now quotes the measured value.
- ESMFold usage confirmed inside the source's stated safe envelope: it says aggregate
  `helix_frac` is safe and long-run helix content is not, and the atlas serves only the former.

**Privacy pass**
- Tandem-array curation notes were shipping internal lab process to a public page: curator
  initials and dates, verbatim quotes, and a named
  personal exception. Notes are now reduced to their meaning — "manually rejected during
  curation", "flagged pseudogene-like", "curated verdict disagrees with the automatic gate" —
  which is what a visitor can use. Zero shards now carry a curator identity or raw quote.
- Confirmed separately that the unpublished LSG candidate labels (names withheld here since
  2026-09-21) appear nowhere in the shipped data or UI, so no candidate identity is public. The `lsg` flag is only PS ≥ 18,
  derived from the public genEra rank.

**Surfaced for Chen**
- ms1-dup's `CLAUDE.md` contradicts itself on the canonical expression panel: §B says n=202 was
  superseded by n=222 on 2026-08-24, §D still says "the current canonical n is 202". Line 197
  breaks the tie for n=222. Worth fixing so the next reader is not misled.

## 0.3.0 — 2026-09-05

Seven genome-wide computed layers ingested from the MS1 and MS2 analysis repos, and a new
protein module. Every gene now carries duplication class, TE proximity, gene structure,
HAP1:HAP2 pangene relationship, disorder, and mass-spec evidence.

**Added**
- **Duplication class**, genome-wide: salicoid WGD / ancient WGD / tandem / dispersed / none,
  from the MS1 duplication analysis. This closes the gap the module previously declared —
  it no longer has to say "no WGD ohnolog call exists".
- **TE proximity**: distance to the nearest transposable element, per superfamily.
- **New protein module**: predicted disorder (63,910 genes), ESMFold secondary structure and
  pLDDT (40,685, 64%), and peptide evidence from three independent mass-spec datasets kept
  separate — detection is strong evidence a predicted protein is translated, which is the
  sharpest credibility test available for a young lineage-specific gene.
- **Gene structure** (exons/introns) on the location card; LSGs are known intron-poor.
- **HAP1:HAP2 pangene relationship** including hemizygosity, shown on the allele card — and
  shown especially when there is NO allele, since hemizygosity usually explains why.
- **Neighbourhood co-expression** (k=5, k=10) on the expression card.
- **Organelle-homology warning**: 362 genes have plastid/mito homology, a real false-positive
  source for novel-gene claims.

**Added (batch 2)**
- **Tandem array identity**: which genes share an array, from ms1-dup's hand-curated union set
  (13,663 genes, 4,371 arrays) — which that repo explicitly says supersedes its own v8 tandem
  tables. Carries array size, median Ks, age bin, pseudogene flags and the curator's verdict.
  This closes the "array identity is not resolved" gap the module used to declare.
- **Perturbation responsiveness**: median |log2 fold-change| across eligible contrasts
  (49,289 genes).
- **Independent tau** from a separate 202-sample panel, shown BESIDE the atlas's own
  652-sample value rather than replacing it — two panels, two answers, and their agreement is
  itself informative.
- **Previous/next gene navigation** along the chromosome, from genomic rank order.

**Not ingested, deliberately**
- `master_duplication_table_v4.csv` is superseded: it still carries the `W_excluded` category
  that ms1-dup's own CLAUDE.md says was eliminated in v5. The canonical v6 master is not
  present in this mirror, so the v8 membership file — whose A/S/T/D/C legend is confirmed by
  ms1-dup `RESOURCES.md` — is the most current per-gene duplication call available, with the
  tandem component taken from the union set above.

**Guarded**
- Duplicate source rows are collapsed only when the columns actually ingested agree. The
  proteomics tables repeat 5,024 genes that are both a `conserved` gene and an LSG's
  `matched_control`, and one gene appears twice under two canonical candidate labels (gene
  and labels withheld here since 2026-09-21). Measurements agree in every case; a
  disagreement is fatal.
- Coil fraction is flagged on every gene page as largely a pLDDT proxy, not evidence of
  disorder — the easiest misreading of the structure table.
- Where the duplication class says "none detected" but paralogs are listed, the card explains
  that the two rows answer different questions rather than leaving an apparent contradiction.

## 0.2.1 — 2026-09-04

**Added**
- Study pages render the full sample metadata that `samples.json` already carried: tissue,
  treatment, genotype, growth condition, control/perturbation role, layout, reads, alignment
  rate and per-sample processing notes.
- Expression gene card gains a **By condition** view: replicate means per experimental
  condition, grouped by study, alongside the existing per-sample strip. For a
  drought-responsive gene in study 27 bark this reads as the drought and control means side by
  side in WT (the example gene and its values are withheld here since 2026-09-21): the
  question a reader actually has, which 652 individual dots do not answer.
- Duplication module (see below) and its checks.

**Corrected**
- Condition grouping uses the metadata fields, not a `_repN` suffix strip. Study 27 encodes
  replicates as `DR1/DR2/DR3`, so label-parsing split all 72 of its samples into singleton
  "conditions". Metadata grouping gives 204 groups with a median of 3 replicates.
- `check.mjs` assertions were case-sensitive against `innerText`, which returns RENDERED text.
  Since `table.data th` is `text-transform:uppercase`, asserting "% aligned" could never match
  "% ALIGNED" — two checks failed against a page that was correct.

## 0.2.0 — 2026-09-04

The gene page becomes a hub, and phylostratigraphy gets a real module.

**Added**
- Phylostratigraphy module: log-scaled strata ladder over both haplotypes, the LSG pool
  (PS ≥ 18), genEra's own ambiguity flags (44 genes) and unplaced genes (50), and each gene's
  family origin stratum and size. 1,512 of the 1,725 LSG-pool genes are singleton families.
- Functional annotation per gene: description, best-Arabidopsis hit, Pfam, PANTHER, GO
  (4,862-term shared dictionary). 60,746 of 63,960 genes annotated.
- HAP1↔HAP2 allele link with Yang–Nielsen Ka/Ks over the 25,931-pair syntelog map;
  51,862 genes carry a partner.
- Panel presence across the 12 genomes, from the OrthoFinder orthogroup.
- Free-text search over descriptions, Arabidopsis loci and Pfam/PANTHER accessions,
  as a first-character-sharded token index. Gene-ID search still needs no index at all.
- Outbound links: Phytozome gene report, TAIR locus, AmiGO GO terms.
- `.nojekyll`, `LICENSE`, `CITATION.cff`, this changelog, a provenance page, and CI
  running the headless render checks.

- Browse / query builder: filter all 63,960 genes across synteny, phylostratigraphy,
  expression and annotation at once, over a 274 KB facet index rather than the 250 MB of
  shards. Named gene sets and TSV export. Filtering `private_no_ortholog` ∩ PS ≥ 18 returns
  923 genes, independently reproducing the step-7 report's LSG-pool figure (275 + 648).
- `scripts/validate_data.py` grew facet checks, including a sampled cross-check that facet
  values equal the gene shards they were derived from.

**Corrected**
- PAML reports `omega = 99.0` where it cannot estimate the ratio — the 716 pairs whose
  Ks is 0. Previously this would have rendered as extreme positive selection. Now nulled,
  with the pair flagged as "identical at synonymous sites".
- One pair carries `=`/`w` sentinels for Ks and Ka but a numeric omega of 0.0000, which
  displayed as "strong purifying selection". Dropped.

- The facet index encoded "no orthogroup" (0 genomes) as missing data, so 1,575
  OrthoFinder-unassigned genes displayed as "—" in the browse table instead of "none".

**Known limitation**
- HAP2 domain coverage is thin: the v5.1 release left HAP2's Pfam/PANTHER/GO columns empty
  for all 65,212 rows. GO was recovered from the lab-built `h2.custom.GO`; Pfam only partly,
  from the defline (3,222 HAP2 genes vs 26,132 on HAP1). The gene card states this, so the
  asymmetry is not mistaken for biology.

## 0.1.0 — 2026-09-01

- Gene shards for 63,960 genes; the gene ID encodes its own shard, asserted against the
  annotation at build time.
- Synteny module: five-way class, orthogroup span, old-vs-new panel diff, DIAMOND-sensitivity
  stability.
- Expression module: 652 samples, 28 curated studies, 38 BioProjects; tissue-baseline summary
  in the shard, full 652-sample vector on demand.
