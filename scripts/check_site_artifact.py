#!/usr/bin/env python3
"""Verify the GitHub Pages staging tree before it is uploaded.

This check works on the directory that will be given to ``upload-pages-artifact``.  It closes
two gaps that source-tree checks cannot see: a packaging typo that omits a requested file, and
an extra file that leaks into a public Pages artifact.  It also writes a compact, deterministic
release identity after the data gates have run, so a downloaded artifact can be tied to both a
Git commit and the exact bytes that were tested.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path


ROOT_FILES = frozenset({"index.html", ".nojekyll", "LICENSE", "CITATION.cff"})
RELEASE_PATH = Path("data/meta/site-release.json")
# These source trees are build inputs and compatibility fallbacks, never Pages assets.
EXCLUDED_DATA_PREFIXES = ("data/expr/buckets/", "data/expr/combat_buckets/")
REQUIRED_PATHS = ROOT_FILES | {
    "css/app.css",
    "js/app.js",
    "data/meta/manifest.json",
    "data/meta/gates.json",
}
DEFAULT_MAX_BYTES = 900 * 1024 * 1024  # GitHub Pages permits 1 GiB published sites.
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def fail(message: str) -> None:
    raise SystemExit(f"check_site_artifact.py: {message}")


def allowed(rel: Path) -> bool:
    posix = rel.as_posix()
    if posix in ROOT_FILES:
        return True
    parts = rel.parts
    if not parts:
        return False
    if any(part.startswith(".") for part in rel.parts):
        return False
    if any(posix.startswith(prefix) for prefix in EXCLUDED_DATA_PREFIXES):
        return False
    if parts[0] == "css":
        return rel.suffix == ".css"
    if parts[0] == "js":
        return rel.suffix == ".js" or posix == "js/vendor/3dmol/LICENSE"
    if parts[0] == "data":
        return rel.suffix in {".json", ".gz", ".gzb"}
    if parts[0] == "downloads":
        # The dissertation's tables, offered on the Downloads page (scripts/publish_downloads.py
        # writes them with their checksums). Tables and their notes only.
        return rel.suffix in {".csv", ".xlsx", ".md", ".txt", ".json"}
    if parts[0] == "sources":
        return len(parts) == 2 and rel.name.endswith(".provenance.json")
    return False


def artifact_files(site: Path) -> tuple[list[Path], list[str]]:
    files, bad = [], []
    for base, directories, names in os.walk(site, followlinks=False):
        base_path = Path(base)
        for name in directories:
            path = base_path / name
            if path.is_symlink():
                bad.append(f"symlinked directory: {path.relative_to(site)}")
        for name in names:
            path = base_path / name
            rel = path.relative_to(site)
            if path.is_symlink():
                bad.append(f"symlinked file: {rel}")
            elif not path.is_file():
                bad.append(f"non-regular file: {rel}")
            else:
                files.append(rel)
    return sorted(files, key=lambda p: p.as_posix()), bad


def digest(site: Path, files: list[Path]) -> tuple[str, int]:
    """Hash path, size, and content for every byte except the self-describing sidecar."""
    whole = hashlib.sha256()
    n_bytes = 0
    for rel in files:
        if rel == RELEASE_PATH:
            continue
        path = site / rel
        content = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                content.update(chunk)
        size = path.stat().st_size
        whole.update(rel.as_posix().encode("utf-8"))
        whole.update(b"\0")
        whole.update(str(size).encode("ascii"))
        whole.update(b"\0")
        whole.update(content.hexdigest().encode("ascii"))
        whole.update(b"\n")
        n_bytes += size
    return whole.hexdigest(), n_bytes


def read_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read {label}: {error}")
    if not isinstance(value, dict):
        fail(f"{label} must be a JSON object")
    return value


def check_gates(site: Path) -> str:
    manifest = read_json(site / "data/meta/manifest.json", "data/meta/manifest.json")
    if manifest.get("tier") != "public":
        fail(f"manifest tier must be 'public' for GitHub Pages (got {manifest.get('tier')!r})")
    gates = read_json(site / "data/meta/gates.json", "data/meta/gates.json")
    version = manifest.get("data_version")
    if not isinstance(version, str) or not version:
        fail("manifest has no data_version")
    if gates.get("data_version") != version:
        fail("gates.json data_version does not match manifest.json")
    if gates.get("n_failed") != 0:
        fail(f"gates.json records {gates.get('n_failed')!r} failed validation gate(s)")
    if not isinstance(gates.get("n_checks"), int) or gates["n_checks"] <= 0:
        fail("gates.json records no validation gates")
    return version


def validate_layout(site: Path, files: list[Path], max_bytes: int) -> tuple[str, int, int]:
    missing = sorted(path for path in REQUIRED_PATHS if not (site / path).is_file())
    if missing:
        fail(f"required public files are missing: {', '.join(missing)}")
    disallowed = [path.as_posix() for path in files if not allowed(path)]
    if disallowed:
        preview = ", ".join(disallowed[:8])
        suffix = " ..." if len(disallowed) > 8 else ""
        fail(f"artifact contains files outside the public allowlist: {preview}{suffix}")
    all_bytes = sum((site / rel).stat().st_size for rel in files)
    if all_bytes > max_bytes:
        fail(f"artifact is {all_bytes / 1024 / 1024:.1f} MiB; budget is {max_bytes / 1024 / 1024:.0f} MiB")
    content_sha, content_bytes = digest(site, files)
    return content_sha, content_bytes, all_bytes


def expected_release(commit: str, version: str, files: list[Path], content_sha: str,
                     content_bytes: int) -> dict:
    return {
        "schema_version": 1,
        "git_commit": commit,
        "data_version": version,
        "file_count": sum(rel != RELEASE_PATH for rel in files),
        "content_bytes": content_bytes,
        "content_sha256": content_sha,
        "what_this_is": (
            "Identity of the exact allowlisted Pages artifact after validation. The digest covers "
            "every published file except this self-describing record."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True, type=Path, help="assembled Pages directory")
    parser.add_argument("--commit", required=True, help="full 40-character Git commit SHA")
    parser.add_argument("--write-release", action="store_true",
                        help="write data/meta/site-release.json before verifying it")
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES,
                        help="maximum public artifact size in bytes (default: 900 MiB)")
    args = parser.parse_args(argv)

    site = args.site.expanduser().resolve()
    if not site.is_dir():
        fail(f"site directory does not exist: {site}")
    if not SHA_RE.fullmatch(args.commit):
        fail("--commit must be a full lowercase 40-character SHA")
    if args.max_bytes <= 0:
        fail("--max-bytes must be positive")

    files, structural_errors = artifact_files(site)
    if structural_errors:
        fail("; ".join(structural_errors[:8]))
    version = check_gates(site)
    content_sha, content_bytes, all_bytes = validate_layout(site, files, args.max_bytes)
    wanted = expected_release(args.commit, version, files, content_sha, content_bytes)
    release_file = site / RELEASE_PATH

    if args.write_release:
        release_file.parent.mkdir(parents=True, exist_ok=True)
        release_file.write_text(json.dumps(wanted, indent=2) + "\n", encoding="utf-8")
        files, structural_errors = artifact_files(site)
        if structural_errors:
            fail("; ".join(structural_errors[:8]))
        content_sha, content_bytes, all_bytes = validate_layout(site, files, args.max_bytes)
        wanted = expected_release(args.commit, version, files, content_sha, content_bytes)

    got = read_json(release_file, "data/meta/site-release.json")
    if got != wanted:
        fail("data/meta/site-release.json does not describe the current artifact")

    print(
        f"verified {len(files):,} public files ({all_bytes / 1024 / 1024:.1f} MiB), "
        f"data v{version}, commit {args.commit[:12]}, content {content_sha[:16]}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
