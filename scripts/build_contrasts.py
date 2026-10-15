#!/usr/bin/env python3
"""Reduce the dissertation's curated contrast set to a small index file for the study pages, the
Expression card's contrast view and the expression scrubber.

Not a new analysis: ms1-dup `data/60_curated_contrasts_20260915/curated_contrasts_652panel.csv`
names, per contrast, its reference and test samples. This script only resolves those sample LABELS
into their fixed positions in `data/expr/samples.json`, so the client can slice any gene's
already-fetched 652-sample vector by index.

Why this set and not the v4 191-contrast panel it replaced (2026-10-15): the dissertation computes
on the curated 165 (its 149 perturbation contrasts, categories 1-7, are the stress-responsiveness
set), and the v4 panel pooled developing and mature xylem into one arm in six study 2/3 contrasts
(ArrayExpress E-MTAB-7288 / E-MTAB-7587 keep the site as a separate factor; the curated set splits
them 4 vs 4). Shipping the set the numbers were computed on removes that mismatch.
"""
import roots
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CURATED = roots.path("ms1_dup", "data/60_curated_contrasts_20260915/curated_contrasts_652panel.csv")
RESP_CATEGORIES = {str(k) for k in range(1, 8)}          # the 149 perturbation contrasts


def tidy(v):
    return " ".join(v.replace("_", " ").split())


def main():
    samples = json.load(open(os.path.join(DATA, "expr", "samples.json")))
    pos = {s["label"]: i for i, s in enumerate(samples)}
    rows = list(csv.DictReader(open(CURATED)))
    out, missing = [], set()
    for r in rows:
        ctrl = [lab for lab in r["ref_samples"].split(";") if lab]
        pert = [lab for lab in r["test_samples"].split(";") if lab]
        missing |= {lab for lab in ctrl + pert if lab not in pos}
        cat_no, _, cat = r["category"].partition(" ")
        t_ref, t_test = tidy(r["tissue_ref"]), tidy(r["tissue_test"])
        out.append({
            "id": r["contrast_id"], "kind": cat, "sub": r["subcategory"], "tier": r["tier"],
            # a developmental contrast compares two tissues; every other one is within a tissue
            "tissue": t_test if t_ref == t_test else f"{t_ref} to {t_test}",
            "control_label": r["reference"], "pert_label": r["test"],
            # what both arms share (the factors held fixed), as the curated table states it
            "within": "; ".join(tidy(x.split("=", 1)[-1]) for x in r["blocking"].split(";") if x.strip()),
            "resp": cat_no in RESP_CATEGORIES,
            "ctrl": [pos[lab] for lab in ctrl if lab in pos],
            "pert": [pos[lab] for lab in pert if lab in pos],
        })
    assert not missing, f"{len(missing)} curated sample labels not in samples.json: {sorted(missing)[:5]}"
    assert len(out) == 165, f"expected the 165 curated contrasts, got {len(out)}"
    n_resp = sum(c["resp"] for c in out)
    assert n_resp == 149, f"expected 149 perturbation contrasts (categories 1-7), got {n_resp}"
    for c in out:
        assert c["ctrl"] and c["pert"], f"{c['id']}: an empty arm"
    # no arm may mix two sampling sites of one study (the defect this set replaces)
    def site(i):
        s = samples[i]
        return s["label"].split("_")[1] if s["study"] in (2, 3) else s.get("tissue_analysis")
    mixed = [c["id"] for c in out for arm in (c["ctrl"], c["pert"]) if len({site(i) for i in arm}) > 1]
    assert not mixed, f"arms that mix sampling sites: {mixed[:5]}"

    out_path = os.path.join(DATA, "expr", "contrasts.json")
    with open(out_path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"wrote {len(out)} contrasts ({n_resp} perturbation) to {out_path} "
          f"({os.path.getsize(out_path) / 1024:.1f} KB)")

    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    man["expression"]["n_contrasts"] = len(out)
    man["expression"].pop("n_contrasts_recommended", None)
    man["expression"]["n_contrasts_perturbation"] = n_resp
    man["expression"]["contrast_set"] = ("the dissertation's curated contrast set (ms1-dup "
                                         "data/60_curated_contrasts_20260915), 165 contrasts")
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
