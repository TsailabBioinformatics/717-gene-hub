#!/usr/bin/env python3
"""Regenerate the committed sources that tie the atlas to the dissertation's tables.

Three sources, written together because they must describe ONE state of the upstream tables:

  sources/wgd_pairs.tsv.gz        `event` relabelled from the frozen WGD pair call
                                  (ms1-dup data/79_*/tables/wgd_pair_classes_FROZEN_1p05.csv,
                                  column cls_final_loose). dS, block and r are left as they were.
  sources/dissertation_layer.tsv.gz
                                  per gene: tissue specificity as in the dissertation (tau and
                                  peak tissue from the per-gene master table; mean TPM per tissue
                                  group over the 222-sample reference panel, recomputed here and
                                  required to reproduce the master's tau), the master table's
                                  Arabidopsis best hit, gene names from the lab annotation, and
                                  the final lineage-specific gene (LSG) set with the reason each
                                  excluded candidate left it.
  sources/dissertation_layer.provenance.json

Not a build stage (see check_stages.py): run by hand when the upstream tables change, commit the
sources, then run patch_wgd_pairs.py, patch_dissertation_layer.py, build_families.py and
build_facets.py.

Inputs are found through environment variables so no machine path is needed in the call:
  MS1_DUP   a checkout of the analysis repository          (default ~/dev/ms1-dup)
  MS1_EXPR  folder holding the TPM matrix                   (default: the OneDrive MS1_2026 tree)
  CH3_TABLE Table_3.S1_S3_per_gene.tsv of the final LSG set
"""
import csv, gzip, hashlib, io, json, os, re, subprocess, sys, time

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MS1_DUP = os.environ.get("MS1_DUP", os.path.expanduser("~/dev/ms1-dup"))
ONEDRIVE = os.path.expanduser("~/Library/CloudStorage/OneDrive-UniversityofGeorgia/01_work")
MS1_EXPR = os.environ.get("MS1_EXPR", os.path.join(
    ONEDRIVE, "MS1_2026/data/04_gene_atlas/expression_2026_0813_rerun"))
CH3_TABLE = os.environ.get("CH3_TABLE", os.path.join(
    ONEDRIVE, "fin/dissertation_work/ch3_strict567_20261005/tables/Table_3.S1_S3_per_gene.tsv"))

MASTER = os.path.join(MS1_DUP, "data/131_master_v12_20261002/tables/master_per_gene_v12.csv")
FROZEN = os.path.join(MS1_DUP, "data/79_nn_to_11_and_wgd_freeze_20260919/tables/wgd_pair_classes_FROZEN_1p05.csv")
PANEL = os.path.join(MS1_DUP, "data/50_v4_panel_20260814/v4_panel_20260814.csv")
TPM = os.path.join(MS1_EXPR, "combined_tpm_k21_rounded_20260814.csv")

TISSUES = ["leaf_young", "leaf", "leaf_old", "xylem", "bark", "root", "stem", "bud", "catkin"]
# The order of Table 3.1: an excluded candidate is reported under the FIRST criterion it meets.
LSG_REASON = [("f_ms1_qc", "gene_model_quality"), ("f_spurious_long", "gene_model_quality"),
              ("f_absense", "homology_detection_failure"),
              ("f_outgroup_window_tblastn", "homolog_in_outgroup_syntenic_window"),
              ("f_split_gene_model", "split_gene_model")]
# Dissertation totals the relabelled pair table must reproduce (Figure 2.S2).
PAIR_TOTALS = {("HAP1", "S"): 7081, ("HAP2", "S"): 7105, ("HAP1", "A"): 4445, ("HAP2", "A"): 4523}
LSG_TOTALS = {("HAP1", 18): 380, ("HAP1", 19): 203, ("HAP2", 18): 418, ("HAP2", 19): 203}


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def write_gz(path, text):
    # fixed mtime so the same inputs give the same bytes
    with open(path, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz:
        gz.write(text.encode())


def relabel_pairs():
    p = os.path.join(ROOT, "sources", "wgd_pairs.tsv.gz")
    cur = pd.read_csv(p, sep="\t", dtype=str, keep_default_na=False)
    fz = pd.read_csv(FROZEN, dtype=str)
    key = lambda a, b: a + "|" + b if a < b else b + "|" + a
    call = {key(a, b): c for a, b, c in zip(fz.gene1, fz.gene2, fz.cls_final_loose)}
    assert len(call) == len(fz) == len(cur), (len(call), len(fz), len(cur))
    assert set(call.values()) == {"sWGD", "aWGD"}
    ks = [key(a, b) for a, b in zip(cur.gene_a, cur.gene_b)]
    assert set(ks) == set(call), "the anchor pairs and the frozen call are not the same pair set"
    new = ["S" if call[k] == "sWGD" else "A" for k in ks]
    changed = int(sum(o != n for o, n in zip(cur.event, new)))
    cur["event"] = new
    got = {k: int(v) for k, v in cur.groupby(["hap", "event"]).size().items()}
    assert got == PAIR_TOTALS, f"pair totals {got} are not the dissertation's {PAIR_TOTALS}"
    buf = io.StringIO()
    cur.to_csv(buf, sep="\t", index=False, lineterminator="\n")
    write_gz(p, buf.getvalue())
    print(f"wgd_pairs: {len(cur):,} pairs, {changed} relabelled; totals {got}")
    return {"pairs": len(cur), "event_from": "cls_final_loose of the frozen call",
            "totals": {f"{h}|{e}": n for (h, e), n in got.items()}}


def symbols(v):
    """Gene names from the lab annotation's genes-of-interest column (format examples: 'NAME1', 'NAME1, NAME2'; real names are held, never written here).
    The family prefix letter is dropped; every name and family code is kept as a search alias."""
    if not isinstance(v, str):
        return []
    out = []
    for part in v.split(","):
        part = part.strip()
        if ":" in part:
            part = part.split(":", 1)[1]
        for s in re.split(r"[/;]", part):
            s = s.strip()
            if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.\-]{1,19}", s) and s not in out:
                out.append(s)
    return out


def main():
    for p in (MASTER, FROZEN, PANEL, TPM, CH3_TABLE):
        if not os.path.exists(p):
            sys.exit(f"missing input: {p}")
    pairs = relabel_pairs()

    m = pd.read_csv(MASTER, low_memory=False).set_index("gene_id")
    assert len(m) == 63960 and m.index.is_unique

    # ---- tissue means over the reference panel, and proof they are the master's tau ----------
    panel = pd.read_csv(PANEL)
    kept = panel[panel.kept == True]                                   # noqa: E712
    assert len(kept) == 222 and sorted(kept.tissue_analysis.unique()) == sorted(TISSUES)
    x = pd.read_csv(TPM, index_col=0)
    x.index = x.index.str.replace(r"\.\d+$", "", regex=True)
    assert set(x.index) == set(m.index)
    tm = pd.DataFrame({t: x[g.sample_label.tolist()].mean(axis=1)
                       for t, g in kept.groupby("tissue_analysis")})[TISSUES].loc[m.index]
    mx = tm.max(axis=1)
    tau = (1 - tm.div(mx, axis=0)).sum(axis=1) / (len(TISSUES) - 1)
    has = m.tau_raw.notna()
    d = float((m.tau_raw[has] - tau[has]).abs().max())
    assert d < 1e-6, f"recomputed tau differs from the master by up to {d}"
    # ties (a handful of genes) go to the alphabetically first group, as in the master table
    assert (tm[sorted(TISSUES)].idxmax(axis=1)[has] == m.peak_tissue[has]).all(), \
        "peak tissue differs from the master"
    assert mx[~has].max() < 5 <= mx[has].min(), "tau is defined exactly where a tissue mean reaches 5 TPM"
    n_spec = {h: int(((g.tau_raw >= 0.85) & g.tau_passes_filter & ~g.qc_questionable).sum())
              for h, g in m.groupby("hap")}
    print(f"tau reproduces the master (max difference {d:.1e}); tissue-specific genes {n_spec}")

    # ---- final LSG set ------------------------------------------------------------------------
    t = pd.read_csv(CH3_TABLE, sep="\t").set_index("gene_id")
    assert t.index.is_unique and set(t.index) <= set(m.index)
    got = {k: int(v) for k, v in t[t.strict].groupby(["hap", "phylostratum_used"]).size().items()}
    assert got == LSG_TOTALS, f"final LSG set {got} is not the dissertation's {LSG_TOTALS}"
    excl = ~t[[f for f, _ in LSG_REASON]].any(axis=1)
    assert (excl == t.strict).all(), "the strict flag is not 'none of the four exclusion criteria'"

    def reason(r):
        for f, name in LSG_REASON:
            if r[f]:
                return name
        return ""

    cols = (["gene_id", "tau", "tau_passes_filter", "peak_tissue", "mean_tpm_222"]
            + [f"mean_{k}" for k in TISSUES]
            + ["at_locus", "at_desc", "names", "lsg_candidate", "lsg_final", "ps_genera", "ps_used",
               "lsg_excluded_reason"])
    buf = io.StringIO()
    w = csv.writer(buf, delimiter="\t", lineterminator="\n")
    w.writerow(cols)
    n_at = n_sym = 0
    for gid in sorted(m.index):
        r = m.loc[gid]
        at = atd = ""
        if isinstance(r.arabidopsis_hit, str):
            mm = re.match(r"^(AT[1-5CM]G\d{5})(?:\.\d+)?\s*(?:-\s*(.*))?$", r.arabidopsis_hit.strip())
            if mm:
                at, atd = mm.group(1), (mm.group(2) or "").strip().replace("\t", " ")
                n_at += 1
        sy = symbols(r.genes_of_interest)
        n_sym += bool(sy)
        row = [gid,
               "" if pd.isna(r.tau_raw) else f"{r.tau_raw:.8f}",
               "1" if r.tau_passes_filter else "0",
               r.peak_tissue if isinstance(r.peak_tissue, str) else "",
               "" if pd.isna(r.mean_tpm_222) else f"{r.mean_tpm_222:.2f}"]
        row += [f"{v:.2f}" for v in tm.loc[gid]]
        row += [at, atd, ";".join(sy)]
        if gid in t.index:
            q = t.loc[gid]
            row += ["1", "1" if q.strict else "0", int(q.genera_rank), int(q.phylostratum_used),
                    "" if q.strict else reason(q)]
        else:
            row += ["0", "0", "", "", ""]
        w.writerow(row)
    out = os.path.join(ROOT, "sources", "dissertation_layer.tsv.gz")
    write_gz(out, buf.getvalue())

    head = subprocess.run(["git", "-C", MS1_DUP, "rev-parse", "--short", "HEAD"],
                          capture_output=True, text=True).stdout.strip()
    prov = {
        "generated": time.strftime("%Y-%m-%d"),
        "by": "scripts/make_dissertation_layer_source.py",
        "analysis_repository_commit": head,
        "inputs": {
            "master_per_gene_v12.csv": sha(MASTER),
            "wgd_pair_classes_FROZEN_1p05.csv": sha(FROZEN),
            "v4_panel_20260814.csv": sha(PANEL),
            "combined_tpm_k21_rounded_20260814.csv": sha(TPM),
            "Table_3.S1_S3_per_gene.tsv": sha(CH3_TABLE),
        },
        "wgd_pairs": pairs,
        "tau": {"definition": "tau over mean TPM of 9 tissue groups, 222-sample reference panel; "
                              "defined where at least one tissue mean reaches 5 TPM; a gene is "
                              "counted tissue-specific at tau >= 0.85 with mean TPM >= 5",
                "panel_n": {k: int(v) for k, v in kept.tissue_analysis.value_counts().items()},
                "max_abs_difference_from_master": d,
                "genes_with_tau": int(has.sum()),
                "tissue_specific_quality_filtered": n_spec},
        "arabidopsis_hit_genes": n_at,
        "genes_with_a_name": n_sym,
        "lsg": {"candidates": {h: int(v) for h, v in t.groupby("hap").size().items()},
                "final": {f"{h}|PS{p}": n for (h, p), n in got.items()},
                "reassigned_PS19_to_PS18": {h: int(v) for h, v in
                                            t[t.reassigned_PS19_to_PS18].groupby("hap").size().items()},
                "excluded_by_first_criterion": {k: int(v) for k, v in
                                                t[~t.strict].apply(reason, axis=1).value_counts().items()}},
    }
    with open(os.path.join(ROOT, "sources", "dissertation_layer.provenance.json"), "w") as fh:
        json.dump(prov, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(json.dumps(prov["lsg"], indent=1))
    print(f"wrote {out}: Arabidopsis hit for {n_at:,} genes, a name for {n_sym:,}")


if __name__ == "__main__":
    main()
