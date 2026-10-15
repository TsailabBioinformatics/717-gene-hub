#!/usr/bin/env python3
"""
Adds the duplication layer: within-haplotype paralog pairs with dS/dN.

SCOPE, stated because it is easy to over-read: `tier2_ds_pairs.tsv` is NOT a genome-wide
duplication catalog. It is the chapter's tier-2 selection -- 1,346 pairs concentrated at
phylostratum ranks 18 (290), 17 (360), 16 (96) plus a rank-12 Pentapetalae comparator set
(600). Two sources: gene families whose founder is at that stratum ("founder", 861) and
syntenic paralogs ("synteny", 485). Any dS distribution drawn from it describes that
selection, not the genome, and the module says so.

Tandem-array membership IS genome-wide -- it comes from the pangene array flags already in
each gene record (syn.flags.ar), so nothing new is needed for it here.

No salicoid-WGD ohnolog call is included: none has been computed for this assembly, and
inferring a WGD peak from a phylostratum-selected subset would be invalid.

PATCHER -- runs after build_data.py. See README "Build order".
"""
import roots
import csv, json, os, sys
from collections import defaultdict

DS = roots.path('scratch', 'tier2_ds_input/tier2_ds_pairs.tsv')
ATLAS = roots.root('atlas')

def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v else None

def shard_paths(root):
    """Every gene-shard JSON under a haplotype directory, at any nesting depth."""
    out = []
    for dp, _, fs in os.walk(root):
        out += [os.path.join(dp, f) for f in fs if f.endswith(".json")]
    return out


def main():
    data = os.path.join(ATLAS, "data")
    per_gene = defaultdict(list)
    n_undef = 0
    dist = defaultdict(list)

    with open(DS) as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    for r in rows:
        ks, ka, w = num(r["yn_ks"]), num(r["yn_ka"]), num(r["yn_omega"])
        # Same PAML sentinel as the allele layer: omega 99 means "cannot estimate", which is
        # exactly the pairs whose Ks is 0. Never publish it as a selection value.
        ks0 = ks is not None and ks <= 0
        if ks0:
            ks, w = 0.0, None
            n_undef += 1
        if w is not None and w >= 99:
            w = None
        if ks is None or ka is None:
            w = None
        rank = int(r["rank"]) if r["rank"].isdigit() else None
        rec = {"ks": ks, "ka": ka, "w": w, "src": r["source"],
               "sat": r["status"] == "saturated"}
        if ks0:
            rec["ks0"] = True
        per_gene[r["gene_a"]].append(dict(rec, id=r["gene_b"]))
        per_gene[r["gene_b"]].append(dict(rec, id=r["gene_a"]))
        if ks is not None and ks > 0 and rank is not None:
            dist[rank].append(round(ks, 4))

    print(f"paralog pairs: {len(rows)}  genes touched: {len(per_gene)}  "
          f"({n_undef} pairs with Ks=0, omega undefined)")

    genes_dir = os.path.join(data, "genes")
    patched = 0
    for hap in ("hap1", "hap2"):
        # Shards are nested one level deeper since the bucketed split; walk, don't listdir.
        for p in sorted(shard_paths(os.path.join(genes_dir, hap))):
            with open(p) as fh:
                shard = json.load(fh)
            hit = False
            for gid, rec in shard.items():
                if gid in per_gene:
                    rec["para"] = sorted(per_gene[gid], key=lambda x: x["id"])
                    patched += 1
                    hit = True
            if hit:
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    print(f"patched {patched} genes with paralog pairs")

    # Per-stratum Ks summary for the module overview (quartiles, not the raw vectors).
    summary = {}
    for rank, vals in sorted(dist.items()):
        vals.sort()
        n = len(vals)
        q = lambda f: vals[min(int(f * n), n - 1)]
        summary[str(rank)] = {"n": n, "min": vals[0], "q1": q(0.25), "med": q(0.5),
                              "q3": q(0.75), "max": vals[-1]}
    man_path = os.path.join(data, "meta", "manifest.json")
    man = json.load(open(man_path))
    if "duplication" not in man["modules"]:
        man["modules"].append("duplication")
    man["duplication"] = {
        "n_pairs": len(rows), "n_genes": patched, "n_ks_undefined": n_undef,
        "n_saturated": sum(1 for r in rows if r["status"] == "saturated"),
        "ks_by_rank": summary,
        "sources": dict((s, sum(1 for r in rows if r["source"] == s))
                        for s in {r["source"] for r in rows}),
        "scope": "Chapter tier-2 selection, NOT genome-wide: pairs are concentrated at "
                 "phylostrata 16-18 with a rank-12 Pentapetalae comparator set. Any Ks "
                 "distribution here describes that selection, not the genome.",
    }
    json.dump(man, open(man_path, "w"), indent=1, sort_keys=True)
    print("Ks by rank:", {k: f"n={v['n']} med={v['med']}" for k, v in summary.items()})
    return 0

if __name__ == "__main__":
    sys.exit(main())
