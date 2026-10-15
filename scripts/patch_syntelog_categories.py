#!/usr/bin/env python3
"""Duplication classes, allele partners, strict PAV and the syntelog relationship categories,
all from ms1-dup's current per-gene master table and its tandem-array status table.

Replaces patch_dup_v9_and_pav.py (kept as a historical, non-stage script). That stage read two
files from the OneDrive tree; this one reads ms1-dup through git at a PINNED commit and checks
each file's sha256, so it runs on any machine with an ms1-dup clone and cannot be fed a stale
checkout. Nothing from those tables is vendored here: this repo's root is public and the master
table carries columns that are held off the site (candidate gene names). Only the columns below
are read; `genes_of_interest` is never touched.

Per gene (every shard record):
  dup     {t, s, a, td, d}  class letters and the WGD / tandem / dispersed flags
  allele  {id, ks, ka, w}   the syntelog partner; divergence from the syntelog yn00 table, or for
                            pairs that table lacks, from sources/allele_ks_added.tsv.gz (computed
                            on Sapelo2 by the same MAFFT + yn00 method). null when no partner.
  pav     {strict: 1}       only on the strict PAV set; the old DIAMOND candidate record is
                            removed, so nothing on the site can show the superseded call.
  rel     {c, d, u, ut, n1, n2, g, qc}  relationship category code, detail, unit, group copy
                            counts; c is null for genes outside the quality-filtered universe.
Arrays: data/index/array_status.json, one record per counted tandem array.
Then route C's disagreement mark (dup.ccd) is recomputed against the new letters by the next
stage (patch_wgd_combined_call.py), and the genome map's tile/index copies of the class letters
and allele id are resynced by patch_map_overlays.py.

GATES (refuses to write on any failure): sha256 of every input; every atlas gene has exactly one
row; per-haplotype category counts equal the owning analysis's own count table; strict PAV
528 / 605 genes; array status counts equal its status_by_hap table; every partner pair has a
divergence row or is declared missing; tandem membership unchanged from the shipped shards.
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
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PIN = os.path.join(ROOT, "sources", "syntelog_categories.pin.json")
KS_ADDED = os.path.join(ROOT, "sources", "allele_ks_added.tsv.gz")


def ms1_repo():
    for p in (os.environ.get("MS1_DUP_REPO"), os.path.join(os.path.dirname(ROOT), "ms1-dup"),
              roots.root('ms1_dup'), os.path.expanduser(roots.root('ms1_dup'))):
        if p and os.path.exists(os.path.join(p, ".git")):  # a worktree has a .git FILE
            return p
    raise SystemExit("REFUSING: no ms1-dup git clone found (set MS1_DUP_REPO)")


def pinned(repo, commit, path, sha):
    b = subprocess.run(["git", "-C", repo, "show", f"{commit}:{path}"], capture_output=True, check=True).stdout
    got = hashlib.sha256(b).hexdigest()
    if got != sha:
        raise SystemExit(f"REFUSING: {path} sha256 {got[:12]} != pinned {sha[:12]}")
    return b.decode()


T = lambda v: str(v).strip() == "True"


def num(v):
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


def main():
    pin = json.load(open(PIN))
    repo = ms1_repo()
    subprocess.run(["git", "-C", repo, "fetch", "-q", "origin"], check=False)
    F = {k: pinned(repo, pin["ms1_dup_commit"], v["path"], v["sha256"]) for k, v in pin["files"].items()}
    master = list(csv.DictReader(io.StringIO(F["per_gene"])))
    status = list(csv.DictReader(io.StringIO(F["array_status"])))
    cat_counts = list(csv.DictReader(io.StringIO(F["category_counts"])))
    status_counts = list(csv.DictReader(io.StringIO(F["status_by_hap"])))
    syn_ks = csv.DictReader(io.StringIO(F["syntelog_ks"]))
    M = {r["gene_id"]: r for r in master}
    print(f"per-gene table: {len(M)} genes")

    # -- divergence for every partner pair ----------------------------------------------
    KS = {}
    for r in syn_ks:
        ks, ka, w = num(r["yn_ks"]), num(r["yn_ka"]), num(r["yn_omega"])
        if ks is None and ka is None:
            continue                      # the two debris rows ks_lookup also drops
        KS[frozenset((r["gene_id_1"], r["gene_id_2"]))] = (ks, ka, w)
    # ms1-dup's append-only cache of pairs computed by ks_lookup.py (same method)
    for r in csv.DictReader(io.StringIO(F["ks_cache"])):
        ks, ka = num(r["ks"]), num(r["ka"])
        KS.setdefault(frozenset((r["gene_id_1"], r["gene_id_2"])),
                      (ks, ka, ka / ks if ks and ka is not None else None))
    n_from_table = len(KS)
    if os.path.exists(KS_ADDED):
        with gzip.open(KS_ADDED, "rt") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                ks, ka = num(r["ks"]), num(r["ka"])
                KS.setdefault(frozenset((r["gene_id_1"], r["gene_id_2"])),
                              (ks, ka, ka / ks if ks and ka is not None else None))
    print(f"divergence: {n_from_table} syntelog-table pairs + {len(KS) - n_from_table} computed here")

    # -- gates on the inputs themselves ---------------------------------------------------
    got = Counter((r["hap"], r["cj_category"]) for r in master if r["cj_category"])
    want = {(r["hap"], r["label"]): int(r["genes"]) for r in cat_counts if r["level"] == "category"}
    bad = {k: (got.get(k), v) for k, v in want.items() if got.get(k) != v}
    if bad:
        raise SystemExit(f"REFUSING: category counts differ from the owning table: {bad}")
    if (got[("HAP1", "hemizygous_strict_PAV")], got[("HAP2", "hemizygous_strict_PAV")]) != (528, 605):
        raise SystemExit("REFUSING: strict PAV is not 528 / 605")
    s_got = Counter((r["hap"], r["status_key"]) for r in status)
    s_want = {(r["hap"], r["status_key"]): int(r["n_arrays"]) for r in status_counts
              if ":" not in r["status_key"] and int(r["n_arrays"])}
    bad = {k: (s_got.get(k), v) for k, v in s_want.items() if s_got.get(k) != v}
    if bad or sum(s_got.values()) != sum(s_want.values()):
        raise SystemExit(f"REFUSING: array status counts differ from status_by_hap: {bad}")

    # -- patch every shard ------------------------------------------------------------------
    seen, changed_dup, changed_allele, no_ks, td_moved = set(), 0, 0, [], []
    pending = {}                      # nothing is written until every gate below has passed
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in sorted(fs):
                if not fn.endswith(".json"):
                    continue
                p = os.path.join(dp, fn)
                shard = json.load(open(p))
                for gid, rec in shard.items():
                    r = M.get(gid)
                    if r is None:
                        raise SystemExit(f"REFUSING: {gid} has no row in the per-gene table")
                    seen.add(gid)
                    old = rec.get("dup") or {}
                    if bool(old.get("td")) != T(r["has_T_gene"]):
                        td_moved.append(gid)
                    new = {"t": r["dup_type_v10"], "s": int(T(r["has_S_anchor"])),
                           "a": int(T(r["has_A_anchor"])), "td": int(T(r["has_T_gene"])),
                           "d": int(T(r["has_D"]))}
                    for k in ("cc", "ccd"):          # route C call: kept, its mark is recomputed next
                        if k in old:
                            new[k] = old[k]
                    if any(old.get(k) != new[k] for k in ("t", "s", "a", "td", "d")):
                        changed_dup += 1
                    rec["dup"] = new
                    pid = r["syntelog_partner_gene_id"] or None
                    if pid:
                        key = frozenset((gid, pid))
                        if key not in KS:
                            no_ks.append(gid)
                        ks, ka, w = KS.get(key, (None, None, None))
                        al = {"id": pid, "ks": None if ks is None else round(ks, 4),
                              "ka": None if ka is None else round(ka, 4),
                              # yn00 writes omega 99 when dS is ~0 ("cannot estimate"); never ship it
                              "w": None if w is None or w >= 99 else round(w, 4)}
                        if al["ks"] == 0:
                            al["ks0"] = True     # identical at synonymous sites; the card says so
                            al["w"] = None
                    else:
                        al = None
                    if (rec.get("allele") or {}).get("id") != pid:
                        changed_allele += 1
                    rec["allele"] = al
                    rec.pop("pav", None)
                    if r["cj_category"] == "hemizygous_strict_PAV":
                        rec["pav"] = {"strict": 1}
                    rec["rel"] = {
                        "c": r["cj_category"] or None, "d": r["cj_detail"] or None,
                        "u": r["cj_unit_id"] or None, "ut": r["cj_unit_type"] or None,
                        "g": r["cj_group_id"] or None,
                        "n1": int(r["cj_group_n_hap1"]) if r["cj_group_n_hap1"] else None,
                        "n2": int(r["cj_group_n_hap2"]) if r["cj_group_n_hap2"] else None,
                        "qc": int(T(r["qc_questionable"])),
                    }
                pending[p] = shard

    if len(seen) != len(M):
        raise SystemExit(f"REFUSING: {len(M) - len(seen)} table genes are not in the atlas")
    if td_moved:
        raise SystemExit(f"REFUSING: tandem membership moved for {len(td_moved)} genes, e.g. {td_moved[:3]}")
    if no_ks:
        raise SystemExit(f"REFUSING: {len(no_ks)} partner pairs have no divergence row, e.g. {no_ks[:3]} "
                         "(compute them into sources/allele_ks_added.tsv.gz first)")
    for p, shard in pending.items():
        with open(p, "w") as fh:
            json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    print(f"duplication: {changed_dup} genes changed class letters or flags")
    print(f"alleles: {changed_allele} genes changed partner (gained, lost or different)")

    # -- one record per counted tandem array --------------------------------------------
    arrays = {}
    for r in status:
        arrays[r["array_id"]] = {
            "k": r["status_key"], "dt": r["status_detail"] or None,
            "n1": int(r["group_n_hap1"]), "n2": int(r["group_n_hap2"]),
            "o": [x for x in (r["other_hap_td_array_ids"] or "").split(";") if x],
            "og": [x for x in (r["other_hap_genes_in_group"] or "").split(";") if x],
            "g": r["cj_group_id"],
        }
    with open(os.path.join(DATA, "index", "array_status.json"), "w") as fh:
        json.dump(arrays, fh, separators=(",", ":"), sort_keys=True)
    print(f"array status: {len(arrays)} arrays")

    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    man["duplication"]["source"] = (f"ms1-dup {pin['ms1_dup_commit'][:7]} "
                                    f"{pin['files']['per_gene']['path']} (dup_type_v10 and anchors)")
    # the home page's "allele pairs" tile reads this; the stage that changes alleles owns it
    man.setdefault("annotation", {})["n_allele"] = sum(
        1 for sh in pending.values() for rec in sh.values() if rec.get("allele"))
    # build_layers.py still loads the DIAMOND candidate PAV layer that this stage supersedes; drop its manifest
    # coverage so the manifest describes the records actually shipped (no gene carries the DIAMOND record).
    (man.get("layers") or {}).get("coverage", {}).pop("PAV / hemizygosity (DIAMOND tier1_floor, candidate set only)", None)
    (man.get("layers") or {}).get("applied", {}).pop("pav", None)
    man["pav"] = {"strict_hap1": 528, "strict_hap2": 605,
                  "source": f"ms1-dup {pin['ms1_dup_commit'][:7]} per-gene table, strict protein-level set"}
    man["relationship"] = {
        "counts": {f"{h}|{c}": n for (h, c), n in sorted(got.items())},
        "unclassified": dict(Counter(r["hap"] for r in master if not r["cj_category"])),
        "array_status": {f"{h}|{k}": n for (h, k), n in sorted(s_got.items())},
        "source": f"ms1-dup {pin['ms1_dup_commit'][:7]}",
    }
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
