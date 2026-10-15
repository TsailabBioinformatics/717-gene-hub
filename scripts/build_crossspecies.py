#!/usr/bin/env python3
"""
Adds the P. trichocarpa syntenic ortholog for each 717 gene.

Source is THIS ATLAS'S OWN GENESPACE run (job 47798208), which was QC'd in this project --
not an imported table. That matters after the 2026-09-05 audit: every external layer had to be
checked against a repo's canonical/superseded statements, whereas this one is ours.

Why it is worth having: P. trichocarpa is the reference Populus genome, so a Potri id is the
key that unlocks Phytozome and PopGenIE for a visitor holding a 717 gene. That is exactly the
lookup a community user arrives wanting.

Only reciprocal 1:1 pairs are published. Where a 717 gene hits several Potri genes (or vice
versa) the relationship is recorded as ambiguous with its multiplicity rather than resolved by
picking the top hit -- an arbitrary pick would read as a confident ortholog call.

PATCHER -- runs after build_data.py, before build_facets.py.
"""
import roots
import csv, gzip, json, os, sys
from collections import defaultdict

GS = roots.path('scratch', 'ms2_genespace/workdir_local_47798208/syntenicHits')
ATLAS = roots.root('atlas')

def shard_paths(root):
    out = []
    for dp, _, fs in os.walk(root):
        out += [os.path.join(dp, f) for f in fs if f.endswith(".json")]
    return out

def main():
    data = os.path.join(ATLAS, "data")
    # Reciprocity is computed WITHIN each haplotype. 717 is a phased diploid, so a Potri gene
    # is expected to hit one HAP1 gene AND one HAP2 gene; testing reciprocity across the pooled
    # set counts that normal pairing as ambiguity and collapsed the 1:1 set to 724 of 52,470.
    fwd, rev = defaultdict(set), defaultdict(lambda: defaultdict(set))
    n_hit = 0
    for hap in ("Ptrxalhap1", "Ptrxalhap2"):
        path = f"{GS}/Ptrichocarpa_vs_{hap}.synHits.txt.gz"
        if not os.path.exists(path):
            print(f"MISSING {path}", file=sys.stderr)
            return 1
        with gzip.open(path, "rt") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                potri, gene = r.get("id1"), r.get("id2")
                if potri and gene:
                    fwd[gene].add(potri)
                    rev[hap][potri].add(gene)

    hap_of = lambda g: "Ptrxalhap1" if g.startswith("PtXaTreH") else "Ptrxalhap2"
    one_to_one, ambiguous = {}, {}
    for gene, potris in fwd.items():
        if len(potris) == 1:
            p = next(iter(potris))
            back = rev[hap_of(gene)][p]
            if len(back) == 1:
                one_to_one[gene] = p
            else:
                ambiguous[gene] = {"p": p, "n_back": len(back)}
        else:
            ambiguous[gene] = {"n": len(potris)}
    print(f"717 genes with a syntenic Ptrichocarpa hit: {len(fwd)}")
    print(f"  reciprocal 1:1 : {len(one_to_one)}")
    print(f"  ambiguous      : {len(ambiguous)}")

    patched = defaultdict(int)
    for hap in ("hap1", "hap2"):
        for p in sorted(shard_paths(os.path.join(data, "genes", hap))):
            with open(p) as fh:
                shard = json.load(fh)
            hit = False
            for gid, rec in shard.items():
                if gid in one_to_one:
                    rec["ptri"] = {"id": one_to_one[gid], "one2one": 1}
                    patched["1:1"] += 1
                    hit = True
                elif gid in ambiguous:
                    a = ambiguous[gid]
                    rec["ptri"] = {"one2one": 0, "n": a.get("n"), "id": a.get("p")}
                    patched["ambiguous"] += 1
                    hit = True
            if hit:
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    print("patched:", dict(patched))

    man_path = os.path.join(data, "meta", "manifest.json")
    man = json.load(open(man_path))
    man["crossspecies"] = {
        "target": "Populus trichocarpa (Potri, v4.1 ids)",
        "source": "this atlas's own GENESPACE run 47798208, syntenicHits",
        "n_hit": len(fwd), "n_one2one": len(one_to_one), "n_ambiguous": len(ambiguous),
        "note": "Only reciprocal 1:1 pairs are presented as orthologs. Ambiguous ones keep "
                "their multiplicity rather than being resolved by taking a top hit.",
    }
    json.dump(man, open(man_path, "w"), indent=1, sort_keys=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
