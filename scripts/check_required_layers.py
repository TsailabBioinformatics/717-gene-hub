#!/usr/bin/env python3
"""Read-only completeness checks for layers a full data build must restore.

A field-by-field validator can pass when an entire optional layer is absent. This gate checks
the output contracts of the layers that are easy to drop when build_data.py rewrites shards:
source-backed shard fields, derived indexes, binary artifacts, and map overlays. It never
writes data/, so it is also safe after either half of the two-machine build.
"""
import csv
import gzip
import json
import os
import re
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HAPS = ("hap1", "hap2")
FAMILY_ALIAS = {"ABRE_bZIP": "bZIP", "DREB_ERF": "AP2_ERF", "MADS_box": "MADS"}
PROFILE_MARKS = ("atac", "k4", "k36", "k27")
STRUCT_SPAN = 2500


class Checks:
    def __init__(self):
        self.failed = []

    def check(self, label, passed, detail=""):
        print(f"{'PASS' if passed else 'FAIL'}  {label}" + (f" — {detail}" if detail else ""))
        if not passed:
            self.failed.append(label)


def shard_paths(root):
    for directory, dirs, files in os.walk(root):
        dirs.sort()
        for name in sorted(files):
            if name.endswith(".json"):
                yield Path(directory) / name


def gz_rows(path):
    with gzip.open(path, "rt") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def integer(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def load_records():
    records, by_hap = {}, {hap: [] for hap in HAPS}
    for hap in HAPS:
        root = DATA / "genes" / hap
        if not root.is_dir():
            raise RuntimeError(f"missing shard directory: {root}")
        for path in shard_paths(root):
            with path.open() as fh:
                shard = json.load(fh)
            for gene_id, record in shard.items():
                if gene_id in records:
                    raise RuntimeError(f"duplicate gene record: {gene_id}")
                records[gene_id] = (hap, record)
            by_hap[hap].append((path, shard))
    return records, by_hap


def check_expression_ranges(checks, records, manifest):
    ranges = manifest.get("expr_ranges") or {}
    checks.check("expression range manifest exists", bool(ranges))
    for label, pointer, range_key, prefix, count_key, bytes_key in (
        ("raw", "b", "o", "raw", "genes_raw", "raw_bytes"),
        ("ComBat", "cb", "co", "cb", "genes_combat", "combat_bytes"),
    ):
        found, invalid = 0, []
        actual_sizes = {}
        for hap in HAPS:
            path = DATA / "expr" / f"{prefix}_{hap}.gzb"
            if not path.is_file():
                invalid.append(f"missing {path.name}")
                continue
            size = path.stat().st_size
            actual_sizes[hap] = size
            for gene_id, (gene_hap, record) in records.items():
                if gene_hap != hap:
                    continue
                expression = record.get("x") or {}
                has_pointer = bool(expression.get(pointer))
                value = expression.get(range_key)
                if has_pointer:
                    found += 1
                    if (not isinstance(value, list) or len(value) != 2
                            or not all(isinstance(n, int) for n in value)
                            or value[0] < 0 or value[1] <= 0 or value[0] + value[1] > size):
                        invalid.append(gene_id)
                elif value is not None:
                    invalid.append(f"{gene_id} has {range_key} without {pointer}")
        checks.check(f"{label} range blobs and offsets cover their shard pointers",
                     not invalid, f"{found:,} records; {len(invalid)} invalid")
        checks.check(f"{label} range manifest gene count matches shards",
                     ranges.get(count_key) == found,
                     f"manifest {ranges.get(count_key)} vs shards {found}")
        checks.check(f"{label} range manifest byte counts match blobs",
                     ranges.get(bytes_key) == actual_sizes,
                     f"manifest {ranges.get(bytes_key)} vs blobs {actual_sizes}")


def check_gene_age_crosscheck(checks, records):
    """Every candidate carries the cross-check its source row gives, and nothing else does."""
    rows = {r["gene_id"]: (int(r["r"]), int(r["f"])) for r in gz_rows(ROOT / "sources" / "gene_age_crosscheck.tsv.gz")}
    cand = {g for g, (_h, rec) in records.items() if (rec.get("ps") or {}).get("lsg")}
    have = {g: (rec["ps"]["xc"]["r"], rec["ps"]["xc"]["f"]) for g, (_h, rec) in records.items()
            if (rec.get("ps") or {}).get("xc")}
    checks.check("gene-age cross-checks on exactly the candidates, equal to sources/gene_age_crosscheck.tsv.gz",
                 set(have) == cand and all(have[g] == rows.get(g) for g in have),
                 f"{len(have):,} genes carry one, {len(cand):,} candidates")


def check_dup_crosscheck(checks, records):
    """Every quality-filtered gene in the tandem cross-check source carries its row, nothing else does."""
    rows = {r["gene_id"]: (int(r["t"]), int(r["x"])) for r in gz_rows(ROOT / "sources" / "dup_tandem_crosscheck.tsv.gz")}
    want = {g for g, (_h, rec) in records.items() if g in rows and rec.get("dup") is not None
            and not (rec.get("rel") or {}).get("qc")}
    have = {g: (rec["dup"]["xt"]["t"], rec["dup"]["xt"]["x"]) for g, (_h, rec) in records.items()
            if (rec.get("dup") or {}).get("xt")}
    checks.check("tandem cross-checks equal sources/dup_tandem_crosscheck.tsv.gz on quality-filtered genes",
                 set(have) == want and all(have[g] == rows[g] for g in have),
                 f"{len(have):,} genes carry one, {len(want):,} expected")


def check_wgd_pairs(checks, records):
    rows = gz_rows(ROOT / "sources" / "wgd_pairs.tsv.gz")
    expected = Counter()
    for row in rows:
        expected[(row["gene_a"], row["gene_b"], row["event"])] += 1
        expected[(row["gene_b"], row["gene_a"], row["event"])] += 1
    actual = Counter(
        (gene_id, partner.get("id"), partner.get("e"))
        for gene_id, (_hap, record) in records.items()
        for partner in (record.get("wgd") or [])
    )
    checks.check("WGD partner records exactly match sources/wgd_pairs.tsv.gz",
                 actual == expected,
                 f"{sum(actual.values()):,} shard links vs {sum(expected.values()):,} expected")


def check_gene_model(checks, records, manifest):
    intron_rows = {row["gene_id"]: row for row in gz_rows(ROOT / "sources" / "intron_support.tsv.gz")}
    pair_rows = {row["gene_id"]: row for row in gz_rows(ROOT / "sources" / "gene_model_pairs.tsv.gz")}
    actual_intron = {
        gene_id for gene_id, (_hap, record) in records.items()
        if (record.get("gm") or {}).get("in") is not None
    }
    actual_pairs = {
        gene_id for gene_id, (_hap, record) in records.items()
        if "np" in (record.get("gm") or {})
    }
    actual_flags = {
        gene_id for gene_id, (_hap, record) in records.items()
        if (record.get("gm") or {}).get("sp") is not None
    }
    expected_flags = {gene_id for gene_id, row in pair_rows.items() if row["flagged"] == "1"}
    mismatches = []
    for gene_id, row in intron_rows.items():
        gm = records.get(gene_id, (None, {}))[1].get("gm") or {}
        if (gm.get("in") or {}).get("n") != integer(row["n_introns"]):
            mismatches.append(gene_id)
    for gene_id, row in pair_rows.items():
        gm = records.get(gene_id, (None, {}))[1].get("gm") or {}
        if gm.get("np") != integer(row["n_pairs"]) or gm.get("nev") != integer(row["n_pairs_evaluable"]):
            mismatches.append(gene_id)
    checks.check("gene-model intron coverage matches its source",
                 actual_intron == set(intron_rows) and not mismatches,
                 f"{len(actual_intron):,} records; {len(mismatches)} mismatches")
    checks.check("gene-model adjacent-pair coverage and flags match their source",
                 actual_pairs == set(pair_rows) and actual_flags == expected_flags,
                 f"{len(actual_pairs):,} pair records; {len(actual_flags):,} flags")
    model = manifest.get("gene_model") or {}
    checks.check("gene-model manifest counts match sources",
                 ((model.get("intron_support") or {}).get("genes") == len(intron_rows)
                  and (model.get("split_model") or {}).get("flagged_genes") == len(expected_flags)),
                 f"introns {len(intron_rows):,}; flags {len(expected_flags):,}")


def check_peptide_detail(checks, records, manifest):
    expected = defaultdict(set)
    for row in gz_rows(ROOT / "sources" / "peptide_detail.tsv.gz"):
        expected[row["gene_id"]].add(row["dataset"])
    actual = {}
    for gene_id, (_hap, record) in records.items():
        detail = ((record.get("prot") or {}).get("ms") or {}).get("det")
        if detail is not None:
            actual[gene_id] = set(detail)
    checks.check("peptide-detail gene and dataset coverage matches its source",
                 actual == {gene_id: set(datasets) for gene_id, datasets in expected.items()},
                 f"{len(actual):,} genes; {sum(map(len, actual.values())):,} gene-dataset records")
    detail_manifest = ((manifest.get("proteomics") or {}).get("peptide_detail") or {})
    checks.check("peptide-detail manifest count matches source",
                 detail_manifest.get("genes") == len(expected),
                 f"manifest {detail_manifest.get('genes')} vs source {len(expected)}")


def check_promoter_positions(checks, records, manifest):
    expected = defaultdict(lambda: defaultdict(list))
    for row in gz_rows(ROOT / "sources" / "promoter_motif_pos.tsv.gz"):
        family = FAMILY_ALIAS.get(row["family"], row["family"])
        expected[row["gene_id"]][family].append(integer(row["dist_to_tss"]))
    for families in expected.values():
        for distances in families.values():
            distances.sort()

    excluded = set()
    excluded_path = ROOT / "sources" / "promoter_motif_pos.excluded.tsv"
    with excluded_path.open() as fh:
        next(fh, None)
        for line in fh:
            excluded.add(line.split("\t", 1)[0])

    wanted = {
        gene_id: {family: distances for family, distances in sorted(families.items())}
        for gene_id, families in expected.items() if gene_id not in excluded
    }
    actual, actual_excluded = {}, set()
    for gene_id, (_hap, record) in records.items():
        promoter = record.get("cre") or {}
        if promoter.get("pos") is not None:
            actual[gene_id] = promoter["pos"]
        if promoter.get("posx"):
            actual_excluded.add(gene_id)
    checks.check("promoter-position records match the committed source and exclusions",
                 actual == wanted and actual_excluded == excluded,
                 f"{len(actual):,} positioned; {len(actual_excluded):,} withheld")
    positions = ((manifest.get("cre") or {}).get("positions") or {})
    checks.check("promoter-position manifest counts match shards",
                 (positions.get("genes_with_positions") == len(actual)
                  and positions.get("genes_withheld") == len(actual_excluded)),
                 f"manifest {positions.get('genes_with_positions')}/{positions.get('genes_withheld')}")


def profile_shard(locus):
    match = re.match(r"Potri\.(\w{3})G", locus)
    return match.group(1) if match else "other"


def check_chromatin_profiles(checks, records, manifest):
    source = {}
    for row in gz_rows(ROOT / "sources" / "chromatin_profiles.tsv.gz"):
        source[row["locus"]] = [[integer(value) for value in row[mark].split(",")]
                                for mark in PROFILE_MARKS]
    wanted_by_gene = {}
    for gene_id, (_hap, record) in records.items():
        ptri = record.get("ptri") or {}
        if ptri.get("one2one") == 1 and ptri.get("id") in source and record.get("atac"):
            wanted_by_gene[gene_id] = ptri["id"]
    actual_flags = {
        gene_id for gene_id, (_hap, record) in records.items()
        if (record.get("atac") or {}).get("pf")
    }
    checks.check("chromatin-profile flags cover exactly the reachable source loci",
                 actual_flags == set(wanted_by_gene),
                 f"{len(actual_flags):,} flagged genes vs {len(wanted_by_gene):,} expected")

    actual_profiles = {}
    for path in sorted((DATA / "chromatin").glob("*.json")):
        with path.open() as fh:
            payload = json.load(fh)
        actual_profiles.update(payload)
    wanted_loci = set(wanted_by_gene.values())
    checks.check("chromatin-profile files contain exactly the reachable loci",
                 set(actual_profiles) == wanted_loci,
                 f"{len(actual_profiles):,} loci vs {len(wanted_loci):,} expected")
    bad_values = [
        locus for locus in wanted_loci
        if actual_profiles.get(locus) != source.get(locus)
    ]
    checks.check("chromatin-profile values match the committed source",
                 not bad_values, f"{len(bad_values)} differing loci")
    profile_manifest = ((manifest.get("chromatin") or {}).get("profiles") or {})
    checks.check("chromatin-profile manifest counts match artifacts",
                 (profile_manifest.get("genes") == len(wanted_by_gene)
                  and profile_manifest.get("loci") == len(wanted_loci)),
                 f"manifest genes/loci {profile_manifest.get('genes')}/{profile_manifest.get('loci')}")


def map_values(records, overview):
    bins = defaultdict(lambda: defaultdict(lambda: {
        "n": 0, "td": 0, "lsg": 0, "tau": 0.0, "ntau": 0,
        "w": 0.0, "nw": 0, "ms": 0, "acr": 0, "nacr": 0,
    }))
    bin_size = overview["bin"]
    for _gene_id, (hap, record) in records.items():
        ps, expression = record.get("ps") or {}, record.get("x") or {}
        duplication, kaks = record.get("dup") or {}, record.get("ks") or {}
        ms = (record.get("prot") or {}).get("ms") or {}
        atac = record.get("atac") or {}
        bucket = bins[(hap, record["chr"])][record["start"] // bin_size]
        bucket["n"] += 1
        bucket["td"] += bool(duplication.get("td"))
        bucket["lsg"] += bool(ps.get("lsg"))
        if expression.get("tau") is not None:
            bucket["tau"] += expression["tau"]
            bucket["ntau"] += 1
        if kaks.get("w") is not None:
            bucket["w"] += kaks["w"]
            bucket["nw"] += 1
        if ms.get("n"):
            bucket["ms"] += 1
        if atac.get("ex"):
            bucket["nacr"] += 1
            bucket["acr"] += bool(atac.get("acr"))
    expected, differences = {}, []
    for hap, chromosomes in overview["hap"].items():
        for chromosome, rows in chromosomes.items():
            mine = bins[(hap, chromosome)]
            expected[(hap, chromosome)] = []
            for index in range(len(rows)):
                bucket = mine.get(index)
                value = ([bucket["n"], bucket["td"], bucket["lsg"],
                          round(bucket["tau"] / bucket["ntau"], 3) if bucket["ntau"] else None,
                          round(bucket["w"] / bucket["nw"], 3) if bucket["nw"] else None,
                          round(bucket["ms"] / bucket["n"], 3) if bucket["n"] else None,
                          round(bucket["acr"] / bucket["nacr"], 3) if bucket["nacr"] else None]
                         if bucket else [0, 0, 0, None, None, None, None])
                expected[(hap, chromosome)].append(value)
                if rows[index] != value:
                    differences.append((hap, chromosome, index))
    return differences


def check_map_overlays(checks, records):
    path = DATA / "locus" / "overview.json"
    if not path.is_file():
        checks.check("genome-map overlay artifact exists", False, "data/locus/overview.json is missing")
        return
    with path.open() as fh:
        overview = json.load(fh)
    expected_columns = ["n", "tandem", "lsg", "tau", "omega", "ms_frac", "acr_frac"]
    ragged = sum(
        len(row) != len(expected_columns)
        for chromosomes in overview.get("hap", {}).values()
        for rows in chromosomes.values() for row in rows
    )
    checks.check("genome-map overlay schema has all seven metrics",
                 overview.get("cols") == expected_columns and ragged == 0,
                 f"columns {overview.get('cols')}; {ragged} ragged rows")
    differences = map_values(records, overview)
    checks.check("genome-map overlay values are current shard aggregates",
                 not differences, f"{len(differences)} stale bins")


def struct_key(gene_id):
    match = re.match(r"^PtXa(TreH|AlbH)\.(\d\d)G(\d+)$", gene_id)
    if match:
        hap = "hap1" if match.group(1) == "TreH" else "hap2"
        return f"{hap}/Chr{match.group(2)}/{int(match.group(3)) // STRUCT_SPAN}"
    match = re.match(r"^PtXa(TreH|AlbH)\.T(\d+)$", gene_id)
    if match:
        hap = "hap1" if match.group(1) == "TreH" else "hap2"
        return f"{hap}/scaffolds/{int(match.group(2)) // STRUCT_SPAN}"
    raise ValueError(gene_id)


def check_structure(checks, records, manifest):
    wanted = {
        gene_id: ((record.get("prot") or {}).get("ss") or {}).get("n")
        for gene_id, (_hap, record) in records.items()
        if (record.get("prot") or {}).get("ss")
    }
    actual, wrong_bucket, wrong_count, malformed = {}, [], [], []
    root = DATA / "struct"
    for path in sorted(root.glob("**/*.bin.gz")):
        key = str(path.relative_to(root))[:-len(".bin.gz")]
        try:
            raw = gzip.decompress(path.read_bytes())
            (header_size,) = struct.unpack_from("<I", raw, 0)
            header = json.loads(raw[4:4 + header_size])
        except Exception as exc:
            malformed.append(f"{path.name}: {exc}")
            continue
        for gene_id, value in header.get("genes", {}).items():
            actual[gene_id] = value[1] if isinstance(value, list) and len(value) == 2 else None
            if struct_key(gene_id) != key:
                wrong_bucket.append(gene_id)
            if actual[gene_id] != wanted.get(gene_id):
                wrong_count.append(gene_id)
    checks.check("3D structure buckets cover exactly the gene records with prot.ss",
                 set(actual) == set(wanted),
                 f"{len(actual):,} bucket records vs {len(wanted):,} expected")
    checks.check("3D structure bucket headers are well formed and match shard metadata",
                 not malformed and not wrong_bucket and not wrong_count,
                 f"{len(malformed)} malformed, {len(wrong_bucket)} misplaced, {len(wrong_count)} wrong counts")
    structure = manifest.get("structure") or {}
    checks.check("3D structure manifest count matches buckets",
                 structure.get("genes") == len(actual),
                 f"manifest {structure.get('genes')} vs buckets {len(actual)}")


def family_components(records):
    parent = {gene_id: gene_id for gene_id in records}

    def find(gene_id):
        root = gene_id
        while parent[root] != root:
            root = parent[root]
        while parent[gene_id] != gene_id:
            parent[gene_id], gene_id = root, parent[gene_id]
        return root

    def union(left, right):
        if left not in parent or right not in parent:
            return
        left, right = find(left), find(right)
        if left != right:
            parent[left] = right

    edge_counts = Counter()
    for gene_id, (_hap, record) in records.items():
        for partner in record.get("wgd") or []:
            union(gene_id, partner.get("id"))
            edge_counts["wgd"] += 1
        allele = record.get("allele") or {}
        if allele:
            union(gene_id, allele.get("id"))
            edge_counts["allele"] += 1
        for member in ((record.get("td") or {}).get("mem") or []):
            if member:
                union(gene_id, member[0])
                edge_counts["tandem"] += 1
        for partner in record.get("para") or []:
            union(gene_id, partner.get("id"))
            edge_counts["para"] += 1

    groups = defaultdict(list)
    for gene_id in sorted(records):
        groups[find(gene_id)].append(gene_id)
    components = {frozenset(members) for members in groups.values() if len(members) > 1}
    return components, dict(edge_counts)


def check_families(checks, records, manifest):
    path = DATA / "index" / "families.json"
    if not path.is_file():
        checks.check("family index artifact exists", False, "data/index/families.json is missing")
        return
    with path.open() as fh:
        families = json.load(fh)
    actual_components = {frozenset(members) for members in families.values()}
    expected_components, edge_counts = family_components(records)
    family_of_gene = {}
    duplicates = []
    for family_id, members in families.items():
        for gene_id in members:
            if gene_id in family_of_gene:
                duplicates.append(gene_id)
            family_of_gene[gene_id] = family_id
    shard_family_of_gene = {
        gene_id: record.get("fam")
        for gene_id, (_hap, record) in records.items() if record.get("fam")
    }
    checks.check("family index is the current homology connected-component graph",
                 actual_components == expected_components and not duplicates,
                 f"{len(families):,} families; {len(duplicates)} duplicate memberships")
    checks.check("family IDs on shards exactly match data/index/families.json",
                 shard_family_of_gene == family_of_gene,
                 f"{len(shard_family_of_gene):,} shard assignments")
    family_manifest = manifest.get("families") or {}
    checks.check("family manifest counts and edge totals match artifacts",
                 (family_manifest.get("n_families") == len(families)
                  and family_manifest.get("genes_in_a_family") == len(family_of_gene)
                  and family_manifest.get("edges") == edge_counts),
                 f"families {family_manifest.get('n_families')}; edges {family_manifest.get('edges')}")


def main():
    checks = Checks()
    records, _shards = load_records()
    with (DATA / "meta" / "manifest.json").open() as fh:
        manifest = json.load(fh)

    check_expression_ranges(checks, records, manifest)
    check_wgd_pairs(checks, records)
    check_gene_age_crosscheck(checks, records)
    check_dup_crosscheck(checks, records)
    check_gene_model(checks, records, manifest)
    check_peptide_detail(checks, records, manifest)
    check_promoter_positions(checks, records, manifest)
    check_chromatin_profiles(checks, records, manifest)
    check_map_overlays(checks, records)
    check_structure(checks, records, manifest)
    check_families(checks, records, manifest)

    print()
    if checks.failed:
        print(f"{len(checks.failed)} REQUIRED LAYER CHECK(S) FAILED: {checks.failed}")
        return 1
    print("ALL REQUIRED LAYERS PRESENT AND CURRENT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
