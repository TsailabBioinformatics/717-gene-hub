#!/usr/bin/env python3
"""TODO 34b: gate the per-residue ESMFold records, then pack them into data/struct/.

Input: <scratch>/atlas_structure_ca/ca_NN.jsonl.gz, written by
make_structure_source.py (Sapelo2 only). Nothing here reads a PDB.

THE GATE. Every gene page already shows ESMFold numbers -- residue count, mean pLDDT,
fraction below 70, helix and strand fractions -- built from secondary_structure_summary.tsv.
The per-residue arrays this script ships must reproduce ALL FIVE for EVERY one of those genes,
and cover exactly that gene set, or it writes nothing. A viewer that drew a different model
from the one the numbers beside it describe would be the "stable and wrong" failure this
repo's checks cannot otherwise see.

Then a second, independent check on the output: every bucket is decoded back with a decoder
written the way the browser reads it, and compared integer-for-integer with the records.

BUCKET RULE (mirrored in js/core/data.js:structKey and validate_data.py:struct_key):
  PtXa{TreH|AlbH}.NNGmmmmmm -> data/struct/{hap1|hap2}/ChrNN/{mmmmmm // 2500}.bin.gz
  PtXa{TreH|AlbH}.Tmmmmmm   -> data/struct/{hap1|hap2}/scaffolds/{mmmmmm // 2500}.bin.gz
Ten times finer than the gene shards: ~15 models, ~25 KB per fetch.

FILE FORMAT (gzip, mtime 0 so rebuilds are byte-identical):
  uint32 LE  header length H (multiple of 4)
  H bytes    JSON {"v":1,"unit":0.1,"genes":{id:[offset,n],...}}, space-padded
  payload    per gene, at `offset` from the payload start, 10*n bytes:
               int16 LE [3n]  Calpha x,y,z in 0.1 A; residue 0 absolute, then deltas
               uint16 LE [n]  pLDDT x 100
               uint8 [n]      sequence, ASCII
               uint8 [n]      DSSP c3, ASCII '-', 'H', 'E'
"""
import roots
import csv
import glob
import gzip
import hashlib
import json
import os
import re
import struct
import sys
from collections import Counter, defaultdict

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "struct")
SRC = roots.path('scratch', 'atlas_structure_ca')
PDB_ROOT = roots.path('scratch', 'foldseek/results')
# the exact file build_layers.py reads for prot.ss (md5-identical to sequence_features' copy)
SS_TABLE = roots.path('ms2_lsg', 'analyses/esmfold_secondary_structure/results/secondary_structure_summary.tsv')
N_SHARDS = 24
STRUCT_SPAN = 2500
EXPECTED_SKIPPED = {"PtXaTreH.08G115400"}    # a 0-byte PDB; absent from the SS table too
AA = set("ACDEFGHIKLMNPQRSTVWYX")


def struct_key(gene_id):
    """THE CLIENT RULE. Must be mirrored exactly in js/core/data.js:structKey."""
    m = re.match(r"^PtXa(TreH|AlbH)\.(\d\d)G(\d+)$", gene_id)
    if m:
        return ("hap1" if m.group(1) == "TreH" else "hap2"), f"Chr{m.group(2)}/{int(m.group(3)) // STRUCT_SPAN}"
    m = re.match(r"^PtXa(TreH|AlbH)\.T(\d+)$", gene_id)
    if m:
        return ("hap1" if m.group(1) == "TreH" else "hap2"), f"scaffolds/{int(m.group(2)) // STRUCT_SPAN}"
    raise ValueError(gene_id)


def load_shard_ss():
    ss = {}
    for path in sorted(glob.glob(os.path.join(DATA, "genes", "*", "**", "*.json"), recursive=True)):
        with open(path) as fh:
            for gid, g in json.load(fh).items():
                s = (g.get("prot") or {}).get("ss")
                if s:
                    ss[gid] = s
    return ss


def load_records():
    files = [os.path.join(SRC, f"ca_{i:02d}.jsonl.gz") for i in range(N_SHARDS)]
    missing = [f for f in files if not os.path.exists(f)]
    assert not missing, f"source shards missing (array not finished?): {missing}"
    stray = glob.glob(os.path.join(SRC, "*.tmp"))
    assert not stray, f"half-written source shard present: {stray}"
    recs, skipped = {}, set()
    for i, f in enumerate(files):
        with gzip.open(f, "rt") as fh:
            for line in fh:
                r = json.loads(line)
                assert r["g"] not in recs, f"duplicate record {r['g']}"
                recs[r["g"]] = r
        with open(os.path.join(SRC, f"ca_{i:02d}.skipped.txt")) as fh:
            skipped |= {l.strip() for l in fh if l.strip()}
    return recs, skipped


def load_source_table():
    """The table build_layers.py built prot.ss from (4 decimals), keyed like the atlas."""
    out = {}
    with open(SS_TABLE) as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            gid = r["gene_id"]
            assert gid.endswith(".1.p"), gid
            out[gid[:-4]] = r
    return out


def gate(recs, skipped, shard_ss, tsv):
    """Return a dict of field -> list of offending genes. Empty lists everywhere = pass."""
    bad = defaultdict(list)
    if set(tsv) != set(shard_ss):
        bad["source table and shard cover different genes"] = sorted(set(tsv) ^ set(shard_ss))
    if skipped != EXPECTED_SKIPPED:
        bad["unexpected skipped set"] = sorted(skipped ^ EXPECTED_SKIPPED)
    only_src = sorted(set(recs) - set(shard_ss))
    only_atlas = sorted(set(shard_ss) - set(recs))
    if only_src:
        bad["record with no prot.ss in the atlas"] = only_src
    if only_atlas:
        bad["prot.ss with no record"] = only_atlas
    for gid in sorted(set(recs) & set(shard_ss)):
        r, s = recs[gid], shard_ss[gid]
        n = r["n"]
        if not (len(r["ca"]) == 3 * n and len(r["pl"]) == n and len(r["seq"]) == n and len(r["ss"]) == n):
            bad["array lengths disagree with n"].append(gid)
            continue
        if n != s["n"]:
            bad["n"].append(gid)
        # Two links, and NO tolerance on either. History, because both shortcuts were tried:
        #  - arrays vs shard at 0.00051 failed ~1,400 genes. The shard is the 4-decimal table
        #    re-rounded to 3, so it sits up to 0.0005 + 0.00005 from the truth.
        #  - arrays vs table at half a unit then failed 1 gene on mean pLDDT (88.795005 in
        #    float64 against "88.79"): ss_content.py averages float32, which lands on 88.794998.
        # Loosening either tolerance would have passed. Replaying the producer's own arithmetic
        # and formatting instead reproduces every field of every gene as an identical STRING.
        #   (1) arrays -> source table: ss_content.py's computation and format, verbatim
        pl = (np.asarray(r["pl"], dtype=np.float64) / 100).astype(np.float32)
        c = Counter(r["ss"])
        h = float(c["H"]) / n
        e = float(c["E"]) / n
        replay = {"n_residues": str(n), "helix_frac": f"{h:.4f}", "strand_frac": f"{e:.4f}",
                  "coil_frac": f"{1.0 - h - e:.4f}", "mean_plddt": f"{pl.mean():.2f}",
                  "frac_plddt_lt70": f"{float((pl < 70).mean()):.4f}"}
        t = tsv[gid]
        for col, v in replay.items():
            if t[col] != v:
                bad[f"{col} vs source table"].append(gid)
        #   (2) source table -> shard: exactly the rounding build_layers.py applies
        for k, col in (("plddt", "mean_plddt"), ("low", "frac_plddt_lt70"), ("h", "helix_frac"), ("e", "strand_frac")):
            if round(float(t[col]), 3) != s[k]:
                bad[f"{k}: shard is not round(source, 3)"].append(gid)
        if set(c) - {"-", "H", "E"}:
            bad["ss alphabet"].append(gid)
        if set(r["seq"]) - AA:
            bad["seq alphabet"].append(gid)
    return bad


def pack(genes):
    """genes: list of records, sorted. Returns the gzipped bucket bytes."""
    index, chunks, off = {}, [], 0
    for r in genes:
        n = r["n"]
        ca = np.asarray(r["ca"], dtype=np.int64).reshape(n, 3)
        enc = ca.copy()
        enc[1:] = ca[1:] - ca[:-1]
        assert np.abs(enc).max() < 32768, f"{r['g']}: coordinate out of int16 range"
        pl = np.asarray(r["pl"], dtype=np.int64)
        assert pl.min() >= 0 and pl.max() <= 10000, r["g"]
        body = (enc.astype("<i2").tobytes() + pl.astype("<u2").tobytes()
                + r["seq"].encode("ascii") + r["ss"].encode("ascii"))
        assert len(body) == 10 * n
        index[r["g"]] = [off, n]
        chunks.append(body)
        off += len(body)
    header = json.dumps({"v": 1, "unit": 0.1, "genes": index}, sort_keys=True,
                        separators=(",", ":")).encode()
    header += b" " * (-len(header) % 4)
    raw = struct.pack("<I", len(header)) + header + b"".join(chunks)
    return gzip.compress(raw, compresslevel=9, mtime=0)


def unpack(blob):
    """Decode the way js/core/data.js does. Returns {gene: (ca ints (n,3), pl, seq, ss)}."""
    raw = gzip.decompress(blob)
    (h,) = struct.unpack_from("<I", raw, 0)
    head = json.loads(raw[4:4 + h])
    base = 4 + h
    out = {}
    for gid, (off, n) in head["genes"].items():
        p = base + off
        enc = np.frombuffer(raw, dtype="<i2", count=3 * n, offset=p).reshape(n, 3).astype(np.int64)
        ca = np.cumsum(enc, axis=0)
        pl = np.frombuffer(raw, dtype="<u2", count=n, offset=p + 6 * n).astype(np.int64)
        seq = raw[p + 8 * n: p + 9 * n].decode("ascii")
        ss = raw[p + 9 * n: p + 10 * n].decode("ascii")
        out[gid] = (ca, pl, seq, ss)
    return out


def main():
    shard_ss = load_shard_ss()
    recs, skipped = load_records()
    print(f"atlas genes with prot.ss: {len(shard_ss):,}; source records: {len(recs):,}; skipped: {sorted(skipped)}")

    bad = gate(recs, skipped, shard_ss, load_source_table())
    for field, genes in bad.items():
        print(f"  GATE FAIL {field}: {len(genes)} e.g. {genes[:5]}")
    if bad:
        sys.exit("refusing to write data/struct: the per-residue records do not reproduce the published ss layer")
    print(f"gate: all {len(recs):,} genes reproduce every field of the source table as an identical "
          "string, and every shard value is that table rounded to 3")

    buckets = defaultdict(list)
    for gid in sorted(recs):
        hap, key = struct_key(gid)
        buckets[(hap, key)].append(recs[gid])

    written, total, max_step = set(), 0, 0.0
    for (hap, key), genes in sorted(buckets.items()):
        blob = pack(genes)
        path = os.path.join(OUT, hap, key + ".bin.gz")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(blob)
        written.add(os.path.relpath(path, OUT))
        total += len(blob)
        back = unpack(blob)
        assert set(back) == {r["g"] for r in genes}, f"{path}: gene set changed in round trip"
        for r in genes:
            ca, pl, seq, ss = back[r["g"]]
            assert ca.ravel().tolist() == r["ca"] and pl.tolist() == r["pl"], f"{r['g']}: round trip"
            assert seq == r["seq"] and ss == r["ss"], f"{r['g']}: round trip"
            if r["n"] > 1:
                max_step = max(max_step, float(np.linalg.norm(np.diff(ca, axis=0), axis=1).max()) / 10)

    stray = sorted(set(os.path.relpath(p, OUT) for p in glob.glob(os.path.join(OUT, "**", "*.bin.gz"), recursive=True)) - written)
    assert not stray, f"data/struct holds buckets this build did not write (remove them by hand): {stray[:5]}"
    print(f"wrote {len(written):,} buckets, {total / 1e6:.1f} MB; every one decoded back identically; "
          f"largest Calpha-Calpha step {max_step:.1f} A")

    # provenance: what was read, fingerprinted without re-reading 9.4 GB
    listing = sorted((h, os.path.basename(p), os.path.getsize(p))
                     for h in ("hap1", "hap2")
                     for p in glob.glob(f"{PDB_ROOT}/{h}/esmfold/pdbs/*.pdb"))
    pdb_sha = hashlib.sha256("".join(f"{h}\t{b}\t{s}\n" for h, b, s in listing).encode()).hexdigest()
    rec_sha = hashlib.sha256("".join(json.dumps(recs[g], sort_keys=True) + "\n" for g in sorted(recs)).encode()).hexdigest()
    by_hap = Counter(r["hap"] for r in recs.values())
    info = {
        "genes": len(recs), "hap1": by_hap["hap1"], "hap2": by_hap["hap2"],
        "buckets": len(written), "bytes": total, "span": STRUCT_SPAN,
        "what": "ESMFold Calpha trace (0.1 A), per-residue pLDDT, sequence and pydssp c3 secondary "
                "structure. Not the full-atom model: that is 2.3 GB gzipped, over the Pages site cap.",
        "excluded": {"PtXaTreH.08G115400": "ESMFold PDB is 0 bytes; also absent from the SS table"},
        "gate": "per-residue arrays reproduce n_residues, mean_plddt, frac_plddt_lt70, helix_frac and "
                "strand_frac of secondary_structure_summary.tsv to half a unit of its last decimal, "
                "for every gene; and every shard ss value is that table rounded to 3 decimals",
    }
    prov = dict(info, pdb_root=PDB_ROOT, pdb_files=len(listing), pdb_listing_sha256=pdb_sha,
                records_sha256=rec_sha, extractor="scripts/make_structure_source.py",
                parser_origin="sequence_features/scripts/ss_content.py:parse_backbone (copied)")
    with open(os.path.join(ROOT, "sources", "structure_ca.provenance.json"), "w") as fh:
        json.dump(prov, fh, indent=2, sort_keys=True)
        fh.write("\n")

    mpath = os.path.join(DATA, "meta", "manifest.json")
    with open(mpath) as fh:
        man = json.load(fh)
    man["structure"] = info
    # a patcher that changes data/ is a data release: stamp VERSION the way build_data.py does,
    # so check_version.py holds it equal to CITATION.cff and the newest CHANGELOG heading
    with open(os.path.join(ROOT, "VERSION")) as fh:
        man["data_version"] = fh.read().strip()
    man["layers"]["coverage"]["ESMFold 3D model (C-alpha trace)"] = len(recs)
    with open(mpath, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=False)
        fh.write("\n")
    print("manifest.structure + sources/structure_ca.provenance.json written")


if __name__ == "__main__":
    main()
