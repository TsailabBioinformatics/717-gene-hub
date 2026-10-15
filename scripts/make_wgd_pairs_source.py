#!/usr/bin/env python3
"""Copy ms1-dup's WGD anchor pairs into sources/, with an expression correlation per pair.

The gene page showed a curated duplication class (S = salicoid WGD, A = gamma) but never named
the WGD partner, its dS, or the chromosome pair. This is that detail.

EVENT LABELS (since 0.18.0): this script writes the label carried by the anchor table it reads.
make_dissertation_layer_source.py then replaces `event` with the frozen pair call the
dissertation uses, and asserts the pair totals. Run that script after this one, always.

INCLUSIVE BY DESIGN: every anchor pair in the source is kept. No dS window, no site filter, no
cap on partners -- the curated result is not re-filtered here. The gene-level S/A letters stay
the authoritative call; ms1-dup derives them from `cls_5c` plus a 356-gene override, not from
the pair label `cls_v8` carried here (see ms1-dup data/55_master_v9_20260902/README.md), so ~70
genes have a letter without a matching pair label or vice versa. The page shows both as they
are rather than reconciling one to the other.

Correlation: same basis as duplicate_coexpr.tsv.gz -- Pearson r on log2(ComBat TPM + 1) over
652 samples. Blank r = a partner is outside the ComBat matrix or flat, NOT uncorrelated.
"""
import roots
import csv, gzip, io, json, os
import numpy as np

from expr_range_reader import load_combat_vectors

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SRC = roots.path('ms1_dup', 'data/54_v8_freeze_20260825/wgd_anchor_pairs_v8_reordered_20260902.csv')
OUT = os.path.join(ROOT, "sources", "wgd_pairs.tsv.gz")


def main():
    src = list(csv.DictReader(open(SRC)))
    ptr, known = {}, set()
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in fs:
                if fn.endswith(".json"):
                    for gid, r in json.load(open(os.path.join(dp, fn))).items():
                        known.add(gid)
                        x = r.get("x") or {}
                        if x.get("cb"):
                            ptr[gid] = {"hap": hap, "range": x.get("co"), "bucket": x["cb"]}
    missing = {g for r in src for g in (r["gene1"], r["gene2"]) if g not in known}
    assert not missing, f"{len(missing)} pair genes not in the atlas, e.g. {sorted(missing)[:3]}"
    assert {r["cls_v8"] for r in src} == {"sWGD", "aWGD"}

    need = {g for r in src for g in (r["gene1"], r["gene2"]) if g in ptr}
    vectors, storage = load_combat_vectors(DATA, {g: ptr[g] for g in need})
    print(f"loaded {len(vectors):,} ComBat vectors "
          f"({storage['range']:,} packed ranges; {storage['legacy']:,} from "
          f"{storage['legacy_buckets']:,} legacy buckets)")
    cent = {}
    for g, values in vectors.items():
        v = np.log2(np.asarray(values, dtype=np.float64) + 1.0)
        c = v - v.mean()
        cent[g] = (c, float(np.sqrt((c * c).sum())), v)

    rows, n_r = [], 0
    for r in src:
        a, b = r["gene1"], r["gene2"]
        rv = ""
        if a in cent and b in cent and cent[a][1] > 0 and cent[b][1] > 0:
            rv = round(float((cent[a][0] * cent[b][0]).sum() / (cent[a][1] * cent[b][1])), 4)
            n_r += 1
        rows.append({"hap": r["hap"], "gene_a": a, "gene_b": b,
                     "event": "S" if r["cls_v8"] == "sWGD" else "A",
                     "dS": r["dS_v6"], "syn_sites": r["syn_sites_v6"], "chrpair": r["chrpair"],
                     "multiplicon": r["multiplicon"].replace(".0", ""),
                     "conflict_resolved": r["conflict"], "r": rv})
    assert len(rows) == len(src), "a pair was dropped"
    rng = np.random.RandomState(0)
    worst = 0.0
    for i in rng.choice([i for i, x in enumerate(rows) if x["r"] != ""], 300, replace=False):
        x = rows[i]
        worst = max(worst, abs(np.corrcoef(cent[x["gene_a"]][2], cent[x["gene_b"]][2])[0, 1] - x["r"]))
    assert worst < 1e-3, worst
    print(f"GATE PASS: {len(rows):,} pairs kept of {len(src):,}; r on {n_r:,}; numpy delta {worst:.1e}")

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0]), delimiter="\t", lineterminator="\n")
    w.writeheader(); w.writerows(rows)
    with open(OUT, "wb") as fh, gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:
        gz.write(buf.getvalue().encode())
    print(f"wrote {OUT} ({os.path.getsize(OUT)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
