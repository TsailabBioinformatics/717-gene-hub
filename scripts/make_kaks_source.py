#!/usr/bin/env python3
"""Build sources/kaks_ptri.tsv.gz -- per-gene Ka/Ks against Populus trichocarpa.

WHAT IS SHIPPED AND WHAT IS NOT.

  * Shipped: the HAP1_Ptri and HAP2_Ptri arms, 52,232 genes. New to the atlas -- nothing here
    previously compared a 717 gene to another SPECIES.
  * Not shipped: the HAP1_HAP2 arm. The atlas already carries a HAP1<->HAP2 Ka/Ks on the
    allele card from an independent pipeline, and the two agree on the partner gene for
    100.0% of 50,656 shared genes. Shipping a second omega for the same pair beside the first
    would put two numbers for one quantity on one page with no way to tell which is right.
    The comparison between them is written up in docs/DATA_AUDIT_2026-09-10.md instead.

  * NG86 is shipped as THE per-gene omega; YN00 is shipped only as a spread flag. On these
    alignments the two estimators correlate at r = 0.07 to 0.36 PER GENE while their class
    medians agree to within 0.06. At a median dS near 0.04 the sequences are too close for
    YN00's maximum-likelihood estimate to be stable gene by gene. NG86 is the one with
    external support: it correlates at r = 0.94 with the atlas's existing, independently
    derived allele omega, where YN00 correlates at 0.08 with the same series.

    That is a per-gene resource's problem specifically. A class-level summary is fine under
    either estimator; a gene page is not.

GATE. This reproduces the owning analysis's published kaks_summary_by_class.tsv for every
trichocarpa cell -- n_pairs, median NG86 omega and median YN00 omega, 11 cells -- or writes
nothing. The HAP1_HAP2 cells of that table are deliberately not gated on: it counts each
pair once per partner gene, so its n is exactly twice a per-gene-keyed count.
"""
import roots
import csv, gzip, io, json, os, sys
import statistics as st
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K = roots.path('scratch', 'ms2lsg_wt_proteomics/analyses/kaks_populus/results/kaks_all_pairs.tsv.gz')
POOL = roots.path('scratch', 'ms2lsg_wt_proteomics/pipeline/out/lsg_pool_idesia.tsv.gz')
PUB = roots.path('scratch', 'kaks_populus/out/kaks_summary_by_class.tsv')
OUT = os.path.join(ROOT, "sources", "kaks_ptri.tsv.gz")
ARMS = ("HAP1_Ptri", "HAP2_Ptri")


def gene_class(rk):
    rk = int(float(rk))
    if rk <= 2:  return "PS1_2"
    if rk <= 12: return "PS3_12"
    if rk <= 15: return "PS13_15"
    if rk <= 17: return "PS16_17"
    if rk == 18: return "LSG_PS18_populus"
    return "LSG_PS19_hybrid"


def num(v):
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def main():
    cls = {}
    with gzip.open(POOL, "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if r["rank"] not in ("", "NA", "nan"):
                cls[r["gene_id"]] = gene_class(r["rank"])

    rows = []
    with gzip.open(K, "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if r["comparison"] in ARMS:
                rows.append(r)
    seen = {r["gene_a"] for r in rows}
    assert len(seen) == len(rows), "a 717 gene appears in more than one trichocarpa pair"
    print(f"{len(rows)} trichocarpa pairs over {len(seen)} genes")

    # ---- GATE against the owning analysis's published per-class table --------------------
    agg = defaultdict(lambda: {"n": 0, "ng": [], "yn": []})
    for r in rows:
        c = cls.get(r["gene_a"])
        if not c:
            continue
        a = agg[(r["comparison"], c)]
        a["n"] += 1
        for col, key in (("ng86_omega", "ng"), ("yn00_omega", "yn")):
            v = num(r[col])
            if v is not None:
                a[key].append(v)
    pub = {(p["partner_set"], p["gene_class"]): p
           for p in csv.DictReader(open(PUB), delimiter="\t")
           if p["partner_set"] in ARMS}
    bad = []
    for k, p in pub.items():
        m = agg.get(k)
        if not m:
            bad.append((k, "missing")); continue
        for col, key in (("median_omega", "ng"), ("median_yn00_omega", "yn")):
            want = num(p[col])
            got = st.median(m[key]) if m[key] else None
            if (want is None) != (got is None) or (want is not None and abs(want - got) > 5e-4):
                bad.append((k, col, want, got))
        if int(p["n_pairs"]) != m["n"]:
            bad.append((k, "n_pairs", p["n_pairs"], m["n"]))
    if bad:
        for b in bad[:10]:
            print("  GATE FAIL", b, file=sys.stderr)
        raise SystemExit(f"GATE FAILED on {len(bad)} checks against {PUB}. Nothing written.")
    print(f"GATE PASS: reproduces all {len(pub)} trichocarpa cells of kaks_summary_by_class.tsv "
          "(n_pairs, median NG86 omega, median YN00 omega)")

    cols = ["gene_id", "hap", "ptri_id", "n_codons", "pct_identity",
            "ng86_dn", "ng86_ds", "ng86_omega", "yn00_omega"]
    out = []
    for r in sorted(rows, key=lambda x: x["gene_a"]):
        out.append({
            "gene_id": r["gene_a"],
            "hap": "HAP1" if r["comparison"] == "HAP1_Ptri" else "HAP2",
            "ptri_id": r["gene_b"],
            "n_codons": r["n_codons"],
            "pct_identity": r["pct_identity"],
            "ng86_dn": r["ng86_dn"], "ng86_ds": r["ng86_ds"], "ng86_omega": r["ng86_omega"],
            "yn00_omega": r["yn00_omega"],
        })
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, delimiter="\t", lineterminator="\n")
    w.writeheader(); w.writerows(out)
    with open(OUT, "wb") as fh:
        with gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:
            gz.write(buf.getvalue().encode())
    print(f"wrote {OUT}: {len(out)} rows")
    for c in ("PS1_2", "PS3_12", "PS13_15", "PS16_17", "LSG_PS18_populus", "LSG_PS19_hybrid"):
        v = [num(r["ng86_omega"]) for r in rows if cls.get(r["gene_a"]) == c]
        v = [x for x in v if x is not None]
        print(f"  {c:18s} n={len(v):6d} median NG86 omega "
              f"{st.median(v):.4f}" if v else f"  {c:18s} n=0")


if __name__ == "__main__":
    main()
