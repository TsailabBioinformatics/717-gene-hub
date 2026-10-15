#!/usr/bin/env python3
"""The route C combined Ks + topology WGD call, per gene.

WHAT THIS IS. The atlas's salicoid/gamma letters come from `master_duplication_table_v9`,
which is v8's rule 5c plus a dS conflict resolution. The gamma-branch route C work
(`data/57_gamma_branch/painting_v3/`) re-adjudicated every anchor pair against the ancestral
eudicot karyotype: it takes the TOPOLOGY call where grape and segment Ks independently agree
with it, keeps v8 otherwise, and sets aside the pairs whose evidence is split. That is the
`combined_call` column carried here.

It moves 182 HAP1 genes into salicoid and 162 out of gamma (HAP2: +212 / -201) -- see
`main_dupclass_euler_combined_call_vs_v8_backup.csv` in the 2026-09-18 talk figure set, which
this reproduces exactly as an ingest gate.

WHAT IT IS NOT. As of MS1's 2026-09-16 reconciliation this is NOT applied to the canonical
tables: "nothing applied, for the WGD track owner" (open item (t)). The canonical duplication
table is still v9, and the manuscript still quotes v8 numbers. So the atlas carries BOTH and
says which is which -- the same treatment the withdrawn LSG pool got (TODO 26): show the
correction, never silently swap it.

DERIVATION, copied from the figure script that published the numbers
(`ms1_talk_20260918/class_figures/make_class_figures.py`, lines 366-369): a gene is salicoid
or gamma if it is an endpoint of ANY pair whose `combined_call` says so; `review` pairs are
recorded separately rather than counted into either event.
"""
import roots
import csv, gzip, io, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SRC = (roots.path('ms1_dup', '.claude/worktrees/talk-td-act/data/57_gamma_branch/painting_v3/results/ks_topology_pairs_{hap}.tsv.gz'))
OUT = os.path.join(ROOT, "sources", "wgd_combined_call.tsv.gz")
PROV = os.path.join(ROOT, "sources", "wgd_combined_call.provenance.json")

# The published figure's own totals. Refuse to write if we cannot reproduce them.
TARGET = {"HAP1": {"S": 14748, "A": 4857}, "HAP2": {"S": 14747, "A": 4910}}
COLS = ["hap", "gene_id", "cc_salicoid", "cc_gamma", "cc_review"]


def known_genes():
    out = set()
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in fs:
                if fn.endswith(".json"):
                    out |= set(json.load(open(os.path.join(dp, fn))))
    return out


def main():
    genes = known_genes()
    rows, summary = [], {}
    for hap in ("HAP1", "HAP2"):
        with gzip.open(SRC.format(hap=hap), "rt") as fh:
            src = list(csv.DictReader(io.StringIO(fh.read()), delimiter="\t"))
        sal, gam, rev = set(), set(), set()
        for r in src:
            tgt = {"sWGD": sal, "aWGD": gam, "review": rev}.get(r["combined_call"])
            if tgt is not None:
                tgt.add(r["gene1"])
                tgt.add(r["gene2"])
        assert len(sal) == TARGET[hap]["S"], f"{hap} salicoid {len(sal)} != {TARGET[hap]['S']}"
        assert len(gam) == TARGET[hap]["A"], f"{hap} gamma {len(gam)} != {TARGET[hap]['A']}"
        missing = {g for g in (sal | gam | rev) if g not in genes}
        assert not missing, f"{len(missing)} genes not in the atlas, e.g. {sorted(missing)[:3]}"
        for g in sorted(sal | gam | rev):
            rows.append({"hap": hap, "gene_id": g,
                         "cc_salicoid": int(g in sal), "cc_gamma": int(g in gam),
                         "cc_review": int(g in rev)})
        summary[hap] = {"salicoid": len(sal), "gamma": len(gam),
                        "review_pairs": sum(1 for r in src if r["combined_call"] == "review"),
                        "review_only_genes": len(rev - sal - gam),
                        "pairs": len(src)}
        print(f"{hap}: {len(src):,} pairs -> salicoid {len(sal):,}, gamma {len(gam):,}, "
              f"review-only genes {len(rev - sal - gam):,}  [gate OK]")

    with gzip.open(OUT, "wt", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLS, delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows):,} gene rows written")

    json.dump({
        "purpose": "Route C combined Ks + topology WGD call per gene, carried BESIDE the "
                   "canonical v9 letters so the correction is visible rather than applied "
                   "silently.",
        "tier": "public",
        "source_file": SRC,
        "rule": "topology where grape and segment Ks independently agree with it; v8 "
                "otherwise; pairs with split evidence marked `review` and counted into "
                "neither event.",
        "derivation": "A gene is salicoid/gamma if it is an endpoint of any pair with that "
                      "combined_call. Copied from make_class_figures.py (the script that "
                      "published the figure), not re-invented here.",
        "gate": "Refuses to write unless it reproduces that figure's own totals: HAP1 "
                "14,748 / 4,857, HAP2 14,747 / 4,910.",
        "status_upstream": "NOT APPLIED to the canonical tables as of MS1's 2026-09-16 "
                           "reconciliation, open item (t): 'nothing applied, for the WGD "
                           "track owner'. The canonical duplication table is master v9 and "
                           "the manuscript still quotes v8 numbers.",
        "movement_vs_v9": {"HAP1": {"salicoid": "+182", "gamma": "-162"},
                           "HAP2": {"salicoid": "+212", "gamma": "-201"}},
        "summary": summary,
    }, open(PROV, "w"), indent=1)


if __name__ == "__main__":
    main()
