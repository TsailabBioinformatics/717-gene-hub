#!/usr/bin/env python3
"""Copy the dissertation's release tables into downloads/ and write the list the Downloads page shows.

    python3 scripts/publish_downloads.py [--bundle <folder>]

The bundle is built elsewhere (the analysis repository's release script) and is taken as it is:
this script copies, verifies and lists. It refuses to start unless the bundle carries a READY
marker and every file matches the bundle's own MD5SUMS.txt, refuses any file over GitHub's 100 MB
per-file limit, and refuses a text file that carries a machine path, a held label or a retired
name. It writes:

    downloads/<files>            byte-identical copies
    downloads/MD5SUMS.txt        the bundle's checksums, re-verified against the copies
    downloads/index.json         name, size, md5, version and one line per file

Never placed here: the raw expression matrix and the analysis code.
"""
import argparse, hashlib, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.expanduser("~/Library/CloudStorage/OneDrive-UniversityofGeorgia/01_work/fin/"
                             "dissertation_work/atlas_release_20261013")
OUT = os.path.join(ROOT, "downloads")
LIMIT = 100 * 1000 * 1000
ALLOWED_EXT = {".csv", ".xlsx", ".md", ".txt"}
NEVER = re.compile(r"tpm|est_counts|fpkm|\.bam$|\.fastq|\.fa$|\.py$|\.sh$|\.ipynb$", re.I)
# (the curation-note phrase is assembled from two pieces so that this file does not itself
# contain it: publish_lab.py refuses any file that does)
FORBID = re.compile(rb"/Users/|/scratch/|/home/[a-z]|ch29576|ghp_[A-Za-z0-9]{20}|curator" rb" wrote|cj_2026\d{4}"
                    rb"|LSG\d+\.\d+g|TD-associated PAV|aWGD|(?:post|pre)[ _]divergence")
# In the notes a reader sees (README), tables are described by content, never by chapter.
NO_CHAPTER = re.compile(rb"Chapters? [23]|dissertation chapter", re.I)

# group, one line per file. A file in the bundle that is not listed here stops the run: every
# published file gets a description a reader can act on.
DESCRIBE = {
    "README.md": ("Start here", "What each file is, the gene basis, how each dissertation number is obtained from the tables, and known caveats."),
    "DATA_DICTIONARY.csv": ("Start here", "Every column of the four tables and of Table 2.S1: type, units, allowed values, definition."),
    "HEADLINE_NUMBERS_CHECK.csv": ("Start here", "113 numbers of the dissertation recomputed from these files, each beside the printed value."),
    "717_genes.csv": ("Gene duplication and cross-haplotype tables", "One row per gene (63,960): duplication classes, tandem array, syntelog category, strict PAV, tau and expression summaries, annotation."),
    "717_gene_pairs.csv": ("Gene duplication and cross-haplotype tables", "One row per gene pair (47,923): sWGD and aWGT anchor pairs, tandem pairs with Ks and Ka/Ks, pairings inside multi-copy syntelog groups."),
    "717_tandem_arrays.csv": ("Gene duplication and cross-haplotype tables", "One row per tandem array (4,204): size, median Ks, age bin, status compared with the other haplotype."),
    "717_LSG_candidates.csv": ("Lineage-specific gene tables", "One row per lineage-specific gene candidate (1,611): phylostratum, each exclusion criterion, reason, final-set flag (Table 3.S1 as a flat file)."),
    "supplementary_tables/Table_2.S1_RNAseq_libraries.csv": ("Supplementary tables", "Table 2.S1. The 652 RNA-seq libraries with accessions, tissue group and the 222-library reference panel marked."),
    "supplementary_tables/Table_2.S2_read_separability_exclusion.csv": ("Supplementary tables", "Table 2.S2. Pairs excluded because their reads cannot be assigned to one copy, with the effect on each pair metric."),
    "supplementary_tables/Table_2.S3_tandem_chromosome_enrichment.csv": ("Supplementary tables", "Table 2.S3. Tandem genes per chromosome compared with expectation, array-intact permutation test."),
    "supplementary_tables/Table_2.S4_qc_excluded_gene_models.csv": ("Supplementary tables", "Table 2.S4. The 553 gene models flagged by quality control, with the reason."),
    "supplementary_tables/Table_2.S5_array_size_by_age.csv": ("Supplementary tables", "Table 2.S5. Tandem array size by age bin and haplotype."),
    "supplementary_tables/Table_2.S6_multiage_arrays.xlsx": ("Supplementary tables", "Table 2.S6. Tandem arrays whose member pairs span several age bins."),
    "supplementary_tables/Table_2.S7_td_agebin_sensitivity.xlsx": ("Supplementary tables", "Table 2.S7. Sensitivity of the results to the rule that assigns an array to an age bin."),
    "supplementary_tables/Table_3.S1_LSG_candidates.xlsx": ("Supplementary tables", "Table 3.S1. Lineage-specific gene candidates with per-gene exclusion reasons and the final set."),
    "supplementary_tables/Table_3.S2_LSG_vs_controls.xlsx": ("Supplementary tables", "Table 3.S2. Lineage-specific genes compared with control gene sets."),
    "supplementary_tables/Table_3.S3_codon_RSCU.xlsx": ("Supplementary tables", "Table 3.S3. Codon usage (RSCU)."),
}
GROUP_ORDER = ["Start here", "Gene duplication and cross-haplotype tables", "Lineage-specific gene tables",
               "Supplementary tables"]


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", default=DEFAULT)
    ap.add_argument("--release", default=None, help="release label; default: the date in the bundle's README title")
    a = ap.parse_args()
    B = a.bundle
    if not os.path.exists(os.path.join(B, "READY")):
        sys.exit(f"no READY marker in {B}: the bundle is not finished, nothing published")
    sums = {}
    for line in open(os.path.join(B, "MD5SUMS.txt")):
        if line.strip():
            h, name = line.split(None, 1)
            sums[name.strip()] = h
    files = []
    for dp, _, fs in os.walk(B):
        for fn in fs:
            rel = os.path.relpath(os.path.join(dp, fn), B)
            if rel in ("READY", "MD5SUMS.txt") or fn.startswith("."):
                continue
            files.append(rel)
    files.sort()
    problems = []
    for rel in files:
        p = os.path.join(B, rel)
        if os.path.splitext(rel)[1] not in ALLOWED_EXT or NEVER.search(rel):
            problems.append(f"{rel}: not a kind of file this page offers")
        if rel not in DESCRIBE:
            problems.append(f"{rel}: no description in publish_downloads.py")
        if rel not in sums:
            problems.append(f"{rel}: not in the bundle's MD5SUMS.txt")
        elif md5(p) != sums[rel]:
            problems.append(f"{rel}: md5 differs from the bundle's MD5SUMS.txt")
        if os.path.getsize(p) > LIMIT:
            problems.append(f"{rel}: {os.path.getsize(p):,} bytes, over the 100 MB per-file limit")
        if rel.endswith((".csv", ".md", ".txt")):
            m = FORBID.search(open(p, "rb").read())
            if m:
                problems.append(f"{rel}: contains {m.group(0)!r}, which is never published")
        if rel.endswith(".md"):
            m = NO_CHAPTER.search(open(p, "rb").read())
            if m:
                problems.append(f"{rel}: says {m.group(0)!r}; describe tables by content, not by chapter")
    missing = sorted(set(sums) - set(files))
    if missing:
        problems.append(f"listed in MD5SUMS.txt but absent: {missing}")
    if problems:
        sys.exit("NOT PUBLISHED:\n  " + "\n  ".join(problems))

    release = a.release
    if not release:
        m = re.search(r"release (\d{4}-\d{2}-\d{2})", open(os.path.join(B, "README.md")).readline())
        release = m.group(1) if m else "unversioned"
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    index = []
    for rel in files:
        dst = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(os.path.join(B, rel), dst)
        assert md5(dst) == sums[rel]
        group, desc = DESCRIBE[rel]
        index.append({"group": group, "name": os.path.basename(rel), "href": "downloads/" + rel,
                      "bytes": os.path.getsize(dst), "md5": sums[rel], "version": release, "description": desc})
    index.sort(key=lambda f: (GROUP_ORDER.index(f["group"]), f["href"]))
    shutil.copyfile(os.path.join(B, "MD5SUMS.txt"), os.path.join(OUT, "MD5SUMS.txt"))
    with open(os.path.join(OUT, "index.json"), "w") as fh:
        json.dump({"release": release, "atlas_version": open(os.path.join(ROOT, "VERSION")).read().strip(),
                   "files": index}, fh, indent=1)
        fh.write("\n")
    total = sum(f["bytes"] for f in index)
    print(f"published {len(index)} files, {total / 1e6:.1f} MB, release {release}; largest "
          f"{max(index, key=lambda f: f['bytes'])['name']} {max(f['bytes'] for f in index) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
