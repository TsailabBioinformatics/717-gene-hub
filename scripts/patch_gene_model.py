#!/usr/bin/env python3
"""TODO: RNA-seq gene-model evidence -- intron support, and the split-model flag.

Two layers from one source (ms2 piggyback_rnaseq_junctions, out_idesia, 94-library frozen
panel, corrected pool). Both are FLAGS, never filters.

  gm.in   {n, seen, rd}  annotated introns, how many were observed, and the gene's read count
  gm.np / gm.nev         adjacent pairs, and how many were deep enough to test at all
  gm.sp   {...}          the strongest flagged pair, only when one exists

WHY THE READ COUNT AND THE PAIR COUNTS ARE NOT OPTIONAL. Intron detection is a function of
depth: under 20 reads the per-intron detection rate is below 27%, over 5,000 reads it is 98.8%.
LSG genes are shallow. So "3 of 5 introns seen" for an LSG is mostly a statement about its
expression, and shipping it without the depth and the power curve would read as evidence
against LSG gene models -- which the data does not support. Likewise 17,528 pairs were too
shallow to test, so a gene with no split flag may simply never have been testable, and
`nev` is what lets the card say which.

THREE GATES:
  1. n_introns must equal the atlas's OWN gs.in for every gene -- the source and the atlas
     derive it independently (spliced-read pipeline vs the v5.1 GFF3 longest isoform) and they
     agree 50,631/50,631. If they ever diverge, the two are describing different gene models
     and neither layer should ship.
  2. exactly 2,629 genes carry a split flag.
  3. every flagged gene's partner is a real atlas gene.
"""
import roots
import csv
import gzip
import io
import json
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SRC = roots.path('scratch', 'pb_rnaseq_wt/analyses/piggyback_rnaseq_junctions/out_idesia')
I_TSV = os.path.join(ROOT, "sources", "intron_support.tsv.gz")
P_TSV = os.path.join(ROOT, "sources", "gene_model_pairs.tsv.gz")


def rd(path):
    with gzip.open(path, "rt") as fh:
        return list(csv.DictReader(io.StringIO(fh.read()), delimiter="\t"))


def num(v, d=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return d


def shard_paths(root):
    for dp, _, fs in os.walk(root):
        for fn in sorted(fs):
            if fn.endswith(".json"):
                yield os.path.join(dp, fn)


def main():
    intron = {r["gene_id"]: r for r in rd(I_TSV)}
    pairs = {r["gene_id"]: r for r in rd(P_TSV)}
    print(f"source: {len(intron)} genes with intron data, {len(pairs)} genes in adjacent pairs")

    all_ids = set()
    for hap in ("hap1", "hap2"):
        for p in shard_paths(os.path.join(DATA, "genes", hap)):
            all_ids.update(json.load(open(p)))

    bad_partner = [r["partner"] for r in pairs.values()
                   if r["flagged"] == "1" and r["partner"] not in all_ids]
    assert not bad_partner, f"{len(bad_partner)} flagged partners are not atlas genes"

    mismatch, n_in, n_pair, n_flag, untestable = [], 0, 0, 0, 0
    for hap in ("hap1", "hap2"):
        for p in shard_paths(os.path.join(DATA, "genes", hap)):
            shard = json.load(open(p))
            changed = False
            for gid, rec in shard.items():
                gm = {}
                ir = intron.get(gid)
                if ir:
                    ni = num(ir["n_introns"])
                    gsin = (rec.get("gs") or {}).get("in")
                    if gsin is not None and gsin != ni:
                        mismatch.append((gid, gsin, ni))
                    gm["in"] = {"n": ni, "seen": num(ir["n_introns_seen"]),
                                "rd": num(ir["gene_reads"])}
                    n_in += 1
                pr = pairs.get(gid)
                if pr:
                    gm["np"] = num(pr["n_pairs"])
                    gm["nev"] = num(pr["n_pairs_evaluable"])
                    n_pair += 1
                    if gm["nev"] == 0:
                        untestable += 1
                    if pr["flagged"] == "1":
                        gm["sp"] = {"p": pr["partner"], "arm": pr["arm"],
                                    "gap": num(pr["gap_bp"]), "jr": num(pr["junc_reads"]),
                                    "je": num(pr["junc_exon"]), "lib": num(pr["libs"]),
                                    "gr": num(pr["gap_reads"]), "ur": num(pr["up_reads"]),
                                    "dr": num(pr["dn_reads"])}
                        n_flag += 1
                if gm:
                    rec["gm"] = gm
                    changed = True
                elif rec.pop("gm", None) is not None:
                    changed = True
            if changed:
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)

    print(f"patched: {n_in} genes with intron support, {n_pair} with pair context, "
          f"{n_flag} flagged, {untestable} never testable")
    assert not mismatch, (
        f"{len(mismatch)} genes where the source's intron count disagrees with the atlas's own "
        f"gs.in, e.g. {mismatch[:5]} -- the two are describing different gene models")
    print(f"GATE PASS: n_introns == gs.in for all {n_in} genes")
    assert n_flag == 2629, f"expected 2,629 flagged genes, got {n_flag}"
    print("GATE PASS: 2,629 flagged genes")

    power = [r for r in csv.DictReader(open(f"{SRC}/power_curve.tsv"), delimiter="\t")]
    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    man["gene_model"] = {
        "panel": "94 public RNA-seq libraries, frozen; an 827-library expansion is in progress "
                 "and will supersede this. The expansion's own panel94 equivalence gate passes.",
        "intron_support": {
            "genes": n_in,
            "note": "13,329 atlas genes are single-exon and have no intron to detect.",
            "multi_exon_all_introns_seen_pct": 89.6,
            "lsg_all_introns_seen_pct": 52.6, "lsg_no_intron_seen_pct": 37.2,
            "confound": "Detection tracks DEPTH. Under 20 reads the per-intron detection rate "
                        "is below 27%; over 5,000 reads it is 98.8%. LSG genes are shallow, so "
                        "a low figure for an LSG is largely about its expression. Never show "
                        "it without the gene's read count.",
            "power_curve": [{"hap": r["hap"], "reads": r["reads_bin"],
                             "n_genes": num(r["n_genes"]),
                             "detect": round(float(r["detect_rate"]), 4),
                             "all_seen": round(float(r["frac_genes_all_introns_seen"]), 4)}
                            for r in power],
        },
        "split_model": {
            "flagged_genes": n_flag, "flagged_pairs": 1435,
            "tier": "3+ spliced reads with both ends on annotated exon boundaries",
            "specificity": "0 of 27,276 opposite-strand pairs clear the tier, where fusion is "
                           "impossible. That zero floor is what makes a positive a measurement.",
            "not_an_lsg_problem": "1,422 of the 1,435 flagged pairs are conserved-with-"
                                  "conserved; only 13 are LSG-with-conserved. At matched gap "
                                  "and depth LSG pairs are fused LESS often (0.96% vs 3.61%).",
            "discriminator": "An intron is spliced out, so a genuine split shows a junction "
                             "with LOW gap coverage. High gap coverage is readthrough with a "
                             "defensible annotation. gap_reads ships for this reason.",
            "flag_not_filter": f"{untestable} genes had no adjacent pair deep enough to test. "
                               "Absence of a flag must never read as 'confirmed separate'.",
        },
    }
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print("manifest: gene_model block written")


if __name__ == "__main__":
    main()
