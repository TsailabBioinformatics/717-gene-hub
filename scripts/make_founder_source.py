#!/usr/bin/env python3
"""Write sources/founder_families_rerun.tsv.gz: each gene's founder family, from the pool's run.

WHY THIS EXISTS (2026-09-26). The gene card's family origin (`ps.fnd`) came from the frozen
2026-04 genEra run while the gene's own rank comes from the rerun that added Idesia (the pool
since C5). Two runs joined let a family look younger than one of its own members, which cannot
happen inside one run, on 419 genes. ms2-lsg now carries the rerun's own founder families
(`data/founder_families_rerun_20260926/`, built by the "ms2 sapelo2" session at this atlas's
request), so family origin and gene age come from the same run again.

WHERE IT COMES FROM. That table, read through git at the commit pinned in
sources/ms2_canon.pin.json, checked against the pinned git blob AND the pinned sha256 (the owner
read both back from origin/main). Dropped before shipping: `gene` (the transcript name; `gene_id`
is the join key) and `family_id` (the owner's own hash of the member list, meaningless outside
that file, so it must not look like an identifier a reader could look up).

GATES, all of which must pass or nothing is written:
  * 63,954 rows, gene_id unique, 15,040 families, 32,134 HAP1 + 31,820 HAP2 (the owner's README).
  * Within one run a family is never younger than a member: family_rank <= gene_rank on every
    row that has a gene_rank, and family_rank equals the family's oldest member rank.
  * family_size equals the family's row count.
  * gene_rank equals the pool call's rank (lsg_pool_idesia.tsv.gz, pinned) on every gene that has
    one: this is what makes the two fields one run, not merely a newer file.

NOT A BUILD STAGE. Regenerates a committed source by hand; the stage that applies it is
patch_founder_rerun.py. Needs a clone of ms2-lsg (private).
"""
import roots
import collections
import csv
import gzip
import hashlib
import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIN = os.path.join(ROOT, "sources", "ms2_canon.pin.json")
OUT = os.path.join(ROOT, "sources", "founder_families_rerun.tsv.gz")
PROV = os.path.join(ROOT, "sources", "founder_families_rerun.provenance.json")
SRC = "data/founder_families_rerun_20260926/founder_family_per_gene.tsv.gz"
POOL = "pipeline/out/lsg_pool_idesia.tsv.gz"
KEEP = ["gene_id", "hap", "family_phylostratum", "family_rank", "family_size", "gene_rank"]
CANDIDATES = [roots.root("ms2_lsg")]


def git_blob(root, commit, path, want_blob):
    blob = subprocess.run(["git", "-C", root, "rev-parse", f"{commit}:{path}"],
                          capture_output=True, text=True).stdout.strip()
    if blob != want_blob:
        sys.exit(f"REFUSED: {path} at {commit[:9]} is blob {blob or 'ABSENT'}, pin says {want_blob}")
    return subprocess.run(["git", "-C", root, "cat-file", "blob", blob],
                          capture_output=True, check=True).stdout, blob


def rk(v):
    return None if v in ("", "nan", "NA", None) else int(float(v))


def main():
    pin = json.load(open(PIN))
    commit = pin["ms2_lsg_commit"]
    root = next((r for r in CANDIDATES if r and subprocess.run(
        ["git", "-C", r, "cat-file", "-e", f"{commit}^{{commit}}"],
        capture_output=True).returncode == 0), None)
    if not root:
        sys.exit(f"REFUSED: no ms2-lsg clone holds commit {commit[:9]} (set MS2_LSG_ROOT)")
    raw, blob = git_blob(root, commit, SRC, pin["tables"][SRC])
    sha = hashlib.sha256(raw).hexdigest()
    if sha != pin["sha256"][SRC]:
        sys.exit(f"REFUSED: {SRC} sha256 {sha}, pin says {pin['sha256'][SRC]}")
    rows = list(csv.DictReader(io.StringIO(gzip.decompress(raw).decode()), delimiter="\t"))

    # ---- the owner's stated shape ---------------------------------------------------------
    ids = [r["gene_id"] for r in rows]
    assert len(rows) == 63954 and len(set(ids)) == len(ids), f"{len(rows)} rows, {len(set(ids))} unique"
    fams = collections.defaultdict(list)
    for r in rows:
        fams[r["family_id"]].append(r)
    haps = collections.Counter(r["hap"] for r in rows)
    assert len(fams) == 15040, f"{len(fams)} families"
    assert haps == {"HAP1": 32134, "HAP2": 31820}, dict(haps)

    # ---- one run: a family is never younger than a member, and is as old as its oldest ------
    young, origin_bad, size_bad = [], [], []
    for fid, members in fams.items():
        fr = {rk(m["family_rank"]) for m in members}
        assert len(fr) == 1, f"{fid}: members disagree on the family's rank"
        f_rank = fr.pop()
        ranked = [rk(m["gene_rank"]) for m in members if rk(m["gene_rank"]) is not None]
        young += [m["gene_id"] for m in members
                  if rk(m["gene_rank"]) is not None and f_rank > rk(m["gene_rank"])]
        if ranked and f_rank != min(ranked):
            origin_bad.append(fid)
        if any(int(m["family_size"]) != len(members) for m in members):
            size_bad.append(fid)
    assert not young, f"{len(young)} genes in a family younger than themselves, e.g. {young[:3]}"
    assert not origin_bad, f"{len(origin_bad)} families whose rank is not their oldest member's"
    assert not size_bad, f"{len(size_bad)} families whose family_size is not their row count"

    # ---- the same run as the pool ---------------------------------------------------------
    praw, _ = git_blob(root, commit, POOL, pin["tables"][POOL])
    pool = {r["gene_id"]: r for r in csv.DictReader(
        io.StringIO(gzip.decompress(praw).decode()), delimiter="\t")}
    off = [r["gene_id"] for r in rows
           if rk(r["gene_rank"]) is not None and rk(r["gene_rank"]) != rk(pool[r["gene_id"]]["rank"])]
    assert not off, f"{len(off)} genes whose gene_rank is not the pool call's rank, e.g. {off[:3]}"
    no_age = [r["gene_id"] for r in rows if rk(r["gene_rank"]) is None]
    no_family = sorted(set(pool) - set(ids))
    print(f"gates pass: {len(rows)} genes, {len(fams)} families, 0 younger-than-member, "
          f"gene_rank = pool rank on every ranked gene; no age {len(no_age)}, no family {len(no_family)}")

    buf = io.StringIO()
    w = csv.writer(buf, delimiter="\t", lineterminator="\n")
    w.writerow(KEEP)
    for r in sorted(rows, key=lambda r: r["gene_id"]):
        w.writerow([r[c] for c in KEEP])
    data = gzip.compress(buf.getvalue().encode(), mtime=0)
    with open(OUT, "wb") as fh:
        fh.write(data)

    prov = {
        "purpose": "Each gene's founder family (the family's origin stratum and size) from the "
                   "same genEra run as the LSG pool, the rerun that added Idesia. Replaces the "
                   "frozen 2026-04 run's families, which, joined to the rerun's gene ranks, made "
                   "a family look younger than its own member on 419 genes.",
        "tier": "public",
        "generated_by": "scripts/make_founder_source.py",
        "source": f"ChenHsieh/ms2-lsg {commit} : {SRC} (git blob {blob}, sha256 {sha})",
        "built_upstream_by": "the 'ms2 sapelo2' session, 2026-09-26, from absense_20260901/"
                             "hap{1,2}_idesia/pass2/80863_founder_events.tsv, beside the "
                             "80863_gene_ages.tsv that pipeline/s00b_lsg_pool_idesia.py reads. The "
                             "abSENSE-corrected (HDF) variants are deliberately not used, because "
                             "the pool reads the non-HDF ages.",
        "columns_dropped": {"gene": "the transcript name; gene_id is the join key",
                            "family_id": "the owner's hash of the member list; meaningless outside "
                                         "that file, so it must not look like a lookup identifier"},
        "gates": ["63,954 rows, gene_id unique, 15,040 families, 32,134 HAP1 + 31,820 HAP2",
                  "family_rank <= gene_rank on every ranked row, and equals the oldest member's rank",
                  "family_size equals the family's row count",
                  "gene_rank equals the pool call's rank (lsg_pool_idesia.tsv.gz) on every ranked gene"],
        "not_available": {"no_gene_age": len(no_age), "no_family": len(no_family),
                          "treatment": "the gene card says the family origin is not shown because the run gives the gene no rank (true of all 45; only 6 lack a family); "
                                       "nothing is filled in"},
        "read_this_before_writing_prose": "A pool gene (rank >= 18) can sit in a family that "
                                          "originates much earlier, down to cellular organisms: a "
                                          "diverged or newly added member of an old family. That is "
                                          "a different claim from a lineage-specific family, and "
                                          "the gene card says so on those genes.",
        "rows": len(rows),
        "shipped_sha256": hashlib.sha256(data).hexdigest(),
        "applied_by": "scripts/patch_founder_rerun.py (build stage)",
    }
    with open(PROV, "w") as fh:
        json.dump(prov, fh, indent=1)
        fh.write("\n")
    print(f"wrote {OUT}: {len(rows)} genes, {len(data) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
