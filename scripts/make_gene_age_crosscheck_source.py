#!/usr/bin/env python3
"""Build sources/gene_age_crosscheck.tsv.gz: for every gene of the frozen candidate pool the
gene-age comparison was run on (842 HAP1 / 883 HAP2), which independent checks ran on it and
which found a homolog older than the default search did. Not a build stage (like the other
make_*_source.py): run it by hand on Sapelo2, where the inputs are, and commit its output.

    python3 scripts/make_gene_age_crosscheck_source.py [--check]

Inputs, all pinned (sources/gene_age_crosscheck.pin.json):
  * seven per-gene tables committed on the lineage-specific-gene repository at a fixed commit,
    read through git so a stale checkout cannot feed a different file;
  * eight tables that exist only in the comparison's working directory, read from their archive
    copy on /work by sha256 (archived 2026-10-14, stage G1 of the plan);
  * the frozen pool itself, sources/lsg_pool_frozen.tsv.gz, already in this repository.

Checks, one bit each in the output (r = ran on this gene, f = found older homology):
  1  phylostratr: a second gene-age program on a different database (120 UniProt proteomes,
     BLASTP); older = below its top stratum.                                  both haplotypes
  2  deeper profile search (MMseqs2, 3 iterations, UniRef50): cluster lineage at or above
     Saliceae at e <= 1e-5. An upper bound: the comparison found cluster lineage overstates
     depth on about 37% of old controls.                                      both haplotypes
  4  protein-family profiles (Pfam-A, gathering thresholds): any domain.       both haplotypes
  8  the default search with repeat masking switched off (DIAMOND): a hit outside Saliceae
     that the masked search did not find.                                     HAP1 only
  16 a more sensitive pairwise search (BLASTP) only: deep with BLASTP, not with either DIAMOND
     search.                                                                  HAP1 only
  32 predicted-structure search: genEra's structure mode on Swiss-Prot or AFDB-UniProt50 at or
     above Saliceae, or Foldseek 3Di+AA at e <= 1e-5 against a target outside Salicaceae.
                                                                              HAP1 only

Refuses to write unless, from its own output rows, it reproduces the comparison's published
summary on the frozen pool (numbers in WANT below, from its SUMMARY.md and RUN_LOG.md), and
unless its flags equal the comparison's own per-gene cross-arm table gene for gene.

The structure union is 11 here, where the summary says 12. Per RUN_LOG 27f, AFDB-UniProt50
labelled two pool genes "possible contamination or HGT", and those "are not age calls and are
excluded"; following that rule gives 11. The disputed gene, PtXaTreH.08G090100, has since left
the candidate pool (genEra rank 16 in the current pool call), so the difference touches no
gene the atlas annotates. Gated at 11, by the run log's own rule.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import subprocess
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roots  # noqa: E402

PIN = roots.path("atlas", "sources/gene_age_crosscheck.pin.json")
OUT = roots.path("atlas", "sources/gene_age_crosscheck.tsv.gz")
SIDE = roots.path("atlas", "sources/gene_age_crosscheck.provenance.json")
COLS = ["gene_id", "hap", "r", "f", "p"]

WANT = {
    "phylostratr_shared": {"HAP1": 741, "HAP2": 787},       # SUMMARY 2: genEra pool also top stratum here
    "pfam": {"HAP1": 12, "HAP2": 5},                         # SUMMARY 3
    "mmseqs": {"HAP1": 86, "HAP2": 82},                      # SUMMARY 4
    "masking_sensitive": 37, "blastp_only": 26,              # SUMMARY 5
    "deep_tantan": 18, "deep_nomask": 55, "deep_blastp": 73, # SUMMARY 5 table
    "struct": {"Swiss": 6, "Uni50": 10, "3di": 10, "all_three": 6, "union": 11},  # RUN_LOG 27f, see docstring
    "frozen": {"HAP1": 842, "HAP2": 883},
}
LAD = {"cellular organisms": 1, "Eukaryota": 2, "Viridiplantae": 3, "Streptophyta": 4, "Streptophytina": 5,
       "Embryophyta": 6, "Tracheophyta": 7, "Euphyllophyta": 8, "Spermatophyta": 9, "Magnoliopsida": 10,
       "Mesangiospermae": 11, "Pentapetalae": 12, "rosids": 13, "fabids": 14, "Malpighiales": 15,
       "Salicaceae": 16, "Saliceae": 17, "Populus": 18, "Populus tremula x Populus alba": 19}


def die(msg):
    sys.exit(f"REFUSING: {msg}")


def key(pid):
    if not pid.endswith(".1.p"):
        die(f"unexpected tool ID {pid!r} (want <gene>.1.p)")
    return pid[:-4]


def load_inputs(pin):
    """Every input as text, after verifying its blob or sha256 against the pin."""
    repo = roots.root("ms2_lsg")
    text = {}
    for name, spec in pin["git"]["files"].items():
        rev = f"{pin['git']['commit']}:{spec['path']}"
        blob = subprocess.run(["git", "-C", repo, "rev-parse", rev], capture_output=True, text=True)
        if blob.returncode != 0:
            die(f"{rev} not readable in {repo} (fetch the pinned commit)")
        if blob.stdout.strip() != spec["blob"]:
            die(f"{name}: blob {blob.stdout.strip()} != pinned {spec['blob']}")
        text[name] = subprocess.run(["git", "-C", repo, "show", rev], capture_output=True, text=True, check=True).stdout
    base = roots.path("work", pin["archive"]["dir"])
    for name, spec in pin["archive"]["files"].items():
        p = os.path.join(base, spec["path"])
        b = open(p, "rb").read()
        if hashlib.sha256(b).hexdigest() != spec["sha256"]:
            die(f"{name}: sha256 differs from the pin ({p})")
        text[name] = b.decode()
    return text


def build(text):
    frozen = {}
    with gzip.open(roots.path("atlas", "sources/lsg_pool_frozen.tsv.gz"), "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if r["is_lsg"] == "True":
                frozen[r["gene_id"]] = "HAP1" if r["gene_id"].startswith("PtXaTreH") else "HAP2"
    S = {h: {g for g, x in frozen.items() if x == h} for h in ("HAP1", "HAP2")}
    got = {"frozen": {h: len(S[h]) for h in S}}
    rows = lambda name: list(csv.DictReader(io.StringIO(text[name]), delimiter="\t"))
    run = {g: 0 for g in frozen}
    found = {g: 0 for g in frozen}
    strat = {}

    # 1 phylostratr
    got["phylostratr_shared"] = {}
    for h in S:
        rr = rows(f"phylostratr_{h.lower()}")
        top = max(int(r["ps_phylostratr"]) for r in rr if r["ps_phylostratr"] != "NA")
        older = set()
        for r in rr:
            g = key(r["gene"])
            if g in run:
                run[g] |= 1
                if r["ps_phylostratr"] != "NA" and int(r["ps_phylostratr"]) < top:
                    found[g] |= 1; strat[g] = int(r["ps_phylostratr"]); older.add(g)
        got["phylostratr_shared"][h] = len(S[h] - older)
    # 2 MMseqs2
    got["mmseqs"] = {"HAP1": 0, "HAP2": 0}
    for r in rows("mmseqs_depth"):
        if r["arm"] != "lsg":
            continue
        g = key(r["id"])
        if g in run:
            run[g] |= 2
            if r["deepest_e1e-5"] != "NA" and int(r["deepest_e1e-5"]) <= 17:
                found[g] |= 2; got["mmseqs"][frozen[g]] += 1
    # 4 Pfam (whole proteome searched, so it ran on every gene)
    got["pfam"] = {"HAP1": 0, "HAP2": 0}
    for h in S:
        hit = {key(l.split()[0]) for l in text[f"pfam_{h.lower()}"].splitlines() if l.strip() and not l.startswith("#")}
        for g in S[h]:
            run[g] |= 4
            if g in hit:
                found[g] |= 4; got["pfam"][h] += 1
    # 8, 16 masking and BLASTP-only (HAP1 pool only)
    deep = lambda v: v != "NA" and int(v) <= 16
    mt = rows("masking_test")
    ms = {key(r["qseqid"]) for r in mt if not deep(r["ps_diamond_tantan"]) and deep(r["ps_diamond_nomask"])}
    bo = {key(r["qseqid"]) for r in mt if not deep(r["ps_diamond_tantan"]) and not deep(r["ps_diamond_nomask"]) and deep(r["ps_blastp"])}
    if ms != {key(l.strip()) for l in text["masking_sensitive"].splitlines() if l.strip()}:
        die("masking-sensitive re-derivation differs from its published list")
    if bo != {key(l.strip()) for l in text["blastp_only"].splitlines() if l.strip()}:
        die("BLASTP-only re-derivation differs from its published list")
    got.update(masking_sensitive=len(ms), blastp_only=len(bo),
               deep_tantan=sum(deep(r["ps_diamond_tantan"]) for r in mt),
               deep_nomask=sum(deep(r["ps_diamond_nomask"]) for r in mt),
               deep_blastp=sum(deep(r["ps_blastp"]) for r in mt))
    for r in mt:
        g = key(r["qseqid"])
        if g in run:
            run[g] |= 8 | 16
            if g in ms: found[g] |= 8
            if g in bo: found[g] |= 16
    # 32 structure (HAP1 pool only)
    struct, present = {}, set()
    for db in ("Swiss", "Uni50"):
        s = set()
        for line in text[f"struct_{db}"].splitlines():
            if line.startswith("#") or not line.strip():
                continue
            f = line.split("\t")
            g = key(f[0].replace(".pdb", ""))
            present.add(g)
            if f[1] in LAD and LAD[f[1]] <= 17:
                s.add(g)
        struct[db] = s & S["HAP1"]
    fam = dict(l.split("\t", 1) for l in text["taxid_family"].splitlines() if "\t" in l)
    tdi = set()
    for db in ("PDB", "Swiss", "Proteome"):
        for line in text[f"3di_{db}"].splitlines():
            p = line.split("\t")
            g = key(p[0]); present.add(g)
            if float(p[11]) <= 1e-5 and fam.get(p[14], "").strip() != "Salicaceae":
                tdi.add(g)
    struct["3di"] = tdi & S["HAP1"]
    union = struct["Swiss"] | struct["Uni50"] | struct["3di"]
    got["struct"] = {"Swiss": len(struct["Swiss"]), "Uni50": len(struct["Uni50"]), "3di": len(struct["3di"]),
                     "all_three": len(struct["Swiss"] & struct["Uni50"] & struct["3di"]), "union": len(union)}
    for g in S["HAP1"] & present:
        run[g] |= 32
        if g in union: found[g] |= 32
    if any(found[g] & ~run[g] for g in run):
        die("a check found something on a gene it did not run on")

    # the comparison's own per-gene table must agree with these flags, gene for gene
    ca = rows("cross_arm_hap1")
    cmap = {"Pfam domain": 4, "masking-sensitive": 8, "BLASTP-only deep": 16, "MMseqs2 LCA<=17": 2, "phylostratr older": 1}
    for col, bit in cmap.items():
        theirs = {key(r["gene"]) for r in ca if r[col] == "1"}
        mine = {g for g in S["HAP1"] if found[g] & bit}
        if theirs != mine:
            die(f"cross-arm table column {col!r} differs from the re-derivation on {len(theirs ^ mine)} genes")

    if got != WANT:
        diff = {k: (got.get(k), WANT[k]) for k in WANT if got.get(k) != WANT[k]}
        die(f"does not reproduce the published summary: {diff}")
    out = [[g, frozen[g], run[g], found[g], strat.get(g, "")] for g in sorted(frozen)]
    return out, got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="rebuild in memory and compare with the committed file")
    a = ap.parse_args()
    pin = json.load(open(PIN))
    rows, got = build(load_inputs(pin))
    buf = io.StringIO()
    w = csv.writer(buf, delimiter="\t", lineterminator="\n")
    w.writerow(COLS); w.writerows(rows)
    raw = buf.getvalue().encode()
    blob = gzip.compress(raw, mtime=0)
    if a.check:
        old = gzip.decompress(open(OUT, "rb").read())
        if old != raw:
            die("committed source differs from a rebuild")
        print(f"gene_age_crosscheck source reproduces ({len(rows)} genes)")
        return 0
    open(OUT, "wb").write(blob)
    side = {"what": "per-gene independent gene-age checks on the frozen candidate pool; bits in r (ran) and f (found older homology), see the generator's docstring",
            "columns": COLS, "rows": len(rows), "sha256_uncompressed": hashlib.sha256(raw).hexdigest(),
            "reproduces": got, "pin": os.path.basename(PIN),
            "note_structure_union": "11, not the summary's 12: the contamination/HGT-labelled gene is excluded per RUN_LOG 27f; it is no longer a candidate"}
    json.dump(side, open(SIDE, "w"), indent=1, sort_keys=True)
    print(f"wrote {OUT} ({len(rows)} genes); reproduces {json.dumps(got, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
