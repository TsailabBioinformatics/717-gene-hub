#!/usr/bin/env python3
"""
Adds three layers to the gene shards, and builds the search index.

  ann     functional annotation: description, best-Arabidopsis hit, Pfam/PANTHER, GO
  allele  the HAP1<->HAP2 syntelog partner and its Ka/Ks
  pres    which of the 12 panel genomes the orthogroup spans

ORDER MATTERS. This is a PATCHER, like build_expression.py -- it reads the existing shards
and adds keys. build_data.py rewrites shards from scratch, so the pipeline is:
    build_data.py  ->  build_expression.py  ->  build_annotation.py

A NOTE ON THE HAP2 ANNOTATION GAP, because it is real and asymmetric:
HAP2's annotation_info.txt has EMPTY Pfam / PANTHER / GO / KOG / KO columns for all 65,212
rows (HAP1 has 54,364 / 62,564 / 44,516). The schemas are identical and the file is not
truncated -- the release simply did not populate them for HAP2. Recovered as follows:
  - GO      : h{1,2}.custom.GO, lab-built, per locus, WITH term names, both haplotypes.
  - Pfam    : parsed out of defline.txt, which carries the accessions in its text for BOTH
              haplotypes (6,159 HAP1 / 6,163 HAP2 rows mention a PF accession).
  - PANTHER : same, from defline.
Every annotation field records which source it came from, so an asymmetry between the
haplotypes is never mistaken for biology. See manifest.annotation.sources.
"""
import roots
import argparse, csv, gzip, json, os, re, sys, time
from collections import defaultdict

ANN = roots.path('scratch', 'genome_resources/pangenome/input/717Official/annotation')
KS = roots.path('scratch', 'synt_ks/syntelog_ks.csv')
MS2 = roots.path('scratch', 'ms2_genespace')
HAPFILE = {"hap1": "PtremulaxPopulusalbaHAP1_717_v5.1", "hap2": "PtremulaxPopulusalbaHAP2_716_v5.1"}

# "(1 of 24) PF04564//PF04826 - U-box domain (U-box) // Armadillo-like (Arm_2)"
DEFLINE_RE = re.compile(r"^\(\d+ of \d+\)\s+(\S+)\s+-\s+(.*)$")

def num(x):
    """Ka/Ks columns carry '=', 'w' and 'NA' sentinels for degenerate comparisons."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v else None

def read_defline(hap):
    """Primary transcript only. Returns {locus: (description, [accessions])}."""
    out = {}
    with open(f"{ANN}/{HAPFILE[hap]}.defline.txt") as fh:
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) < 3 or not f[0].endswith(".1"):
                continue
            locus = f[0][:-2]
            m = DEFLINE_RE.match(f[2])
            if not m:
                continue
            accs = [a.split(":")[0] for a in m.group(1).split("//") if a]
            out[locus] = (m.group(2).strip(), accs)
    return out

def read_annotation_info(hap):
    """Best-Arabidopsis hit is populated for BOTH haplotypes; the domain columns are not."""
    out = {}
    with open(f"{ANN}/{HAPFILE[hap]}.annotation_info.txt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if not r["transcriptName"].endswith(".1"):
                continue
            out[r["locusName"]] = {
                "at": r["Best-hit-arabi-name"].strip() or None,
                "atd": r["Best-hit-arabi-defline"].strip() or None,
                "pfam_native": [p for p in r["Pfam"].split() if p],
            }
    return out

def read_dissertation_at():
    """gene -> (Arabidopsis locus, description) from the dissertation layer (lab annotation via the per-gene
    master table). Same rule as patch_dissertation_layer.py: the dissertation's hit replaces Phytozome's where
    it has one; otherwise Phytozome's is kept. Used here so the free-text search index states the same hit the
    gene page shows (until 2026-10-14 the index kept Phytozome's older hits)."""
    out = {}
    with gzip.open(os.path.join(roots.root('atlas'), "sources", "dissertation_layer.tsv.gz"), "rt") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if r["at_locus"]:
                out[r["gene_id"]] = (r["at_locus"], r["at_desc"] or None)
    return out


def read_go(hap):
    """h{1,2}.custom.GO -- per locus, GO id + name + namespace, both haplotypes."""
    per_gene, terms = {}, {}
    h = "h1" if hap == "hap1" else "h2"
    with open(f"{ANN}/GO/{h}.custom.GO") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            gid = r["geneID"]
            ids = []
            for ns in ("P", "F", "C"):
                for item in (r.get(ns) or "").split("||"):
                    item = item.strip()
                    if not item or "|" not in item:
                        continue
                    go_id, name = item.split("|", 1)
                    # The release uses the root terms as "no annotation" placeholders.
                    if go_id in ("GO:0008150", "GO:0003674", "GO:0005575"):
                        continue
                    terms[go_id] = [name, ns]
                    ids.append(go_id)
            if ids:
                per_gene[gid] = sorted(set(ids))
    return per_gene, terms

TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9'-]{2,}")
STOP = {"the", "and", "for", "with", "from", "not", "named", "family", "subfamily", "protein",
        "domain", "containing", "like", "related", "putative", "expressed", "unknown",
        "function", "uncharacterized", "isoform", "similar", "type", "class"}

def tokens(text):
    return {t.lower() for t in TOKEN_RE.findall(text or "") if t.lower() not in STOP}

def shard_paths(root):
    """Every gene-shard JSON under a haplotype directory, at any nesting depth."""
    out = []
    for dp, _, fs in os.walk(root):
        out += [os.path.join(dp, f) for f in fs if f.endswith(".json")]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=roots.path('atlas', 'data'))
    a = ap.parse_args()

    # ---- allele: HAP1 <-> HAP2 syntelogs ----------------------------------------------
    allele, undef = {}, 0
    with open(KS) as fh:
        for r in csv.DictReader(fh):
            g1, g2 = r["gene_id_1"], r["gene_id_2"]
            ks, ka, w = num(r["yn_ks"]), num(r["yn_ka"]), num(r["yn_omega"])
            # PAML yn00 reports omega = 99.0 when it cannot estimate the ratio -- which is
            # exactly the 716 pairs whose Ks is 0 (identical at synonymous sites). Publishing
            # 99 would read as extreme positive selection; it means "undefined". Null it and
            # flag the pair instead. Ks of -0.0 is the same case, normalised to 0.
            ks0 = ks is not None and ks <= 0
            if ks0:
                ks, w = 0.0, None
                undef += 1
            if w is not None and w >= 99:
                w = None
            # One pair carries '='/'w' sentinels for Ks and Ka but a numeric omega of 0.0000.
            # An omega whose numerator and denominator are both unestimable is not evidence of
            # purifying selection -- it is a failed estimate. Drop it rather than label it.
            if ks is None or ka is None:
                w = None
            rec = {"ks": ks, "ka": ka, "w": w}
            if ks0:
                rec["ks0"] = True
            allele[g1] = dict(rec, id=g2)
            allele[g2] = dict(rec, id=g1)
    print(f"allele: {len(allele)} genes across {len(allele)//2} syntelog pairs "
          f"({undef} with Ks=0, omega undefined)")

    # ---- presence across the 12-genome panel -------------------------------------------
    pres = {}
    with open(f"{MS2}/step7_diff_20260901/diff_all_genes.tsv") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            g = (r.get("of_genomes") or "").strip()
            if g:
                pres[r["gene_id"]] = g.split(",")
    print(f"presence: {len(pres)} genes carry an of_genomes list")

    # ---- annotation --------------------------------------------------------------------
    ann, go_terms, acc_names = {}, {}, {}
    acc_offers = defaultdict(set)
    stats = defaultdict(int)
    diss_at = read_dissertation_at()
    print(f"dissertation Arabidopsis hits: {len(diss_at)} genes")
    for hap in ("hap1", "hap2"):
        defl = read_defline(hap)
        info = read_annotation_info(hap)
        go_per_gene, terms = read_go(hap)
        go_terms.update(terms)
        for locus in sorted(set(defl) | set(info) | set(go_per_gene)):
            desc, accs = defl.get(locus, (None, []))
            i = info.get(locus, {})
            pf = i.get("pfam_native") or [x for x in accs if x.startswith("PF")]
            pt = [x for x in accs if x.startswith("PTHR")]
            rec = {}
            if desc:
                rec["d"] = desc
                # A defline names its own accessions, so a single-accession defline offers
                # a name for that accession. COLLECT every offer rather than keeping
                # whichever arrived first: 834 PANTHER accessions (11.5%) are named
                # inconsistently across the genes that carry them -- PTHR13832 is offered
                # both "PROTEIN PHOSPHATASE 1D" and "PROTEIN PHOSPHATASE 1K", and PTHR27001
                # is offered 40 different names. Those are per-gene SUBFAMILY names, not the
                # family's name, so "first one wins" shipped one arbitrary gene's label as
                # the family's -- and, iterating an unordered set, a DIFFERENT arbitrary one
                # on every build. Resolved below: label only where every offer agrees.
                if len(accs) == 1 and desc:
                    acc_offers[accs[0]].add(desc[:80])
            if locus in diss_at:
                rec["at"], atd = diss_at[locus]
                if atd:
                    rec["atd"] = atd
                stats[f"{hap}:at_from_dissertation"] += 1
            else:
                if i.get("at"):
                    rec["at"] = i["at"]
                if i.get("atd"):
                    rec["atd"] = i["atd"]
            if pf:
                rec["pf"] = sorted(set(pf))
            if pt:
                rec["pt"] = sorted(set(pt))
            if locus in go_per_gene:
                rec["go"] = go_per_gene[locus]
            if rec:
                ann[locus] = rec
                for k in ("d", "at", "pf", "go"):
                    stats[f"{hap}:{k}"] += bool(rec.get(k))
    # Keep a name only where it is unambiguous. An accession whose genes disagree gets no
    # entry, and the gene page renders the bare accession -- correct and unlabelled beats
    # labelled and wrong.
    acc_names.update({a: next(iter(v)) for a, v in acc_offers.items() if len(v) == 1})
    ambiguous = sum(1 for v in acc_offers.values() if len(v) > 1)

    print("annotation coverage:", dict(sorted(stats.items())))
    print(f"GO vocabulary: {len(go_terms)} terms   accession names: {len(acc_names)} "
          f"({ambiguous} accessions left unnamed: their genes disagree on the name)")

    # ---- patch the shards, and collect search postings ----------------------------------
    genes_dir = os.path.join(a.out, "genes")
    gene_ids, postings = [], defaultdict(set)
    patched = defaultdict(int)
    for hap in ("hap1", "hap2"):
        # Shards are nested one level deeper since the bucketed split; walk, don't listdir.
        for p in sorted(shard_paths(os.path.join(genes_dir, hap))):
            with open(p) as fh:
                shard = json.load(fh)
            for gid, rec in shard.items():
                idx = len(gene_ids)
                gene_ids.append(gid)
                if gid in ann:
                    rec["ann"] = ann[gid]
                    patched["ann"] += 1
                    a_ = ann[gid]
                    for t in tokens(a_.get("d")) | tokens(a_.get("atd")):
                        postings[t].add(idx)
                    if a_.get("at"):
                        postings[a_["at"].lower()].add(idx)
                    for x in a_.get("pf", []) + a_.get("pt", []):
                        postings[x.lower()].add(idx)
                if gid in allele:
                    rec["allele"] = allele[gid]
                    patched["allele"] += 1
                if gid in pres:
                    rec["pres"] = pres[gid]
                    patched["pres"] += 1
            with open(p, "w") as fh:
                json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    print("patched:", dict(patched), f"over {len(gene_ids)} genes")

    idx_dir = os.path.join(a.out, "index")
    os.makedirs(idx_dir, exist_ok=True)
    with open(os.path.join(idx_dir, "genes.json"), "w") as fh:
        json.dump(gene_ids, fh, separators=(",", ":"))
    with open(os.path.join(idx_dir, "terms.json"), "w") as fh:
        json.dump({"go": go_terms, "acc": acc_names}, fh, separators=(",", ":"), sort_keys=True)

    # Shard the token index by first character, so typing "kin" fetches one small file
    # instead of a multi-megabyte index.
    shards = defaultdict(dict)
    dropped = 0
    # sorted(): postings is keyed by strings collected out of set unions, whose iteration
    # order is randomised per process. Without this the 26 search shards were rewritten in a
    # different key order on every build -- content-identical, but a 26-file diff that made
    # `git status` useless as a "did the data actually change" signal.
    for tok in sorted(postings):
        ids = postings[tok]
        if len(ids) > 6000:      # a token matching >9% of genes is noise, not a search term
            dropped += 1
            continue
        c = tok[0] if tok[0].isalnum() else "_"
        shards[c][tok] = sorted(ids)
    sdir = os.path.join(idx_dir, "search")
    os.makedirs(sdir, exist_ok=True)
    for c, d in shards.items():
        with open(os.path.join(sdir, f"{c}.json"), "w") as fh:
            json.dump(d, fh, separators=(",", ":"), sort_keys=True)
    print(f"search: {len(postings)} tokens ({dropped} too-common dropped) in {len(shards)} shards")

    man_path = os.path.join(a.out, "meta", "manifest.json")
    with open(man_path) as fh:
        man = json.load(fh)
    man["annotation"] = {
        "n_annotated": patched["ann"], "n_allele": patched["allele"], "n_presence": patched["pres"],
        "go_terms": len(go_terms), "search_tokens": len(postings),
        "sources": {
            "best_arabidopsis": "annotation_info.txt (both haplotypes)",
            "go": "GO/h{1,2}.custom.GO (lab-built, both haplotypes, with term names)",
            "pfam_panther": "annotation_info.txt for HAP1; parsed from defline.txt for HAP2 "
                            "because HAP2's annotation_info domain columns are empty in the release",
            "kaks": "synt_ks/syntelog_ks.csv, Yang-Nielsen (yn_*), 25,931 syntelog pairs",
        },
    }
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)

    tot = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(idx_dir) for f in fs)
    print(f"index: {tot/1e6:.1f} MB raw -> {idx_dir}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
