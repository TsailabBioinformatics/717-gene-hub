#!/usr/bin/env python3
"""Build sources/dup_tandem_crosscheck.tsv.gz: for every 717 gene that the dissertation or any of
three published duplication callers puts in a tandem array, or that a caller calls a nearby
(proximal) copy, which callers call it what. Not a build stage: run by hand on Sapelo2 and commit.

    python3 scripts/make_dup_crosscheck_source.py [--check]

Callers, run 2026-09-13 on the same 717 annotation (inputs archived on /work, pinned by sha256 in
sources/dup_tandem_crosscheck.pin.json; the scripts that ran them are in the duplication repo):
  1 DupGen_finder  tandem / proximal pairs (both members of every pair; its .genes lists hold one)
  2 MCScanX        duplicate_gene_classifier: 3 tandem, 2 proximal
  4 doubletrouble  TD tandem, PD proximal
Columns: t = callers that call it tandem; x = callers that call it proximal and not tandem;
td = the dissertation's curated tandem set (dup.td) at the time of the build.

Refuses unless it reproduces the comparison table's unfiltered tandem counts for both haplotypes
(FINAL_12genome_4method.tsv: DupGen_finder 4,249 / 4,126, MCScanX 3,155 / 3,050, doubletrouble
4,197 / 4,072), and the planning re-derivation against the dissertation's tandem genes on
quality-filtered genes: all three tools 3,000 of 6,663 HAP1 and 2,921 of 6,385 HAP2; a nearby copy
only 1,732 and 1,558; neither 815 and 807.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roots  # noqa: E402

PIN = roots.path("atlas", "sources/dup_tandem_crosscheck.pin.json")
OUT = roots.path("atlas", "sources/dup_tandem_crosscheck.tsv.gz")
SIDE = roots.path("atlas", "sources/dup_tandem_crosscheck.provenance.json")
COLS = ["gene_id", "hap", "t", "x", "td"]
WANT = {
    "unfiltered_tandem": {"HAP1": {"DupGen_finder": 4249, "MCScanX": 3155, "doubletrouble": 4197},
                          "HAP2": {"DupGen_finder": 4126, "MCScanX": 3050, "doubletrouble": 4072}},
    "dissertation_tandem": {"HAP1": 6663, "HAP2": 6385},
    "all_three": {"HAP1": 3000, "HAP2": 2921},
    "proximal_only": {"HAP1": 1732, "HAP2": 1558},
    "neither": {"HAP1": 815, "HAP2": 807},
}
TOOLS = (("DupGen_finder", 1), ("MCScanX", 2), ("doubletrouble", 4))


def die(msg):
    sys.exit(f"REFUSING: {msg}")


def load(pin):
    base = roots.path("work", pin["archive"]["dir"])
    text = {}
    for name, spec in pin["archive"]["files"].items():
        b = open(os.path.join(base, spec["path"]), "rb").read()
        if hashlib.sha256(b).hexdigest() != spec["sha256"]:
            die(f"{name}: sha256 differs from the pin")
        text[name] = b.decode()
    return text


def atlas_genes():
    out = {}
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(roots.path("atlas", f"data/genes/{hap}")):
            for fn in fs:
                if fn.endswith(".json"):
                    for gid, r in json.load(open(os.path.join(dp, fn))).items():
                        d = r.get("dup") or {}
                        out[gid] = (hap.upper(), bool(d.get("td")), bool((r.get("rel") or {}).get("qc")), bool(d))
    return out


def build(text):
    genes = atlas_genes()
    calls = {h: {n: {"t": set(), "p": set()} for n, _ in TOOLS} for h in ("HAP1", "HAP2")}
    got = {"unfiltered_tandem": {}}
    for h, c in (("HAP1", "Pt1"), ("HAP2", "Pt2")):
        for kind, key in (("tandem", "t"), ("proximal", "p")):
            rows = text[f"dupgen_{c}_{kind}"].splitlines()[1:]
            calls[h]["DupGen_finder"][key] = {x for l in rows if l for x in (l.split("\t")[0], l.split("\t")[2])}
        for l in text[f"mcscanx_{c}"].splitlines():
            if l.strip():
                g, k = l.split()
                if k == "3": calls[h]["MCScanX"]["t"].add(g)
                if k == "2": calls[h]["MCScanX"]["p"].add(g)
        dt = defaultdict(set)
        for r in csv.DictReader(io.StringIO(text[f"dtrouble_{c}"]), delimiter="\t"):
            dt[r["gene"].split("_", 1)[1]].add(r["type"])
        calls[h]["doubletrouble"]["t"] = {g for g, s in dt.items() if "TD" in s}
        calls[h]["doubletrouble"]["p"] = {g for g, s in dt.items() if "PD" in s}
        got["unfiltered_tandem"][h] = {n: len(calls[h][n]["t"]) for n, _ in TOOLS}
        unknown = set().union(*[calls[h][n]["t"] | calls[h][n]["p"] for n, _ in TOOLS]) - set(genes)
        if unknown:
            die(f"{len(unknown)} {h} caller IDs are not atlas genes, e.g. {sorted(unknown)[:3]}")
    rows, stats = [], {k: {} for k in ("dissertation_tandem", "all_three", "proximal_only", "neither")}
    for h in ("HAP1", "HAP2"):
        filt = {g for g, v in genes.items() if v[0] == h and not v[2] and v[3]}
        td = {g for g in filt if genes[g][1]}
        anyT = set().union(*[calls[h][n]["t"] for n, _ in TOOLS]) & filt
        anyP = set().union(*[calls[h][n]["p"] for n, _ in TOOLS]) & filt
        allT = set.intersection(*[calls[h][n]["t"] & filt for n, _ in TOOLS])
        stats["dissertation_tandem"][h] = len(td)
        stats["all_three"][h] = len(td & allT)
        stats["proximal_only"][h] = len(td & (anyP - anyT))
        stats["neither"][h] = len(td - anyT - anyP)
        for g in sorted(td | anyT | anyP):
            t = sum(b for n, b in TOOLS if g in calls[h][n]["t"])
            x = sum(b for n, b in TOOLS if g in calls[h][n]["p"] and g not in calls[h][n]["t"])
            rows.append([g, h, t, x, int(g in td)])
    got.update(stats)
    if got != WANT:
        die(f"does not reproduce the comparison: {json.dumps({k: (got[k], WANT[k]) for k in WANT if got[k] != WANT[k]})}")
    return rows, got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    rows, got = build(load(json.load(open(PIN))))
    buf = io.StringIO()
    w = csv.writer(buf, delimiter="\t", lineterminator="\n")
    w.writerow(COLS); w.writerows(rows)
    raw = buf.getvalue().encode()
    if a.check:
        if gzip.decompress(open(OUT, "rb").read()) != raw:
            die("committed source differs from a rebuild")
        print(f"dup_tandem_crosscheck source reproduces ({len(rows)} genes)")
        return 0
    open(OUT, "wb").write(gzip.compress(raw, mtime=0))
    json.dump({"what": "which published callers call each gene tandem or proximal; see the generator's docstring",
               "columns": COLS, "rows": len(rows), "sha256_uncompressed": hashlib.sha256(raw).hexdigest(),
               "reproduces": got, "pin": os.path.basename(PIN)}, open(SIDE, "w"), indent=1, sort_keys=True)
    print(f"wrote {OUT} ({len(rows)} genes); reproduces {json.dumps(got, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
