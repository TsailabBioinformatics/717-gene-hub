#!/usr/bin/env python3
"""The search index, rebuilt from the finished gene records (runs after every other data stage).

data/index/search/<c>.json, one file per first character of a token:
    {token: {"ids": [gene positions in index/genes.json], "f": [field bits, one per id]}}
Field bits (what the token matched in that gene), so the client can rank and say why:
    1   a word of the gene's description (Phytozome)
    2   a word of its Arabidopsis best hit's description
    4   its Arabidopsis best-hit locus (the hit the gene page states, ann.at)
    8   a Pfam or PANTHER accession
    16  a word of a Pfam or PANTHER name
    32  an Arabidopsis gene symbol or alias of its best hit (Araport11), by homology
    64  its P. trichocarpa ortholog ID
    128 a gene name given in the dissertation
Description words that match more than 6,000 genes (9%) are dropped as noise; IDs, symbols and
accessions never are. The client reads `ids` alone for exact lookups, so a reader that predates
the field bits still works.

Invariant (from 0.19.0, checked here and by validate_data.py): every gene whose page states an
Arabidopsis hit is findable under that locus and under no other Arabidopsis locus.
"""
import gzip
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roots  # noqa: E402

DATA = roots.path("atlas", "data")
ARAPORT = "TAIR11/Araport11_GFF3_genes_transposons.Mar92021.gff.gz"
STOP = {"of", "and", "the", "in", "to", "a", "an", "for", "with", "by", "on", "or", "from", "like", "related", "family",
        "protein", "domain", "containing", "putative", "probable", "uncharacterized", "similar"}
COMMON = 6000
WORD = re.compile(r"[a-z0-9]+")
AGI = re.compile(r"^at[1-5cm]g\d{5}$")


def words(text):
    return {w for w in WORD.findall((text or "").lower()) if len(w) > 1 and w not in STOP}


def araport_symbols():
    """{agi (lower case): {symbol tokens}} from Araport11 gene lines: symbol= and one-word Alias= entries."""
    out = defaultdict(set)
    with gzip.open(roots.path("work", ARAPORT), "rt") as fh:
        for line in fh:
            f = line.split("\t")
            if len(f) < 9 or f[2] != "gene":
                continue
            attrs = dict(x.split("=", 1) for x in f[8].strip().split(";") if "=" in x)
            agi = attrs.get("ID", "").lower()
            if not AGI.match(agi):
                continue
            for name in [attrs.get("symbol", "")] + attrs.get("Alias", "").split(","):
                n = name.strip().lower()
                if n and " " not in n and len(n) <= 20 and not AGI.match(n):
                    out[agi].add(re.sub(r"[^a-z0-9.\-]", "", n))
    return out


def main():
    gene_ids = json.load(open(os.path.join(DATA, "index", "genes.json")))
    pos = {g: i for i, g in enumerate(gene_ids)}
    terms = json.load(open(os.path.join(DATA, "index", "terms.json")))
    acc_names = terms.get("acc", {})
    names = json.load(open(os.path.join(DATA, "index", "alias.json"))).get("name", {})
    sym = araport_symbols()
    post = defaultdict(lambda: defaultdict(int))     # token -> gene position -> field bits
    stated_at = {}
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in fs:
                if not fn.endswith(".json"):
                    continue
                for gid, rec in json.load(open(os.path.join(dp, fn))).items():
                    i = pos[gid]
                    a = rec.get("ann") or {}
                    for w in words(a.get("d")):
                        post[w][i] |= 1
                    for w in words(a.get("atd")):
                        post[w][i] |= 2
                    if a.get("at"):
                        agi = a["at"].lower()
                        stated_at[i] = agi
                        post[agi][i] |= 4
                        for s in sym.get(agi, ()):
                            post[s][i] |= 32
                    for acc in a.get("pf", []) + a.get("pt", []):
                        post[acc.lower()][i] |= 8
                        for w in words(acc_names.get(acc)):
                            post[w][i] |= 16
                    p = (rec.get("ptri") or {}).get("id")
                    if p:
                        post[p.lower()][i] |= 64
    for name, idxs in names.items():
        for i in idxs:
            post[name.lower()][i] |= 128
    # the 0.19.0 invariant, before writing anything
    agis = defaultdict(set)
    for tok, d in post.items():
        if AGI.match(tok):
            for i, b in d.items():
                if b & 4:
                    agis[i].add(tok)
    bad = [gene_ids[i] for i, a in stated_at.items() if agis.get(i) != {a}]
    if bad:
        sys.exit(f"REFUSING: {len(bad)} genes are not findable under exactly their stated Arabidopsis locus, e.g. {bad[:3]}")
    shards, dropped = defaultdict(dict), 0
    for tok in sorted(post):
        d = post[tok]
        bits = set(d.values())
        if len(d) > COMMON and all(b & ~(1 | 2 | 16) == 0 for b in bits):
            dropped += 1
            continue
        ids = sorted(d)
        c = tok[0] if tok[0].isalnum() else "_"
        shards[c][tok] = {"ids": ids, "f": [d[i] for i in ids]}
    # A first-character shard over 400 KB (p: the P. trichocarpa IDs; a: the Arabidopsis loci) is
    # split by its first two characters, so a query starting with that letter loads a fraction.
    split = []
    for c in sorted(shards):
        if len(json.dumps(shards[c], separators=(",", ":"))) > 400_000:
            split.append(c)
            for tok, v in shards.pop(c).items():
                shards[tok[:2]][tok] = v
    sdir = os.path.join(DATA, "index", "search")
    for old in os.listdir(sdir):
        if old.endswith(".json"):
            os.remove(os.path.join(sdir, old))
    for c, d in shards.items():
        with open(os.path.join(sdir, f"{c}.json"), "w") as fh:
            json.dump(d, fh, separators=(",", ":"), sort_keys=True)
    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    man["search"] = {"tokens": sum(map(len, shards.values())), "shards": sorted(shards), "split": split, "dropped_common_words": dropped,
                     "fields": {"1": "description", "2": "Arabidopsis hit description", "4": "Arabidopsis locus",
                                "8": "Pfam/PANTHER accession", "16": "Pfam/PANTHER name", "32": "Arabidopsis symbol (by homology)",
                                "64": "P. trichocarpa ortholog", "128": "gene name"},
                     "genes_with_symbol": len({i for t, d in post.items() for i, b in d.items() if b & 32}),
                     "stated_arabidopsis_hits_findable": len(stated_at)}
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print(f"search: {man['search']['tokens']:,} tokens in {len(shards)} shards ({dropped} common words dropped); "
          f"{man['search']['genes_with_symbol']:,} genes findable by an Arabidopsis symbol; "
          f"{len(stated_at):,} stated Arabidopsis hits findable under exactly that locus")
    return 0


if __name__ == "__main__":
    sys.exit(main())
