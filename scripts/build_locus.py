#!/usr/bin/env python3
"""Build the locus layer: per-megabase structure tiles, per-chromosome position
indexes, and a whole-genome overview for the zoomed-out map.

Step 1 of docs/PLAN_locus_map_and_experimental_ux.md. Runs OFF-cluster: the only
external input is the v5.1 gene annotation, which lives in OneDrive, not on
Sapelo2. Repeats are deliberately NOT handled here — their intervals are
Sapelo2-only and their volume is unmeasured (plan 1.3).

Three outputs, each sized for how it is fetched:

  data/locus/tile/{hap}/{chr}/{mb}.json   the locus card's ONLY fetch. Genes in
      that megabase with position, strand, longest-isoform exon structure, and
      the handful of fields the card draws. Self-sufficient by design: a phone
      opening a gene page should not also pull a chromosome index.
  data/locus/index/{hap}/{chr}.json       every gene on the chromosome, position
      and class only, no structure. For the genome map.
  data/locus/overview.json                100 kb bins per chromosome per
      haplotype. For the zoomed-out map, loaded once.

Isoform choice is the annotation's own `longest=1` flag on the mRNA, not a
length computed here — the file already states which transcript is canonical.

Structure segments are [offset_from_gene_start, length, kind] with kind 1 = CDS,
0 = UTR, so the client draws thick CDS boxes and thin UTR boxes the way a
manuscript locus figure does.
"""
import roots
import argparse, collections, gzip, hashlib, json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
GFF_DEFAULT = (roots.path('onedrive_work', '03_resources/bioPoplar Genome Files/PtremulaxPopulusalbaALL_v5.1.gene.named.gff3'))
MB = 1_000_000
BIN = 100_000          # overview bin size
NAME_RE = re.compile(r"Name=([^;]+)")
PARENT_RE = re.compile(r"Parent=([^;]+)")


def seqid_to_hap_chr(seqid):
    """'Chr05_H1' -> ('hap1', 'Chr05');  'scaffold_33_H2' -> ('hap2', 'scaffold_33')."""
    if seqid.endswith("_H1"):
        return "hap1", seqid[:-3]
    if seqid.endswith("_H2"):
        return "hap2", seqid[:-3]
    return None, None


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_gff(path):
    """-> genes[gid] = dict(hap, chr, start, end, strand), feats[gid] = [(start,end,kind)]"""
    genes, feats = {}, collections.defaultdict(list)
    longest_mrna = {}          # mrna Name -> gene Name, only for longest=1
    n_lines = 0
    with open(path) as fh:
        for line in fh:
            if line[0] == "#":
                continue
            f = line.rstrip("\n").split("\t")
            if len(f) < 9:
                continue
            n_lines += 1
            typ = f[2]
            if typ == "gene":
                hap, chrom = seqid_to_hap_chr(f[0])
                if hap is None:
                    continue
                m = NAME_RE.search(f[8])
                if not m:
                    continue
                genes[m.group(1)] = {"hap": hap, "chr": chrom,
                                     "start": int(f[3]), "end": int(f[4]), "strand": f[6]}
            elif typ == "mRNA":
                if "longest=1" not in f[8]:
                    continue
                m, p = NAME_RE.search(f[8]), PARENT_RE.search(f[8])
                if m and p:
                    # Parent is the gene's ID (…​.v5.1); strip the suffix to the Name form.
                    longest_mrna[m.group(1)] = re.sub(r"\.v5\.1$", "", p.group(1))
            elif typ == "CDS" or typ.endswith("_UTR"):
                p = PARENT_RE.search(f[8])
                if not p:
                    continue
                mrna = re.sub(r"\.v5\.1$", "", p.group(1))
                gid = longest_mrna.get(mrna)
                if gid is None:
                    continue                      # a non-canonical isoform's feature
                feats[gid].append((int(f[3]), int(f[4]), 1 if typ == "CDS" else 0))
    print(f"  parsed {n_lines:,} feature lines")
    return genes, feats


def load_shard_fields():
    """Per gene, the few fields the locus card draws. From the committed shards, so
    this stays consistent with whatever the last data build produced."""
    out = {}
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in fs:
                if not fn.endswith(".json"):
                    continue
                for gid, rec in json.load(open(os.path.join(dp, fn))).items():
                    dup = rec.get("dup") or {}
                    x = rec.get("x") or {}
                    ps = rec.get("ps") or {}
                    syn = rec.get("syn") or {}
                    out[gid] = {
                        "c": dup.get("t"),                       # A/S/T/D/C letters
                        "a": dup.get("td") or None,              # tandem array id, 0 -> None
                        "t": x.get("tau"),
                        "p": x.get("top"),
                        "l": bool(ps.get("lsg")),
                        "y": syn.get("cls"),
                        "n": (rec.get("ann") or {}).get("d"),    # description, for the tooltip
                        "al": (rec.get("allele") or {}).get("id"),
                    }
    return out


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"))
    return os.path.getsize(path)


def gz_size(path):
    with open(path, "rb") as fh:
        return len(gzip.compress(fh.read(), 6))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gff", default=os.environ.get("ATLAS_GFF", GFF_DEFAULT))
    ap.add_argument("--out", default=os.path.join(DATA, "locus"))
    a = ap.parse_args()

    if not os.path.exists(a.gff):
        sys.exit(f"annotation not found: {a.gff}\nSet ATLAS_GFF or pass --gff.")

    print(f"reading {os.path.basename(a.gff)} ({os.path.getsize(a.gff)/1e6:.0f} MB)")
    genes, feats = read_gff(a.gff)
    print(f"  {len(genes):,} genes, {sum(len(v) for v in feats.values()):,} "
          f"longest-isoform CDS/UTR features")

    fields = load_shard_fields()
    print(f"  {len(fields):,} genes carry shard fields")

    # The annotation and the atlas must describe the same gene set. A mismatch here
    # means the locus layer would silently disagree with every other layer.
    only_gff = set(genes) - set(fields)
    only_atlas = set(fields) - set(genes)
    assert not only_gff, f"{len(only_gff)} genes in the GFF3 but not the atlas, e.g. {sorted(only_gff)[:3]}"
    assert not only_atlas, f"{len(only_atlas)} genes in the atlas but not the GFF3, e.g. {sorted(only_atlas)[:3]}"
    print(f"  gene sets match exactly ({len(genes):,})")

    tiles = collections.defaultdict(list)      # (hap, chr, mb) -> [rec]
    index = collections.defaultdict(list)      # (hap, chr)     -> [rec]
    bins = collections.defaultdict(lambda: collections.defaultdict(
        lambda: {"n": 0, "td": 0, "lsg": 0, "tau": 0.0, "ntau": 0}))

    for gid, g in genes.items():
        fl = fields[gid]
        segs = sorted(feats.get(gid, []))
        # offsets relative to gene start keep the integers small and gzip-friendly
        struct = [[s - g["start"], e - s + 1, k] for s, e, k in segs]
        strand = 1 if g["strand"] == "+" else -1

        tiles[(g["hap"], g["chr"], g["start"] // MB)].append({
            "g": gid, "s": g["start"], "e": g["end"], "d": strand,
            "c": fl["c"], "a": fl["a"], "t": fl["t"], "p": fl["p"],
            "l": fl["l"], "y": fl["y"], "n": fl["n"], "al": fl["al"],
            "f": struct,
        })
        index[(g["hap"], g["chr"])].append({
            "g": gid, "s": g["start"], "e": g["end"], "d": strand,
            "c": fl["c"], "t": fl["t"], "p": fl["p"], "l": fl["l"],
        })
        b = bins[(g["hap"], g["chr"])][g["start"] // BIN]
        b["n"] += 1
        if fl["a"]:
            b["td"] += 1
        if fl["l"]:
            b["lsg"] += 1
        if fl["t"] is not None:
            b["tau"] += fl["t"]
            b["ntau"] += 1

    # ---- write tiles -------------------------------------------------------------
    n_tiles = raw = 0
    sizes = []
    for (hap, chrom, mb), recs in sorted(tiles.items()):
        recs.sort(key=lambda r: r["s"])
        p = os.path.join(a.out, "tile", hap, chrom, f"{mb}.json")
        sz = write_json(p, recs)
        raw += sz
        sizes.append(gz_size(p))
        n_tiles += 1
    sizes.sort()
    print(f"\ntiles: {n_tiles} files, {raw/1e6:.1f} MB raw")
    print(f"  gzipped per tile: median {sizes[len(sizes)//2]/1024:.1f} KB, "
          f"p95 {sizes[int(len(sizes)*0.95)]/1024:.1f} KB, max {sizes[-1]/1024:.1f} KB")
    print(f"  gzipped total: {sum(sizes)/1e6:.1f} MB")

    # ---- write per-chromosome indexes --------------------------------------------
    idx_raw = 0
    idx_gz = []
    for (hap, chrom), recs in sorted(index.items()):
        recs.sort(key=lambda r: r["s"])
        p = os.path.join(a.out, "index", hap, f"{chrom}.json")
        idx_raw += write_json(p, recs)
        idx_gz.append(gz_size(p))
    print(f"index: {len(index)} files, {idx_raw/1e6:.1f} MB raw, "
          f"{sum(idx_gz)/1e6:.1f} MB gz, max {max(idx_gz)/1024:.0f} KB gz")

    # ---- overview ----------------------------------------------------------------
    ov = {"bin": BIN, "hap": {}}
    for (hap, chrom), bb in sorted(bins.items()):
        top = max(bb) if bb else 0
        rows = []
        for i in range(top + 1):
            b = bb.get(i)
            if not b:
                rows.append([0, 0, 0, None])
            else:
                rows.append([b["n"], b["td"], b["lsg"],
                             round(b["tau"] / b["ntau"], 3) if b["ntau"] else None])
        ov["hap"].setdefault(hap, {})[chrom] = rows
    p = os.path.join(a.out, "overview.json")
    ov_raw = write_json(p, ov)
    print(f"overview: {ov_raw/1e3:.0f} KB raw, {gz_size(p)/1e3:.0f} KB gz")

    # ---- provenance --------------------------------------------------------------
    side = {
        "built": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "annotation": a.gff,
        "annotation_sha256": sha256(a.gff),
        "genes": len(genes),
        "features_longest_isoform": sum(len(v) for v in feats.values()),
        "isoform_rule": "the annotation's own longest=1 flag on the mRNA",
        "tiles": n_tiles,
        "tile_mb": MB // 1_000_000,
        "overview_bin": BIN,
        "structure_encoding": "[offset_from_gene_start, length, kind]; kind 1=CDS, 0=UTR",
        "excludes": "repeat intervals — Sapelo2-only, see plan 1.3",
    }
    write_json(os.path.join(ROOT, "sources", "locus.provenance.json"), side)
    print("\nwrote sources/locus.provenance.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
