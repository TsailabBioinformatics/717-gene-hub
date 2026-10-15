#!/usr/bin/env python3
"""Build sources/chromatin_ptri.tsv.gz -- accessible chromatin and histone marks at the
Populus trichocarpa ortholog's promoter, from GEO GSE128434 (Schmitz lab, Nature Plants 2019).

WHOSE PROPERTY THIS IS. The analysis runs entirely inside P. trichocarpa: peaks called on
trichocarpa leaf, scored against trichocarpa gene starts. Nothing here was measured on 717,
and no 717 chromatin data exists. So this ships as a property OF THE ORTHOLOG, rendered as
such, and never as a statement about the 717 gene's own promoter. Carrying it across the
ortholog edge as a 717 property would assert promoter synteny that a reciprocal-ortholog
call does not establish.

THE DENOMINATOR IS LOAD-BEARING, and is shipped for the same reason the proteomics layer
ships detectability. The chromatin is LEAF ONLY. A gene silent in leaf correctly has no
promoter mark there, so a mark's absence is uninterpretable unless you know the gene was
expressed. The source analysis's first run failed its own gate for exactly this reason, plus
a window that was too narrow -- 55% of conserved gene starts have their nearest accessible
region more than 2 kb away, which is that paper's own headline finding about distal elements
in plants. Both corrections are baked into the table this reads.

GATE. Reproduces the analysis's published numbers before writing: the conserved leaf-expressed
H3K4me3 rate (81.5%) that its own gate turns on, and all eight cells of its Populus-specific
versus matched-conserved effect table. Nothing is written if any of them moves.
"""
import roots
import csv, gzip, io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = roots.path('scratch', 'ms2_hybrid_rationale/results/tss/l6_promoter_by_gene.tsv')
OUT = os.path.join(ROOT, "sources", "chromatin_ptri.tsv.gz")

# published in that analysis's docs/FINDINGS.md section 14
GATE_CONSERVED_H3K4ME3 = 81.5
GATE_EFFECT = {
    ("ps", "acr"): 50.4, ("ps", "h3k4me3"): 47.4,
    ("ps", "own_promoter"): 26.0, ("ps", "h3k36me3_body"): 15.6,
    ("ctrl", "acr"): 37.7, ("ctrl", "h3k4me3"): 35.2,
    ("ctrl", "own_promoter"): 17.4, ("ctrl", "h3k36me3_body"): 8.6,
}


def main():
    rows = list(csv.DictReader(open(SRC), delimiter="\t"))
    print(f"source: {len(rows)} P. trichocarpa loci")

    def rate(sel, col):
        s = [r for r in rows if sel(r) and r["expressed"] == "1"]
        return (len(s), round(100 * sum(1 for r in s if r[col] == "1") / len(s), 1)) if s else (0, None)

    bad = []
    n, p = rate(lambda r: r["rank"] == "1", "h3k4me3")
    if p != GATE_CONSERVED_H3K4ME3:
        bad.append(("conserved leaf-expressed H3K4me3", GATE_CONSERVED_H3K4ME3, p))
    sels = {"ps": lambda r: r["rank"] == "18", "ctrl": lambda r: r["is_matched_control"] == "1"}
    for (arm, col), want in GATE_EFFECT.items():
        _, got = rate(sels[arm], col)
        if got != want:
            bad.append((f"{arm}/{col}", want, got))
    if bad:
        for b in bad:
            print("  GATE FAIL", b, file=sys.stderr)
        raise SystemExit(f"GATE FAILED on {len(bad)} published values. Nothing written.")
    print(f"GATE PASS: reproduces the published conserved H3K4me3 rate ({p}%, n={n}) and all "
          f"{len(GATE_EFFECT)} cells of the effect table")

    # `rank` and `is_matched_control` are NOT shipped. `rank` is a P. trichocarpa phylostratum
    # from a different genEra run, and a column named `rank` sitting on a 717 gene page would
    # be read as the 717 rank. `is_matched_control` is an analysis-internal sampling flag.
    cols = ["locus", "expressed", "rpk", "acr", "h3k4me3", "h3k36me3_body", "own_promoter"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, delimiter="\t", lineterminator="\n",
                       extrasaction="ignore")
    w.writeheader()
    w.writerows(sorted(rows, key=lambda r: r["locus"]))
    with open(OUT, "wb") as fh:
        with gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:
            gz.write(buf.getvalue().encode())
    print(f"wrote {OUT}: {len(rows)} rows, {len(cols)} cols (rank and is_matched_control dropped)")


if __name__ == "__main__":
    main()
