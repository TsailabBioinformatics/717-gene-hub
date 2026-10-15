#!/usr/bin/env python3
"""TODO 21: move the duplication call from v8 to v9, and add the PAV layer that never
shipped (both files are already in the ms1-dup mirror, under names the atlas never
searched for -- see docs/DATA_AUDIT.md for the earlier "not in the mirror" claim this
corrects).

Two independent patches to every shipped shard, both local joins, no Sapelo2 needed:

1. DUPLICATION CLASS: v8 membership -> v9. v6 (the file the TODO literally named) is
   itself superseded by v9, which carries the adopted WGD rule 5c + 178-conflict dS
   recompute and the current TD union set -- going to v6 would import an already-stale
   table. v9 keeps the same letter scheme (A/S/T/D/C, concatenated), so the consuming JS
   needs no change, only the source values do.

2. PAV / hemizygosity: genuinely new, not a swap. `hemi_pav_crosstab.csv` (the previous
   candidate) is the OrthoFinder call, forbidden by ms1-dup's own CLAUDE.md (2,075/1,942,
   the wrong family). `hemizygous_pav_diamond.csv` is the canonical DIAMOND-based
   `tier1_floor` call (805/859 confirmed here from the file itself, matching the number
   both this project and ms1-dup already cite), and it was never wired in because the
   earlier audit did not know it existed under this name. Scope is 6,092 candidate
   hemizygous genes, not genome-wide -- genes outside that candidate set get no `pav` key
   at all, matching this site's existing convention for coverage-limited layers.
"""
import roots
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
MS1 = roots.root('onedrive_ms1')
V9_CSV = f"{MS1}/data/55_master_v9_20260902/master_duplication_table_v9.csv"
PAV_CSV = f"{MS1}/data/02_synteny_section/hemizygous_pav_diamond.csv"


def tf(v):
    return 1 if str(v).strip().lower() == "true" else 0


def num(v):
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def main():
    # -- 1. load v9 duplication letters, one row per gene, all 63,960 -------------------
    dup_v9 = {}
    with open(V9_CSV) as fh:
        for r in csv.DictReader(fh):
            dup_v9[r["gene_id"]] = {
                "t": r["dup_type_v9"], "s": tf(r["has_S_v9"]), "a": tf(r["has_A_v9"]),
                "td": tf(r["has_T_union"]), "d": tf(r["has_D_v6"]),
            }
    print(f"v9 duplication table: {len(dup_v9)} genes")

    # -- 2. load the PAV candidate set, one row per (gene, hap), 6,092 rows -------------
    pav = {}
    with open(PAV_CSV) as fh:
        for r in csv.DictReader(fh):
            pav[r["gene_id"]] = {
                "rel": r["relationship"],
                "confirmed": r["is_pav_diamond"] == "True",
                "nhits": int(r["n_diamond_hits_partner_hap"]),
                "target": r["best_target_partner_hap"] or None,
                "pident": num(r["best_pident"]),
                "evalue": r["best_evalue"] or None,
            }
    n_confirmed = sum(1 for v in pav.values() if v["confirmed"])
    print(f"PAV candidate set: {len(pav)} genes, {n_confirmed} DIAMOND-confirmed")

    # -- 3. walk every shard once, patch both fields together ---------------------------
    genes_dir = os.path.join(DATA, "genes")
    dup_before, dup_changed, pav_added, no_v9 = 0, 0, 0, []
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(os.path.join(genes_dir, hap)):
            for fn in fs:
                if not fn.endswith(".json"):
                    continue
                p = os.path.join(dp, fn)
                shard = json.load(open(p))
                changed = False
                for gid, rec in shard.items():
                    if gid in dup_v9:
                        dup_before += 1
                        new = dup_v9[gid]
                        if rec.get("dup") != new:
                            dup_changed += 1
                        rec["dup"] = new
                        changed = True
                    else:
                        no_v9.append(gid)
                    if gid in pav:
                        rec["pav"] = pav[gid]
                        pav_added += 1
                        changed = True
                if changed:
                    with open(p, "w") as fh:
                        json.dump(shard, fh, separators=(",", ":"), sort_keys=True)

    assert not no_v9, f"{len(no_v9)} atlas genes have no v9 row: {no_v9[:5]}"
    print(f"duplication: {dup_before} genes patched, {dup_changed} changed class vs the old v8 source")
    print(f"PAV: {pav_added} genes patched with a pav record")

    # -- 4. manifest + provenance --------------------------------------------------------
    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    man["duplication"]["source"] = "master_duplication_table_v9.csv (rule 5c + 178-conflict " \
        "WGD resolution, TD union set) -- supersedes dupclass_membership_v8.csv"
    man.setdefault("pav", {})
    man["pav"] = {
        "candidate_genes": len(pav), "confirmed_pav": n_confirmed,
        "confirmed_hap1": sum(1 for g, v in pav.items() if v["confirmed"] and g.startswith("PtXaTreH")),
        "confirmed_hap2": sum(1 for g, v in pav.items() if v["confirmed"] and g.startswith("PtXaAlbH")),
        "source": "hemizygous_pav_diamond.csv (canonical DIAMOND-based tier1_floor call)",
    }
    parts = [int(x) for x in man["data_version"].split(".")]
    parts[-1] += 1
    man["data_version"] = ".".join(map(str, parts))
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print(f"manifest: data_version -> {man['data_version']}")
    print(f"PAV confirmed: HAP1 {man['pav']['confirmed_hap1']}, HAP2 {man['pav']['confirmed_hap2']}")

    prov = {
        "purpose": "Two independent corrections to the duplication module (TODO 21). "
                   "(1) duplication class moved from the v8 membership file to the current "
                   "v9 table -- v6, the file TODO 21 literally named, is itself superseded "
                   "by v9 and was not used. (2) a PAV/hemizygosity layer added for the "
                   "first time; the previous candidate (hemi_pav_crosstab.csv) is the "
                   "OrthoFinder-based call, which ms1-dup's own CLAUDE.md forbids.",
        "tier": "public",
        "duplication": {
            "source_file": V9_CSV,
            "letter_scheme_unchanged": "A/S/T/D/C, concatenated -- identical to v8, so the "
                                       "consuming JS needed no change, only the values did",
            "genes_changed_vs_v8_source": dup_changed,
        },
        "pav": {
            "source_file": PAV_CSV,
            "scope": "6,092 candidate hemizygous genes (from an asymmetric HAP1/HAP2 "
                    "orthogroup), NOT genome-wide -- a gene outside this candidate set gets "
                    "no `pav` key at all, same convention as ESMFold's 64% coverage.",
            "fields": "rel = which haplotype the candidate orthogroup relationship names as "
                     "absent; confirmed = the DIAMOND verdict (true PAV vs a real hit the "
                     "candidate call missed); nhits/target/pident/evalue = the contradicting "
                     "hit's own evidence when confirmed is false.",
            "confirmed_totals": {"hap1": 805, "hap2": 859},
        },
    }
    with open(os.path.join(ROOT, "sources", "dup_v9_and_pav.provenance.json"), "w") as fh:
        json.dump(prov, fh, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
