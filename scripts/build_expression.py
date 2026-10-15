#!/usr/bin/env python3
"""
Build the expression module's data: samples.json, studies.json, per-bucket TPM shards,
and the tissue-baseline summary written into each gene's shard.

Source: <scratch>/ms2_genespace/expression/ -- the 652-sample v3 rerun. Validated
separately (see docs/EXPRESSION_DESIGN.md) against the atlas gene set before this was written:
TPM matrix gene IDs == the BED gene set exactly, sample columns == metadata sample_label set
exactly, no ragged rows.

Two-level data, per the design doc:
  - a tissue-baseline SUMMARY (median TPM over WT controls per tissue, n, tau) is folded into
    the existing gene shard at data/genes/{hap}/{chr}.json under key "x"
  - the full 652-sample vector lives in a SEPARATE bucket (250 genes/bucket, gene order fixed
    by first appearance in the BED, i.e. genomic order) that a gene page fetches on demand

TISSUE GROUPING (fixed 2026-09-05, see docs/DATA_AUDIT.md): the baseline and tau MUST group
on `tissue_analysis`, not the coarser `tissue`. The source metadata's own `tissue` column
pools leaf_young + leaf_old (46 samples, all study 1) into one "leaf" bucket -- silently: no
error, a plausible-looking mean, wrong biology (one real case moved the baseline from 8.12 to
two values 3x apart, 13.74 vs 4.52). `tissue_analysis` is not in the source metadata; it is
joined from `sources/sample_tissue_analysis.tsv`, committed in this repo and derived from
MS1_2026's own curated v4 sample panel (see that file's sidecar for provenance). The join
covers all 652 samples exactly; anything short of that is a hard stop, not a silent partial
join -- see the assert immediately after `read_samples()` below.
"""
import roots
import argparse, csv, gzip, hashlib, json, math, os, shutil, sys, time
from collections import defaultdict

EXPR = roots.path('scratch', 'ms2_genespace/expression')
ATLAS = roots.root('atlas')
BUCKET_SIZE = 250

SRC = {}
def note(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    SRC[path] = {"sha256": h.hexdigest()[:16], "bytes": os.path.getsize(path),
                 "mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(os.path.getmtime(path)))}
    return path

# Non-callus tissues for tau, per README: "include in any full data delivery, do NOT include
# in the manuscript panel." Tau is a manuscript-facing statistic.
TAU_TISSUES_EXCLUDE = {"callus"}

def read_tissue_analysis():
    """sample_label -> tissue_analysis, from the frozen join file (see docstring above)."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "sources", "sample_tissue_analysis.tsv")
    out = {}
    with open(path) as fh:
        next(fh)
        for line in fh:
            label, ta = line.rstrip("\n").split("\t")
            out[label] = ta
    return out

def tau(values):
    """Yanai's tau. 0 = uniformly expressed, 1 = perfectly tissue-specific. Undefined (None)
    if every value is <=0."""
    mx = max(values)
    if mx <= 0:
        return None
    n = len(values)
    if n <= 1:
        return None
    return sum(1 - (v / mx) for v in values) / (n - 1)

def read_reference_panel():
    """sample_label -> True for the 222-sample reference panel (ms1-dup v4 panel, `kept`), the control panel
    behind the dissertation's tau. Canonical per ms1-dup CLAUDE.md CANONICAL DATA."""
    path = roots.path('ms1_dup', 'data/50_v4_panel_20260814/v4_panel_20260814.csv')
    with open(path) as fh:
        rows = list(csv.DictReader(fh))
    kept = {r["sample_label"]: r["tissue_analysis"] for r in rows if r["kept"] == "True"}
    assert len(kept) == 222, f"reference panel has {len(kept)} samples, expected 222"
    return kept


def read_samples():
    with open(note(f"{EXPR}/COLUMN_LEVEL_sample_metadata.csv")) as fh:
        rows = list(csv.DictReader(fh))
    return rows

def read_runlevel():
    with open(note(f"{EXPR}/RUN_LEVEL_supplementary.csv")) as fh:
        return list(csv.DictReader(fh))

def build_studies(samples, runlevel):
    by_study = defaultdict(list)
    for r in samples:
        by_study[int(r["study"])].append(r)
    runs_by_col = defaultdict(list)
    for r in runlevel:
        runs_by_col[r["matrix_column"]].append(r["Run"])

    studies = {}
    for s, rs in sorted(by_study.items()):
        bps = sorted(set(r["bioproject"] for r in rs))
        tissues = sorted(set(r["tissue_analysis"] for r in rs))
        panel = sorted(set(r["panel_type"].strip() for r in rs if r["panel_type"].strip()))
        genotypes = sorted(set(r["genotype"] for r in rs if r["genotype"]))
        treatments = sorted(set(r["treatment"] for r in rs if r["treatment"]))
        growth = sorted(set(r["growth_condition"].strip() for r in rs if r["growth_condition"].strip()))
        additional = sorted(set(r["additional_condition"] for r in rs if r["additional_condition"]))
        dois = sorted(set(r["publication_doi"] for r in rs if r["publication_doi"].strip()))
        citation = next((r["citation"] for r in rs if r["citation"].strip()), None)
        flags = []
        if s == 29:
            flags.append("prefer_counts_over_tpm")  # short-transcript effective-length inflation, see README
        if any("requantified" in r["processing_notes"] for r in rs):
            flags.append("has_requantified_samples")
        studies[s] = {
            "id": s, "n": len(rs), "bioprojects": bps, "tissues": tissues,
            "panel_type": panel, "genotypes": genotypes, "treatments": treatments,
            "growth_conditions": growth, "additional_conditions": additional,
            "doi": dois, "citation": citation, "flags": flags,
            "samples": sorted(r["sample_label"] for r in rs),
        }
    return studies

def shard_paths(root):
    """Every gene-shard JSON under a haplotype directory, at any nesting depth."""
    out = []
    for dp, _, fs in os.walk(root):
        out += [os.path.join(dp, f) for f in fs if f.endswith(".json")]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=f"{ATLAS}/data")
    a = ap.parse_args()

    samples = read_samples()
    runlevel = read_runlevel()
    print(f"samples: {len(samples)}  runs: {len(runlevel)}")

    tissue_analysis_by_label = read_tissue_analysis()
    unmapped = [r["sample_label"] for r in samples if r["sample_label"] not in tissue_analysis_by_label]
    assert not unmapped, (
        f"{len(unmapped)} samples have no tissue_analysis mapping, e.g. {unmapped[:5]} -- "
        f"regenerate sources/sample_tissue_analysis.tsv from the current MS1_2026 v4 panel.")
    for r in samples:
        r["tissue_analysis"] = tissue_analysis_by_label[r["sample_label"]]
    ref = read_reference_panel()
    labels = {r["sample_label"] for r in samples}
    assert set(ref) <= labels, f"{len(set(ref) - labels)} reference-panel samples are not in the matrix"
    bad = [l for l, t in ref.items() if tissue_analysis_by_label[l] != t]
    assert not bad, f"{len(bad)} reference-panel samples disagree on tissue group, e.g. {bad[:3]}"

    # Order is the TPM matrix column order (== metadata order per validated README claim, but
    # assert it rather than trust it -- this order becomes the fixed vector index).
    order = [r["sample_label"] for r in samples]
    assert len(set(order)) == len(order), "duplicate sample_label in metadata"

    studies = build_studies(samples, runlevel)
    os.makedirs(os.path.join(a.out, "expr"), exist_ok=True)
    with open(os.path.join(a.out, "expr", "studies.json"), "w") as fh:
        json.dump(studies, fh, separators=(",", ":"), sort_keys=True)
    print(f"studies: {len(studies)}")

    samples_out = [{
        "i": i, "label": r["sample_label"], "study": int(r["study"]), "bioproject": r["bioproject"],
        "tissue": r["tissue"], "tissue_full": r["tissue_comprehensive"],
        "tissue_analysis": r["tissue_analysis"],
        "treatment": r["treatment"] or None, "growth": r["growth_condition"].strip() or None,
        "additional": r["additional_condition"] or None, "genotype": r["genotype"] or None,
        "ctrl": r["control/perturbation"] or None, "layout": r["library_layout"],
        "reads": int(r["total_read_count"]) if r["total_read_count"] else None,
        "pct_aligned": float(r["pct_pseudoaligned"]) if r["pct_pseudoaligned"] else None,
        "field": bool(r["field?"].strip()), "notes": r["processing_notes"] or None,
        "ref222": r["sample_label"] in ref,
    } for i, r in enumerate(samples)]
    assert sum(x["ref222"] for x in samples_out) == 222
    with open(os.path.join(a.out, "expr", "samples.json"), "w") as fh:
        json.dump(samples_out, fh, separators=(",", ":"))
    print(f"wrote samples.json ({len(samples_out)} rows, this IS the vector index order)")

    # -- read the TPM matrix, reordering columns to `order` --------------------------------
    tpm_path = note(f"{EXPR}/combined_tpm_k21_rounded_20260814_study_sorted.csv")
    with open(tpm_path) as fh:
        r = csv.reader(fh)
        hdr = next(r)
        col_of = {name: i for i, name in enumerate(hdr[1:])}
        missing = set(order) - set(col_of)
        assert not missing, f"{len(missing)} sample_labels missing from TPM header"
        idx = [col_of[s] for s in order]

        # tissue -> list of column indices, restricted to WT controls (the baseline definition)
        wt_ctrl_idx = defaultdict(list)
        for i, s in enumerate(samples_out):
            if s["genotype"] == "WT" and s["ctrl"] == "control":
                wt_ctrl_idx[s["tissue_analysis"]].append(i)
        print("WT-control samples per tissue:", {t: len(v) for t, v in sorted(wt_ctrl_idx.items())})

        gene_order = []  # genomic order, from the BED files -- fixes bucket assignment
        for hap, fname in (("hap1", "Ptrxalhap1"), ("hap2", "Ptrxalhap2")):
            with open(f"{roots.path('scratch', 'ms2_genespace/workdir/bed')}/{fname}.bed") as bf:
                for line in bf:
                    gene_order.append(line.rstrip("\n").split("\t")[3])
        gene_pos = {g: i for i, g in enumerate(gene_order)}

        buckets = {}   # bucket_key -> {gene_id: [tpm...]}
        summary = {}   # gene_id -> {t: {...}, n: {...}, tau, top, max, bucket}
        seen = set()
        n_rows = 0
        for row in r:
            gid = row[0]
            if gid not in gene_pos:
                continue  # defensive; README says gene sets match exactly
            seen.add(gid)
            vals = [float(row[1 + j]) for j in idx]
            pos = gene_pos[gid]
            hap = "hap1" if pos < 32137 else "hap2"  # BED read hap1 fully before hap2
            bnum = pos if hap == "hap1" else pos - 32137
            bkey = f"{hap}/{bnum // BUCKET_SIZE}"
            buckets.setdefault(bkey, {})[gid] = [round(v, 2) for v in vals]

            tmed = {}
            tn = {}
            for t, idxs in wt_ctrl_idx.items():
                tv = sorted(vals[k] for k in idxs)
                tmed[t] = round(tv[len(tv) // 2], 2)
                tn[t] = len(idxs)
            tau_vals = [tmed[t] for t in tmed if t not in TAU_TISSUES_EXCLUDE]
            tv = tau(tau_vals) if tau_vals else None
            top = max(tmed, key=tmed.get) if tmed else None
            summary[gid] = {
                "b": bkey, "t": tmed, "n": tn,
                "tau": round(tv, 3) if tv is not None else None,
                "top": top, "max": max(vals),
            }
            n_rows += 1
            if n_rows % 10000 == 0:
                print(f"  {n_rows} genes processed")

    missing_genes = set(gene_pos) - seen
    assert not missing_genes, f"{len(missing_genes)} BED genes missing from TPM matrix"
    print(f"TPM rows processed: {n_rows}  buckets: {len(buckets)}")

    outdir = os.path.join(a.out, "expr", "buckets")
    if os.path.isdir(outdir):
        shutil.rmtree(outdir)
    os.makedirs(outdir)
    for bkey, genes in buckets.items():
        hap, bnum = bkey.split("/")
        d = os.path.join(outdir, hap)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{bnum}.json"), "w") as fh:
            json.dump(genes, fh, separators=(",", ":"))

    # -- fold the summary into the existing gene shards -------------------------------------
    genes_dir = os.path.join(a.out, "genes")
    patched = 0
    for hap in ("hap1", "hap2"):
        # Shards are nested one level deeper since the bucketed split; walk, don't listdir.
        for p in sorted(shard_paths(os.path.join(genes_dir, hap))):
            with open(p) as fh:
                shard = json.load(fh)
            changed = False
            for gid, rec in shard.items():
                if gid in summary:
                    rec["x"] = summary[gid]
                    changed = True
                    patched += 1
            if changed:
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    print(f"patched {patched} gene records with expression summary")

    man_path = os.path.join(a.out, "meta", "manifest.json")
    with open(man_path) as fh:
        man = json.load(fh)
    man.setdefault("modules", [])
    if "expression" not in man["modules"]:
        man["modules"].append("expression")
    man["expression"] = {
        "n_samples": len(samples_out), "n_studies": len(studies),
        "n_bioprojects": len(set(r["bioproject"] for r in samples)),
        "bucket_size": BUCKET_SIZE, "n_buckets": len(buckets),
        "tau_excludes": sorted(TAU_TISSUES_EXCLUDE),
        "tissue_wt_control_n": {t: len(v) for t, v in sorted(wt_ctrl_idx.items())},
    }
    man["sources"].update(SRC)
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)

    bsize = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(outdir) for f in fs)
    print(f"buckets: {len(buckets)} files, {bsize/1e6:.1f} MB raw -> {outdir}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
