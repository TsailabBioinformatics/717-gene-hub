#!/usr/bin/env python3
"""TODO 34a: per-residue Calpha trace, pLDDT, sequence and DSSP for every ESMFold model.

Sapelo2-only -- reads the 40,686 PDBs under <scratch>/foldseek/results, which are
not in this repo and never will be (9.4 GB raw, 2.3 GB gzipped: over the Pages cap alone).
Run as an sbatch array (scripts/make_structure_source.sbatch); writes one gzipped JSONL per
array task OUTSIDE the repo. patch_structure.py then gates those records against what the
atlas already publishes and packs them into data/struct/.

The backbone parser is a copy of sequence_features/scripts/ss_content.py:parse_backbone --
the script that produced the ss.* numbers every gene page already shows -- extended only
to also keep each residue's name. Same altloc rule, same "drop a residue with an incomplete
backbone" rule, same float32 input to pydssp. That is what makes the downstream gate an
exact one: a residue count or a helix fraction that differs from the shard is a real
disagreement, not a parser difference.

Record per gene (keys kept short; ~40k of them):
  g    gene id without the .1.p suffix (the atlas key)
  hap  hap1 | hap2
  n    residues kept
  ca   flat [x0,y0,z0,x1,...] Calpha coordinates in units of 0.1 Angstrom, integers
  pl   CA B-factor (ESMFold pLDDT) x 100, integers -- the PDB carries 2 decimals, so lossless
  seq  one-letter sequence of the kept residues
  ss   pydssp c3 string, one of '-', 'H', 'E' per residue
"""
import roots
import glob
import gzip
import json
import os
import sys

import numpy as np
import pydssp

PDB_ROOT = roots.path('scratch', 'foldseek/results')
BB = ("N", "CA", "C", "O")
SUFFIX = ".1.p.pdb"
AA3 = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E",
    "GLY": "G", "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F",
    "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}


def parse_backbone(path):
    """ss_content.py's parser, plus residue names. Returns (L,4,3), (L,), seq, or None."""
    res = {}
    order = []
    names = {}
    with open(path) as fh:
        for line in fh:
            if not line.startswith("ATOM"):
                if line.startswith("ENDMDL"):
                    break
                continue
            name = line[12:16].strip()
            if name not in BB:
                continue
            if line[16] not in (" ", "A"):      # altloc
                continue
            key = (line[21], line[22:27])        # chain, resseq+icode
            if key not in res:
                res[key] = {}
                order.append(key)
                names[key] = line[17:20]
            res[key][name] = (
                float(line[30:38]), float(line[38:46]), float(line[46:54]),
                float(line[60:66]),
            )
    coords, plddt, seq = [], [], []
    for key in order:
        d = res[key]
        if not all(a in d for a in BB):
            continue                              # incomplete backbone: drop
        coords.append([d[a][:3] for a in BB])
        plddt.append(d["CA"][3])
        seq.append(AA3.get(names[key], "X"))
    if len(coords) < 4:
        return None
    return (np.asarray(coords, dtype=np.float32), np.asarray(plddt, dtype=np.float32),
            "".join(seq))


def all_pdbs():
    out = []
    for hap in ("hap1", "hap2"):
        for p in sorted(glob.glob(f"{PDB_ROOT}/{hap}/esmfold/pdbs/*.pdb")):
            out.append((hap, p))
    return out


def main(out_dir, shard, nshards):
    os.makedirs(out_dir, exist_ok=True)
    mine = all_pdbs()[shard::nshards]
    out = os.path.join(out_dir, f"ca_{shard:02d}.jsonl.gz")
    tmp = out + ".tmp"
    skipped = []
    n = 0
    with gzip.open(tmp, "wt") as fh:
        for hap, p in mine:
            base = os.path.basename(p)
            assert base.endswith(SUFFIX), base
            gene = base[: -len(SUFFIX)]
            parsed = parse_backbone(p) if os.path.getsize(p) else None
            if parsed is None:
                skipped.append(gene)
                continue
            xyz, pl, seq = parsed
            ss = pydssp.assign(xyz, out_type="c3")
            ca = np.rint(xyz[:, 1, :].astype(np.float64) * 10).astype(np.int64)
            fh.write(json.dumps({
                "g": gene, "hap": hap, "n": len(seq),
                "ca": ca.ravel().tolist(),
                "pl": np.rint(pl.astype(np.float64) * 100).astype(np.int64).tolist(),
                "seq": seq, "ss": "".join(ss),
            }, separators=(",", ":")) + "\n")
            n += 1
            if n % 500 == 0:
                print(f"shard {shard}: {n}/{len(mine)} written, {len(skipped)} skipped", flush=True)
    with open(os.path.join(out_dir, f"ca_{shard:02d}.skipped.txt"), "w") as fh:
        fh.write("".join(g + "\n" for g in skipped))
    os.replace(tmp, out)      # a half-written shard never carries the final name
    print(f"shard {shard}: done, {n} written, {len(skipped)} skipped {skipped}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
