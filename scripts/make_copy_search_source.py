#!/usr/bin/env python3
"""Build sources/copy_search.json: every copy of a tandem array on BOTH haplotypes, found in
the genome sequence rather than in the annotation.

WHY. A gene table can only show annotated genes. When one haplotype carries an expanded array
and the other carries degraded remnants, a remnant the annotator did not call is invisible to
every gene-based view, and two remnants it did call can end up joined into one gene model.
NRX1 is the case that surfaced this (2026-09-21): seven annotated copies on HAP1; on HAP2, one
annotated gene spanning two separate pieces 5 kb apart, plus a more complete piece that is not
annotated at all. No HAP1 gene page led to any of them.

METHOD, per locus:
  1. ARRAY: the seed gene plus its tandem members (`td.mem` on the atlas record, the same TD
     union set the Duplication card draws).
  2. REGION, bounded by synteny rather than by a chosen distance: walk outward from each end of
     the array to the nearest gene that has an allele (`allele.id`). The HAP1 region runs
     between those two genes; the HAP2 region runs between their two alleles.
  3. tblastn of every array protein against each whole haplotype genome. Only hits inside the
     region are kept. Searching the whole genome keeps E-values on a genome scale. Alignments
     are collected at E <= 1e-3 and a copy is reported only if one reaches E <= 1e-10.
  4. A hit overlapping an annotated gene belongs to that gene. Hits overlapping no gene are
     clustered into unannotated copies.
  5. Coverage and identity are measured against ONE reference protein (the longest array
     protein, ties broken by gene id), so every copy is drawn on one scale. NRX1 carries
     internal repeats, so a stretch of genome can align to several parts of the protein at
     once. Each stretch is explained ONCE, by its best-scoring alignment to the reference.
     Without that, an 880 bp locus was once reported as covering 82% of a 564 aa protein.
  6. PIECES. No annotated copy in the array spans more genome than MAX_SPAN (the longest
     member's gene model, MEASURED on the array, not chosen), so alignments that would stretch
     one copy beyond that cannot be one copy. A row's alignments are split into separate pieces
     there, and unannotated hits are clustered under the same bound. A gene model holding two
     pieces is one model laid over two separate pieces of sequence.
     (Tried first: the largest gap between consecutive alignments inside an intact copy. It
     measured 199 bp, because tblastn bridges short introns in an intact copy and cannot in a
     degraded one, so it cut single degraded copies in two. A gap inside intact copies is not
     the right yardstick for gaps inside broken ones; a copy's total length is.)

READ WITH: tblastn does not model introns. A hit that bridges one absorbs translated intron,
so identity reads low. The reference aligned to its OWN gene is recorded as `self_pid`, which is
the size of that effect for this locus. Coverage is robust; per-segment identity is not.

CONTROL, or nothing is written: the search must recover every annotated array member on its own
haplotype. Without it, "nothing else found" would mean nothing.

Coordinates are BED (0-based start, half-open end), the convention of every other coordinate
on this site, so a row's position here matches its gene page exactly.

Sapelo2 only (BLAST+, the v5.0 genome FASTA, the v5.1 proteins). DELIBERATELY NOT A BUILD STAGE,
like make_kaks_source.py: it regenerates a committed source, and patch_copies.py turns that
source into data/. Run it by hand when a locus is added:
    python3 scripts/make_copy_search_source.py        (~5 min on 32 cores)
"""
import roots
import glob
import hashlib
import json
import os
import subprocess
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sources", "copy_search.json")
WORK = os.environ.get("ATLAS_COPY_WORK", roots.path("scratch", "atlas_copy_search"))

ANN = roots.path('scratch', 'genome_resources/pangenome/input/717Official/annotation')
PROT = {"hap1": f"{ANN}/PtremulaxPopulusalbaHAP1_717_v5.1.protein_primaryTranscriptOnly.fa",
        "hap2": f"{ANN}/PtremulaxPopulusalbaHAP2_716_v5.1.protein_primaryTranscriptOnly.fa"}
GENOME = {"hap1": roots.path('work', '717Official/PtremulaxPopulusalbaHAP1_717_v5.0.fa'),
          "hap2": roots.path('work', '717Official/PtremulaxPopulusalbaHAP2_716_v5.0.fa')}
BLAST = "module load BLAST+/2.14.1-gompi-2023a >/dev/null 2>&1 && "
CPUS = os.environ.get("SLURM_CPUS_PER_TASK") or os.environ.get("SLURM_CPUS_ON_NODE") or "8"

# Two conventional homology levels, neither tuned on this result. Alignments are COLLECTED at
# the permissive level, so a short or diverged stretch of a real copy still counts toward its
# coverage; a copy is only REPORTED if at least one of its alignments reaches the confident
# level. The HAP2 pieces this was written for sit at 1e-100 or lower, so the panel does not
# rest on where either line falls.
SEARCH_EVALUE = 1e-3
ROW_EVALUE = 1e-10

# One entry per locus. The seed is any array member; the rest is derived from atlas data.
LOCI = [
    {"slug": "nrx1", "name": "NRX1", "desc": "nucleoredoxin", "seed": "PtXaTreH.10G047000"},
]


def sh(cmd):
    r = subprocess.run(["bash", "-lc", cmd], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"FAILED ({r.returncode}): {cmd}\n{r.stderr[-2000:]}")
    return r.stdout


def load_records():
    """Every atlas gene record, with `hap` added from the shard it lives in (records do not
    carry it; the shard directory is the haplotype)."""
    recs = {}
    base = os.path.join(ROOT, "data", "genes")
    for p in sorted(glob.glob(os.path.join(base, "*", "*.json"))
                    + glob.glob(os.path.join(base, "*", "*", "*.json"))):
        hap = os.path.relpath(p, base).split(os.sep)[0]
        for gid, r in json.load(open(p)).items():
            recs[gid] = {**r, "hap": hap}
    return recs


def read_proteins(path, keep):
    out, cur = {}, None
    with open(path) as fh:
        for ln in fh:
            if ln.startswith(">"):
                loc = [t.split("=", 1)[1] for t in ln.split() if t.startswith("locus=")]
                cur = loc[0] if loc and loc[0] in keep else None
                if cur:
                    out[cur] = []
            elif cur:
                out[cur].append(ln.strip())
    return {k: "".join(v).rstrip("*") for k, v in out.items()}


def fai_lengths(fa):
    return {ln.split("\t")[0]: int(ln.split("\t")[1]) for ln in open(fa + ".fai")}


def walk_to_allele(recs, gid, direction):
    """Nearest gene in `direction` ('p' or 'n') that has an allele."""
    while True:
        gid = (recs[gid].get("ord") or {}).get(direction)
        if not gid:
            return None
        if (recs[gid].get("allele") or {}).get("id"):
            return gid


def regions(recs, array):
    first, last = array[0], array[-1]
    lf, rf = walk_to_allele(recs, first, "p"), walk_to_allele(recs, last, "n")
    if not lf or not rf:
        sys.exit(f"FATAL: no allele-bearing flank on {'left' if not lf else 'right'} of the array")
    la, ra = recs[lf]["allele"]["id"], recs[rf]["allele"]["id"]
    if recs[la]["chr"] != recs[ra]["chr"]:
        sys.exit(f"FATAL: the flanks' alleles sit on different chromosomes ({la}, {ra}); the "
                 "region on the other haplotype is not defined by synteny here")
    h1 = {"chr": recs[first]["chr"], "start": recs[lf]["end"], "end": recs[rf]["start"],
          "flanks": [lf, rf]}
    a, b = sorted((recs[la], recs[ra]), key=lambda r: r["start"])
    h2 = {"chr": a["chr"], "start": a["end"], "end": b["start"], "flanks": [a["id"], b["id"]]}
    return {recs[first]["hap"]: h1, recs[la]["hap"]: h2}


def search(hap, queries_faa):
    os.makedirs(WORK, exist_ok=True)
    db = f"{WORK}/db_{hap}"
    if not glob.glob(db + "*.nsq"):
        print(f"  building BLAST db for {hap} ...", flush=True)
        sh(BLAST + f"makeblastdb -in {GENOME[hap]} -dbtype nucl -out {db} -parse_seqids")
    out = f"{WORK}/{os.path.basename(queries_faa)}.vs_{hap}.tsv"
    print(f"  tblastn vs {hap} ...", flush=True)
    sh(BLAST + f"tblastn -query {queries_faa} -db {db} -evalue {SEARCH_EVALUE} -num_threads {CPUS} "
               f"-max_target_seqs 500 -max_hsps 2000 "
               f"-outfmt '6 qseqid sseqid pident length qstart qend sstart send evalue bitscore' "
               f"-out {out}")
    hsps = []
    for ln in open(out):
        f = ln.rstrip("\n").split("\t")
        s, e = sorted((int(f[6]), int(f[7])))
        hsps.append({"q": f[0], "chr": f[1], "pid": float(f[2]), "qs": int(f[4]), "qe": int(f[5]),
                     "s": s - 1, "e": e,                      # BLAST 1-based -> BED
                     "ev": float(f[8]), "bits": float(f[9]),
                     "strand": "+" if int(f[6]) <= int(f[7]) else "-"})
    return hsps


def kept_reference(hs, reference):
    """The reference's alignments, each stretch of genome explained once by its best one."""
    kept = []
    for h in sorted((h for h in hs if h["q"] == reference), key=lambda h: (-h["bits"], h["s"])):
        if all(h["e"] <= k["s"] or h["s"] >= k["e"] for k in kept):
            kept.append(h)
    return sorted(kept, key=lambda h: h["s"])


def weighted_pid(hs):
    w = sum(h["qe"] - h["qs"] + 1 for h in hs)
    return round(sum(h["pid"] * (h["qe"] - h["qs"] + 1) for h in hs) / w, 1) if w else None


def summarise(hs, reference, ref_len, max_span):
    kept = kept_reference(hs, reference)
    covered = set()
    for h in kept:
        covered.update(range(h["qs"], h["qe"] + 1))
    genomic = sum(h["e"] - h["s"] for h in kept)
    # physical bound: a stretch of genome cannot encode more protein than its length / 3
    assert len(covered) <= genomic // 3 + len(kept), (len(covered), genomic)
    pieces, cur = [], []
    for h in kept:
        if cur and h["e"] - cur[0]["s"] > max_span:
            pieces.append(cur)
            cur = []
        cur.append(h)
    if cur:
        pieces.append(cur)
    return {
        "cov_aa": len(covered), "cov_pct": round(100 * len(covered) / ref_len, 1),
        "pid": weighted_pid(kept),
        "best_evalue": min(h["ev"] for h in hs),
        "queries_hitting": len({h["q"] for h in hs}),
        "pieces": [{"start": p[0]["s"], "end": max(h["e"] for h in p), "pid": weighted_pid(p),
                    "segs": [[h["qs"], h["qe"], round(h["pid"], 1)] for h in
                             sorted(p, key=lambda h: h["qs"])]} for p in pieces],
    }


def build_locus(recs, spec):
    seed = recs[spec["seed"]]
    array = sorted({spec["seed"], *[m for m, _ in (seed.get("td") or {}).get("mem", [])]},
                   key=lambda g: recs[g]["start"])
    if len(array) < 2:
        sys.exit(f"FATAL: {spec['seed']} is not in a tandem array (no td.mem)")
    hap = seed["hap"]
    reg = regions(recs, array)
    print(f"\n== {spec['name']}: {len(array)} array members on {hap}")
    for h, r in sorted(reg.items()):
        print(f"   {h} region {r['chr']}:{r['start']:,}-{r['end']:,} "
              f"({(r['end'] - r['start']) / 1000:.1f} kb) between {r['flanks'][0]} and {r['flanks'][1]}")

    # the regions must exist in the FASTA each search runs on: same seqname, inside its length
    for h, r in reg.items():
        L = fai_lengths(GENOME[h])
        if r["chr"] not in L or r["end"] > L[r["chr"]]:
            sys.exit(f"FATAL: {h} {r['chr']}:{r['end']} is not inside {GENOME[h]}")

    prot = read_proteins(PROT[hap], set(array))
    missing = set(array) - set(prot)
    if missing:
        sys.exit(f"FATAL: no protein for {sorted(missing)}")
    reference = sorted(array, key=lambda g: (-len(prot[g]), g))[0]
    ref_len = len(prot[reference])
    faa = f"{WORK}/{spec['slug']}_array.faa"
    os.makedirs(WORK, exist_ok=True)
    with open(faa, "w") as fh:
        for g in array:
            fh.write(f">{g}\n{prot[g]}\n")
    print(f"   reference {reference} ({ref_len} aa); array proteins "
          + ", ".join(f"{g.split('.')[-1]} {len(prot[g])}" for g in array))

    genes = defaultdict(list)
    for g in recs.values():
        genes[(g["hap"], g["chr"])].append(g)

    by_hap = {}
    for h, r in sorted(reg.items()):
        hsps = [x for x in search(h, faa)
                if x["chr"] == r["chr"] and x["s"] < r["end"] and x["e"] > r["start"]]
        by_gene, orphans = defaultdict(list), []
        for x in hsps:
            hit = [g["id"] for g in genes[(h, r["chr"])] if x["s"] < g["end"] and x["e"] > g["start"]]
            (by_gene[hit[0]].append(x) if hit else orphans.append(x))
        by_hap[h] = (by_gene, orphans, hsps)
        print(f"   {h}: {len(hsps)} alignments in the region, {len(by_gene)} annotated genes hit, "
              f"{len(orphans)} alignments on no gene")

    # CONTROL: every annotated member recovered on its own haplotype.
    got = set(by_hap[hap][0]) & set(array)
    if got != set(array):
        sys.exit(f"CONTROL FAILED: the search missed annotated members {sorted(set(array) - got)}; "
                 "it cannot see copies, so its answer for the other haplotype means nothing. "
                 "Nothing written.")
    print(f"   control: all {len(array)} annotated array members recovered")

    # MAX_SPAN: the most genome any annotated member's gene model covers.
    max_span, max_span_gene = max((recs[g]["end"] - recs[g]["start"], g) for g in array)
    print(f"   MAX_SPAN {max_span:,} bp ({max_span_gene}); no copy is taken to be longer")

    rows = []
    for h, (by_gene, orphans, _) in sorted(by_hap.items()):
        for gid, hs in by_gene.items():
            g = recs[gid]
            rows.append({"hap": h, "gene": gid, "chr": g["chr"], "start": g["start"],
                         "end": g["end"], "strand": g.get("strand"), "in_array": gid in array,
                         **summarise(hs, reference, ref_len, max_span)})
        orphans.sort(key=lambda x: (x["strand"], x["s"]))
        clusters = []
        for x in orphans:
            c = clusters[-1] if clusters else None
            if c and c["strand"] == x["strand"] and x["e"] - c["s"] <= max_span:
                c["hs"].append(x)
                c["e"] = max(c["e"], x["e"])
            else:
                clusters.append({"strand": x["strand"], "s": x["s"], "e": x["e"], "hs": [x]})
        for c in clusters:
            rows.append({"hap": h, "gene": None, "chr": reg[h]["chr"], "start": c["s"], "end": c["e"],
                         "strand": c["strand"], "in_array": False,
                         **summarise(c["hs"], reference, ref_len, max_span)})
    weak = [r for r in rows if r["best_evalue"] > ROW_EVALUE]
    for r in weak:
        print(f"     dropped, no alignment at E <= {ROW_EVALUE:g}: {r['hap']} {r['chr']}:{r['start']:,} "
              f"{r['gene'] or 'not annotated'} (best {r['best_evalue']:.1e})")
    rows = sorted((r for r in rows if r["best_evalue"] <= ROW_EVALUE),
                  key=lambda r: (r["hap"], r["start"]))

    self_row = next(r for r in rows if r["gene"] == reference)
    for r in rows:
        tag = r["gene"] or "not annotated"
        print(f"     {r['hap']} {r['chr']}:{r['start']:>11,} {tag:<20} covers {r['cov_pct']:5.1f}%  "
              f"id {r['pid'] if r['pid'] is not None else '-':>5}  pieces {len(r['pieces'])}")
    return {
        "name": spec["name"], "desc": spec["desc"], "seed": spec["seed"], "hap": hap,
        "array": array, "reference": {"id": reference, "aa": ref_len},
        "regions": reg, "search_evalue": SEARCH_EVALUE, "row_evalue": ROW_EVALUE,
        "max_span_bp": max_span, "max_span_gene": max_span_gene,
        "self_pid": self_row["pid"],
        "controls": {"array_members_recovered": [len(got), len(array)]},
        "rows": rows,
    }


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    recs = load_records()
    print(f"{len(recs):,} atlas gene records")
    loci = {spec["slug"]: build_locus(recs, spec) for spec in LOCI}
    doc = {"method": "tblastn (BLAST+ 2.14.1) of every array protein against each whole "
                     "haplotype genome; see scripts/make_copy_search_source.py",
           "inputs": {h: {"genome": os.path.basename(GENOME[h]), "genome_sha256": sha256(GENOME[h]),
                          "proteins": os.path.basename(PROT[h])} for h in sorted(GENOME)},
           "loci": loci}
    with open(OUT, "w") as fh:                               # written before anything is printed
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(f"\nwrote {os.path.relpath(OUT, ROOT)}: {len(loci)} locus, "
          f"{sum(len(l['rows']) for l in loci.values())} rows")


if __name__ == "__main__":
    main()
