#!/usr/bin/env python3
"""
Ingests the genome-wide computed layers from the MS1 and MS2 analysis repos.

Sources (all keyed on gene_id, all genome-wide unless noted):

  ms1-dup
    master_duplication_table_v9.csv   duplication class: S salicoid WGD / A ancient WGD /
                                      T tandem (union set) / D dispersed, concatenated;
                                      "C" = none of them. Supersedes dupclass_membership_v8.csv
                                      (2026-09-06, TODO 21) -- checked against it directly at
                                      the swap: 0 genes differed, since the WGD letters were
                                      already carried byte-identical from the v8 freeze and the
                                      T set was already the adopted union (6,663/6,385). Kept
                                      the swap anyway: the v8 file's name and this comment both
                                      claimed staleness that was no longer true, and nothing
                                      guarantees that file keeps tracking v9 as either evolves.
    gene_te_distances_*.csv           distance to the nearest TE, per superfamily
    gene_intron_counts.csv            exon / intron counts
    hemizygous_pav_diamond.csv        PAV / hemizygosity, DIAMOND-based tier1_floor call
                                      (805/859 confirmed HAP1/HAP2). Added 2026-09-06 (TODO 21)
                                      -- the earlier hemi_pav_crosstab.csv is the OrthoFinder
                                      call ms1-dup's own CLAUDE.md forbids (2,075/1,942); this
                                      file was believed absent from the mirror and was not,
                                      just named differently than the audit searched for.
                                      Scope: 6,092 candidate hemizygous genes, not genome-wide.
  ms2-lsg
    predicted_disorder_genomewide.tsv mean disorder, disordered fraction
    secondary_structure_summary.tsv   ESMFold helix/strand/coil + pLDDT -- 40,685 of 63,960
                                      genes only (64%), so absence is coverage, not biology
    tier1_pxd*_by_gene.tsv            mass-spec peptide evidence, THREE datasets kept separate
                                      (detection rates differ 4x: 3,989 / 18,739 / 21,449)
    neighbor_coexpr_652.tsv           co-expression with genomic neighbours
    organelle_homology_by_gene.tsv    plastid/mito homology -- a real false-positive source
                                      for "novel gene" claims

`pipeline/out/*.tsv` are READ-ONLY by standing instruction: read, never write.

Two known data quirks, both asserted rather than assumed:
  * One gene appears twice in the pipeline/out tables because it carries two canonical
    candidate labels (ms2-lsg docs/GOTCHAS.md #12; the gene and its labels are not named here
    because this file is served by GitHub Pages), so those files have one row per
    (gene, label). The duplicate rows are identical; this script verifies that before
    collapsing them and fails if they ever diverge.
  * ESMFold gene ids carry a ".1.p" transcript suffix the other tables do not.

PATCHER -- runs after build_data.py, before build_facets.py.
"""
import roots
import csv, json, os, re, sys
from collections import defaultdict

MS1 = roots.root('ms1_dup')
MS2 = roots.root('ms2_lsg')
ATLAS = roots.root('atlas')
STRIP = re.compile(r"\.\d+\.p$")
PXD = ("023826", "025636", "064017")

def shard_paths(root):
    out = []
    for dp, _, fs in os.walk(root):
        out += [os.path.join(dp, f) for f in fs if f.endswith(".json")]
    return out

def num(x):
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None

def sanitise_note(raw):
    """Reduce a curation note to its MEANING, dropping the person.

    The raw notes carry internal lab process onto a public page: curator initials and dates
    tags, verbatim quotes, and a named exception. A visitor
    benefits from knowing a gene was hand-rejected or flagged pseudogene-like; nobody benefits
    from the curator's initials, and one note pairs a REJECT verdict with the curator writing
    "ok", which reads as a contradiction without the context that produced it.
    """
    raw = (raw or "").strip()
    if not raw:
        return None
    low = raw.lower()
    parts = []
    if "pseudogene-like" in low:
        parts.append("flagged pseudogene-like, not hand reviewed")
    if "relaxed" in low:
        parts.append("admitted on a relaxed edge only")
    if "undecided" in low:
        parts.append("curation undecided; automatic call used")
    if "contradiction" in low:
        parts.append("curated verdict disagrees with the automatic gate")
    if "reject" in low:
        parts.append("manually rejected during curation")
    elif "keep" in low:
        parts.append("manually confirmed during curation")
    return " · ".join(dict.fromkeys(parts)) or "carries a curation note"


def read_rows(path, delim, key="gene_id", strip_suffix=False, value_cols=None):
    """One row per gene.

    Several sources carry one row per (gene, GROUP) rather than per gene: the proteomics
    tables repeat 5,024 genes that are both a `conserved` gene and an LSG's `matched_control`,
    and the pipeline/out tables repeat PtXaAlbH.14G133000 under two canonical labels. Those
    are selection metadata, not measurements.

    So duplicates are collapsed only when the columns this script actually INGESTS agree.
    A conflict in a measured value is still fatal -- collapsing there would silently pick one.
    """
    out, dupes = {}, 0
    same = (lambda a, b: a == b) if value_cols is None else \
           (lambda a, b: all(a.get(c) == b.get(c) for c in value_cols))
    with open(path) as fh:
        for r in csv.DictReader(fh, delimiter=delim):
            g = r.get(key) or ""
            if strip_suffix:
                g = STRIP.sub("", g)
            if not g:
                continue
            if g in out:
                if not same(out[g], r):
                    raise SystemExit(
                        f"FAIL {os.path.basename(path)}: duplicate rows for {g} disagree on a "
                        f"value this script ingests ({value_cols}).\n  {out[g]}\n  {r}\n"
                        "Collapsing would silently pick one. Resolve upstream.")
                dupes += 1
                continue
            out[g] = r
    if dupes:
        print(f"    ({dupes} duplicate row(s) collapsed in {os.path.basename(path)}; "
              f"they agree on {value_cols or 'every column'})")
    return out

def main():
    data = os.path.join(ATLAS, "data")
    L = defaultdict(dict)          # gene_id -> {field: value}
    cov = {}

    # ---- duplication class -------------------------------------------------------------
    d = read_rows(f"{MS1}/data/55_master_v9_20260902/master_duplication_table_v9.csv", ",")
    tf = lambda v: 1 if str(v).strip().lower() == "true" else 0
    for g, r in d.items():
        L[g]["dup"] = {"t": r["dup_type_v9"], "s": tf(r["has_S_v9"]), "a": tf(r["has_A_v9"]),
                       "td": tf(r["has_T_union"]), "d": tf(r["has_D_v6"])}
    cov["duplication class"] = len(d)

    # ---- TE proximity, re-derived from the AUTHORITATIVE repeatmasker annotation --------
    # The previous source lived in data/32_te_proximity_threshold/, which ms1-dup CLAUDE.md
    # files under "structural explorations". Rather than serve an exploratory table, the
    # distance is recomputed here from the v5.1 repeatmasked GFF3 that ships with the genome.
    ANN = roots.path('work', '717Official/annotation')
    RM = {"hap1": f"{ANN}/PtremulaxPopulusalbaHAP1_717_v5.1.repeatmasked_assembly_v5.0.gff3",
          "hap2": f"{ANN}/PtremulaxPopulusalbaHAP2_716_v5.1.repeatmasked_assembly_v5.0.gff3"}
    GFF = {"hap1": f"{ANN}/PtremulaxPopulusalbaHAP1_717_v5.1.gene_exons.gff3",
           "hap2": f"{ANN}/PtremulaxPopulusalbaHAP2_716_v5.1.gene_exons.gff3"}
    CLASS_RE = re.compile(r"class=([^;\s]+)")
    n_te = 0
    for hap in ("hap1", "hap2"):
        # TE intervals per chromosome, excluding low-complexity/simple repeats which are not TEs
        te_by_chr = defaultdict(list)
        with open(RM[hap]) as fh:
            for line in fh:
                if line.startswith("#"):
                    continue
                f = line.rstrip("\n").split("\t")
                if len(f) < 9:
                    continue
                m = CLASS_RE.search(f[8])
                cls = m.group(1) if m else ""
                if not cls or cls.startswith(("Simple_repeat", "Low_complexity", "Satellite",
                                              "rRNA", "tRNA", "snRNA", "Unknown")):
                    continue
                te_by_chr[f[0]].append((int(f[3]), int(f[4]), cls.split("/")[0]))
        for c in te_by_chr:
            te_by_chr[c].sort()

        # gene spans from the same annotation, so coordinates are on one system
        genes_hap = []
        with open(GFF[hap]) as fh:
            for line in fh:
                if line.startswith("#"):
                    continue
                f = line.rstrip("\n").split("\t")
                if len(f) < 9 or f[2] != "gene":
                    continue
                m = re.search(r"(?:^|;)Name=([^;]+)", f[8]) or re.search(r"(?:^|;)ID=([^;]+)", f[8])
                if m:
                    genes_hap.append((f[0], int(f[3]), int(f[4]), m.group(1)))

        for chrom, gs, ge, gid in genes_hap:
            tes = te_by_chr.get(chrom)
            if not tes:
                continue
            best, best_by = None, {}
            # linear scan is fine: ~30k genes x sorted TEs per chromosome, done once
            lo, hi = 0, len(tes)
            while lo < hi:                      # first TE ending at/after the gene start
                mid = (lo + hi) // 2
                if tes[mid][1] < gs:
                    lo = mid + 1
                else:
                    hi = mid
            for k in range(max(0, lo - 40), min(len(tes), lo + 40)):
                s, e, cls = tes[k]
                dist = 0 if (s <= ge and e >= gs) else (s - ge if s > ge else gs - e)
                if best is None or dist < best:
                    best = dist
                if cls not in best_by or dist < best_by[cls]:
                    best_by[cls] = dist
            if best is not None:
                rec = {"all": int(best)}
                for cls, dv in sorted(best_by.items(), key=lambda kv: kv[1])[:4]:
                    rec[cls] = int(dv)
                L[gid]["te"] = rec
                n_te += 1
    cov["TE distance (re-derived from v5.1 repeatmask GFF3)"] = n_te

    # ---- gene structure, re-derived from the AUTHORITATIVE GFF3 -------------------------
    # The previous source was an incidental file inside a retroduplication case-study folder,
    # documented nowhere. Exon counts are a plain fact of the annotation, so take them from it.
    n_gs = 0
    for hap in ("hap1", "hap2"):
        exons = defaultdict(int)
        primary = {}
        with open(GFF[hap]) as fh:
            for line in fh:
                if line.startswith("#"):
                    continue
                f = line.rstrip("\n").split("\t")
                if len(f) < 9:
                    continue
                if f[2] == "mRNA":
                    m = re.search(r"(?:^|;)ID=([^;]+)", f[8])
                    g = re.search(r"(?:^|;)Parent=([^;]+)", f[8])
                    if m and g and "longest=1" in f[8]:
                        primary[m.group(1)] = g.group(1)
                elif f[2] == "exon":
                    pm = re.search(r"(?:^|;)Parent=([^;]+)", f[8])
                    if pm:
                        exons[pm.group(1)] += 1
        for mrna, gene in primary.items():
            n = exons.get(mrna, 0)
            # GFF3 IDs carry a ".v5.1" release suffix that Name= does not; Parent= points at
            # the ID form, so strip it to get the atlas gene id.
            gene = re.sub(r"\.v5\.1$", "", gene)
            if n:
                L[gene]["gs"] = {"ex": n, "in": n - 1}
                n_gs += 1
    cov["exon/intron (re-derived from v5.1 GFF3, longest isoform)"] = n_gs

    # ---- PAV / hemizygosity: ADDED 2026-09-06 (TODO 21) ---------------------------------
    # The 2026-09-05 audit was right to reject hemi_pav_crosstab.csv (the forbidden
    # OrthoFinder family, 2,356/2,117) but wrong that the canonical file was absent from
    # the mirror -- it is present as hemizygous_pav_diamond.csv, confirmed here to give
    # exactly 805/859. Scope is the 6,092-gene candidate set only; a gene outside it gets
    # no `pav` key, same convention as ESMFold's 64% coverage below.
    d = read_rows(f"{MS1}/data/02_synteny_section/hemizygous_pav_diamond.csv", ",")
    n_pav = 0
    for g, r in d.items():
        L[g]["pav"] = {
            "rel": r["relationship"], "confirmed": r["is_pav_diamond"].strip().lower() == "true",
            "nhits": int(r["n_diamond_hits_partner_hap"]),
            "target": r["best_target_partner_hap"] or None,
            "pident": float(r["best_pident"]) if r["best_pident"] else None,
            "evalue": r["best_evalue"] or None,
        }
        n_pav += 1
    cov["PAV / hemizygosity (DIAMOND tier1_floor, candidate set only)"] = n_pav

    # ---- disorder ------------------------------------------------------------------------
    d = read_rows(f"{MS2}/analyses/strict_control_audit/results/predicted_disorder_genomewide.tsv", "\t")
    for g, r in d.items():
        md, fd = num(r.get("mean_disorder")), num(r.get("frac_disordered"))
        if md is not None:
            L[g].setdefault("prot", {}).update({"dis": round(md, 3), "disf": round(fd, 3)})
    cov["predicted disorder"] = len(d)

    # ---- ESMFold secondary structure (64% coverage) --------------------------------------
    d = read_rows(f"{MS2}/analyses/esmfold_secondary_structure/results/secondary_structure_summary.tsv",
                  "\t", strip_suffix=True)
    for g, r in d.items():
        ss = {k: num(r.get(c)) for k, c in
              (("h", "helix_frac"), ("e", "strand_frac"), ("c", "coil_frac"),
               ("plddt", "mean_plddt"), ("low", "frac_plddt_lt70"))}
        ss["n"] = int(num(r.get("n_residues")) or 0)
        L[g].setdefault("prot", {})["ss"] = {k: (round(v, 3) if isinstance(v, float) else v)
                                             for k, v in ss.items() if v is not None}
    cov["ESMFold structure"] = len(d)

    # ---- proteomics: three datasets, never pooled ----------------------------------------
    for p in PXD:
        d = read_rows(f"{MS2}/analyses/proteomics_translation_evidence/results/tier1_pxd{p}_by_gene.tsv",
                      "\t", value_cols=("n_tryptic_peptides", "any_peptide_detected"))
        for g, r in d.items():
            n = num(r.get("n_tryptic_peptides"))
            L[g].setdefault("prot", {}).setdefault("ms", {})[p] = [
                int(n) if n is not None else None,
                1 if str(r.get("any_peptide_detected")).strip().lower() == "true" else 0]
        cov[f"proteomics PXD{p}"] = len(d)

    # ---- neighbour co-expression ----------------------------------------------------------
    d = read_rows(f"{MS2}/pipeline/out/neighbor_coexpr_652.tsv", "\t")
    for g, r in d.items():
        k5, k10 = num(r.get("neighbor_coexpr_k5")), num(r.get("neighbor_coexpr_k10"))
        if k5 is not None:
            L[g]["nb"] = {"k5": round(k5, 3), "k10": round(k10, 3) if k10 is not None else None}
    cov["neighbour co-expression"] = len(d)

    # ---- organelle homology (flag only when a hit exists) ----------------------------------
    d = read_rows(f"{MS2}/pipeline/out/organelle_homology_by_gene.tsv", "\t",
                  value_cols=("organelle", "pident", "evalue", "bitscore"))
    norg = 0
    for g, r in d.items():
        if (r.get("organelle") or "").strip():
            L[g]["org"] = {"o": r["organelle"], "pid": num(r.get("pident")),
                           "e": r.get("evalue") or None}
            norg += 1
    cov["organelle homology"] = f"{len(d)} scanned, {norg} with a hit"

    # ---- tandem arrays: the curated UNION set -------------------------------------------
    # ms1-dup CLAUDE.md: "Canonical TD files (use these, not the v8 TD tables)". The union
    # contains all 13,048 v8 T-flagged genes plus 615 more, and adds array IDENTITY -- which
    # genes share an array -- plus each array's median Ks, age bin, and the curator's verdict.
    d = read_rows(f"{MS1}/data/09_td_pairs/td_union_20260831/union_genes_final.csv", ",")
    arrays = defaultdict(list)
    for g, r in d.items():
        aid = r.get("array_id") or None
        rec = {"aid": aid, "n": int(num(r.get("array_n")) or 0),
               "age": r.get("array_age_bin") or None,
               "status": r.get("array_status") or None}
        ks = num(r.get("array_median_ks"))
        if ks is not None:
            rec["ks"] = round(ks, 4)
        if str(r.get("removed")).strip().lower() == "true":
            rec["removed"] = 1
            rec["why"] = r.get("removal_basis") or None
        if str(r.get("pseudogene_like")).strip().lower() == "true":
            rec["pseudo"] = 1
        note = sanitise_note(r.get("manual_note"))
        if note:
            rec["note"] = note
        L[g]["td"] = rec
        if aid:
            arrays[aid].append(g)
    cov["tandem arrays (union set)"] = f"{len(d)} genes in {len(arrays)} arrays"

    # Array membership is written out separately so a gene page can list its neighbours in the
    # array without every gene record carrying the whole member list.
    os.makedirs(os.path.join(data, "index"), exist_ok=True)
    with open(os.path.join(data, "index", "arrays.json"), "w") as fh:
        json.dump({k: sorted(v) for k, v in arrays.items()}, fh, separators=(",", ":"))

    # ---- perturbation responsiveness ------------------------------------------------------
    # 149 curated perturbation contrasts (the dissertation's set, ms1-dup data/139, gated there against the
    # v8 117-contrast values); until 2026-10-14 this read the 117 recommended v4 contrasts.
    d = read_rows(f"{MS1}/data/139_perturbation_per_gene_149_20261014/perturbation_per_gene_149.csv", ",")
    n_resp = 0
    for g, r in d.items():
        v = num(r.get("responsiveness_med_absl2fc"))
        nc = num(r.get("n_contrasts_eligible"))
        if v is not None:
            L[g]["resp"] = {"v": round(v, 3), "n": int(nc) if nc is not None else None}
            n_resp += 1
    cov["perturbation responsiveness"] = (f"{len(d)} scanned, {n_resp} with a value; median |log2FC| over "
                                          "the eligible contrasts of the 149 curated perturbation contrasts")

    # ---- independent tau: REMOVED after audit (2026-09-05) ------------------------------
    # tau_n202_per_gene_all.csv is computed on the n=202 atlas panel. ms1-dup CLAUDE.md is
    # self-contradictory here -- its pitfalls section still says "the current canonical n is
    # 202" -- but the dated statements win: line 148 "n=202 superseded 2026-08-24" and line 197
    # "Unchanged and still canonical: v4 n=222 atlas panel". A superseded panel is not a
    # cross-check, so no tau202 layer ships.

    # ---- genomic order, computed from the atlas's OWN coordinates -----------------------
    # The previous source was an incidental file inside an aWGD calibration folder. Order is
    # just a sort of the coordinates already in every gene record, so derive it here and owe
    # nothing to an undocumented table.
    coords = defaultdict(list)
    for hap in ("hap1", "hap2"):
        for pth in shard_paths(os.path.join(data, "genes", hap)):
            for gid, rec in json.load(open(pth)).items():
                coords[(hap, rec.get("chr"))].append((rec.get("start", 0), gid))
    n_ord = 0
    for _, lst in coords.items():
        lst.sort()
        for i2, (_, g) in enumerate(lst):
            L[g]["ord"] = {"p": lst[i2 - 1][1] if i2 > 0 else None,
                           "n": lst[i2 + 1][1] if i2 < len(lst) - 1 else None}
            n_ord += 1
    cov["genomic order (computed from atlas coordinates)"] = n_ord

    print("source coverage:")
    for k, v in cov.items():
        print(f"  {k:<26} {v}")

    # ---- patch the shards ------------------------------------------------------------------
    genes_dir = os.path.join(data, "genes")
    applied = defaultdict(int)
    seen = set()
    for hap in ("hap1", "hap2"):
        for p in sorted(shard_paths(os.path.join(genes_dir, hap))):
            with open(p) as fh:
                shard = json.load(fh)
            hit = False
            for gid, rec in shard.items():
                seen.add(gid)
                for field, val in L.get(gid, {}).items():
                    rec[field] = val
                    applied[field] += 1
                    hit = True
            if hit:
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    print("\nfields written:", dict(sorted(applied.items())))
    orphan = set(L) - seen
    if orphan:
        print(f"NOTE: {len(orphan)} source gene ids are not in the atlas "
              f"(e.g. {sorted(orphan)[:3]}) — ignored, not invented.")

    man_path = os.path.join(data, "meta", "manifest.json")
    man = json.load(open(man_path))
    dist = {}
    for g, f in L.items():
        if "dup" in f:
            dist[f["dup"]["t"]] = dist.get(f["dup"]["t"], 0) + 1
    man["layers"] = {
        "dup_class_dist": dict(sorted(dist.items(), key=lambda kv: -kv[1])),
        "coverage": {k: (v if isinstance(v, str) else v) for k, v in cov.items()},
        "applied": dict(sorted(applied.items())),
        "esmfold_note": "ESMFold structure covers 40,685 of 63,960 genes (64%). Absence is "
                        "coverage, not a structural claim.",
        "proteomics_note": "Three independent PXD datasets, reported separately. Detection "
                           "rates differ ~4x (3,989 / 18,739 / 21,449 genes), so a gene absent "
                           "from one is not undetected.",
        "responsiveness": {"contrast_set": "curated perturbation contrasts", "n_contrasts": 149,
                           "eligibility": "max(arm mean TPM) >= 5", "statistic": "median |log2FC|"},
        "dup_code": {"S": "salicoid WGD", "A": "ancient WGD", "T": "tandem",
                     "D": "dispersed", "C": "none detected"},
    }
    json.dump(man, open(man_path, "w"), indent=1, sort_keys=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
