#!/usr/bin/env python3
"""Gene-age cross-checks on every candidate: do independent methods agree with the call?

Writes `ps.xc` on exactly the candidate-pool genes (ps.lsg, 776 HAP1 + 835 HAP2) and removes it
from every other gene. A cross-check, never part of the call: it does not touch ps.lsg, ps.fin or
any rank, and refuses if ps.fin differs before and after.

    ps.xc = {"v": outcome, "r": checks run, "f": checks that found older homology, "p": stratum}

  v  0 agree             none of the checks run on this gene found a homolog older than the call
     1 search-sensitive  only search-choice checks did (phylostratr, the deeper profile search,
                         the unmasked search, BLASTP only): the call depends on how the search
                         was run, which the comparison says should be flagged, not reassigned
     2 disagree          a protein-family profile (Pfam) or the predicted-structure search found
                         older homology, the two checks the comparison treats as positive
                         evidence of an older family
  r, f  bits: 1 phylostratr, 2 deeper profile search (MMseqs2), 4 Pfam, 8 unmasked search,
        16 BLASTP only, 32 structure. 8, 16 and 32 ran on HAP1 only.
  p  phylostratr's stratum, only where bit 1 is set in f.

The rule for v is a declared choice, not a threshold from a source (Chen approved it 2026-10-14).
The source (sources/gene_age_crosscheck.tsv.gz, make_gene_age_crosscheck_source.py) carries only
r, f and p; v is derived here so there is one definition.
"""
import csv
import gzip
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roots  # noqa: E402

DATA = roots.path("atlas", "data")
SRC = roots.path("atlas", "sources/gene_age_crosscheck.tsv.gz")
BITS = {"phylostratr": 1, "deeper_profile_search": 2, "pfam": 4, "unmasked_search": 8,
        "blastp_only": 16, "structure": 32}
POSITIVE, SENSITIVE = 4 | 32, 1 | 2 | 8 | 16
OUTCOME = ("agree", "search_sensitive", "disagree")
# Re-derived independently from the comparison's tables while planning (2026-10-14); the
# generator's gate covers the frozen pool, this covers the pool and the final set it ships on.
WANT = {
    "final": {"HAP1": {"agree": 543, "search_sensitive": 36, "disagree": 4},
              "HAP2": {"agree": 584, "search_sensitive": 37, "disagree": 0}},
    "pool": {"HAP1": {"agree": 695, "search_sensitive": 71, "disagree": 10},
             "HAP2": {"agree": 755, "search_sensitive": 77, "disagree": 3}},
    "final_found": {"HAP1": {"phylostratr": 25, "deeper_profile_search": 23, "pfam": 3, "unmasked_search": 8,
                             "blastp_only": 8, "structure": 3},
                    "HAP2": {"phylostratr": 29, "deeper_profile_search": 20, "pfam": 0, "unmasked_search": 0,
                             "blastp_only": 0, "structure": 0}},
}


def outcome(f):
    return 2 if f & POSITIVE else 1 if f & SENSITIVE else 0


def main():
    src = {}
    with gzip.open(SRC, "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            src[r["gene_id"]] = (r["hap"], int(r["r"]), int(r["f"]), int(r["p"]) if r["p"] else None)
    fin_before, fin_after = hashlib.sha256(), hashlib.sha256()
    xc, hap_of, fin, missing = {}, {}, {}, []
    for hap in ("hap1", "hap2"):
        for dp, _, fs in sorted(os.walk(os.path.join(DATA, "genes", hap))):
            for fn in sorted(fs):
                if not fn.endswith(".json"):
                    continue
                p = os.path.join(dp, fn)
                shard = json.load(open(p))
                for gid in sorted(shard):
                    rec = shard[gid]
                    ps = rec.get("ps") or {}
                    fin_before.update(json.dumps([gid, ps.get("fin"), ps.get("lsg")], sort_keys=True).encode())
                    if not ps.get("lsg"):
                        ps.pop("xc", None)
                    elif gid not in src:
                        missing.append(gid)
                    else:
                        h, r, f, st = src[gid]
                        x = {"v": outcome(f), "r": r, "f": f}
                        if f & 1:
                            x["p"] = st
                        ps["xc"] = x
                        xc[gid], hap_of[gid], fin[gid] = x, h, bool((ps.get("fin") or {}).get("s"))
                    fin_after.update(json.dumps([gid, ps.get("fin"), ps.get("lsg")], sort_keys=True).encode())
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    assert not missing, f"{len(missing)} candidates have no cross-check row, e.g. {missing[:5]}"
    assert fin_before.digest() == fin_after.digest(), "ps.fin or ps.lsg changed: a cross-check must not move the call"
    bad = [g for g, x in xc.items() if hap_of[g] == "HAP2" and x["r"] & (8 | 16 | 32)]
    assert not bad, f"HAP2 genes marked as run on HAP1-only checks: {bad[:5]}"

    def count(sel):
        return {h: {o: sum(1 for g in xc if hap_of[g] == h and sel(g) and OUTCOME[xc[g]["v"]] == o) for o in OUTCOME}
                for h in ("HAP1", "HAP2")}
    got = {"final": count(lambda g: fin[g]), "pool": count(lambda g: True),
           "final_found": {h: {k: sum(1 for g in xc if hap_of[g] == h and fin[g] and xc[g]["f"] & b) for k, b in BITS.items()}
                           for h in ("HAP1", "HAP2")}}
    assert got == WANT, f"counts {json.dumps(got, sort_keys=True)}, expected {json.dumps(WANT, sort_keys=True)}"

    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    got["excluded"] = count(lambda g: not fin[g])
    man["gene_age_crosscheck"] = {
        "what": "independent gene-age checks on every candidate; cross-checks run after the dissertation's analysis, never part of its call",
        "outcomes": OUTCOME, "rule": "disagree if Pfam or the structure search found older homology; search-sensitive if only the others did",
        "bits": BITS, "hap1_only": ["unmasked_search", "blastp_only", "structure"],
        "per_set": got,
        "source_sha256": hashlib.sha256(gzip.open(SRC).read()).hexdigest(),
    }
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print(f"ps.xc on {len(xc)} candidates; final set {got['final']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
