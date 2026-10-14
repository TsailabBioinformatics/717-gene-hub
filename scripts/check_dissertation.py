#!/usr/bin/env python3
"""Release gate: the atlas states the dissertation's calls and numbers, everywhere.

Read-only. Two kinds of assertion, tagged in the output:

  [invariant]        must hold for any release, whatever the numbers are: every gene record
                     equals the per-gene master table; summaries equal what the records give;
                     a gene's WGD class agrees with its own anchor pairs; the LSG flag set is
                     exactly the final list; retired names appear nowhere.
  [published value]  equals a number printed in the dissertation (Table 2.1, Figure 2.S2, the
                     LSG set, tissue-specific genes). These change only if the dissertation does.

The upstream tables are read when they are reachable (MS1_DUP, CH3_TABLE; same defaults as
make_dissertation_layer_source.py). Without them the record-by-record comparison against the
master table cannot run, and the script says so and FAILS unless --no-upstream is given, in which
case the committed source (sources/dissertation_layer.tsv.gz) stands in where it can.

Every "none found" check is paired with a positive control: the scanner is first shown a string
it must catch, so a pattern that could never match cannot pass silently.
"""
import argparse, csv, gzip, json, os, re, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
MS1_DUP = os.environ.get("MS1_DUP", os.path.expanduser("~/dev/ms1-dup"))
MASTER = os.path.join(MS1_DUP, "data/131_master_v12_20261002/tables/master_per_gene_v12.csv")
FROZEN = os.path.join(MS1_DUP, "data/79_nn_to_11_and_wgd_freeze_20260919/tables/wgd_pair_classes_FROZEN_1p05.csv")
CH3_TABLE = os.environ.get("CH3_TABLE", os.path.expanduser(
    "~/Library/CloudStorage/OneDrive-UniversityofGeorgia/01_work/fin/dissertation_work/"
    "ch3_strict567_20261005/tables/Table_3.S1_S3_per_gene.tsv"))

# ---- numbers printed in the dissertation (committee copy, 2026-10-08) ----------------------
TABLE_2_1 = {"HAP1": {"quality_filtered_genes": 31819, "sWGD": 14136, "aWGT": 5408, "tandem": 6663,
                      "dispersed_only": 6545, "singleton": 3665},
             "HAP2": {"quality_filtered_genes": 31588, "sWGD": 14170, "aWGT": 5430, "tandem": 6385,
                      "dispersed_only": 6529, "singleton": 3715}}
PAIRS = {"HAP1": {"sWGD": 7081, "aWGT": 4445}, "HAP2": {"sWGD": 7105, "aWGT": 4523}}
LSG = {"HAP1": {"candidates": 776, "final": 583, "final_PS18": 380, "final_PS19": 203, "reassigned_PS19_to_PS18": 104},
       "HAP2": {"candidates": 835, "final": 621, "final_PS18": 418, "final_PS19": 203, "reassigned_PS19_to_PS18": 100}}
TAU_SPECIFIC = {"HAP1": 1372, "HAP2": 1305}
REL = {"HAP1": {"1:1": 22704, "hemizygous_strict_PAV": 528, "hemizygous_TD_array": 159},
       "HAP2": {"1:1": 22704, "hemizygous_strict_PAV": 605, "hemizygous_TD_array": 141}}

# Retired names. The stored table values `aWGD_era`, `pre_divergence`, `post_divergence` and
# `TD_associated_PAV` are keys, never shown; what a reader sees is checked here.
RETIRED = [("TD-associated PAV", re.compile(r"TD-associated PAV")),
           ("PAV (whole array)", re.compile(r"PAV \(whole array\)")),
           ("aWGD", re.compile(r"aWGD(?!_era)")),
           ("post/pre divergence", re.compile(r"\b(?:post|pre)[ -]divergence\b", re.I)),
           # tables and pages are described by content, never as chapters (Chen, 2026-10-13)
           ("Chapter 2 / Chapter 3", re.compile(r"Chapters? [23]\b|dissertation chapter", re.I))]
# In code, a retired name may appear in a comment that explains the rename; rendered strings
# may not. The scan therefore reads string literals in JS and all text in HTML and data.
JS_STRING = re.compile(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`")

fails = []


def check(kind, name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  [{kind}] {name}{'  -- ' + str(detail) if detail != '' else ''}")
    if not ok:
        fails.append(name)


def load_records():
    recs = {}
    for hap, H in (("hap1", "HAP1"), ("hap2", "HAP2")):
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in fs:
                if fn.endswith(".json"):
                    for gid, r in json.load(open(os.path.join(dp, fn))).items():
                        recs[gid] = (H, r)
    return recs


def scan_retired():
    hits = Counter()
    examples = {}

    def feed(where, text):
        for name, pat in RETIRED:
            m = pat.search(text)
            if m:
                hits[name] += 1
                examples.setdefault(name, f"{where}: ...{text[max(0, m.start() - 30):m.end() + 30]}...")

    # positive control: each pattern must catch its own name
    probe = Counter()
    for name, pat in RETIRED:
        for s in ("TD-associated PAV", "PAV (whole array)", "an aWGD pair", "post divergence", "pre-divergence",
                  "see Chapter 3"):
            if pat.search(s):
                probe[name] += 1
    check("invariant", "the retired-name scan can see each retired name (positive control)",
          all(probe[n] for n, _ in RETIRED), dict(probe))
    assert not RETIRED[2][1].search("aWGD_era"), "the stored key must not count as a retired name"

    n_files = 0
    for top in ("js", "css"):
        for dp, _, fs in os.walk(os.path.join(ROOT, top)):
            if "vendor" in dp:
                continue
            for fn in fs:
                p = os.path.join(dp, fn)
                text = open(p, encoding="utf-8", errors="replace").read()
                n_files += 1
                if fn.endswith(".js"):
                    code = re.sub(r"/\*[\s\S]*?\*/", "", text)
                    code = "\n".join(l for l in code.splitlines() if not l.lstrip().startswith("//"))
                    for m in JS_STRING.finditer(code):
                        feed(os.path.relpath(p, ROOT), m.group(0))
                else:
                    feed(os.path.relpath(p, ROOT), text)
    feed("index.html", open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()); n_files += 1
    for dp, _, fs in os.walk(DATA):
        for fn in fs:
            if fn.endswith(".json"):
                p = os.path.join(dp, fn)
                feed(os.path.relpath(p, ROOT), open(p, encoding="utf-8", errors="replace").read())
                n_files += 1
    for dp, _, fs in os.walk(os.path.join(ROOT, "downloads")):
        for fn in fs:
            if fn.endswith((".json", ".md", ".txt")):
                p = os.path.join(dp, fn)
                feed(os.path.relpath(p, ROOT), open(p, encoding="utf-8", errors="replace").read())
                n_files += 1
    check("invariant", f"no retired name in what the site serves ({n_files:,} files: JS strings, HTML, CSS, data JSON)",
          not hits, "; ".join(f"{k} x{v} e.g. {examples[k]}" for k, v in hits.items()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-upstream", action="store_true",
                    help="allow a run where the master table / frozen call / LSG table are unreachable")
    a = ap.parse_args()
    recs = load_records()
    order = json.load(open(os.path.join(DATA, "index", "genes.json")))
    man = json.load(open(os.path.join(DATA, "meta", "manifest.json")))
    print(f"\n{len(recs):,} gene records, data v{man.get('data_version')}\n")
    check("invariant", "every gene in the index has exactly one record", set(order) == set(recs) and len(order) == len(recs))

    # ---- 1. gene records against the per-gene master table --------------------------------
    print("\n== gene records against the per-gene master table ==")
    if os.path.exists(MASTER):
        import pandas as pd
        m = pd.read_csv(MASTER, low_memory=False).set_index("gene_id")
        check("invariant", "master table and atlas hold the same gene set", set(m.index) == set(recs), len(m))
        bad = Counter()
        isna = pd.isna
        for gid, (H, r) in recs.items():
            q = m.loc[gid]
            dup, rel, td = r.get("dup") or {}, r.get("rel") or {}, r.get("td") or {}
            if dup.get("t") != q.dup_type_v10:
                bad["class letters"] += 1
            if bool(dup.get("s")) != bool(q.has_S_anchor) or bool(dup.get("a")) != bool(q.has_A_anchor):
                bad["sWGD / aWGT flags"] += 1
            if bool(dup.get("td")) != bool(q.has_T_gene):
                bad["tandem flag"] += 1
            if (rel.get("c") or None) != (None if isna(q.cj_category) else q.cj_category):
                bad["relationship category"] += 1
            if bool(rel.get("qc")) != bool(q.qc_questionable):
                bad["quality flag"] += 1
            if ((r.get("allele") or {}).get("id") or None) != (None if isna(q.syntelog_partner_gene_id) else q.syntelog_partner_gene_id):
                bad["allele partner"] += 1
            if q.has_T_gene:
                want = None if isna(q.array_age_bin) else q.array_age_bin
                if (td.get("age") or None) != want or td.get("aid") != q.array_id_union:
                    bad["tandem array id / age bin"] += 1
            want_tau = None if isna(q.tau_raw) else int(float(q.tau_raw) * 1000 + 1e-9) / 1000   # truncated
            got = ((r.get("x") or {}).get("p") or {})
            if (got.get("tau") is None) != (want_tau is None) or (want_tau is not None and abs(got["tau"] - want_tau) > 1e-9):
                bad["tau"] += 1
            if (got.get("top") or None) != (None if isna(q.peak_tissue) else q.peak_tissue):
                bad["peak tissue"] += 1
        for field in ("class letters", "sWGD / aWGT flags", "tandem flag", "relationship category", "quality flag",
                      "allele partner", "tandem array id / age bin", "tau", "peak tissue"):
            check("invariant", f"{field}: all {len(recs):,} records equal the master table", bad[field] == 0,
                  f"{bad[field]} differ" if bad[field] else "")
    else:
        check("invariant", "master table reachable (set MS1_DUP)", a.no_upstream, f"not found: {MASTER}")

    # ---- 2. summaries against the records ---------------------------------------------------
    print("\n== page-level totals against the gene records ==")
    t21 = {H: Counter() for H in ("HAP1", "HAP2")}
    pairs = {H: Counter() for H in ("HAP1", "HAP2")}
    lsg = {H: Counter() for H in ("HAP1", "HAP2")}
    rel_n = {H: Counter() for H in ("HAP1", "HAP2")}
    tau_n = Counter()
    letters = Counter()
    mismatch = []
    final_set, cand_set = set(), set()
    for gid, (H, r) in recs.items():
        dup, rel, ps = r.get("dup") or {}, r.get("rel") or {}, r.get("ps") or {}
        letters[dup.get("t")] += 1
        ev = {q["e"] for q in r.get("wgd") or []}
        if bool(dup.get("s")) != ("S" in ev) or bool(dup.get("a")) != ("A" in ev):
            mismatch.append(gid)
        for q in r.get("wgd") or []:
            pairs[H]["sWGD" if q["e"] == "S" else "aWGT"] += 1
        if rel.get("c"):
            rel_n[H][rel["c"]] += 1
        if not rel.get("qc"):
            c = t21[H]
            c["quality_filtered_genes"] += 1
            c["sWGD"] += bool(dup.get("s")); c["aWGT"] += bool(dup.get("a")); c["tandem"] += bool(dup.get("td"))
            c["dispersed_only"] += dup.get("t") == "D"; c["singleton"] += dup.get("t") == "C"
            p = (r.get("x") or {}).get("p") or {}
            if p.get("ok") and p.get("tau") is not None and p["tau"] >= 0.85:
                tau_n[H] += 1
        f = ps.get("fin")
        if f:
            cand_set.add(gid)
            lsg[H]["candidates"] += 1
            lsg[H]["reassigned_PS19_to_PS18"] += f["g"] != f["u"]
            if f["s"]:
                final_set.add(gid)
                lsg[H]["final"] += 1
                lsg[H][f"final_PS{f['u']}"] += 1
    d = man.get("dissertation") or {}
    for H in ("HAP1", "HAP2"):
        check("published value", f"{H} tissue-specific genes on gene records (tau >= 0.85, mean TPM >= 5)",
              tau_n[H] == TAU_SPECIFIC[H] == d["tau"]["per_haplotype"][H]["tissue_specific"], tau_n[H])
        got = {k: int(v) for k, v in t21[H].items()}
        check("invariant", f"{H} Duplication-page table equals the gene records",
              {k: d["table_2_1"][H][k] for k in got} == got)
        check("published value", f"{H} Table 2.1", got == TABLE_2_1[H], got if got != TABLE_2_1[H] else "")
        gp = {k: v // 2 for k, v in pairs[H].items()}
        check("invariant", f"{H} anchor-pair totals on the Duplication page equal the gene records",
              d["wgd_anchor_pairs"][H] == gp)
        check("published value", f"{H} anchor pairs (Figure 2.S2)", gp == PAIRS[H], gp)
        gl = {k: int(lsg[H][k]) for k in LSG[H]}
        check("invariant", f"{H} LSG counts on the Gene age page equal the gene records",
              {k: d["lsg"][H].get(k) for k in gl} == gl)
        check("published value", f"{H} LSG set", gl == LSG[H], gl)
        check("published value", f"{H} relationship categories (1:1, strict PAV, hemizygous TD arrays)",
              {k: rel_n[H][k] for k in REL[H]} == REL[H], {k: rel_n[H][k] for k in REL[H]})
        check("invariant", f"{H} manifest relationship counts equal the gene records",
              all(man["relationship"]["counts"].get(f"{H}|{k}") == v for k, v in rel_n[H].items()))
    check("invariant", "class-letter distribution in the manifest equals the gene records",
          man["layers"]["dup_class_dist"] == {k: v for k, v in letters.items() if k})
    check("invariant", "no gene's WGD class disagrees with its own anchor pairs (no mismatch box on any page)",
          not mismatch, f"{len(mismatch)} genes, e.g. {mismatch[:3]}" if mismatch else "0 of 63,960")

    # ---- 3. the Browse index (what Browse, the tiles and the export count from) -----------
    print("\n== Browse index against the gene records ==")
    fac = json.load(open(os.path.join(DATA, "index", "facets.json")))
    C = {c: i for i, c in enumerate(fac["cols"])}
    for col in ("wgd9", "tandem", "dup", "lsg", "qc", "tau", "tok", "rel"):
        check("invariant", f"Browse index has column `{col}`", col in C)
    dupv = fac["vocab"]["dup"]
    fb = {H: Counter() for H in ("HAP1", "HAP2")}
    for row in fac["rows"]:
        H = "HAP1" if row[C["hap"]] == 0 else "HAP2"
        if row[C["lsg"]] == 1:
            fb[H]["lsg_final"] += 1
        if row[C["qc"]]:
            continue
        b = fb[H]
        b["quality_filtered_genes"] += 1
        b["sWGD"] += bool(row[C["wgd9"]] & 1); b["aWGT"] += bool(row[C["wgd9"]] & 2)
        b["tandem"] += bool(row[C["tandem"]])
        b["dispersed_only"] += dupv[row[C["dup"]]] == "D"; b["singleton"] += dupv[row[C["dup"]]] == "C"
        b["tau_specific"] += bool(row[C["tok"]] and row[C["tau"]] >= 850)
    for H in ("HAP1", "HAP2"):
        check("published value", f"{H} Browse filters return Table 2.1",
              {k: fb[H][k] for k in TABLE_2_1[H]} == TABLE_2_1[H])
        check("published value", f"{H} Browse 'tissue-specific' (tau >= 0.85, mean TPM >= 5, quality-filtered)",
              fb[H]["tau_specific"] == TAU_SPECIFIC[H], fb[H]["tau_specific"])
        check("published value", f"{H} Browse 'final LSG set'", fb[H]["lsg_final"] == LSG[H]["final"], fb[H]["lsg_final"])
    check("invariant", "Export and the old ?wgd= link use the adopted call (the two WGD columns are identical)",
          all(r[C["wgd"]] == r[C["wgd9"]] for r in fac["rows"]))

    # ---- 4. pairs against the frozen call ----------------------------------------------------
    print("\n== anchor pairs against the frozen call ==")
    if os.path.exists(FROZEN):
        want = {}
        for r in csv.DictReader(open(FROZEN)):
            want[frozenset((r["gene1"], r["gene2"]))] = "S" if r["cls_final_loose"] == "sWGD" else "A"
        got = {}
        for gid, (_, r) in recs.items():
            for q in r.get("wgd") or []:
                got[frozenset((gid, q["id"]))] = q["e"]
        diff = sum(1 for k in want if got.get(k) != want[k])
        check("invariant", f"all {len(want):,} anchor pairs carry the frozen call's event, on both genes",
              set(got) == set(want) and diff == 0, f"{diff} differ" if diff else "")
    else:
        check("invariant", "frozen pair call reachable (set MS1_DUP)", a.no_upstream, f"not found: {FROZEN}")

    # ---- 5. LSG flag set against the final list ---------------------------------------------
    print("\n== lineage-specific genes against the final list ==")
    if os.path.exists(CH3_TABLE):
        rows = list(csv.DictReader(open(CH3_TABLE), delimiter="\t"))
        src, what = {r["gene_id"] for r in rows if r["strict"] == "True"}, "Table_3.S1_S3_per_gene.tsv"
        cand = {r["gene_id"] for r in rows}
    else:
        if not a.no_upstream:
            check("invariant", "final LSG table reachable (set CH3_TABLE)", False, CH3_TABLE)
        with gzip.open(os.path.join(ROOT, "sources", "dissertation_layer.tsv.gz"), "rt") as fh:
            rows = list(csv.DictReader(fh, delimiter="\t"))
        src, what = {r["gene_id"] for r in rows if r["lsg_final"] == "1"}, "the committed source"
        cand = {r["gene_id"] for r in rows if r["lsg_candidate"] == "1"}
    check("invariant", f"the final-set flag is exactly the strict list of {what}", final_set == src,
          f"{len(final_set)} flagged vs {len(src)} listed; {len(final_set ^ src)} differ")
    check("invariant", "candidates on the site are exactly the listed candidates", cand_set == cand, len(cand_set))
    excl_no_reason = [g for g in cand_set - final_set if not recs[g][1]["ps"]["fin"].get("r")]
    check("invariant", "every excluded candidate carries its reason", not excl_no_reason, len(excl_no_reason))

    # ---- 5b. the downloadable tables say the same thing as the gene pages -------------------
    print("\n== downloadable tables against the gene records ==")
    dl = os.path.join(ROOT, "downloads")
    if os.path.exists(os.path.join(dl, "717_genes.csv")):
        # the download uses the site's display names, word for word: read them from the site's
        # own table (js/core/relationship.js) so the two cannot be compared against a third copy
        rj = open(os.path.join(ROOT, "js", "core", "relationship.js")).read()
        CAT = dict(re.findall(r"'([^']+)': \{ name: '([^']+)'", rj))
        check("invariant", "the site's eight category names were read", len(CAT) == 8, sorted(CAT.values()))
        T = lambda v: v == "True"
        bad = Counter()
        n = 0
        for q in csv.DictReader(open(os.path.join(dl, "717_genes.csv"))):
            n += 1
            H, r = recs[q["gene_id"]]
            dup, rel = r.get("dup") or {}, r.get("rel") or {}
            xp = (r.get("x") or {}).get("p") or {}
            if T(q["quality_flagged"]) != bool(rel.get("qc")):
                bad["quality flag"] += 1
            if T(q["quality_flagged"]):
                continue          # flagged rows carry no classification in the download
            if q["duplication_class_code"] != dup.get("t") or T(q["sWGD_gene"]) != bool(dup.get("s")) \
                    or T(q["aWGT_gene"]) != bool(dup.get("a")) or T(q["tandem_gene"]) != bool(dup.get("td")):
                bad["duplication class"] += 1
            if q["syntelog_category"] != CAT.get(rel.get("c"), ""):
                bad["syntelog category"] += 1
            if T(q["strict_PAV"]) != (rel.get("c") == "hemizygous_strict_PAV"):
                bad["strict PAV"] += 1
            # the download gives tau to six decimals, the page truncates to three
            dt, st = (float(q["tau"]) if q["tau"] else None), xp.get("tau")
            if (dt is None) != (st is None) or (dt is not None and not (-1e-6 <= dt - st < 0.001 + 1e-6)) \
                    or (q["peak_tissue"] or None) != xp.get("top"):
                bad["tau / peak tissue"] += 1
        check("invariant", f"download and site hold the same {n:,} genes", n == len(recs))
        for f in ("quality flag", "duplication class", "syntelog category", "strict PAV", "tau / peak tissue"):
            check("invariant", f"{f}: the downloadable per-gene table equals the gene pages", bad[f] == 0,
                  f"{bad[f]} differ" if bad[f] else "")
        got = Counter()
        for q in csv.DictReader(open(os.path.join(dl, "717_gene_pairs.csv"))):
            if q["pair_type"] in ("sWGD", "aWGT"):
                got[(q["haplotype"], q["pair_type"])] += 1
        check("invariant", "anchor-pair totals in the downloadable pair table equal the gene pages",
              all(got[(H, e)] == pairs[H][e] // 2 for H in pairs for e in ("sWGD", "aWGT")), dict(got))
        fin = {q["gene_id"] for q in csv.DictReader(open(os.path.join(dl, "717_LSG_candidates.csv")))
               if q["final_LSG_set"] == "True"}
        check("invariant", "final LSG set in the downloadable table equals the gene pages", fin == final_set, len(fin))
        idx = json.load(open(os.path.join(dl, "index.json")))
        import hashlib
        wrong = [f["href"] for f in idx["files"]
                 if hashlib.md5(open(os.path.join(ROOT, f["href"]), "rb").read()).hexdigest() != f["md5"]
                 or os.path.getsize(os.path.join(ROOT, f["href"])) != f["bytes"]]
        check("invariant", f"every one of the {len(idx['files'])} listed downloads has the size and md5 the page states",
              not wrong, wrong)
        big = [f["href"] for f in idx["files"] if f["bytes"] > 100 * 1000 * 1000]
        check("invariant", "no download exceeds the 100 MB per-file limit", not big, big)
    else:
        print("  (no downloads/ in this tree; nothing to compare)")

    # ---- 5c. tandem-array chips: every one must have an array page to open ------------------
    print("\n== tandem-array links ==")
    arrays = json.load(open(os.path.join(DATA, "index", "arrays.json")))
    status = json.load(open(os.path.join(DATA, "index", "array_status.json")))
    td_genes = [g for g, (_, r) in recs.items() if (r.get("dup") or {}).get("td")]
    dead = [g for g in td_genes
            if not (recs[g][1].get("td") or {}).get("aid")
            or recs[g][1]["td"]["aid"] not in arrays or g not in arrays[recs[g][1]["td"]["aid"]]
            or recs[g][1]["td"]["aid"] not in status]
    check("invariant", f"each of the {len(td_genes):,} tandem genes names an array that has a page and lists it",
          td_genes and not dead, f"{len(dead)} without, e.g. {dead[:3]}" if dead else "")
    hemi = [g for g in td_genes if (recs[g][1].get("rel") or {}).get("c") == "hemizygous_TD_array"]
    check("invariant", "genes of hemizygous TD arrays are among them", len(hemi) == 300 and not set(hemi) & set(dead), len(hemi))
    check("invariant", "positive control: a made-up array id would be caught", "HAP1_U99999" not in arrays)
    for gid, (_, r) in recs.items():
        x = r.get("x") or {}
        if x and (x.get("tau") != (x.get("p") or {}).get("tau") or x.get("top") != (x.get("p") or {}).get("top")):
            fails.append("one tau"); print(f"  FAIL  [invariant] {gid} carries a second tau or peak tissue"); break
    else:
        print("  PASS  [invariant] one tissue-specificity value per record: x.tau and x.top are the dissertation's")

    # ---- 6. names ----------------------------------------------------------------------------
    print("\n== retired names ==")
    scan_retired()

    print()
    if fails:
        print(f"{len(fails)} CHECK(S) FAILED:")
        for f in fails:
            print("   ", f)
        return 1
    print("THE ATLAS STATES THE DISSERTATION'S CALLS AND NUMBERS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
