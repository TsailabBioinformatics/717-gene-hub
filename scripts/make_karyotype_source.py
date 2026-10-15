#!/usr/bin/env python3
"""Copy the MS1 gamma-branch route C labels into sources/: where each 717 gene sits in the
ancestral eudicot karyotype (AEK; Wang et al. 2022, BMC Biology 20:216), and which gamma copy and
salicoid copy it descends from.

EXPLORATORY, NOT A CURATED CALL. The gene-level WGD events (S salicoid, A gamma) stay the
duplication call; this layer shows ancestral topology beside them.

Route C, as the owning analysis defines it (gate 2 re-derives it from its own helper columns):
the ancestral chromosome comes from the AEK-717 collinear block that covers the gene, or, where no
AEK block covers it, from the majority label of the 10 nearest anchors of the 717-P. trichocarpa
v3.1 collinear block covering it. Gamma copy (1-3) and salicoid copy (1-2) are always named through
that P. trichocarpa block, from Wang et al.'s published P. trichocarpa painting. Where the AEK block
and the P. trichocarpa naming disagree on the chromosome, no copy is given. Copy numbers are Wang et
al.'s completeness ranks within one ancestral chromosome, not subgenomes.

Two tables, HAP1 and HAP2 kept apart (every row carries its haplotype, nothing is summed across):
  karyotype_route_c.tsv.gz          one row per assessed gene. The assessment covers the 19
                                    chromosomes, so the 131 HAP1 unplaced-scaffold genes are absent.
  karyotype_route_c_anchors.tsv.gz  genes that are direct collinear anchors of an AEK gene, with
                                    the slot (gamma copy x salicoid copy) they occupy. Upstream keeps
                                    only labelled anchors on the AEK gene's own chromosome.
Only what the site shows is copied. The *_pt / *_vv helper columns are read for gate 2 and dropped,
except the P. trichocarpa label support; anchor block ids and AEK ranks are dropped too, and a gene
anchored to the same AEK gene from two blocks is listed once.

GATES, all before anything is written:
  1. every gene is an atlas gene of the file's haplotype on the chromosome the atlas places it, and
     the assessed set is exactly the atlas's chromosomal genes
  2. route C re-derived from the helper columns equals aek_c / gamma_c / salicoid_c / the conflict flag
  3. coverage equals the owning analysis's published painting_v3_route_agreement.csv
  4. every anchor's slot equals its gene's own route C label, and the occupancy rebuilt from the
     anchors equals the published "any anchor" rows of salicoid_on_gamma_both_sisters.csv, cell for cell

Reads the OneDrive MS1_2026 tree, so like make_kaks_source.py it is NOT a build_all.sh stage: the
committed sources/ files are the artifact. Re-run by hand when route C changes upstream, then run
scripts/patch_karyotype.py and scripts/build_facets.py.
"""
import csv, gzip, hashlib, io, json, os, re, sys
import roots
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
HAPS = ("HAP1", "HAP2")
PREFIX = {"HAP1": "PtXaTreH.", "HAP2": "PtXaAlbH."}
OUT = os.path.join(ROOT, "sources", "karyotype_route_c.tsv.gz")
OUT_ANCHORS = os.path.join(ROOT, "sources", "karyotype_route_c_anchors.tsv.gz")
PROV = os.path.join(ROOT, "sources", "karyotype_route_c.provenance.json")

LABEL_COLS = ["gene_id", "chr", "rank", "aek_block", "aek_pt", "gamma_pt", "salicoid_pt", "support_pt",
              "aek_vv", "gamma_vv", "support_vv", "aek_c", "gamma_c", "salicoid_c",
              "aek_conflict_block_vs_pt", "hap"]
ANCHOR_COLS = ["aek_gene", "gene_id", "block", "aek_chr", "aek_rank", "gamma_copy", "salicoid_copy"]
AEK_GENE = re.compile(r"^eud([1-7])g\d{5}$")
COVERAGE_KEYS = ("n", "aek_block", "route_c_gamma", "route_c_salicoid", "aek_block_vs_pt_conflicts")


def ms1_root():
    """The OneDrive tree, from the same roots module build_all.sh asks, so the probe and this script
    cannot drift apart. (Until 2026-10-14 this regex-parsed patch_dup_v9_and_pav.py for the path.)"""
    return roots.root("onedrive_ms1")


PAINT = os.path.join(ms1_root(), "data", "57_gamma_branch", "painting_v3")
AGREEMENT = os.path.join(PAINT, "painting_v3_route_agreement.csv")
BOTH_COPIES = os.path.join(PAINT, "salicoid_on_gamma_both_sisters.csv")


def labels_path(hap):
    return os.path.join(PAINT, "results", f"route_c_labels_{hap}.tsv.gz")


def anchors_path(hap):
    return os.path.join(PAINT, "results", f"route_c_aek_anchors_{hap}.tsv.gz")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def read_tsv(path, cols):
    with gzip.open(path, "rt", newline="") as fh:
        rd = csv.DictReader(fh, delimiter="\t")
        assert rd.fieldnames == cols, f"{os.path.basename(path)}: columns changed to {rd.fieldnames}"
        return list(rd)


def whole(s, lo, hi, what):
    """'' -> None, '2.0' -> 2; anything that is not a whole number in [lo, hi] stops the build."""
    if s == "":
        return None
    v = float(s)
    assert v.is_integer() and lo <= v <= hi, f"{what} out of range: {s!r}"
    return int(v)


def atlas_genes():
    """gene -> (HAP, chromosome) from the committed shards."""
    out = {}
    for hap in ("hap1", "hap2"):
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in sorted(fs):
                if fn.endswith(".json"):
                    for gid, r in json.load(open(os.path.join(dp, fn))).items():
                        out[gid] = (hap.upper(), r["chr"])
    return out


def main():
    atlas = atlas_genes()
    published_cov = {r["hap"]: {k: int(float(r[k])) for k in COVERAGE_KEYS}
                     for r in csv.DictReader(open(AGREEMENT)) if r["comparison"] == "coverage"}
    published_occ = defaultdict(dict)
    for r in csv.DictReader(open(BOTH_COPIES)):
        if r["scope"] == "any anchor":
            published_occ[r["hap"]][(int(r["aek"]), int(r["gamma_copy"]))] = (int(r["n_cells"]), int(r["n_both"]))

    labels, anchors, inputs, gates = [], [], {}, {}
    for hap in HAPS:
        # ---- labels ------------------------------------------------------------------------
        rows = read_tsv(labels_path(hap), LABEL_COLS)
        inputs[os.path.basename(labels_path(hap))] = {"sha256": sha256(labels_path(hap)), "rows": len(rows)}
        ids = [r["gene_id"] for r in rows]
        assert len(set(ids)) == len(ids), f"{hap}: a gene has two label rows"

        # gate 1: the right genes, on the right chromosomes, and all of them
        wrong = [r["gene_id"] for r in rows if r["hap"] != hap or not r["gene_id"].startswith(PREFIX[hap])
                 or atlas.get(r["gene_id"], (None, None)) != (hap, f"Chr{int(r['chr']):02d}")]
        assert not wrong, f"{hap}: {len(wrong)} genes not in the atlas at that haplotype/chromosome, e.g. {wrong[:3]}"
        chromosomal = {g for g, (h, c) in atlas.items() if h == hap and re.fullmatch(r"Chr\d\d", c)}
        n_scaffold = sum(1 for g, (h, c) in atlas.items() if h == hap and g not in chromosomal)
        assert set(ids) == chromosomal, (f"{hap}: assessed genes differ from the atlas's chromosomal genes: "
                                         f"{len(chromosomal - set(ids))} missing, {len(set(ids) - chromosomal)} extra")

        # gate 2: route C re-derived from its own helper columns
        cov, own = Counter(), {}
        for r in rows:
            blk = whole(r["aek_block"], 1, 7, "aek_block")
            pt = whole(r["aek_pt"], 1, 7, "aek_pt")
            g_pt = whole(r["gamma_pt"], 1, 3, "gamma_pt")
            s_pt = whole(r["salicoid_pt"], 1, 2, "salicoid_pt")
            aek = whole(r["aek_c"], 1, 7, "aek_c")
            gam = whole(r["gamma_c"], 1, 3, "gamma_c")
            sal = whole(r["salicoid_c"], 1, 2, "salicoid_c")
            conflict = {"True": True, "False": False}[r["aek_conflict_block_vs_pt"]]
            support = None if r["support_pt"] == "" else float(r["support_pt"])
            named = pt is not None and (blk is None or blk == pt)
            want = (blk if blk is not None else pt, g_pt if named else None, s_pt if named else None,
                    blk is not None and pt is not None and blk != pt)
            assert (aek, gam, sal, conflict) == want, f"{hap} {r['gene_id']}: route C does not re-derive, {want}"
            assert (gam is None) == (sal is None), f"{hap} {r['gene_id']}: gamma and salicoid copy not paired"
            assert (support is None) == (pt is None) and (support is None or 0 < support <= 1), \
                f"{hap} {r['gene_id']}: support {support!r} without a P. trichocarpa label, or out of range"
            cov["n"] += 1
            cov["aek_block"] += blk is not None
            cov["route_c_gamma"] += gam is not None
            cov["route_c_salicoid"] += sal is not None
            cov["aek_block_vs_pt_conflicts"] += conflict
            own[r["gene_id"]] = (aek, gam, sal)
            labels.append({
                "hap": hap, "gene_id": r["gene_id"], "aek_chromosome": aek, "gamma_copy": gam,
                "salicoid_copy": sal,
                # support describes the full (chromosome, gamma, salicoid) label, so it ships only
                # where that label is given; a conflict gene's support would describe a label it lacks
                "label_support": support if gam is not None else None,
                "inside_aek_block": None if aek is None else blk is not None,
                "conflict": conflict,
            })

        # gate 3: the owning analysis's published coverage
        assert dict(cov) == published_cov[hap], f"{hap}: coverage {dict(cov)} vs published {published_cov[hap]}"

        # ---- anchors -----------------------------------------------------------------------
        arows = read_tsv(anchors_path(hap), ANCHOR_COLS)
        inputs[os.path.basename(anchors_path(hap))] = {"sha256": sha256(anchors_path(hap)), "rows": len(arows)}
        slots, chrom, seen, n_repeat = defaultdict(set), {}, set(), 0
        for a in arows:
            e, gid = a["aek_gene"], a["gene_id"]
            m = AEK_GENE.match(e)
            c, g, s = int(a["aek_chr"]), int(a["gamma_copy"]), int(a["salicoid_copy"])
            assert m and int(m.group(1)) == c, f"{hap}: AEK gene {e!r} is not on AEK{c}"
            assert gid in own, f"{hap}: anchor {gid} is not an assessed gene of this haplotype"
            # gate 4a: an anchor's slot is its gene's own label, on its AEK gene's chromosome
            assert own[gid] == (c, g, s), f"{hap}: anchor {gid} slot {(c, g, s)} vs its own label {own[gid]}"
            assert chrom.setdefault(e, c) == c
            slots[e].add((g, s))
            if (e, gid) in seen:
                n_repeat += 1          # the same gene anchored to the same AEK gene from a second block
                continue
            seen.add((e, gid))
            anchors.append({"hap": hap, "aek_gene": e, "aek_chromosome": c, "gamma_copy": g,
                            "salicoid_copy": s, "gene_id": gid})

        # gate 4b: occupancy per (ancestral chromosome, gamma copy), as step 5 published it: cells with
        # at least one salicoid copy present, and cells with both
        cells, both = Counter(), Counter()
        for e, occ in slots.items():
            for gc in (1, 2, 3):
                k = ((gc, 1) in occ) + ((gc, 2) in occ)
                cells[(chrom[e], gc)] += k >= 1
                both[(chrom[e], gc)] += k == 2
        rebuilt = {key: (cells[key], both[key]) for key in cells if cells[key]}
        rebuilt[(0, 0)] = (sum(cells.values()), sum(both.values()))
        assert rebuilt == published_occ[hap], f"{hap}: slot occupancy does not reproduce the published table"

        gates[hap] = {
            "assessed_genes": cov["n"], "unplaced_scaffold_genes_not_assessed": n_scaffold,
            "published_coverage_reproduced": dict(cov),
            "not_placed": sum(1 for x in own.values() if x[0] is None),
            "anchor_rows": len(arows), "anchor_rows_repeated_across_blocks_listed_once": n_repeat,
            "direct_anchor_genes": len({gid for _, gid in seen}), "ancestral_genes_with_an_anchor": len(slots),
            "published_occupancy_reproduced": {"cells_with_a_salicoid_copy": rebuilt[(0, 0)][0],
                                               "cells_with_both_salicoid_copies": rebuilt[(0, 0)][1],
                                               "per_chromosome_gamma_copy_rows": len(rebuilt) - 1},
        }
        print(f"GATE PASS {hap}: {cov['n']:,} genes, copy on {cov['route_c_gamma']:,}, inside an AEK block "
              f"{cov['aek_block']:,}, conflicts {cov['aek_block_vs_pt_conflicts']:,}, not placed {gates[hap]['not_placed']:,}; "
              f"{len(seen):,} anchor links ({n_repeat} repeats listed once) over {len(slots):,} AEK genes; "
              f"occupancy {rebuilt[(0, 0)]} reproduced")

    def cell(v):
        return "" if v is None else ("1" if v is True else "0" if v is False else str(v))

    def write(path, rows, cols, key):
        buf = io.StringIO()
        w = csv.writer(buf, delimiter="\t", lineterminator="\n")
        w.writerow(cols)
        for r in sorted(rows, key=key):
            w.writerow([cell(r[c]) for c in cols])
        with open(path, "wb") as fh, gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:
            gz.write(buf.getvalue().encode())
        print(f"wrote {os.path.relpath(path, ROOT)}: {len(rows):,} rows, {os.path.getsize(path) / 1e3:.0f} KB")

    write(OUT, labels, ["hap", "gene_id", "aek_chromosome", "gamma_copy", "salicoid_copy", "label_support",
                        "inside_aek_block", "conflict"], key=lambda r: (r["hap"], r["gene_id"]))
    write(OUT_ANCHORS, anchors, ["hap", "aek_gene", "aek_chromosome", "gamma_copy", "salicoid_copy", "gene_id"],
          key=lambda r: (r["hap"], r["aek_gene"], r["gamma_copy"], r["salicoid_copy"], r["gene_id"]))

    prov = {
        "what": "Where each 717 gene sits in the ancestral eudicot karyotype, and which gamma copy and salicoid "
                "copy it descends from (route C). Exploratory, not a curated call: the gene-level WGD events "
                "remain the duplication call.",
        "owner": "MS1 duplication analysis, gamma branch, painting v3 (route C)",
        "reference": "Wang et al. 2022, BMC Biology 20:216, doi:10.1186/s12915-022-01420-1. Ancestral eudicot "
                     "karyotype (AEK1 to AEK7) and the published P. trichocarpa painting.",
        "method": "Ancestral chromosome from collinearity between the 717 genome and the AEK genes. Gamma copy and "
                  "salicoid copy named through the collinear block shared with P. trichocarpa v3.1, as the majority "
                  "Wang et al. label of the 10 nearest anchors' P. trichocarpa partners. A gene not inside an AEK "
                  "block takes its ancestral chromosome from those anchors too. No copy where the two sources name "
                  "different ancestral chromosomes.",
        "copy_numbers": "Gamma copy (1 to 3) and salicoid copy (1 to 2) are completeness ranks from Wang et al.'s "
                        "karyotype projection, ranked within one ancestral chromosome. They are not subgenomes.",
        "slots": "An AEK gene has up to 6 slots (3 gamma copies x 2 salicoid copies). A slot with no collinear "
                 "anchor in a haplotype is lost or not detected; that is not evidence of loss.",
        "columns": {
            "karyotype_route_c.tsv.gz": "hap; gene_id; aek_chromosome 1-7, blank = not placed; gamma_copy 1-3 and "
                                        "salicoid_copy 1-2, blank = no copy assigned; label_support = share of the "
                                        "10 nearest collinear anchors agreeing, given only with a copy; "
                                        "inside_aek_block 1 = inside an AEK collinear block, 0 = inherited from "
                                        "neighbouring anchors; conflict 1 = the AEK block and the P. trichocarpa "
                                        "naming disagree, so no copy",
            "karyotype_route_c_anchors.tsv.gz": "hap; aek_gene; aek_chromosome; gamma_copy; salicoid_copy; gene_id "
                                                "(a direct collinear anchor of that AEK gene, in that slot)",
        },
        "inputs": inputs,
        "gates": gates,
        "rows_written": {"karyotype_route_c.tsv.gz": len(labels), "karyotype_route_c_anchors.tsv.gz": len(anchors)},
    }
    with open(PROV, "w") as fh:
        json.dump(prov, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(f"wrote {os.path.relpath(PROV, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
