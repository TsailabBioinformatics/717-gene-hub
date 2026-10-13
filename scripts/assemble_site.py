#!/usr/bin/env python3
"""Assemble the exact, intentionally small GitHub Pages artifact.

The repository contains source tables, cluster scripts, plans, and working notes that must
never reach Pages.  Keep the public tree explicit here rather than relying on a broad
``cp -R`` in a workflow: a new file type needs a deliberate review before it can publish.

The output directory must not already exist.  That makes the caller choose a fresh staging
directory and prevents a previous build's files from silently riding along in a deployment.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import tarfile
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = frozenset({"index.html", ".nojekyll", "LICENSE", "CITATION.cff"})
# This file is generated after data validation.  Never copy a tracked/stale version into a
# staging tree: its commit and digest must describe the artifact being deployed.
GENERATED_ARTIFACT_FILES = frozenset({"data/meta/site-release.json"})
# These source trees are converted into range-addressed blobs for the live atlas. They are
# build inputs and compatibility fallbacks, never Pages assets.
EXCLUDED_DATA_PREFIXES = ("data/expr/buckets/", "data/expr/combat_buckets/")


def fail(message: str) -> None:
    raise SystemExit(f"assemble_site.py: {message}")

def hidden_public_path(rel: Path) -> bool:
    """Reject cleanup leftovers rather than silently treating them as data assets."""
    return (rel.as_posix() != ".nojekyll" and rel.parts[0] in {"css", "js", "data", "sources", "downloads"}
            and any(part.startswith(".") for part in rel.parts))

def committed_files() -> list[Path]:
    result = subprocess.run(
        ["git", "-C", str(ROOT), "ls-tree", "-r", "-z", "--name-only", "HEAD"],
        check=False,
        capture_output=True,
    )
    if result.returncode:
        fail("must run from a Git checkout so the HEAD commit can be packaged")
    return [Path(path) for path in result.stdout.decode().split("\0") if path]


def allowed_source(rel: Path) -> bool:
    posix = rel.as_posix()
    if posix in ROOT_FILES:
        return True
    if any(part.startswith(".") for part in rel.parts):
        return False
    if posix in GENERATED_ARTIFACT_FILES:
        return False
    if any(posix.startswith(prefix) for prefix in EXCLUDED_DATA_PREFIXES):
        return False

    parts = rel.parts
    if not parts:
        return False
    if parts[0] == "css":
        return rel.suffix == ".css"
    if parts[0] == "js":
        # The vendor license is distributed with the minified library; its README is a repo
        # note, not an asset requested by the atlas.
        return rel.suffix == ".js" or posix == "js/vendor/3dmol/LICENSE"
    if parts[0] == "data":
        # Current data is JSON, range-addressed gzip-member blobs, and gzip-compressed model
        # buckets.  Add a type deliberately if a future client needs another one.
        return rel.suffix in {".json", ".gz", ".gzb"}
    if parts[0] == "downloads":
        # The dissertation's tables, offered on the Downloads page (scripts/publish_downloads.py
        # writes them with their checksums). Tables and their notes only.
        return rel.suffix in {".csv", ".xlsx", ".md", ".txt", ".json"}
    if parts[0] == "sources":
        # Only provenance sidecars are reader-facing.  Source tables remain in the repository.
        return len(parts) == 2 and rel.name.endswith(".provenance.json")
    return False


def extract_commit_files(selected: list[Path], output: Path) -> None:
    """Stream allowlisted bytes from HEAD, never from a dirty working tree."""
    names = [path.as_posix() for path in selected]
    expected = set(names)
    command = ["git", "-C", str(ROOT), "archive", "--format=tar", "HEAD", "--", *names]
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
        if process.stdout is None:
            fail("could not read the committed artifact archive")
        with tarfile.open(mode="r|", fileobj=process.stdout) as archive:
            for member in archive:
                if member.isdir():
                    continue
                rel = Path(member.name)
                if rel.as_posix() not in expected:
                    fail(f"Git archive emitted an unallowlisted file: {rel}")
                if not member.isfile():
                    fail(f"refusing non-regular committed file: {rel}")
                source = archive.extractfile(member)
                if source is None:
                    fail(f"could not extract committed file: {rel}")
                destination = output / rel
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open("wb") as target:
                    shutil.copyfileobj(source, target)
        stderr = process.stderr.read().decode(errors="replace") if process.stderr else ""
        if process.wait() != 0:
            fail(f"could not archive HEAD: {stderr.strip()}")
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path,
                        help="new directory to contain the public site")
    args = parser.parse_args(argv)

    output = args.output.expanduser()
    if not output.is_absolute():
        output = (Path.cwd() / output).resolve()
    if output == ROOT:
        fail("refusing to use the repository root as a deployment artifact")
    if output.exists():
        fail(f"output already exists: {output} (use a fresh staging directory)")

    committed = committed_files()
    hidden = sorted((rel for rel in committed if hidden_public_path(rel)),
                    key=lambda path: path.as_posix())
    if hidden:
        preview = ", ".join(path.as_posix() for path in hidden[:4])
        fail(f"refusing hidden path in the public tree: {preview}")
    selected = sorted((rel for rel in committed if allowed_source(rel)),
                      key=lambda p: p.as_posix())
    selected_names = {path.as_posix() for path in selected}
    missing = sorted(ROOT_FILES - selected_names)
    if missing:
        fail(f"required public files are not tracked: {', '.join(missing)}")
    if not any(path.parts[0] == "data" for path in selected):
        fail("no data files selected")

    output.mkdir(parents=True)
    extract_commit_files(selected, output)

    actual = {path.relative_to(output).as_posix()
              for path in output.rglob("*") if path.is_file()}
    if actual != selected_names:
        fail("staging tree differs from the selected allowlist")

    total_bytes = sum((output / rel).stat().st_size for rel in selected)
    print(f"assembled {len(selected):,} allowlisted files ({total_bytes / 1024 / 1024:.1f} MiB) in {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
