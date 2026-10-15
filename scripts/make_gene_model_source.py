#!/usr/bin/env python3
"""Build the two RNA-seq gene-model sources: intron support, and the split-model flag.

Source: ms2 analyses/piggyback_rnaseq_junctions, out_idesia/ -- the CORRECTED pool run
(776/835), which is the pool this atlas serves. out_panel_panel94/ is byte-identical for every
table read here; only libraries.tsv and classification_with_rnaseq.tsv differ, neither of which
is used. Panel: 94 libraries, frozen. An 827-library expansion is running as of 2026-09-12 and
will supersede this; the expansion's own `panel94` equivalence gate PASSES (0 of 16 matched
cells and 0 of 20 arm rows differ), which is what makes shipping the frozen 94 safe rather than
merely convenient.

THE TODO'S NUMBERS WERE WRONG AND ARE NOT USED. It claimed "1,435 adjacent pairs (2,629 genes)
carry 3+ spliced reads" and "40 pairs (79 genes) show the exact splitter signature". Recomputed:
1,435 pairs / 2,629 genes is the EXON-BOUNDARY tier, and the any-junction tier is 5,126 pairs /
9,200 genes. The two figures had been assigned to the wrong tiers. Everything below is
recomputed from the tables and asserted, not quoted.

THE FRAMING THAT MATTERS, and the reason this is not an "LSG problem": of the 1,435 pairs with
3+ exon-boundary junctions, 1,422 are conserved-with-conserved and only 13 are
LSG-with-conserved. The owning analysis's Result 2 says the same thing from the other side --
arm A is 0.96% against a gap- and depth-matched conserved 3.61%, i.e. LSG pairs are LESS often
fused, not more.
"""
import roots
import csv, gzip, io, json, os, sys
from collections import Counter, defaultdict

SRC = roots.path('scratch', 'pb_rnaseq_wt/analyses/piggyback_rnaseq_junctions/out_idesia')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_I = os.path.join(ROOT, "sources", "intron_support.tsv.gz")
OUT_S = os.path.join(ROOT, "sources", "gene_model_pairs.tsv.gz")
MIN_JUNC = 3


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def write_gz(path, cols, rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, delimiter="\t", lineterminator="\n",
                       extrasaction="ignore")
    w.writeheader(); w.writerows(rows)
    with open(path, "wb") as fh:
        with gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:
            gz.write(buf.getvalue().encode())


def main():
    # ---- intron support ------------------------------------------------------------------
    intr = list(csv.DictReader(open(f"{SRC}/intron_detect.tsv"), delimiter="\t"))
    multi = [r for r in intr if num(r["n_introns"]) > 0]
    print(f"intron_detect: {len(intr)} rows, {len(multi)} multi-exon")

    # gate: the analysis's own published figures, by the atlas's OWN corrected ranks
    rank = {}
    for dp, _, fs in os.walk(os.path.join(ROOT, "data", "genes")):
        for fn in fs:
            if fn.endswith(".json"):
                for g, r in json.load(open(os.path.join(dp, fn))).items():
                    rank[g] = (r.get("ps") or {}).get("rank")
    agg = defaultdict(lambda: [0, 0, 0])
    for r in multi:
        rk = rank.get(r["gene_id"])
        k = "LSG" if (rk is not None and rk >= 18) else "other"
        a = agg[k]; a[0] += 1
        if num(r["n_introns_seen"]) == num(r["n_introns"]): a[1] += 1
        if num(r["n_introns_seen"]) == 0: a[2] += 1
    lsg, oth = agg["LSG"], agg["other"]
    lsg_all, lsg_none = 100 * lsg[1] / lsg[0], 100 * lsg[2] / lsg[0]
    oth_all = 100 * oth[1] / oth[0]
    print(f"  LSG   n={lsg[0]} all={lsg_all:.1f}% none={lsg_none:.1f}%")
    print(f"  other n={oth[0]} all={oth_all:.1f}%")
    assert abs(lsg_all - 52.6) < 0.1 and abs(lsg_none - 37.2) < 0.1, \
        f"LSG intron figures moved: {lsg_all:.1f}/{lsg_none:.1f}, expected 52.6/37.2"
    assert abs(oth_all - 89.6) < 0.1, f"conserved figure moved: {oth_all:.1f}, expected 89.6"
    print("  GATE PASS: reproduces 52.6% / 37.2% (LSG) and 89.6% (other)")

    write_gz(OUT_I, ["gene_id", "hap", "n_introns", "n_introns_seen", "gene_reads"], intr)
    print(f"wrote {OUT_I}: {len(intr)} rows, {os.path.getsize(OUT_I)/1e3:.0f} KB")

    # ---- split-model pairs --------------------------------------------------------------
    pe = list(csv.DictReader(open(f"{SRC}/pair_evidence_scored.tsv"), delimiter="\t"))
    flagged = [r for r in pe if num(r["n_junc_exon"]) >= MIN_JUNC]
    any_junc = [r for r in pe if num(r["n_junc_reads"]) >= MIN_JUNC]
    by_arm = Counter(r["arm"] for r in flagged)
    opp = [r for r in pe if r["arm"].startswith("B")]
    floor = sum(1 for r in opp if num(r["n_junc_exon"]) >= MIN_JUNC)
    notev = sum(1 for r in pe if r["evaluable"] != "True")
    genes_flagged = set()
    for r in flagged:
        genes_flagged.update(r["pair_id"].split("|"))
    print(f"\npair_evidence: {len(pe)} pairs")
    print(f"  3+ exon-boundary : {len(flagged)} pairs, {len(genes_flagged)} genes  by arm {dict(by_arm)}")
    print(f"  3+ any junction  : {len(any_junc)} pairs")
    print(f"  floor (arm B)    : {floor} of {len(opp)} opposite-strand pairs")
    print(f"  not evaluable    : {notev} pairs")
    assert len(flagged) == 1435 and len(genes_flagged) == 2629, \
        f"exon-boundary tier moved: {len(flagged)}/{len(genes_flagged)}"
    assert floor == 0, f"the floor is no longer zero: {floor} -- the readout is not specific"
    assert by_arm.get("A_lsg_conserved", 0) == 13 and by_arm.get("C_cons_cons", 0) == 1422, \
        f"arm split moved: {dict(by_arm)}"
    print("  GATE PASS: 1,435 pairs / 2,629 genes, floor 0, arms 1,422 cons-cons + 13 LSG-cons")

    # per GENE, so a card can say both "flagged" and "was it even testable"
    per = defaultdict(lambda: {"np": 0, "nev": 0, "f": None})
    for r in pe:
        for g in r["pair_id"].split("|"):
            d = per[g]
            d["np"] += 1
            if r["evaluable"] == "True":
                d["nev"] += 1
    for r in flagged:
        for g in r["pair_id"].split("|"):
            partner = [x for x in r["pair_id"].split("|") if x != g]
            d = per[g]
            cand = {"partner": partner[0] if partner else "", "arm": r["arm"],
                    "gap_bp": num(r["gap_bp"]), "junc_reads": num(r["n_junc_reads"]),
                    "junc_exon": num(r["n_junc_exon"]),
                    "libs": num(r["n_lib_with_junc"]),
                    # the discriminator: an intron is SPLICED OUT, so a real split shows a
                    # junction with LOW gap coverage. High gap coverage means readthrough.
                    "gap_reads": num(r["n_gap_reads"]),
                    "up_reads": num(r["up_reads"]), "dn_reads": num(r["dn_reads"])}
            if d["f"] is None or cand["junc_exon"] > d["f"]["junc_exon"]:
                d["f"] = cand           # strongest flagged pair, if a gene has several
    rows = []
    for g, d in sorted(per.items()):
        f = d["f"] or {}
        rows.append({"gene_id": g, "n_pairs": d["np"], "n_pairs_evaluable": d["nev"],
                     "flagged": 1 if d["f"] else 0,
                     "partner": f.get("partner", ""), "arm": f.get("arm", ""),
                     "gap_bp": f.get("gap_bp", ""), "junc_reads": f.get("junc_reads", ""),
                     "junc_exon": f.get("junc_exon", ""), "libs": f.get("libs", ""),
                     "gap_reads": f.get("gap_reads", ""), "up_reads": f.get("up_reads", ""),
                     "dn_reads": f.get("dn_reads", "")})
    write_gz(OUT_S, ["gene_id", "n_pairs", "n_pairs_evaluable", "flagged", "partner", "arm",
                     "gap_bp", "junc_reads", "junc_exon", "libs", "gap_reads",
                     "up_reads", "dn_reads"], rows)

    # sanity on the discriminator, using the analysis's own worked counter-example
    ex = {r["gene_id"]: r for r in rows}.get("PtXaAlbH.17G084800")
    if ex and ex["flagged"]:
        print(f"  discriminator check, PtXaAlbH.17G084800: junc_exon={ex['junc_exon']} "
              f"junc_reads={ex['junc_reads']} gap_reads={ex['gap_reads']} -- the owning "
              "analysis calls this a covered readthrough, NOT a clean split, and the shipped "
              "gap count is what lets a card say so")
    n_flag = sum(1 for r in rows if r["flagged"])
    print(f"wrote {OUT_S}: {len(rows)} genes ({n_flag} flagged), "
          f"{os.path.getsize(OUT_S)/1e3:.0f} KB")
    assert n_flag == len(genes_flagged), f"{n_flag} vs {len(genes_flagged)}"


if __name__ == "__main__":
    main()
