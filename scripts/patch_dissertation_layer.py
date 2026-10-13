#!/usr/bin/env python3
"""Bring the gene records and the genome-wide summaries in line with the dissertation.

Reads sources/dissertation_layer.tsv.gz (see make_dissertation_layer_source.py) and the shards.

On each gene record:
  x.p      tissue specificity as in the dissertation: {tau, top, ok, m, t{9 tissue groups}}.
           tau (truncated to 3 decimals) and top are absent where no tissue-group mean reaches
           5 TPM; ok = mean TPM over
           the 222-sample reference panel >= 5. The atlas's own x.tau / x.top stay beside it and
           are labelled as a different statistic on the page.
  ann.at, ann.atd   Arabidopsis best hit from the per-gene master table (lab annotation); a hit
           the record already had is kept only where the master table has none.
  ann.sym  gene names from the lab annotation.
  ps.fin   for the 1,611 lineage-specific candidates: {s final set, u phylostratum used,
           g genEra rank, r reason when excluded}.

In the manifest (all recomputed from the shards just written, never copied from a table):
  layers.dup_class_dist    duplication-class letters over all gene models
  dissertation             Table 2.1 per haplotype on quality-filtered genes, the class codes
                           behind it, anchor-pair totals, tissue-specific counts, the LSG set
  built                    stamped now

And data/index/alias.json: gene names and P. trichocarpa IDs -> positions in index/genes.json.

Run after patch_wgd_pairs.py, patch_syntelog_categories.py and patch_lsg_qc.py; run
build_facets.py afterwards.
"""
import csv, gzip, json, os, time
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
TISSUES = ["leaf_young", "leaf", "leaf_old", "xylem", "bark", "root", "stem", "bud", "catkin"]
HAPS = (("hap1", "HAP1"), ("hap2", "HAP2"))


def main():
    with gzip.open(os.path.join(ROOT, "sources", "dissertation_layer.tsv.gz"), "rt") as fh:
        src = {r["gene_id"]: r for r in csv.DictReader(fh, delimiter="\t")}
    order = json.load(open(os.path.join(DATA, "index", "genes.json")))
    pos = {g: i for i, g in enumerate(order)}
    assert set(src) == set(order), "source and gene index are not the same gene set"

    letters = Counter()
    by_hap = {H: Counter() for _, H in HAPS}
    t21 = {H: Counter() for _, H in HAPS}
    pairs = Counter()
    lsg = {H: Counter() for _, H in HAPS}
    lsg_reason = {H: Counter() for _, H in HAPS}
    tau = {H: Counter() for _, H in HAPS}
    qc_n = Counter()
    at_kept = 0
    names, potri, atl = defaultdict(set), defaultdict(set), defaultdict(set)

    for hap, H in HAPS:
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in sorted(fs):
                if not fn.endswith(".json"):
                    continue
                p = os.path.join(dp, fn)
                shard = json.load(open(p))
                for gid, rec in shard.items():
                    s = src[gid]
                    # --- expression, the dissertation's statistic ---------------------------
                    x = rec.get("x")
                    if x is not None:
                        pp = {"ok": int(s["tau_passes_filter"]),
                              "t": {k: float(s[f"mean_{k}"]) for k in TISSUES}}
                        if s["mean_tpm_222"] != "":
                            pp["m"] = float(s["mean_tpm_222"])
                        if s["tau"] != "":
                            # TRUNCATED to three decimals, never rounded: 0.8496 must not become
                            # 0.850 and pass the dissertation's tau >= 0.85 cutoff on the page.
                            pp["tau"] = int(float(s["tau"]) * 1000 + 1e-9) / 1000
                            pp["top"] = s["peak_tissue"]
                        x["p"] = pp
                    # --- annotation ----------------------------------------------------------
                    ann = rec.get("ann")
                    if ann is None:
                        ann = rec["ann"] = {}
                    if s["at_locus"]:
                        ann["at"] = s["at_locus"]
                        if s["at_desc"]:
                            ann["atd"] = s["at_desc"]
                        else:
                            ann.pop("atd", None)
                    elif ann.get("at"):
                        at_kept += 1
                    if ann.get("at"):
                        atl[ann["at"].lower()].add(pos[gid])
                    if s["names"]:
                        ann["sym"] = s["names"].split(";")
                        for nm in ann["sym"]:
                            names[nm.lower()].add(pos[gid])
                    else:
                        ann.pop("sym", None)
                    for pid in {(rec.get("ks") or {}).get("id"), (rec.get("ptri") or {}).get("id")}:
                        if pid:
                            potri[pid.lower()].add(pos[gid])
                    # --- final LSG set -------------------------------------------------------
                    ps = rec.get("ps") or {}
                    ps.pop("fin", None)
                    if s["lsg_candidate"] == "1":
                        assert ps.get("lsg") and ps.get("rank") == int(s["ps_genera"]), \
                            f"{gid}: the candidate table and the gene record disagree on genEra rank"
                        fin = {"s": int(s["lsg_final"]), "u": int(s["ps_used"]), "g": int(s["ps_genera"])}
                        if s["lsg_excluded_reason"]:
                            fin["r"] = s["lsg_excluded_reason"]
                            lsg_reason[H][fin["r"]] += 1
                        ps["fin"] = fin
                        lsg[H]["candidates"] += 1
                        lsg[H][f"candidates_PS{fin['u']}"] += 1
                        if fin["g"] != fin["u"]:
                            lsg[H]["reassigned_PS19_to_PS18"] += 1
                        if fin["s"]:
                            lsg[H]["final"] += 1
                            lsg[H][f"final_PS{fin['u']}"] += 1
                    else:
                        assert not ps.get("lsg"), f"{gid}: a pool gene is missing from the candidate table"
                    # --- summaries, from the record as it now stands ------------------------
                    dup = rec.get("dup") or {}
                    code = dup.get("t")
                    flagged = bool((rec.get("rel") or {}).get("qc"))
                    if code:
                        letters[code] += 1
                    if flagged:
                        qc_n[H] += 1
                    else:
                        t21[H]["quality_filtered_genes"] += 1
                        if code:
                            by_hap[H][code] += 1
                        t21[H]["sWGD"] += 1 if dup.get("s") else 0
                        t21[H]["aWGT"] += 1 if dup.get("a") else 0
                        t21[H]["tandem"] += 1 if dup.get("td") else 0
                        t21[H]["dispersed_only"] += 1 if code == "D" else 0
                        t21[H]["singleton"] += 1 if code == "C" else 0
                        t21[H]["sWGD_and_aWGT"] += 1 if dup.get("s") and dup.get("a") else 0
                        pp = (rec.get("x") or {}).get("p") or {}
                        if pp.get("ok"):
                            tau[H]["genes_at_mean_TPM_5_or_more"] += 1
                            if pp.get("tau") is not None and float(s["tau"]) >= 0.85:
                                tau[H]["tissue_specific"] += 1
                    for q in rec.get("wgd") or []:
                        pairs[(H, q["e"])] += 1
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)

    assert all(v % 2 == 0 for v in pairs.values())
    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    man.setdefault("layers", {})["dup_class_dist"] = dict(sorted(letters.items(), key=lambda kv: -kv[1]))
    prov = json.load(open(os.path.join(ROOT, "sources", "dissertation_layer.provenance.json")))
    man["dissertation"] = {
        "what": "Summaries recomputed from the gene records, on the dissertation's gene basis: "
                "quality-filtered gene models, each haplotype separately.",
        "table_2_1": {H: dict(t21[H]) for _, H in HAPS},
        "class_codes_quality_filtered": {H: dict(sorted(by_hap[H].items(), key=lambda kv: -kv[1]))
                                         for _, H in HAPS},
        "quality_flagged_gene_models": {H: qc_n[H] for _, H in HAPS},
        "wgd_anchor_pairs": {H: {"sWGD": pairs[(H, "S")] // 2, "aWGT": pairs[(H, "A")] // 2}
                             for _, H in HAPS},
        "tau": {"definition": prov["tau"]["definition"], "panel_n": prov["tau"]["panel_n"],
                "per_haplotype": {H: dict(tau[H]) for _, H in HAPS}},
        "lsg": {H: dict(lsg[H], excluded_by_first_criterion=dict(lsg_reason[H])) for _, H in HAPS},
        "arabidopsis_hit_kept_from_older_annotation": at_kept,
        "source_tables": prov["inputs"],
        "analysis_repository_commit": prov["analysis_repository_commit"],
    }
    man["built"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    json.dump(man, open(man_path, "w"), indent=1, sort_keys=True)

    alias = {"note": "lower-case gene name, P. trichocarpa ID or Arabidopsis locus -> positions in index/genes.json",
             "name": {k: sorted(v) for k, v in sorted(names.items())},
             "potri": {k: sorted(v) for k, v in sorted(potri.items())},
             "at": {k: sorted(v) for k, v in sorted(atl.items())}}
    with open(os.path.join(DATA, "index", "alias.json"), "w") as fh:
        json.dump(alias, fh, separators=(",", ":"))

    d = man["dissertation"]
    print(json.dumps({k: d[k] for k in ("table_2_1", "wgd_anchor_pairs", "quality_flagged_gene_models")}, indent=1))
    print("tau", d["tau"]["per_haplotype"]); print("lsg", d["lsg"])
    print(f"alias index: {len(names):,} names, {len(potri):,} P. trichocarpa IDs; "
          f"{at_kept:,} genes keep an older Arabidopsis hit")


if __name__ == "__main__":
    main()
