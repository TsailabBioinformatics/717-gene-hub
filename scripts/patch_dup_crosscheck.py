#!/usr/bin/env python3
"""Tandem cross-check: do published duplication callers also call this gene tandem?

Writes `dup.xt = {"t": tandem bits, "x": proximal-not-tandem bits}` (1 DupGen_finder, 2 MCScanX,
4 doubletrouble) on every quality-filtered gene that the dissertation or any caller puts in a
tandem array or calls a nearby (proximal) copy, from sources/dup_tandem_crosscheck.tsv.gz, and
removes it from every other gene. A cross-check, never part of the call: it does not touch
dup.td, dup.t or any duplication field, and refuses if they differ before and after.

Why the line is worded as a difference of definition, not a verdict: the callers' tandem sets
sit almost entirely inside the dissertation's (DupGen_finder: 4,110 of its 4,148 quality-filtered
tandem genes are dissertation tandem genes on HAP1), and most of the dissertation's surplus is
what the callers call proximal: copies close by with other genes between, which the
dissertation's rule counts as one array.
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
SRC = roots.path("atlas", "sources/dup_tandem_crosscheck.tsv.gz")
# all_three, nearby_copy_only, none: the planning re-derivation (also gated in the source generator);
# some = the remainder of the dissertation tandem set; tools_only counted from the source table.
WANT = {"all_three": {"HAP1": 3000, "HAP2": 2921}, "some": {"HAP1": 1116, "HAP2": 1099},
        "nearby_copy_only": {"HAP1": 1732, "HAP2": 1558}, "none": {"HAP1": 815, "HAP2": 807},
        "tools_only": {"HAP1": 38, "HAP2": 52}}
CODE = ("all_three", "some", "nearby_copy_only", "none", "tools_only")


def code(td, x):
    """Facet code: 0..4 as CODE, -1 when nothing to say (a nearby copy, not tandem anywhere)."""
    if td:
        return 0 if x["t"] == 7 else 1 if x["t"] else 2 if x["x"] else 3
    return 4 if x["t"] else -1


def main():
    src = {}
    with gzip.open(SRC, "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            src[r["gene_id"]] = (r["hap"], int(r["t"]), int(r["x"]), r["td"] == "1")
    before, after = hashlib.sha256(), hashlib.sha256()
    n = {k: {"HAP1": 0, "HAP2": 0} for k in CODE}
    td_mismatch = []
    for hap in ("hap1", "hap2"):
        for dp, _, fs in sorted(os.walk(os.path.join(DATA, "genes", hap))):
            for fn in sorted(fs):
                if not fn.endswith(".json"):
                    continue
                p = os.path.join(dp, fn)
                shard = json.load(open(p))
                for gid in sorted(shard):
                    rec = shard[gid]
                    d = rec.get("dup")
                    keep = {k: v for k, v in (d or {}).items() if k != "xt"}
                    before.update(json.dumps([gid, keep], sort_keys=True).encode())
                    if d is not None:
                        d.pop("xt", None)
                    if gid in src and d is not None and not (rec.get("rel") or {}).get("qc"):
                        h, t, x, td = src[gid]
                        if td != bool(d.get("td")):
                            td_mismatch.append(gid)
                        d["xt"] = {"t": t, "x": x}
                        c = code(bool(d.get("td")), d["xt"])
                        if c >= 0:
                            n[CODE[c]][h] += 1
                    after.update(json.dumps([gid, {k: v for k, v in (d or {}).items() if k != "xt"}], sort_keys=True).encode())
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    assert not td_mismatch, f"the source's dissertation tandem column differs on {len(td_mismatch)} genes, e.g. {td_mismatch[:3]}; rebuild the source"
    assert before.digest() == after.digest(), "a duplication field other than dup.xt changed"
    assert n == WANT, f"counts {json.dumps(n, sort_keys=True)}, expected {json.dumps(WANT, sort_keys=True)}"
    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    man["dup_crosscheck"] = {
        "what": "whether three published duplication callers also call a gene tandem; a cross-check, never part of the dissertation's call",
        "callers": {"DupGen_finder": 1, "MCScanX": 2, "doubletrouble": 4},
        "outcomes": CODE, "per_haplotype": n,
        "source_sha256": hashlib.sha256(gzip.open(SRC).read()).hexdigest(),
    }
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print(f"dup.xt written; {json.dumps(n, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
