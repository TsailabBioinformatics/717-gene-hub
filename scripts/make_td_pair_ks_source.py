#!/usr/bin/env python3
"""Copy ms1-dup's per-PAIR tandem dS into sources/, so a tandem link can carry a number.

Why this exists. `td.ks` on a gene record is the ARRAY MEDIAN -- `patch_duplicate_partners.py`
says so in its own docstring and deliberately refused to render it beside an individual member,
because a median drawn on one edge reads as that edge's divergence. That refusal was correct and
is unchanged. What changes is that a real per-pair number now travels with the pair:
`union_pairs_final.csv` from the adopted TD union rebuild carries `ks`/`ka` per detected edge,
on the same canonical set (13,048 members / 4,204 arrays) the atlas already serves.

FILTERS, and why each one. Only two, both from the source's own QC, applied exactly as
`06_ks_panels.py` applies them for the published Ks figures:

  pair_retained   the edge survived the union rebuild's curation (1,129 of 22,473 did not)
  kaks_cov_ok     the codon alignment covered enough of the pair to trust dS (5,448 failed)
  ks > 0          a zero is a saturation/alignment artefact here, not an observation

No dS window, no array-level dedup. Array dedup (ms1-dup CLAUDE.md #14) exists to stop
pseudoreplication in a DISTRIBUTION; this is a per-edge lookup, where every edge is asked about
individually, so deduplicating would delete real answers.

COVERAGE IS PARTIAL AND MUST RENDER AS SUCH. 15,710 usable pairs cover 30,918 of the 60,036
`td.mem` member entries (51.5%). The gap is structural, not missing data: `td.mem` lists every
OTHER member of a gene's array (all-vs-all), while this table holds the DETECTED EDGES. A member
with no dS here is "this pair was never scored", never "these two are identical".
"""
import roots
import csv, gzip, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SRC = (roots.path('ms1_dup', 'data/09_td_pairs/td_union_20260831/union_pairs_final.csv'))
OUT = os.path.join(ROOT, "sources", "td_pair_ks.tsv.gz")
PROV = os.path.join(ROOT, "sources", "td_pair_ks.provenance.json")
COLS = ["hap", "gene_a", "gene_b", "dS", "dN", "omega", "cov_frac", "ks_source", "age_bin"]


def known_genes():
    out = set()
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in fs:
                if fn.endswith(".json"):
                    out |= set(json.load(open(os.path.join(dp, fn))))
    return out


def main():
    src = list(csv.DictReader(open(SRC)))
    genes = known_genes()
    missing = {g for r in src for g in (r["gene1"], r["gene2"]) if g not in genes}
    assert not missing, f"{len(missing)} pair genes not in the atlas, e.g. {sorted(missing)[:3]}"

    n_drop = {"not_retained": 0, "cov_fail": 0, "no_ks": 0}
    rows, seen = [], set()
    for r in src:
        if r["pair_retained"] != "True":
            n_drop["not_retained"] += 1
            continue
        if r["kaks_cov_ok"] != "True":
            n_drop["cov_fail"] += 1
            continue
        try:
            ks = float(r["ks"])
        except (TypeError, ValueError):
            ks = 0.0
        if not ks > 0:
            n_drop["no_ks"] += 1
            continue
        a, b = sorted((r["gene1"], r["gene2"]))
        if (a, b) in seen:
            continue
        seen.add((a, b))
        num = lambda k: (round(float(r[k]), 4) if r.get(k) not in (None, "", "NA") else "")
        rows.append({"hap": r["haplotype"], "gene_a": a, "gene_b": b,
                     "dS": round(ks, 4), "dN": num("ka"), "omega": num("ka_ks_omega"),
                     "cov_frac": num("cov_frac"), "ks_source": r["ks_source"],
                     "age_bin": r.get("age_bin", "")})
    rows.sort(key=lambda r: (r["hap"], r["gene_a"], r["gene_b"]))

    with gzip.open(OUT, "wt", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLS, delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"{len(src):,} source edges -> {len(rows):,} pairs written; dropped {n_drop}")

    json.dump({
        "purpose": "Per-PAIR tandem dS, so a tandem link in the duplication-layers view can "
                   "carry its own number instead of borrowing the array median (td.ks).",
        "tier": "public",
        "source_file": SRC,
        "source_set": "TD union rebuild adopted 2026-09-02: 13,048 members in 4,204 arrays "
                      "(HAP1 6,663 / 2,119; HAP2 6,385 / 2,085) -- the same set the atlas "
                      "already serves for tandem membership.",
        "filters": {
            "pair_retained": "edge survived the union rebuild's curation",
            "kaks_cov_ok": "codon alignment coverage sufficient for dS",
            "ks_gt_0": "a zero dS here is an alignment/saturation artefact, not an observation",
            "no_array_dedup": "ms1-dup CLAUDE.md #14's array dedup guards a DISTRIBUTION "
                              "against pseudoreplication; this is a per-edge lookup, so "
                              "deduplicating would delete real per-pair answers.",
        },
        "dropped": n_drop,
        "pairs": len(rows),
        "coverage_caveat": "These are DETECTED EDGES; `td.mem` lists every other member of an "
                           "array (all-vs-all). A member without a dS was never scored as a "
                           "pair -- it does not mean the two are identical.",
    }, open(PROV, "w"), indent=1)


if __name__ == "__main__":
    main()
