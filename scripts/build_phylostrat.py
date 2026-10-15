#!/usr/bin/env python3
"""
Adds the genEra context that build_data.py does not carry: ambiguous-stratum flags, founder
events, and the per-stratum ladder used by the module overview.

PATCHER -- runs after build_data.py. See README "Build order".

Why ambiguity matters enough to ship: genEra emits a separate file listing genes whose
phylostratum it could not resolve to one node (29 HAP1 + 15 HAP2). Those genes still carry a
rank in gene_ages.tsv, so without this flag a reader sees a confident stratum for a gene the
method itself flagged as uncertain. For a chapter whose thesis rests on PS >= 18, that is
exactly the wrong place to look confident.
"""
import roots
import json, os, re, sys
from collections import defaultdict

GENERA = roots.path('scratch', 'genera/output')
ATLAS = roots.root('atlas')
STRIP = re.compile(r"\.\d+\.p$")

def hap_dir(h):
    return f"{GENERA}/hap{h}/genera_717hap{h}_v5.1/80863"

def shard_paths(root):
    """Every gene-shard JSON under a haplotype directory, at any nesting depth."""
    out = []
    for dp, _, fs in os.walk(root):
        out += [os.path.join(dp, f) for f in fs if f.endswith(".json")]
    return out


def main():
    data = os.path.join(ATLAS, "data")

    ambiguous, founder, ladder = {}, {}, {}
    for h in (1, 2):
        with open(f"{hap_dir(h)}_ambiguous_phylostrata.tsv") as fh:
            next(fh)
            for line in fh:
                f = line.rstrip("\n").split("\t")
                if len(f) >= 2:
                    ambiguous[STRIP.sub("", f[0])] = f[1].split(",")

        # A "founder event" is a gene family whose oldest member appears at this stratum --
        # i.e. the family originated there. Family size is the whole family, so a gene can be
        # a founder member of a large ancient family or a singleton novelty.
        with open(f"{hap_dir(h)}_founder_events.tsv") as fh:
            next(fh)
            for line in fh:
                f = line.rstrip("\n").split("\t")
                if len(f) < 4:
                    continue
                rank = None if f[2] == "NA" else int(f[2])
                size = int(f[3]) if f[3].isdigit() else None
                for g in f[0].split(","):
                    founder[STRIP.sub("", g)] = {"rank": rank, "fam": size}

        rows = []
        with open(f"{hap_dir(h)}_gene_age_summary.tsv") as fh:
            next(fh)
            for line in fh:
                f = line.rstrip("\n").split("\t")
                if len(f) >= 3 and f[2] != "NA":
                    rows.append({"rank": int(f[2]), "name": f[1], "n": int(f[0])})
        ladder[f"hap{h}"] = sorted(rows, key=lambda r: r["rank"])

    print(f"ambiguous: {len(ambiguous)}   founder members: {len(founder)}")

    genes_dir = os.path.join(data, "genes")
    patched = defaultdict(int)
    by_rank = defaultdict(lambda: defaultdict(int))
    for hap in ("hap1", "hap2"):
        # Shards are nested one level deeper since the bucketed split; walk, don't listdir.
        for p in sorted(shard_paths(os.path.join(genes_dir, hap))):
            with open(p) as fh:
                shard = json.load(fh)
            for gid, rec in shard.items():
                ps = rec.get("ps")
                if ps is None:
                    continue
                if gid in ambiguous:
                    ps["amb"] = ambiguous[gid]
                    patched["ambiguous"] += 1
                if gid in founder:
                    ps["fnd"] = founder[gid]
                    patched["founder"] += 1
                r = ps.get("rank")
                by_rank[hap][str(r) if r is not None else "NA"] += 1
            with open(p, "w") as fh:
                json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    print("patched:", dict(patched))

    man_path = os.path.join(data, "meta", "manifest.json")
    with open(man_path) as fh:
        man = json.load(fh)
    if "phylostrat" not in man["modules"]:
        man["modules"].append("phylostrat")
    man["phylostrat"] = {
        "ladder": ladder,
        "by_rank": {h: dict(v) for h, v in by_rank.items()},
        "n_ambiguous": patched["ambiguous"],
        "n_founder": patched["founder"],
        "lsg_rank_min": 18,
        "note": "LSG pool = rank >= 18 (PS18 Populus + PS19 hybrid-only), per the chapter "
                "definition. PS17 Saliceae is flanking context and is not in the pool.",
    }
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print("manifest updated with the strata ladder")
    return 0

if __name__ == "__main__":
    sys.exit(main())
