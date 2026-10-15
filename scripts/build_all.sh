#!/usr/bin/env bash
# The data build, in the ONE order that produces a complete data/ directory.
#
# TWO THINGS MAKE THIS SCRIPT NECESSARY, and both have already caused real damage:
#
#   1. build_data.py WIPES and rewrites data/genes/; every later stage PATCHES those shards.
#      Run out of order, or run alone, and you get a plausible-looking data/ that is silently
#      missing layers.
#
#   2. NO SINGLE MACHINE CAN RUN EVERY STAGE. The core stages read Sapelo2-local sources
#      (/scratch, /work). Four later stages read the OneDrive MS1_2026 tree, which is on
#      Chen's Mac and is NOT mounted on Sapelo2. So a complete build is a two-machine
#      sequence, and this script refuses to start a build it cannot finish -- BEFORE
#      build_data.py destroys the layers this machine would be unable to restore.
#
# Usage:
#   scripts/build_all.sh                  full build; aborts unless every stage can run here
#   scripts/build_all.sh --allow-partial  run only the stages available here (see warning)
#
# Two-machine sequence, when no one machine has both source trees:
#   Sapelo2 : scripts/build_all.sh --allow-partial   then commit and push
#   The Mac : git pull && scripts/build_all.sh --allow-partial   then commit and push
# The second machine's run re-applies its own stages and finishes with the facet index.
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW_PARTIAL=0
[ "${1:-}" = "--allow-partial" ] && ALLOW_PARTIAL=1

# This is read-only and runs before build_data.py can erase the previous shard layers.
echo "== build graph =="
python3 scripts/check_stages.py
python3 scripts/roots.py

# --- what each stage needs -------------------------------------------------------------
# env|command|dependencies|description.  A dependency names the script that must precede
# this one in a complete build; check_stages.py rejects a reorder before build_data.py can
# wipe data/genes.  build_facets.py must stay last.
STAGES=(
  "sapelo2|build_data.py --tier public|-|public-tier gene shards (WIPES data/genes)"
  "sapelo2|build_expression.py|build_data.py|expression"
  "sapelo2|build_annotation.py|build_data.py|annotation + search index"
  "sapelo2|build_phylostrat.py|build_data.py|phylostratigraphy context"
  "sapelo2|build_duplication.py|build_data.py|duplication (paralog dS)"
  "sapelo2|build_layers.py|build_data.py|external genome-wide layers"
  "sapelo2|build_crossspecies.py|build_data.py|cross-species orthologs"
  "sapelo2|patch_gene_model.py|build_data.py|RNA-seq intron and split-model evidence"
  "sapelo2|patch_structure.py|build_layers.py|ESMFold C-alpha structure buckets"

  "repo|patch_syntelog_categories.py|build_duplication.py|duplication classes, allele partners, strict PAV, relationship categories"
  "repo|patch_wgd_pairs.py|build_data.py|WGD anchor partners and pair correlations"
  "repo|patch_duplicate_partners.py|build_layers.py|array members + duplicate co-expression"
  "repo|patch_td_pair_ks.py|patch_duplicate_partners.py|per-pair tandem dS"
  "repo|patch_wgd_combined_call.py|patch_syntelog_categories.py|route C combined Ks + topology WGD call"
  "repo|patch_lsg_pool.py|build_phylostrat.py|LSG pool (genEra rerun with Idesia) with the frozen call beside it"
  "repo|patch_lsg_qc.py|patch_lsg_pool.py|LSG evidence flags"
  "repo|patch_founder_rerun.py|build_phylostrat.py,patch_lsg_pool.py|founder families from the pool's genEra run"
  "repo|patch_proteomics_v2.py|build_layers.py,patch_lsg_pool.py|proteomics re-search"
  "repo|patch_peptide_detail.py|patch_proteomics_v2.py|per-gene peptide provenance"
  "repo|patch_kaks.py|build_data.py|Ka/Ks vs P. trichocarpa"
  "repo|build_cre.py|build_data.py|promoter/CRE layer"
  "repo|patch_promoter_pos.py|build_cre.py|promoter motif positions"
  "repo|patch_chromatin.py|build_crossspecies.py|GSE128434 chromatin at the P. trichocarpa ortholog"
  "repo|patch_chromatin_profiles.py|patch_chromatin.py|TSS chromatin signal profiles"
  "repo|patch_karyotype.py|build_data.py|ancestral eudicot karyotype, route C"
  "repo|patch_copies.py|build_data.py|copies of an array on both haplotypes"

  "repo|patch_dissertation_layer.py|patch_wgd_pairs.py,patch_syntelog_categories.py,patch_lsg_qc.py,build_expression.py,build_annotation.py,patch_kaks.py|dissertation's tissue specificity, final LSG set, Arabidopsis hit, names; class summaries"
  "repo|patch_gene_age_crosscheck.py|patch_lsg_qc.py,patch_dissertation_layer.py|gene-age cross-checks on every candidate (never part of the call)"
  "repo|patch_dup_crosscheck.py|patch_syntelog_categories.py,patch_dissertation_layer.py|tandem cross-checks against published callers (never part of the call)"

  "onedrive|build_combat.py|build_expression.py|ComBat-seq view"
  "onedrive|build_expr_ranges.py|build_expression.py,build_combat.py|range-addressable expression blobs"
  "onedrive|build_contrasts.py|build_expression.py|contrast index"
  "onedrive|build_locus.py|build_data.py,patch_dissertation_layer.py|locus tiles + genome map"
  "repo|patch_map_overlays.py|build_locus.py,patch_lsg_pool.py,patch_proteomics_v2.py,patch_kaks.py,patch_chromatin.py|genome-map overlays from current shards"
  "repo|build_families.py|build_annotation.py,build_duplication.py,patch_wgd_pairs.py,patch_duplicate_partners.py|descent-family index"
  "any|build_facets.py|build_families.py|facet index (MUST be last)"
)

# DELIBERATELY NOT STAGES: every make_*_source.py script regenerates a committed source
# artifact from an upstream analysis. Run it by hand when that analysis changes, commit the
# source, then run its matching stage above. The complete inventory lives in
# scripts/check_stages.py and is checked before every build:
#   make_chromatin_source.py, make_copy_search_source.py, make_dissertation_layer_source.py,
#   make_duplicate_coexpr_source.py, make_gene_model_source.py, make_kaks_source.py,
#   make_founder_source.py, make_karyotype_source.py, make_peptide_detail_source.py,
#   make_pool_frozen_source.py,
#   make_proteomics_v2_source.py, make_structure_source.py, make_td_pair_ks_source.py,
#   make_wgd_combined_call_source.py, make_wgd_pairs_source.py.
#
# DELIBERATELY NOT A STAGE: patch_leaf_tissue_analysis.py. It is a one-time correction to
# already-shipped data; build_expression.py is fixed at source, so a real rebuild already
# produces the corrected baseline. check_stages.py makes this exception explicit and refuses
# every other unowned patcher.

# --- can this machine run each class? --------------------------------------------------
have_sapelo2=0
if python3 scripts/preflight.py >/tmp/preflight.$$ 2>&1; then have_sapelo2=1; fi

# Ask the scripts themselves where the OneDrive tree is, so this probe cannot drift from them.
MS1_ROOT="$(python3 scripts/roots.py --get onedrive_ms1)"
have_onedrive=0
[ -n "$MS1_ROOT" ] && [ -d "$MS1_ROOT" ] && have_onedrive=1

avail() {
  case "$1" in
    sapelo2)  [ "$have_sapelo2"  = 1 ] ;;
    onedrive) [ "$have_onedrive" = 1 ] ;;
    *)        true ;;
  esac
}

echo "== source availability =="
echo "  Sapelo2 sources (/scratch, /work) : $([ $have_sapelo2  = 1 ] && echo present || echo ABSENT)"
echo "  OneDrive MS1_2026 tree            : $([ $have_onedrive = 1 ] && echo present || echo ABSENT)"
[ "$have_sapelo2" = 0 ] && { echo; echo "  preflight said:"; sed 's/^/    /' /tmp/preflight.$$; }
rm -f /tmp/preflight.$$

missing=()
for s in "${STAGES[@]}"; do
  IFS='|' read -r env script requires desc <<< "$s"
  avail "$env" || missing+=("$script  ($env)")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo
  echo "  ${#missing[@]} stage(s) cannot run on this machine:"
  printf '    %s\n' "${missing[@]}"
  if [ "$ALLOW_PARTIAL" = 0 ]; then
    echo
    echo "REFUSING TO BUILD. build_data.py would wipe data/genes and this machine could not"
    echo "restore the layers listed above -- you would be left with a data/ that fails"
    echo "validation and cannot be repaired here."
    echo
    echo "  To do your half of a two-machine build:  scripts/build_all.sh --allow-partial"
    echo "  To recover a wiped tree at any time:     git checkout -- data/"
    exit 1
  fi
  echo
  echo "  --allow-partial given: running this machine's stages only."
  echo "  data/ WILL BE INCOMPLETE and validation WILL FAIL until the other machine runs."
fi

# --- run -------------------------------------------------------------------------------
n=0; total=${#STAGES[@]}
for s in "${STAGES[@]}"; do
  IFS='|' read -r env script requires desc <<< "$s"
  n=$((n + 1))
  if ! avail "$env"; then
    echo; echo "== $n/$total SKIPPED ($env unavailable): $desc =="
    continue
  fi
  echo; echo "== $n/$total $desc =="
  # shellcheck disable=SC2086
  python3 scripts/$script
done

echo; echo "== required data layers =="
if [ ${#missing[@]} -gt 0 ]; then
  # A Sapelo2 half-build is expected to fail until the OneDrive stages run. A Mac
  # finishing the second half should pass here, so print the result either way.
  if python3 scripts/check_required_layers.py; then
    echo "  current checkout already has every required layer."
  else
    echo "  current checkout is incomplete; run the missing-machine stages, then rerun this gate."
  fi
else
  python3 scripts/check_required_layers.py
fi

echo; echo "== validate =="
if [ ${#missing[@]} -gt 0 ]; then
  echo "  (skipped: partial build, failures here would be expected and uninformative)"
else
  python3 scripts/validate_data.py
fi

echo; echo "== shard-derivable aggregates =="; python3 scripts/check_aggregates.py

echo; echo "== numbers stated in prose =="; python3 scripts/check_prose_numbers.py

echo; echo "== version consistency =="; python3 scripts/check_version.py

# The two checks here that look OUTWARD. Every other one compares the atlas against itself,
# which is why the withdrawn LSG pool shipped for four days with all of them green.
#
# ms2-lsg owns the LSG pool (both calls), the QC flags and the peptide evidence; this compares
# every gene against its tables, pinned by commit and blob ID in sources/ms2_canon.pin.json.
# It runs BEFORE check_facts.py on purpose: under `set -e` a stage after an expected failure
# never runs, and check_facts.py currently fails by design on the PAV quotable figure.
echo; echo "== agreement with ms2-lsg's canonical tables =="; python3 scripts/check_ms2_canon.py

echo; echo "== agreement with ms1-dup's numbers of record =="; python3 scripts/check_facts.py

echo
if [ ${#missing[@]} -gt 0 ]; then
  echo "PARTIAL build complete. Commit and push, then run the same command on the machine"
  echo "that has the missing sources. The required-layer gate above confirms when the"
  echo "checkout is complete; it must pass before publishing."
else
  echo "Build complete. Now run the render checks:"
  echo "  python3 scripts/serve_ranges.py 8931 . &     # NOT http.server: it ignores Range"
  echo "  node scripts/check.mjs"
fi
