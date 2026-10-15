#!/usr/bin/env python3
"""Write sources/lsg_pool_frozen.tsv.gz: the frozen genEra call for every gene, label-free.

WHY THIS EXISTS (2026-09-21). Chen ruled that the LSG pool is the frozen genEra call, 842 HAP1 +
883 HAP2, and that it does not change; every check on it, the rerun that added Idesia included,
is a per-gene flag (MS2_2026 CLAUDE.md, commit 1e698f2). The atlas had swapped that call out on
2026-09-10 for the rerun's ranks, and in doing so overwrote the frozen call's taxonomic
representativeness (`ps.tr`) on 1,251 genes. build_phylostrat.py writes the frozen call in a full
build, but a full build cannot run on one machine, so the in-place correction needs the frozen
values from a committed source. This is that source.

WHERE IT COMES FROM. ms2-lsg `pipeline/out/lsg_pool.tsv`, read through git at the commit pinned in
sources/ms2_canon.pin.json, so the local ms2-lsg checkout's branch does not matter. That table is
the frozen pool the chapter reports. Two things are done to it, both asserted:
  * `canonical_label` and `group` are dropped. They carry the unpublished candidate names.
  * One gene appears on two rows because it carries two canonical labels. The rows are identical
    once the labels are dropped (asserted), so they collapse to one.

GATES, all of which must pass or nothing is written:
  * 63,960 genes, and the pool is exactly 842 HAP1 + 883 HAP2.
  * rank and is_lsg equal the frozen_rank and frozen_is_lsg columns of the rerun table
    (lsg_pool_idesia.tsv.gz) for every gene: two ms2-lsg tables, one frozen call.

NOT A BUILD STAGE. Like the other make_*_source.py scripts it regenerates a committed source by
hand; the stage that applies it is patch_lsg_pool.py. Needs a clone of ms2-lsg (private).
"""
import roots
import csv
import gzip
import hashlib
import io
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIN = os.path.join(ROOT, "sources", "ms2_canon.pin.json")
OUT = os.path.join(ROOT, "sources", "lsg_pool_frozen.tsv.gz")
PROV = os.path.join(ROOT, "sources", "lsg_pool_frozen.provenance.json")
SRC = "pipeline/out/lsg_pool.tsv"
RERUN = "pipeline/out/lsg_pool_idesia.tsv.gz"
KEEP = ["gene_id", "hap", "phylostratum", "rank", "tax_rep", "is_lsg"]
DROP = {"canonical_label", "group"}
CANDIDATES = [roots.root("ms2_lsg")]


def git_blob(root, commit, path, want_blob):
    blob = subprocess.run(["git", "-C", root, "rev-parse", f"{commit}:{path}"],
                          capture_output=True, text=True).stdout.strip()
    if blob != want_blob:
        sys.exit(f"REFUSED: {path} at {commit[:9]} is blob {blob or 'ABSENT'}, pin says {want_blob}")
    return subprocess.run(["git", "-C", root, "cat-file", "blob", blob],
                          capture_output=True, check=True).stdout, blob


def main():
    pin = json.load(open(PIN))
    commit = pin["ms2_lsg_commit"]
    root = next((r for r in CANDIDATES if r and subprocess.run(
        ["git", "-C", r, "cat-file", "-e", f"{commit}^{{commit}}"],
        capture_output=True).returncode == 0), None)
    if not root:
        sys.exit(f"REFUSED: no ms2-lsg clone holds commit {commit[:9]} (set MS2_LSG_ROOT)")
    raw, blob = git_blob(root, commit, SRC, pin["tables"][SRC])
    rows = list(csv.DictReader(io.StringIO(raw.decode()), delimiter="\t"))
    assert DROP <= set(rows[0]), f"expected label columns {DROP} in the source, found {list(rows[0])}"

    frozen = {}
    for r in rows:
        k = tuple(r[c] for c in KEEP)
        if r["gene_id"] in frozen:
            assert frozen[r["gene_id"]] == k, f"{r['gene_id']}: duplicate rows disagree"
        frozen[r["gene_id"]] = k
    assert len(frozen) == 63960, f"{len(frozen)} genes, expected 63,960"
    pool = {"HAP1": 0, "HAP2": 0}
    for k in frozen.values():
        pool[k[1]] += k[5] == "True"
    assert pool == {"HAP1": 842, "HAP2": 883}, f"frozen pool is {pool}, expected 842 / 883"

    rraw, _ = git_blob(root, commit, RERUN, pin["tables"][RERUN])
    rerun = {r["gene_id"]: r for r in csv.DictReader(
        io.StringIO(gzip.decompress(rraw).decode()), delimiter="\t")}
    rk = lambda v: None if v in ("", "nan", "NA") else int(float(v))
    bad = [g for g, k in frozen.items()
           if rk(k[3]) != rk(rerun[g]["frozen_rank"]) or k[5] != rerun[g]["frozen_is_lsg"]]
    assert not bad, f"{len(bad)} genes where the two ms2-lsg tables disagree on the frozen call: {bad[:5]}"

    buf = io.StringIO()
    w = csv.writer(buf, delimiter="\t", lineterminator="\n")
    w.writerow(KEEP)
    for g in sorted(frozen):
        w.writerow(frozen[g])
    data = gzip.compress(buf.getvalue().encode(), mtime=0)
    with open(OUT, "wb") as fh:
        fh.write(data)

    prov = {
        "purpose": "The frozen genEra call for every gene: the LSG pool is its rank >= 18 genes, "
                   "842 HAP1 + 883 HAP2, and it does not change (Chen, 2026-09-21). Every check on "
                   "the pool, the rerun that added Idesia included, is a per-gene flag.",
        "ruling": "Chen, 2026-09-21: \"the 842/883 is the frozen but the various QC steps from "
                  "Idesia to synteny to abSENSE ... are all for flagging\". Recorded in MS2_2026 "
                  "CLAUDE.md, commit 1e698f2.",
        "what_the_frozen_call_is": "genEra ranks from its NCBI nr search. Its configured comparison "
                                   "panel was never searched (genEra's own changelog); the rerun "
                                   "that added Idesia was the first run to search the full panel, "
                                   "which is why a rank change there is not always due to Idesia.",
        "tier": "public",
        "generated_by": "scripts/make_pool_frozen_source.py",
        "source": f"ChenHsieh/ms2-lsg {commit} : {SRC} (git blob {blob})",
        "columns_dropped": ["canonical_label", "group"],
        "why_dropped": "They carry the unpublished candidate names for 10 genes.",
        "rows_collapsed": "One gene sits on two source rows under two canonical labels; the rows are "
                          "identical without the labels and collapse to one.",
        "gates": ["63,960 genes; pool exactly 842 HAP1 + 883 HAP2",
                  "rank and is_lsg equal frozen_rank and frozen_is_lsg of lsg_pool_idesia.tsv.gz "
                  "for every gene"],
        "rows": len(frozen),
        "shipped_sha256": hashlib.sha256(data).hexdigest(),
        "written": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "applied_by": "scripts/patch_lsg_pool.py (build stage)",
    }
    with open(PROV, "w") as fh:
        json.dump(prov, fh, indent=1)
        fh.write("\n")
    print(f"wrote {OUT}: {len(frozen)} genes, pool {pool}, {len(data) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
