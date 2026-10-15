#!/usr/bin/env python3
"""
Builds data/index/facets.json -- one compact row per gene, in the SAME ORDER as
index/genes.json, holding every field the browse view can filter or sort on.

Why a separate index at all: filtering 63,960 genes by "PS >= 18 and private and tau >= 0.8"
would otherwise mean fetching all 39 gene shards (39 MB) and 257 expression buckets (208 MB).
The facet index is ~2 MB raw / ~500 KB gzipped and is the only thing browse loads.

Encoding is positional, with the vocabularies inlined, so the file stays small and needs no
schema knowledge on the client beyond `cols`.

PATCHER ORDER: runs LAST -- it reads fields written by all three earlier builds.
"""
import json, os, sys
from collections import Counter

ATLAS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# TODO 7e: "expressed in tissue Y" needs a per-tissue value, and the index carried only tau
# and the single peak tissue. Ten booleans per gene is one 10-bit integer, 0.26 MB raw over
# 63,960 genes, rather than ten columns. The ORDER lives in the file's own vocab so the
# client never hardcodes it and the two cannot drift.
#
# THE THRESHOLD IS DECLARED, NOT BURIED: median TPM > 1 across the WT-control baseline -- the
# same ">1" convention the chromatin layer already uses for "expressed in leaf". It is shown
# in the filter's own label so nobody reads "expressed" as an absolute claim.
XIN_TISSUES = ['leaf_young', 'leaf', 'leaf_old', 'xylem', 'bark', 'root', 'stem', 'bud', 'catkin', 'callus']
XIN_MIN_TPM = 1.0

def main():
    data = os.path.join(ATLAS, "data")
    order = json.load(open(f"{data}/index/genes.json"))

    recs = {}
    for hap in ("hap1", "hap2"):
        root = f"{data}/genes/{hap}"
        for dp, _, fs in os.walk(root):      # shards are nested since the bucketed split
            for fn in sorted(fs):
                if not fn.endswith(".json"):
                    continue
                for gid, r in json.load(open(os.path.join(dp, fn))).items():
                    recs[gid] = (hap, r)
    assert len(recs) == len(order), f"{len(recs)} genes vs {len(order)} in genes.json"

    chrs, clss, tops, dups = [], [], [], []
    # declared order (js/core/relationship.js CATEGORY_ORDER), not first-seen order
    rels = ["1:1", "N:N_TD", "N:N_nonTD", "CNV_TD", "CNV_nonTD", "hemizygous_strict_PAV",
            "hemizygous_TD_array", "hemizygous_nonPAV"]
    def idx(vocab, v):
        if v is None:
            return -1
        if v not in vocab:
            vocab.append(v)
        return vocab.index(v)

    rows = []
    for gid in order:
        hap, r = recs[gid]
        syn = r.get("syn") or {}
        ps = r.get("ps") or {}
        x = r.get("x") or {}
        xp = x.get("p") or {}
        ann = r.get("ann") or {}
        flags = syn.get("flags") or {}
        ks = r.get("ks") or {}
        ms = (r.get("prot") or {}).get("ms") or {}
        dup = r.get("dup") or {}
        kar = r.get("aek") or {}
        rows.append([
            0 if hap == "hap1" else 1,
            idx(chrs, r.get("chr")),
            idx(clss, syn.get("cls")),
            # The phylostratum USED in the dissertation: genEra's rank, except for the PS19
            # candidates reassigned to PS18 (ps.fin.u). genEra's own rank is the `psg` column.
            ((ps.get("fin") or {}).get("u") or ps.get("rank")) if ps.get("rank") is not None else -1,
            # tau AS IN THE DISSERTATION (x.p: 222-sample reference panel, tissue-group means),
            # integer per-mille, truncated so that ">= 0.85" here is ">= 0.85" on the source value.
            # -1 = not computed (no tissue-group mean reaches 5 TPM). The atlas's own WT-control
            # tau (x.tau) is not in this index at all, so Browse cannot mix the two.
            int(xp["tau"] * 1000 + 1e-6) if xp.get("tau") is not None else -1,
            idx(tops, xp.get("top")),
            1 if r.get("allele") else 0,
            1 if ann.get("at") else 0,
            # WGD events, non-exclusive: bit 0 salicoid, bit 1 gamma. A gene can carry both
            # (and tandem/dispersed besides). TWO columns, because two calls exist and a
            # reader comparing Browse against a figure needs to know which one they are on:
            #   wgd  = the route C combined Ks + topology call -- what the CURRENT class
            #          figures are drawn from, so Browse matches the Venn a reader is holding.
            #   wgd9 = the canonical master v9 letters, kept selectable so the published
            #          v8/v9 numbers stay reproducible here.
            # Route C covers exactly the 32,170 genes that carry a v9 call and adds none, so
            # nothing is lost by leading with it except the 142 genes it deliberately sets
            # aside on split-evidence pairs.
            # (since 0.18.0 both columns hold the ADOPTED call, the one the dissertation uses;
            # `wgd` is kept only so that older links with ?wgd= keep working.)
            (1 if dup.get("s") else 0) | (2 if dup.get("a") else 0),
            (1 if dup.get("s") else 0) | (2 if dup.get("a") else 0),
            # Does the route C re-adjudication DISAGREE with the canonical v9 call for this
            # gene? Browsable rather than footnoted: the disagreement is currently visible
            # only by opening one gene page at a time, and "which 904 genes moved" is the
            # question anyone auditing the correction actually has. Not derivable from the
            # two wgd columns -- a gene carrying both events under both calls matches
            # "salicoid AND gamma" without disagreeing about anything.
            1 if dup.get("ccd") else 0,
            # THE CURATED UNION TANDEM SET (dup.td), not syn.flags.ar. `ar` is GENESPACE's
            # tandem PLACEMENT and covers 6,804 genes against the canonical 13,048: 6,865
            # curated members are not flagged `ar` and 621 `ar` genes are not curated members.
            # Browsing on `ar` made every tandem count disagree with the Venn, the Duplication
            # card and this repo's own canonical assertion -- selecting tandem + both WGDs
            # returned 103 where the canonical intersection is 385. The GENESPACE placement is
            # still reachable: it is the `tandem_array_member` option of the Synteny class filter.
            1 if dup.get("td") else 0,
            # 0 is a REAL value here (OrthoFinder assigned no orthogroup), not missing data.
            # `or -1` collapsed it to null and the browse table showed those genes as "—".
            len(r.get("pres") or []),
            1 if ps.get("amb") else 0,
            sum(1 << i for i, t in enumerate(XIN_TISSUES)
                if (x.get("t") or {}).get(t) is not None
                and (x["t"][t] or 0) > XIN_MIN_TPM),
            # omega vs P. trichocarpa, as an integer per-mille so the JSON stays short.
            # -1 means "no reciprocal-best ortholog", which is a real state, not missing data:
            # a hybrid-only gene has nothing to measure against. -2 means a pair exists but
            # omega could not be estimated (Ks of 0).
            (-1 if ks.get("no") else
             (int(round(ks["w"] * 1000)) if ks.get("w") is not None else -2)),
            # datasets (of 5) in which a peptide from this gene was identified at 1% FDR
            (ms.get("n") if ms.get("n") is not None else -1),
            # ancestral karyotype (route C, exploratory) as one integer: chromosome*100 +
            # gamma copy*10 + salicoid copy, a 0 digit where no copy was assigned, -1 = not placed.
            # Copy numbers are ranks WITHIN one ancestral chromosome, so they are never split out.
            (kar["c"] * 100 + kar.get("g", 0) * 10 + kar.get("s", 0) if kar.get("c") else -1),
            # relationship category (index into vocab.rel), -1 for quality-flagged gene models
            idx(rels, (r.get("rel") or {}).get("c")) if (r.get("rel") or {}).get("c") else -1,
            # duplication class letters (index into vocab.dup)
            idx(dups, dup.get("t")),
            # lineage-specific genes: 1 = in the final set, 2 = candidate excluded from it, 0 = neither
            (1 if (ps.get("fin") or {}).get("s") else 2) if ps.get("fin") else 0,
            # gene model flagged by quality control (not in the dissertation's counts)
            1 if (r.get("rel") or {}).get("qc") else 0,
            # mean TPM over the 222-sample reference panel >= 5 (the dissertation's expression filter)
            1 if xp.get("ok") else 0,
            # genEra's own rank (differs from `ps` only for the reassigned PS19 genes)
            ps.get("rank") if ps.get("rank") is not None else -1,
            # gene-age cross-checks on candidates: 0 agree, 1 search-sensitive, 2 disagree, -1 not a candidate
            (ps.get("xc") or {}).get("v", -1) if ps.get("xc") else -1,
            # tandem cross-check: 0 all three published callers tandem, 1 some, 2 a nearby copy only,
            # 3 none, 4 callers tandem but not in the dissertation's set; -1 nothing to say
            ((0 if dup['xt']['t'] == 7 else 1 if dup['xt']['t'] else 2 if dup['xt']['x'] else 3) if dup.get('td') else (4 if dup['xt']['t'] else -1)) if dup.get('xt') else -1,
        ])

    out = {
        "cols": ["hap", "chr", "cls", "ps", "tau", "top", "allele", "at", "wgd", "wgd9", "ccd",
                 "tandem", "npres", "amb", "xin", "w", "ms", "aek", "rel", "dup", "lsg", "qc", "tok", "psg", "xa", "xt"],
        "vocab": {"chr": chrs, "cls": clss, "top": tops, "xin": XIN_TISSUES, "rel": rels, "dup": dups},
        "rows": rows,
    }
    # Short gene descriptions for the Browse table, aligned with genes.json like the rows
    # above. The Phytozome description first; where there is none, the Arabidopsis best hit's
    # own defline, prefixed so it is never read as this gene's annotation. Empty string when
    # neither exists: a named absence, and the client shows a dash.
    desc = []
    for gid in order:
        ann = recs[gid][1].get("ann") or {}
        if ann.get("d"):
            desc.append(ann["d"])
        elif ann.get("atd"):
            desc.append(f"similar to {ann.get('at', 'Arabidopsis')}: {ann['atd']}")
        else:
            desc.append("")
    # Dictionary-encoded: 63,960 genes share 18,513 distinct descriptions, so each string is
    # stored once (sorted, so the file is deterministic) and genes carry an index. 837 KB -> 354 KB
    # gzipped. js/core/data.js loadDescIndex() decodes it back to one string per gene.
    vocab = sorted(set(desc))
    at = {s: i for i, s in enumerate(vocab)}
    dp = f"{data}/index/desc.json"
    with open(dp, "w") as fh:
        json.dump({"vocab": vocab, "idx": [at[d] for d in desc]}, fh,
                  separators=(",", ":"), ensure_ascii=False)
    # Gene start/end, aligned with genes.json, for views that need every gene's position at
    # once (the painted karyotype fetched 38 per-chromosome locus files, ~1.5 MB, for this).
    # Starts are stored as the gap from the previous gene's start on the same haplotype and
    # sequence (reset to the absolute start on a change), ends as the gene's length; the
    # client (data.js loadPositions) rebuilds absolute bp. Small numbers compress well.
    ds, ln, prev_key, prev_s = [], [], None, 0
    for gid in order:
        hap, r = recs[gid]
        key = (hap, r.get("chr"))
        s, e = int(r["start"]), int(r["end"])
        ds.append(s - prev_s if key == prev_key else s)
        ln.append(e - s)
        prev_key, prev_s = key, s
    pp = f"{data}/index/pos.json"
    with open(pp, "w") as fh:
        json.dump({"encoding": "start: delta from previous gene on the same hap+chr, else absolute; end = start + len",
                   "ds": ds, "len": ln}, fh, separators=(",", ":"))
    print(f"pos: {len(ds)} genes -> {os.path.getsize(pp)/1e6:.2f} MB raw")
    print(f"desc: {sum(1 for d in desc if d)} of {len(desc)} genes described -> "
          f"{os.path.getsize(dp)/1e6:.2f} MB raw")
    p = f"{data}/index/facets.json"
    with open(p, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    size = os.path.getsize(p)
    print(f"facets: {len(rows)} rows x {len(out['cols'])} cols -> {size/1e6:.2f} MB raw")
    print(f"  chr vocab {len(chrs)}  class vocab {len(clss)}  tissue vocab {len(tops)}")
    # Index by NAME, not position. These were hard-coded offsets, and inserting one column
    # (wgd9) silently shifted every later one: the log claimed 44 genes expressed in at least
    # one tissue instead of 53,704, and a karyotype coverage that counted omega. Nothing was
    # persisted -- the manifest stores only n_rows/cols/bytes -- but a build log that reports
    # confidently wrong numbers is exactly how a real defect gets waved through.
    C = {name: i for i, name in enumerate(out["cols"])}
    n = lambda name, pred: sum(1 for r in rows if pred(r[C[name]]))
    print(f"  with tau: {n('tau', lambda v: v >= 0)}   in LSG pool: {n('ps', lambda v: v >= 18)}")
    print(f"  with omega: {n('w', lambda v: v >= 0)}   "
          f"peptide-detected: {n('ms', lambda v: v > 0)}")
    print(f"  expressed (>{XIN_MIN_TPM} TPM) in at least one tissue: "
          f"{n('xin', bool)}   in none: {n('xin', lambda v: not v)}")
    print(f"  WGD called (adopted call): {n('wgd9', lambda v: v > 0)}   final LSG set: {n('lsg', lambda v: v == 1)}")
    print(f"  ancestral karyotype placed, HAP1: "
          f"{sum(1 for r in rows if r[C['hap']] == 0 and r[C['aek']] >= 0)}   "
          f"HAP2: {sum(1 for r in rows if r[C['hap']] == 1 and r[C['aek']] >= 0)}")

    man_path = f"{data}/meta/manifest.json"
    man = json.load(open(man_path))
    man["facets"] = {"n_rows": len(rows), "cols": out["cols"], "bytes": size}
    # build_data.py stamps VERSION at the start of a full build, but it is also the stage that
    # wipes data/genes -- so on a machine that can only do half the two-machine build it never
    # runs. This script runs LAST in every path, so stamping here too means the manifest
    # converges on VERSION either way, and check_version.py stays honest.
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    man["data_version"] = open(os.path.join(root, "VERSION")).read().strip()
    json.dump(man, open(man_path, "w"), indent=1, sort_keys=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
