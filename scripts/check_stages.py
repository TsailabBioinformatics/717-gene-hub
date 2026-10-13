#!/usr/bin/env python3
"""Check that build_all.sh owns every data writer before it can wipe data/genes/.

This is deliberately a source-level gate. A missing patcher can leave a plausible, internally
valid tree whose optional fields are simply absent. The only reliable time to catch that failure
is before build_data.py destroys the old shards.
"""
from pathlib import Path
import re
import shlex
import sys

ROOT = Path(__file__).resolve().parents[1]
BUILD_ALL = ROOT / "scripts" / "build_all.sh"
STAGE_START = re.compile(r"^\s*STAGES=\(\s*$")
STAGE_END = re.compile(r"^\s*\)\s*$")
STAGE_LINE = re.compile(r'^\s*"([^"]+)"\s*(?:#.*)?$')
ENVIRONMENTS = {"sapelo2", "onedrive", "repo", "any"}

# patch_leaf_tissue_analysis.py repairs an already-published aggregation bug. The fixed
# build_expression.py produces that result directly, so replaying the patch in a full build
# would be redundant. New patchers must be stages, not additions to this escape hatch.
EXEMPT_PATCHERS = {
    "patch_leaf_tissue_analysis.py": "one-time correction superseded by build_expression.py",
    "patch_dup_v9_and_pav.py": "superseded by patch_syntelog_categories.py; kept because build_all.sh "
                               "and make_karyotype_source.py read the OneDrive root from it",
}

# These create committed source artifacts from upstream analyses. Their matching patch/build
# stage is what belongs in build_all.sh. Keeping this inventory exact makes a new generator an
# explicit review decision rather than an unowned script.
SOURCE_GENERATORS = {
    "make_chromatin_source.py",
    "make_copy_search_source.py",
    "make_dissertation_layer_source.py",
    "make_duplicate_coexpr_source.py",
    "make_founder_source.py",
    "make_gene_model_source.py",
    "make_kaks_source.py",
    "make_karyotype_source.py",
    "make_peptide_detail_source.py",
    "make_pool_frozen_source.py",
    "make_proteomics_v2_source.py",
    "make_structure_source.py",
    "make_td_pair_ks_source.py",
    "make_wgd_combined_call_source.py",
    "make_wgd_pairs_source.py",
}


def load_stages():
    stages, errors, in_stages = [], [], False
    for lineno, line in enumerate(BUILD_ALL.read_text().splitlines(), 1):
        if STAGE_START.match(line):
            if in_stages:
                errors.append(f"line {lineno}: nested STAGES declaration")
            in_stages = True
            continue
        if in_stages and STAGE_END.match(line):
            in_stages = False
            continue
        if not in_stages:
            continue
        match = STAGE_LINE.match(line)
        if not match:
            if line.strip() and not line.lstrip().startswith("#"):
                errors.append(f"line {lineno}: malformed STAGES entry")
            continue
        fields = match.group(1).split("|")
        if len(fields) != 4:
            errors.append(f"line {lineno}: expected env|command|dependencies|description")
            continue
        env, command, dependency_field, description = (field.strip() for field in fields)
        try:
            words = shlex.split(command)
        except ValueError as exc:
            errors.append(f"line {lineno}: invalid command: {exc}")
            continue
        if not words or not words[0].endswith(".py") or Path(words[0]).name != words[0]:
            errors.append(f"line {lineno}: stage command must begin with a local .py script")
            continue
        dependencies = [] if dependency_field == "-" else [
            dependency.strip() for dependency in dependency_field.split(",") if dependency.strip()
        ]
        if dependency_field != "-" and not dependencies:
            errors.append(f"line {lineno}: empty dependency list")
        if env not in ENVIRONMENTS:
            errors.append(f"line {lineno}: unknown environment {env!r}")
        if not description:
            errors.append(f"line {lineno}: missing stage description")
        stages.append({
            "line": lineno,
            "environment": env,
            "script": words[0],
            "dependencies": dependencies,
        })
    if in_stages:
        errors.append("STAGES declaration has no closing parenthesis")
    if not stages:
        errors.append("no STAGES declaration found")
    return stages, errors


def main():
    stages, errors = load_stages()
    names = [stage["script"] for stage in stages]
    by_name = {stage["script"]: index for index, stage in enumerate(stages)}

    duplicates = sorted({name for name in names if names.count(name) > 1})
    if duplicates:
        errors.append(f"duplicate stages: {', '.join(duplicates)}")

    for index, stage in enumerate(stages):
        script_path = ROOT / "scripts" / stage["script"]
        if not script_path.is_file():
            errors.append(f"line {stage['line']}: stage script does not exist: {stage['script']}")
        for dependency in stage["dependencies"]:
            if dependency not in by_name:
                errors.append(
                    f"line {stage['line']}: {stage['script']} depends on unknown {dependency}"
                )
            elif by_name[dependency] >= index:
                errors.append(
                    f"line {stage['line']}: {stage['script']} must follow {dependency}"
                )

    if names and names[0] != "build_data.py":
        errors.append("build_data.py must remain the first stage because it wipes data/genes")
    if names and names[-1] != "build_facets.py":
        errors.append("build_facets.py must remain the final stage")

    scripts = ROOT / "scripts"
    stage_set = set(names)
    builders = {path.name for path in scripts.glob("build_*.py")}
    patchers = {path.name for path in scripts.glob("patch_*.py")}
    generators = {path.name for path in scripts.glob("make_*_source.py")}

    missing_builders = sorted(builders - stage_set)
    if missing_builders:
        errors.append("unowned build scripts: " + ", ".join(missing_builders))
    unowned_patchers = sorted(patchers - stage_set - set(EXEMPT_PATCHERS))
    if unowned_patchers:
        errors.append("unowned patch scripts: " + ", ".join(unowned_patchers))
    stale_patch_exemptions = sorted(set(EXEMPT_PATCHERS) - patchers)
    if stale_patch_exemptions:
        errors.append("stale patch exemptions: " + ", ".join(stale_patch_exemptions))

    missing_generators = sorted(generators - SOURCE_GENERATORS)
    stale_generators = sorted(SOURCE_GENERATORS - generators)
    if missing_generators:
        errors.append("unclassified source generators: " + ", ".join(missing_generators))
    if stale_generators:
        errors.append("stale source-generator entries: " + ", ".join(stale_generators))
    staged_generators = sorted(stage_set & generators)
    if staged_generators:
        errors.append("source generators must not be build stages: " + ", ".join(staged_generators))

    if errors:
        print("BUILD GRAPH INVALID:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(
        f"BUILD GRAPH OK: {len(stages)} ordered stages own "
        f"{len(builders)} build scripts and {len(patchers) - len(EXEMPT_PATCHERS)} patch scripts; "
        f"{len(SOURCE_GENERATORS)} source generators and {len(EXEMPT_PATCHERS)} historical patch "
        f"are explicitly non-stages."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
