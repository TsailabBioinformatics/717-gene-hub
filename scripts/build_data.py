#!/usr/bin/env python3
"""
Build static JSON shards for the poplar 717 gene atlas.

DESIGN: the gene ID encodes its own shard, so the client needs NO index file.
    PtXaTreH.05G120200  -> hap1 / Chr05
    PtXaAlbH.14G133000  -> hap2 / Chr14
    PtXaTreH.T000100    -> hap1 / scaffolds   (T-form: 131 genes, HAP1 only)
A gene page is therefore ONE fetch with zero lookup tables. Because that rule is load-bearing
for every page, the build ASSERTS it reproduces the real BED coordinate for all 63,960 genes
and fails loudly if the annotation ever breaks the convention.

Tiers: --tier full  (everything, private repo / local)
       --tier public (drops fields marked private in FIELD_TIERS)
So what is publishable is a build flag, not a rewrite. GitHub Pages is PUBLIC even from a
private repo, so the public tier is the only thing that may ever be deployed.
"""
import roots
import argparse, csv, gzip, hashlib, json, os, re, shutil, sys, time
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Single source of truth for the release version. Read from disk rather than restated here,
# so VERSION, the manifest, CITATION.cff and CHANGELOG.md cannot drift apart unnoticed.
# scripts/check_version.py asserts all four agree; it caught this key being READ in three
# places (validator, footer, About page) while no build script ever WROTE it -- a rebuild
# silently dropped the version chip instead of failing.
VERSION = open(os.path.join(ROOT, "VERSION")).read().strip()

MS2  = roots.path('scratch', 'ms2_genespace')
GENERA = roots.path('scratch', 'genera')
HAPS = {"Ptrxalhap1": ("hap1", "PtXaTreH"), "Ptrxalhap2": ("hap2", "PtXaAlbH")}

# Every currently shipped computational layer is public.  LSG membership remains public
# because the displayed phylostratigraphic rank already makes pool membership inferable.
# Candidate labels stay out of the data tree and are enforced by the release validator.
# Add future embargoed wet-lab fields here before they enter public shards.
FIELD_TIERS = {}

SRC = {}
def note(path):
    """Record provenance for every input actually read."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    SRC[path] = {"sha256": h.hexdigest()[:16], "bytes": os.path.getsize(path),
                 "mtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(os.path.getmtime(path)))}
    return path

# Genes are numbered in steps of 100 within a chromosome, so dividing the numeric suffix by
# BUCKET_SPAN yields at most BUCKET_SPAN/100 genes per shard -- deterministically, with no
# index. 25,000 gives <=250 genes (~40 KB gzipped) instead of a whole chromosome (up to
# 3.9 MB raw / 600 KB gzipped) for a page that renders exactly one gene.
BUCKET_SPAN = 25000

def shard_of(gene_id):
    """THE CLIENT RULE. Must be mirrored exactly in js/core/data.js."""
    m = re.match(r"^PtXa(TreH|AlbH)\.(\d\d)G(\d+)$", gene_id)
    if m:
        hap = "hap1" if m.group(1) == "TreH" else "hap2"
        return hap, f"Chr{m.group(2)}/{int(m.group(3)) // BUCKET_SPAN}"
    m = re.match(r"^PtXa(TreH|AlbH)\.T\d+$", gene_id)
    if m:
        return ("hap1" if m.group(1) == "TreH" else "hap2"), "scaffolds"
    raise ValueError(f"gene id does not match the shard convention: {gene_id}")

def read_bed():
    genes = {}
    for gname, (hap, _) in HAPS.items():
        with open(note(f"{MS2}/workdir/bed/{gname}.bed")) as fh:
            for line in fh:
                chrom, start, end, gid = line.rstrip("\n").split("\t")
                genes[gid] = {"id": gid, "hap": hap, "chr": chrom.split("-", 1)[1],
                              "start": int(start), "end": int(end)}
    return genes

def read_strand():
    strand = {}
    p = f"{MS2}/incoming/synteny_orthogroups.tsv"
    if not os.path.exists(p):
        return strand
    with open(note(p)) as fh:
        r = csv.DictReader(fh, delimiter="\t")
        for row in r:
            if row["genome"] in HAPS and row["strand"] in "+-":
                strand[row["gene_id"]] = row["strand"]
    return strand

def read_pangene_flags():
    """PASS / NSOrtho / array per focal gene, from the RAW placements.

    Recomputed here rather than reused from the SUPERSET's `syntenic_support`, which is
    "has PASS AND NOT array" and so disagrees for the 24 genes carrying both flags. The
    class rule keys on exactly these, so take them from source.
    """
    flags = defaultdict(lambda: {"pass": False, "ns": False, "ar": False})
    p = f"{MS2}/tier3_input_v2_20260901_runA/pangenes_long_RAW.tsv.gz"
    note(p)
    with gzip.open(p, "rt") as fh:
        r = csv.DictReader(fh, delimiter="\t")
        for row in r:
            if row["genome"] not in HAPS:
                continue
            f = flags[row["id"]]
            fl = row["flag"]
            if fl == "PASS":      f["pass"] = True
            elif fl == "NSOrtho": f["ns"] = True
            elif fl == "array":   f["ar"] = True
    return dict(flags)

def read_synteny():
    out = {}
    flags = read_pangene_flags()
    print(f"pangene flags: {len(flags)} genes")
    with open(note(f"{MS2}/step7_diff_20260901/diff_all_genes.tsv")) as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            out[row["gene_id"]] = {
                "cls":     row["cls_new"],
                "cls_old": row["class_old"],
                "n":       int(row["n_new"]) if row["n_new"] else None,
                "n_old":   int(row["n_old"]) if row["n_old"] else None,
                "og":      row["of_og_new"] or None,
                "og_old":  row["og_id_old"] or None,
                "changed": row["class_old"] != row["cls_new"],
                "stable":  row["sens_stable"] == "TRUE",
                "flags":   flags.get(row["gene_id"], {"pass": False, "ns": False, "ar": False}),
            }
    return out

def read_ps():
    out = {}
    for hapn in (1, 2):
        p = f"{GENERA}/output/hap{hapn}/genera_717hap{hapn}_v5.1/80863_gene_ages.tsv"
        with open(note(p)) as fh:
            next(fh)
            for line in fh:
                f = line.rstrip("\n").split("\t")
                gid = re.sub(r"\.\d+\.p$", "", f[0])
                # genEra emits rank "NA" for genes it could not place (ambiguous strata).
                # Keep the gene with rank=None rather than dropping it -- an unplaced gene
                # is a real state the gene page should show, not an absence.
                if f[2] == "NA":
                    out[gid] = {"rank": None, "name": f[1] if f[1] != "NA" else None,
                                "tr": None, "lsg": False, "unplaced": True}
                    continue
                rank = int(f[2])
                out[gid] = {"rank": rank, "name": f[1],
                            "tr": float(f[3]) if f[3] else None, "lsg": rank >= 18}
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", choices=["full", "public"], default="full")
    ap.add_argument("--out", default=roots.path('atlas', 'data'))
    a = ap.parse_args()

    genes = read_bed()
    print(f"BED: {len(genes)} genes")
    strand, syn, ps = read_strand(), read_synteny(), read_ps()
    print(f"strand: {len(strand)}  synteny: {len(syn)}  phylostrat: {len(ps)}")

    # --- the load-bearing assertion -------------------------------------------------------
    bad = []
    for gid, g in genes.items():
        try:
            hap, key = shard_of(gid)
        except ValueError as e:
            bad.append(str(e)); continue
        expect = g["chr"] if g["chr"].startswith("Chr") else "scaffolds"
        got_chr = key.split("/")[0]
        if (hap, got_chr) != (g["hap"], expect):
            bad.append(f"{gid}: rule says {hap}/{key}, BED says {g['hap']}/{expect}")
    if bad:
        print(f"FAIL: shard rule disagrees with the annotation for {len(bad)} genes:", file=sys.stderr)
        for b in bad[:10]:
            print("   ", b, file=sys.stderr)
        return 1
    print(f"shard rule verified against BED for all {len(genes)} genes")

    shards, missing = defaultdict(dict), defaultdict(int)
    for gid, g in genes.items():
        hap, key = shard_of(gid)
        rec = dict(g)
        rec.pop("hap")
        if gid in strand: rec["strand"] = strand[gid]
        else: missing["strand"] += 1
        if gid in syn: rec["syn"] = syn[gid]
        else: missing["synteny"] += 1
        if gid in ps:
            p = dict(ps[gid])
            if a.tier == "public":
                for f, t in FIELD_TIERS.items():
                    if t == "private": p.pop(f, None)
            rec["ps"] = p
        else: missing["phylostrat"] += 1
        shards[f"{hap}/{key}"][gid] = rec
    if missing:
        print("genes missing a layer:", dict(missing))

    outdir = os.path.join(a.out, "genes")
    # Wipe first. Re-running after a sharding change previously LEFT the old layout in place,
    # so the patcher scripts walked both and every gene was patched twice (127,789 records for
    # 63,960 genes). Stale shards are worse than missing ones -- they still serve.
    if os.path.isdir(outdir):
        shutil.rmtree(outdir)
    os.makedirs(outdir, exist_ok=True)
    counts = {}
    for key, recs in sorted(shards.items()):
        p = os.path.join(outdir, key + ".json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as fh:
            json.dump(recs, fh, separators=(",", ":"), sort_keys=True)
        counts[key] = len(recs)

    # Summary stats the landing/module pages need without loading every shard.
    summ = {"synteny_class": defaultdict(int), "ps_rank": defaultdict(int),
            "by_chr": defaultdict(int), "changed": 0, "unstable": 0}
    for recs in shards.values():
        for gid, r in recs.items():
            summ["by_chr"][f"{shard_of(gid)[0]}/{r['chr']}"] += 1
            if "syn" in r:
                summ["synteny_class"][r["syn"]["cls"]] += 1
                summ["changed"] += bool(r["syn"]["changed"])
                summ["unstable"] += not r["syn"]["stable"]
            if "ps" in r:
                summ["ps_rank"][str(r["ps"]["rank"])] += 1
    summ = {k: (dict(v) if isinstance(v, defaultdict) else v) for k, v in summ.items()}

    man = {"built": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "tier": a.tier,
           "data_version": VERSION,
           "n_genes": len(genes), "shards": counts, "summary": summ,
           "modules": ["core", "synteny", "phylostrat"], "sources": SRC,
           # recorded corrections travel with every build (they used to live only in the old manifest)
           "corrections": json.load(open(os.path.join(roots.root('atlas'), "sources",
                                                      "manifest_corrections.json")))["corrections"]}
    os.makedirs(os.path.join(a.out, "meta"), exist_ok=True)
    with open(os.path.join(a.out, "meta", "manifest.json"), "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)

    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(a.out) for f in fs)
    print(f"wrote {len(counts)} shards, {sum(counts.values())} genes, {total/1e6:.1f} MB "
          f"-> {a.out}  (tier={a.tier})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
