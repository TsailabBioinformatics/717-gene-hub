#!/usr/bin/env python3
"""Per-gene QC flags on every gene of the LSG pool: abSENSE and the synteny window search.

RULING (Chen, 2026-09-21 evening, reconfirmed 2026-09-26; ms2-lsg docs/CORRECTIONS.md C5): the
pool is the rerun that added Idesia, 776 HAP1 + 835 HAP2, and "only AbSENSE and synteny check are
the QC steps". A flag never changes the pool. Two flags, as ms2-lsg's own
pipeline/out/lsg_pool_flags_newpool.tsv (s00c) defines them:
  abs   abSENSE rejects the young call: the absence is plausibly a detection failure
        (84 HAP1 + 106 HAP2)
  ret   the syntenic-window search (tblastn) finds a strong hit inside an annotated gene of an
        outgroup (96 HAP1 + 104 HAP2)
  post  neither flag: the chapter's post-QC set, used for its group comparisons (602 + 635)
check_ms2_canon.py compares all three with that table, gene by gene.

WHAT C5 REMOVED, and why each is gone rather than renamed:
  rr    "falls below rank 18 in the Idesia rerun" was a flag only while the frozen call was the
        pool (C4). The rerun IS the pool now, so the 114 genes it described are not pool genes
        and carry no QC record; their gene page says they left the pool, from ps.frz.
  wgd   whole-genome duplication is no longer a QC flag (C5). Duplication is its own analysis on
        MS1's classification, which the Duplication card already shows.

KEPT AS OTHER EVIDENCE, not QC flags: the synteny-contest routes (syn_og, syn_twin, syn_any, from
ms2-lsg lsg_pool_synteny.tsv, which C5 names as part of the synteny checks but s00c keeps out of
`unflagged`), the short-ORF class (short, plen) and DIAMOND-sensitivity stability (stable). The
card lists them under the flags and never folds them into `post`.

Constraints, checked here rather than trusted:
  1. Flags, not filters. The pool is set by patch_lsg_pool.py; this adds `qc` to exactly the
     genes it put in the pool, and asserts every pool gene has a source row.
  2. abSENSE fields are copied as-is (hdf flag, verdict string), never re-derived into a yes/no
     "is this gene old" claim; the card renders the flag names, and the calibration travels in
     manifest.lsg_qc.
"""
import csv
import gzip
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SRC = os.path.join(ROOT, "sources", "lsg_qc_flags.tsv.gz")

# The atlas DERIVES the post-QC set from the two flags and checks it against ms2-lsg
# (check_ms2_canon.py). A second copy arriving in the flag source could disagree with the
# derivation silently, so the source must not carry one.
FORBIDDEN_COLUMNS = {"qc_survivor", "in_idesia_corrected_pool", "canonical_label", "group"}
WANT = {"pool": {"HAP1": 776, "HAP2": 835}, "abs": {"HAP1": 84, "HAP2": 106},
        "ret": {"HAP1": 96, "HAP2": 104}, "both": {"HAP1": 6, "HAP2": 10},
        "post": {"HAP1": 602, "HAP2": 635}}


def tf(v):
    return v.strip().lower() == "true"


def main():
    with gzip.open(SRC, "rt") as fh:
        rows = list(csv.DictReader(io.StringIO(fh.read()), delimiter="\t"))
    forbidden_present = FORBIDDEN_COLUMNS & set(rows[0])
    assert not forbidden_present, f"forbidden column(s) present in the source file: {forbidden_present}"
    print(f"source: {len(rows)} rows (cut for the frozen 842/883 pool), header clean of "
          f"{sorted(FORBIDDEN_COLUMNS)}")

    # The source has one row per gene of the FROZEN pool, a superset of the current one. Rows for
    # the 114 genes that left are read and not shipped.
    src = {}
    for r in rows:
        ret, ab = tf(r["tblastn_retract"]), tf(r["absense_reject"])
        src[r["gene_id"]] = (r["hap"], {
            "ret": ret,
            "abs": ab,
            "post": not ret and not ab,
            "hdf": r["absense_hdf_flag"],
            "verdict": r["absense_verdict"],
            "syn_og": r["synteny_og_contested"] == "1",
            "syn_twin": r["synteny_twin_contested"] == "1",
            "syn_any": r["synteny_contested_any"] == "1",
            "plen": int(r["protein_len"]) if r["protein_len"] else None,
            "short": r["protein_len_lt100"] == "1",
            "stable": tf(r["sens_stable"]),
        })

    qc, hap_of, missing = {}, {}, []
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in fs:
                if not fn.endswith(".json"):
                    continue
                p = os.path.join(dp, fn)
                shard = json.load(open(p))
                for gid, rec in shard.items():
                    if not (rec.get("ps") or {}).get("lsg"):
                        rec.pop("qc", None)             # not a pool gene: no young-age claim
                        continue
                    if gid not in src:
                        missing.append(gid)             # a pool gene with no flag row
                        continue
                    hap_of[gid], rec["qc"] = src[gid][0], src[gid][1]
                    qc[gid] = rec["qc"]
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    assert not missing, (f"{len(missing)} pool genes have no flag row, e.g. {missing[:5]}. "
                         "Run patch_lsg_pool.py first; the pool is set there.")

    by = lambda test: {h: sum(1 for g in qc if hap_of[g] == h and test(qc[g])) for h in ("HAP1", "HAP2")}
    got = {"pool": by(lambda q: True), "abs": by(lambda q: q["abs"]), "ret": by(lambda q: q["ret"]),
           "both": by(lambda q: q["abs"] and q["ret"]), "post": by(lambda q: q["post"])}
    assert got == WANT, f"counts {got}, expected {WANT}"
    print(f"flags on all {len(qc)} pool genes; per haplotype {got}")
    print(f"source rows not shipped (genes that left the pool): {len(src) - len(qc)}")

    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    # The calibration is a recorded measurement, committed as a source (it used to live only in the previous
    # manifest, which a full rebuild rewrites before this stage runs).
    calibration = json.load(open(os.path.join(ROOT, "sources", "absense_calibration.json")))["absense_calibration"]
    assert calibration, "sources/absense_calibration.json has no calibration; it must travel with the flag"
    # Its last line named "the Idesia-rerun flag", which C5 removed; the measurement is unchanged.
    calibration["not_retracted"] = (
        "Nothing in the QC layer is withdrawn by this, and the pool does not rest on abSENSE: it "
        "comes from genEra ranks. What is qualified is the per-gene abSENSE flag and any "
        "statement resting on it.")
    man["lsg_qc"] = {
        "pool_genes": len(qc),
        "per_haplotype": {
            "pool": got["pool"],
            "absense_reject": got["abs"],
            "synteny_window_search": got["ret"],
            "both_flags": got["both"],
            "in_the_chapter_post_qc_set": got["post"],
            "other_evidence_not_qc_flags": {
                "synteny_contested_any": by(lambda q: q["syn_any"]),
                "short_orf": by(lambda q: q["short"]),
                "diamond_sensitivity_unstable": by(lambda q: not q["stable"]),
            },
        },
        "note": "Flags, not filters. Every one of the 1,611 pool genes carries its flags; nothing "
                "here removes, renumbers or filters a gene. Two QC checks (Chen, 2026-09-21 "
                "evening; ms2-lsg CORRECTIONS C5): abSENSE and the synteny window search. The "
                "chapter's post-QC set is the genes with neither flag, used for its group "
                "comparisons; on a gene page it is one line under the flags. WGD-era Ks is no "
                "longer a QC flag. Counts are pass or flag counts, never a pool.",
        "absense_calibration": calibration,
    }
    # NOTE: no data_version bump here. VERSION is the single source of truth and build_facets.py
    # stamps the manifest from it (see check_version.py).
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print(f"manifest lsg_qc: {man['lsg_qc']['per_haplotype']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
