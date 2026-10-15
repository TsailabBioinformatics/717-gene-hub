#!/usr/bin/env python3
"""Roll the Tier-2 / aspen Sage searches up to one per-gene table for the atlas.

The DETECTION RULE IS NOT INVENTED HERE. It is copied verbatim from the analysis that owns
these searches, ms2-lsg analyses/proteomics_translation_evidence/scripts/06_aspen_multidataset
_readout.py: a target PSM (label == 1) at peptide_q <= 0.01 AND spectrum_q <= 0.01, mapped to
every non-decoy protein it lists, gene = first two dot-fields of the accession after the
source prefix.

AND IT IS GATED. This script's per-gene output is aggregated back to gene class and compared
against that analysis's own published `aspen_detection_by_class.tsv`. If a single cell
disagrees, the roll-up is wrong and nothing is written. That is what makes a locally derived
table honest: it is not "trust me", it is "it reproduces the number the owner published".
"""
import roots
import csv, gzip, io, json, os, sys
from collections import defaultdict, Counter

WORK = roots.path('scratch', 'proteomics_aspen')
POOL = roots.path('scratch', 'ms2lsg_wt_proteomics/pipeline/out/lsg_pool_idesia.tsv.gz')
PUB  = roots.path('scratch', 'ms2lsg_wt_proteomics/analyses/proteomics_translation_evidence/results/aspen_detection_by_class.tsv')
DET  = f"{WORK}/out/detectability.tsv"
FDR  = 0.01
OUT  = "sources/proteomics_ms_v2.tsv.gz"

ORDER = ["PS1_2_ancient","PS3_12_conserved","PS13_15_rosids","PS16_17_salicaceae",
         "LSG_PS18_populus","LSG_PS19_hybrid","unassigned"]

def gene_class(r):
    if r in ("", "NA", "nan", None): return "unassigned"
    rk = int(float(r))
    if rk <= 2:  return "PS1_2_ancient"
    if rk <= 12: return "PS3_12_conserved"
    if rk <= 15: return "PS13_15_rosids"
    if rk <= 17: return "PS16_17_salicaceae"
    if rk == 18: return "LSG_PS18_populus"
    return "LSG_PS19_hybrid"

def src_of(p):  return p.split("|", 1)[0]
def gene_of(p):
    g = p.split("|", 1)[1] if "|" in p else p
    return ".".join(g.split(".")[:2])

def main():
    cls = {}
    with gzip.open(POOL, "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            cls[(r["hap"], r["gene_id"])] = gene_class(r["rank"])
    print(f"class map: {len(cls)} genes")

    datasets = sorted(d for d in os.listdir(f"{WORK}/out")
                      if os.path.isfile(f"{WORK}/out/{d}/results.sage.tsv"))
    print(f"datasets: {datasets}")

    # per (hap, gene) per dataset: n distinct peptides, n PSMs, best hyperscore, 717-specific?
    per = defaultdict(dict)
    detected_by_ds = {}
    for acc in datasets:
        pep2prot, pep_psms, pep_best = defaultdict(set), Counter(), {}
        n_psm = n_pass = 0
        with open(f"{WORK}/out/{acc}/results.sage.tsv") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                n_psm += 1
                if row.get("label") != "1":
                    continue
                try:
                    if float(row["peptide_q"]) > FDR or float(row["spectrum_q"]) > FDR:
                        continue
                except (KeyError, ValueError):
                    continue
                n_pass += 1
                pep = row["peptide"]
                pep_psms[pep] += 1
                try:
                    hs = float(row["hyperscore"])
                    if hs > pep_best.get(pep, -1e9): pep_best[pep] = hs
                except (KeyError, ValueError):
                    pass
                for p in row["proteins"].split(";"):
                    p = p.strip()
                    if p and not p.startswith("rev_"):
                        pep2prot[pep].add(p)

        detected = set()
        for pep, prots in pep2prot.items():
            srcs = {src_of(p) for p in prots}
            specific = srcs <= {"HAP1", "HAP2"}
            for p in prots:
                s = src_of(p)
                if s not in ("HAP1", "HAP2"):
                    continue
                key = (s, gene_of(p))
                detected.add(key)
                d = per[key].setdefault(acc, {"pep": 0, "psm": 0, "hs": None, "spec": 0})
                d["pep"] += 1
                d["psm"] += pep_psms[pep]
                if pep in pep_best and (d["hs"] is None or pep_best[pep] > d["hs"]):
                    d["hs"] = pep_best[pep]
                if specific:
                    d["spec"] = 1
        detected_by_ds[acc] = detected
        print(f"  {acc}: {n_psm} PSMs, {n_pass} pass, {len(pep2prot)} peptides, "
              f"{len(detected)} 717 genes")

    # ---- GATE: reproduce the owner's published per-class table, cell for cell -------------
    pub = {}
    for r in csv.DictReader(open(PUB), delimiter="\t"):
        pub[(r["dataset"], r["hap"], r["gene_class"])] = (int(r["n_genes"]), int(r["n_detected"]))
    mine, bad = {}, []
    union = set().union(*detected_by_ds.values())
    for label, det in list(detected_by_ds.items()) + [("UNION_all_datasets", union)]:
        for hap in ("HAP1", "HAP2"):
            for c in ORDER:
                tot = sum(1 for (h, g), cc in cls.items() if h == hap and cc == c)
                if not tot: continue
                n = sum(1 for (h, g) in det if h == hap and cls.get((h, g)) == c)
                mine[(label, hap, c)] = (tot, n)
    for k, v in pub.items():
        if mine.get(k) != v:
            bad.append((k, v, mine.get(k)))
    if bad:
        for k, want, got in bad[:10]:
            print(f"  GATE FAIL {k}: published {want}, this roll-up {got}", file=sys.stderr)
        raise SystemExit(f"GATE FAILED on {len(bad)} of {len(pub)} published cells -- "
                         "the roll-up does not reproduce the owner's table. Nothing written.")
    print(f"GATE PASS: reproduces all {len(pub)} published cells of aspen_detection_by_class.tsv")

    # ---- detectability -------------------------------------------------------------------
    det = {}
    for r in csv.DictReader(open(DET), delimiter="\t"):
        det[(r["hap"], r["gene_id"])] = (int(r["n_tryptic_in_window"]), int(r["n_unique_tryptic"]))
    print(f"detectability: {len(det)} genes")

    # ---- write ---------------------------------------------------------------------------
    cols = ["gene_id", "hap", "n_datasets_detected", "n_datasets_searched",
            "n_peptides_total", "n_psms_total", "best_hyperscore", "any_717_specific_peptide",
            "n_tryptic_in_window", "n_unique_tryptic", "detectable",
            "datasets_detected"]
    rows = []
    genes = sorted(set(cls) | set(det))
    n_det = Counter()
    for (hap, g) in genes:
        d = per.get((hap, g), {})
        tw, uq = det.get((hap, g), (None, None))
        hs = [v["hs"] for v in d.values() if v["hs"] is not None]
        rows.append({
            "gene_id": g, "hap": hap,
            "n_datasets_detected": len(d), "n_datasets_searched": len(datasets),
            "n_peptides_total": sum(v["pep"] for v in d.values()),
            "n_psms_total": sum(v["psm"] for v in d.values()),
            "best_hyperscore": f"{max(hs):.1f}" if hs else "",
            "any_717_specific_peptide": 1 if any(v["spec"] for v in d.values()) else 0,
            "n_tryptic_in_window": "" if tw is None else tw,
            "n_unique_tryptic": "" if uq is None else uq,
            "detectable": "" if tw is None else (1 if tw > 0 else 0),
            "datasets_detected": ",".join(sorted(d)),
        })
        if d: n_det[hap] += 1
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, delimiter="\t", lineterminator="\n")
    w.writeheader(); w.writerows(rows)
    with open(OUT, "wb") as fh:
        with gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:
            gz.write(buf.getvalue().encode())
    print(f"wrote {OUT}: {len(rows)} rows; detected in >=1 dataset: {dict(n_det)}")

if __name__ == "__main__":
    main()
