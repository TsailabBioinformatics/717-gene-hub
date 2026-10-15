#!/usr/bin/env python3
"""
Checks that every source the data build reads is present, BEFORE anything is written.

Why this exists: all build inputs live on the UGA Sapelo2 cluster (/scratch, /work). On any
other machine the build cannot run at all. Without this check the scripts would half-succeed --
build_data.py would write shards and the patchers would silently add nothing -- leaving a
plausible-looking data/ directory missing eleven layers. A loud stop is much safer.

Exit 0 = every source present, safe to build.  Exit 1 = do not build here.
"""
import roots
import os, sys

SOURCES = {
    "gene models (BED)": [
        roots.path('scratch', 'ms2_genespace/workdir/bed/Ptrxalhap1.bed'),
        roots.path('scratch', 'ms2_genespace/workdir/bed/Ptrxalhap2.bed')],
    "synteny (step 7 diff)": [
        roots.path('scratch', 'ms2_genespace/step7_diff_20260901/diff_all_genes.tsv')],
    "synteny (raw pangenes)": [
        roots.path('scratch', 'ms2_genespace/tier3_input_v2_20260901_runA/pangenes_long_RAW.tsv.gz')],
    "phylostratigraphy (genEra)": [
        roots.path('scratch', 'genera/output/hap1/genera_717hap1_v5.1/80863_gene_ages.tsv'),
        roots.path('scratch', 'genera/output/hap2/genera_717hap2_v5.1/80863_gene_ages.tsv')],
    "expression (652-sample v3)": [
        roots.path('scratch', 'ms2_genespace/expression/COLUMN_LEVEL_sample_metadata.csv'),
        roots.path('scratch', 'ms2_genespace/expression/combined_tpm_k21_rounded_20260814_study_sorted.csv')],
    "functional annotation (Phytozome v5.1)": [
        roots.path('scratch', 'genome_resources/pangenome/input/717Official/annotation/PtremulaxPopulusalbaHAP1_717_v5.1.annotation_info.txt')],
    "allele Ka/Ks": [roots.path('scratch', 'synt_ks/syntelog_ks.csv')],
    "duplication class (ms1-dup)": [
        roots.path('ms1_dup', 'ms1-figures/data/dupclass_membership_v8.csv')],
    "tandem arrays (curated union)": [
        roots.path('ms1_dup', 'data/09_td_pairs/td_union_20260831/union_genes_final.csv')],
    "perturbation responsiveness": [
        roots.path('ms1_dup', 'data/139_perturbation_per_gene_149_20261014/perturbation_per_gene_149.csv')],
    "protein layers (ms2-lsg)": [
        roots.path('ms2_lsg', 'analyses/strict_control_audit/results/predicted_disorder_genomewide.tsv'),
        roots.path('ms2_lsg', 'analyses/esmfold_secondary_structure/results/secondary_structure_summary.tsv'),
        roots.path('ms2_lsg', 'analyses/proteomics_translation_evidence/results/tier1_pxd064017_by_gene.tsv')],
    "reference annotation (/work)": [
        roots.path('work', '717Official/annotation/PtremulaxPopulusalbaHAP1_717_v5.1.gene_exons.gff3'),
        roots.path('work', '717Official/annotation/PtremulaxPopulusalbaHAP1_717_v5.1.repeatmasked_assembly_v5.0.gff3')],
    "cross-species synteny (own GENESPACE run)": [
        roots.path('scratch', 'ms2_genespace/workdir_local_47798208/syntenicHits/Ptrichocarpa_vs_Ptrxalhap1.synHits.txt.gz')],
}

def main():
    upstream = roots.upstream_status()
    if not all(status["ok"] for status in upstream):
        print("UPSTREAM ROOT(S) NOT CURRENT. Do not build here.")
        for status in upstream:
            if not status["ok"]:
                print(f"  {status['name']}: {status['path']}")
        return 1
    missing = {}
    for label, paths in SOURCES.items():
        gone = [p for p in paths if not os.path.exists(p)]
        status = "OK  " if not gone else "MISS"
        print(f"  {status} {label}")
        if gone:
            missing[label] = gone
    if not missing:
        print("\nAll sources present — safe to run scripts/build_all.sh")
        return 0
    print(f"\n{len(missing)} SOURCE GROUP(S) MISSING. Do not build here.\n")
    for label, paths in missing.items():
        print(f"  {label}:")
        for p in paths:
            print(f"    {p}")
    print("\nThese live on the UGA Sapelo2 cluster. The data build only runs there.")
    print("The committed data/ directory IS the artifact — a clone can serve and edit the")
    print("site, run scripts/validate_data.py and scripts/check.mjs, but cannot rebuild data/.")
    return 1

if __name__ == "__main__":
    sys.exit(main())
