#!/usr/bin/env python3
"""Build sources/peptide_detail.tsv.gz -- per gene, per dataset, HOW a peptide assignment
was made, not just that one was.

WHY THIS EXISTS. The shipped layer says "detected in N of 5 datasets". A reader cannot tell
from that whether the evidence is a peptide unique to this gene and absent from every other
species, or a peptide shared with P. trichocarpa and with 40 other 717 genes. Those are very
different claims and the card rendered them identically. Measured on the deepest dataset
before this was written: 94.2% of peptides that map to a 717 gene are ALSO in the
P. trichocarpa proteome, and only 11.9% map to a single 717 gene.

So per (gene, dataset) this records:
  n_pep         peptides at 1% peptide AND spectrum FDR mapping to this gene
  n_psm         spectra supporting them
  best_hs       best hyperscore
  n_gene_uniq   of those peptides, how many map to NO other 717 gene
  n_717_only    of those peptides, how many are absent from the P. trichocarpa proteome
  top           up to 3 example peptides, each as seq:npsm:hs:nGenes:n717only

The detection rule is copied from the owning analysis (06_aspen_multidataset_readout.py) and
is identical to make_proteomics_v2_source.py's, so the two cannot disagree.

GATE: per-dataset detected-gene counts must equal the owning analysis's own
aspen_dataset_meta.json, or nothing is written.
"""
import roots
import csv, gzip, io, json, os, sys
from collections import defaultdict

WORK = roots.path('scratch', 'proteomics_aspen')
META = roots.path('scratch', 'ms2lsg_wt_proteomics/analyses/proteomics_translation_evidence/results/aspen_dataset_meta.json')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sources", "peptide_detail.tsv.gz")
FDR = 0.01
TOP_N = 3

def gene_of(p):
    g = p.split("|", 1)[1] if "|" in p else p
    return ".".join(g.split(".")[:2])

def main():
    meta = json.load(open(META))
    datasets = sorted(d for d in os.listdir(f"{WORK}/out")
                      if os.path.isfile(f"{WORK}/out/{d}/results.sage.tsv"))
    rows, bad = [], []
    for acc in datasets:
        pep2prot, pep_psm, pep_hs = defaultdict(set), defaultdict(int), {}
        with open(f"{WORK}/out/{acc}/results.sage.tsv") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                if r.get("label") != "1":
                    continue
                try:
                    if float(r["peptide_q"]) > FDR or float(r["spectrum_q"]) > FDR:
                        continue
                except (KeyError, ValueError):
                    continue
                pep = r["peptide"]
                pep_psm[pep] += 1
                try:
                    hs = float(r["hyperscore"])
                    if hs > pep_hs.get(pep, -1e9):
                        pep_hs[pep] = hs
                except (KeyError, ValueError):
                    pass
                for p in r["proteins"].split(";"):
                    p = p.strip()
                    if p and not p.startswith("rev_"):
                        pep2prot[pep].add(p)

        # per peptide: which 717 genes, and is it absent from the trichocarpa proteome
        pep_genes, pep_only717 = {}, {}
        for pep, prots in pep2prot.items():
            genes = {(p.split("|", 1)[0], gene_of(p)) for p in prots
                     if p.split("|", 1)[0] in ("HAP1", "HAP2")}
            if not genes:
                continue
            pep_genes[pep] = genes
            pep_only717[pep] = {p.split("|", 1)[0] for p in prots} <= {"HAP1", "HAP2"}

        per = defaultdict(lambda: {"pep": [], "psm": 0})
        for pep, genes in pep_genes.items():
            for key in genes:
                per[key]["pep"].append(pep)
                per[key]["psm"] += pep_psm[pep]

        if len(per) != meta[acc]["genes_detected"]:
            bad.append((acc, meta[acc]["genes_detected"], len(per)))

        for (hap, gid), v in per.items():
            peps = sorted(v["pep"], key=lambda p: (-pep_psm[p], -pep_hs.get(p, 0), p))
            top = ";".join(
                f"{p}:{pep_psm[p]}:{pep_hs.get(p, 0):.1f}:{len(pep_genes[p])}:{int(pep_only717[p])}"
                for p in peps[:TOP_N])
            rows.append({
                "gene_id": gid, "hap": hap, "dataset": acc,
                "n_pep": len(peps), "n_psm": v["psm"],
                "best_hs": f"{max(pep_hs.get(p, 0) for p in peps):.1f}",
                "n_gene_uniq": sum(1 for p in peps if len(pep_genes[p]) == 1),
                "n_717_only": sum(1 for p in peps if pep_only717[p]),
                "top": top,
            })
        print(f"{acc}: {len(per)} genes, {sum(len(v['pep']) for v in per.values())} "
              f"(gene,peptide) pairs", flush=True)

    if bad:
        for acc, want, got in bad:
            print(f"  GATE FAIL {acc}: owner says {want} detected genes, this says {got}",
                  file=sys.stderr)
        raise SystemExit("GATE FAILED against aspen_dataset_meta.json. Nothing written.")
    print(f"GATE PASS: per-dataset detected-gene counts match aspen_dataset_meta.json "
          f"for all {len(datasets)} datasets")

    cols = ["gene_id", "hap", "dataset", "n_pep", "n_psm", "best_hs",
            "n_gene_uniq", "n_717_only", "top"]
    rows.sort(key=lambda r: (r["gene_id"], r["dataset"]))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, delimiter="\t", lineterminator="\n")
    w.writeheader(); w.writerows(rows)
    with open(OUT, "wb") as fh:
        with gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:
            gz.write(buf.getvalue().encode())
    print(f"wrote {OUT}: {len(rows)} rows, {os.path.getsize(OUT)/1e6:.2f} MB gz")

if __name__ == "__main__":
    main()
