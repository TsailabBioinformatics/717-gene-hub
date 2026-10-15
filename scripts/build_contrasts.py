#!/usr/bin/env python3
"""Reduce MS1's curated 191-contrast panel to a small index file for the expression
scrubber (locus-map plan section 2.3).

Not a new analysis: `data/50_v4_panel_20260814/v4_contrasts_20260814.csv` already names,
per contrast, which samples are the control arm and which are the perturbation arm.
This script's only job is to resolve those sample LABELS into their fixed positions in
`data/expr/samples.json`'s order, so the client can slice any gene's already-fetched raw
652-sample vector directly by index -- no per-gene, per-contrast table to ship or ingest.

A genuinely wrong path considered and rejected: `data/v7_supporting/
log2FC_per_gene_per_contrast_v4.csv` (225 MB) looks like exactly this, precomputed. It is
not the current contrast set -- checked, not assumed: 47 distinct contrast ids against a
different naming scheme (`control_500CO2_non-recovered`, underscores) versus the current
191-contrast panel's own scheme (`control,,_WT,_recovered`, commas). Predates the current
v4 panel by three months (file mtime May vs the panel's own August build). Not used here.
"""
import roots
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
MS1 = roots.root('onedrive_ms1')
CONTRASTS_CSV = f"{MS1}/data/50_v4_panel_20260814/v4_contrasts_20260814.csv"


def main():
    samples = json.load(open(os.path.join(DATA, "expr", "samples.json")))
    pos = {s["label"]: i for i, s in enumerate(samples)}

    rows = list(csv.DictReader(open(CONTRASTS_CSV)))
    out = []
    missing_labels = set()
    for r in rows:
        ctrl = [lab for lab in r["control_samples"].split(";") if lab]
        pert = [lab for lab in r["perturbation_samples"].split(";") if lab]
        missing_labels |= {lab for lab in ctrl + pert if lab not in pos}
        out.append({
            "id": r["contrast_id"], "kind": r["kind"], "tissue": r["tissue_analysis"],
            "control_label": r["control_desc"], "pert_label": r["perturbation_desc"],
            "recommended": r["recommended"] == "True",
            "ctrl": [pos[lab] for lab in ctrl if lab in pos],
            "pert": [pos[lab] for lab in pert if lab in pos],
        })
    assert not missing_labels, f"{len(missing_labels)} contrast sample labels not in samples.json: {list(missing_labels)[:5]}"
    assert len(out) == 191, f"expected 191 contrasts, got {len(out)}"

    out_path = os.path.join(DATA, "expr", "contrasts.json")
    with open(out_path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"wrote {len(out)} contrasts to {out_path} ({os.path.getsize(out_path)/1024:.1f} KB)")

    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    man["expression"]["n_contrasts"] = len(out)
    man["expression"]["n_contrasts_recommended"] = sum(1 for c in out if c["recommended"])
    parts = [int(x) for x in man["data_version"].split(".")]
    parts[-1] += 1
    man["data_version"] = ".".join(map(str, parts))
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print(f"manifest: data_version -> {man['data_version']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
