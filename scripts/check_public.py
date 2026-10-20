#!/usr/bin/env python3
"""Run before every push: this repository is public, and so is everything in its history.

Refuses (exit 1) if a tracked file holds a credential, a curation note, a personal machine path,
or (when a held-label list is given) an unpublished candidate-gene label. Machine paths are only
allowed in data/meta/manifest.json, which records where the data was built.

    python3 scripts/check_public.py                      # credentials, notes, machine paths
    python3 scripts/check_public.py --held labels.txt    # also the held labels (one per line)

The held-label list is kept OUTSIDE this repository on purpose. Once the labels are published it
is no longer needed.
"""
import argparse
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORBID = [
    ("curation note", re.compile(rb"curator wrote|cj_2026\d{4}")),
    ("credential", re.compile(rb"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}"
                              rb"|sk-ant-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY"
                              rb"|https://[^/\s:@]+:[^/\s@]{8,}@github\.com")),
]
PATHS = re.compile(rb"/Users/chenhsieh|/home/ch29576|/scratch/ch29576|ch29576@")
PATHS_OK = {"data/meta/manifest.json"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--held", help="file of held candidate-gene labels, one per line")
    a = ap.parse_args()
    forbid = list(FORBID)
    if a.held:
        terms = [t.strip() for t in open(a.held) if t.strip()]
        forbid.append(("held label", re.compile(
            rb"(?<![A-Za-z0-9_])(?:" + b"|".join(re.escape(t.encode()) for t in terms) + rb")(?![A-Za-z0-9])")))
    files = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout.split(b"\0")
    bad = []
    for f in filter(None, files):
        rel = f.decode()
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path) or os.path.getsize(path) > 200_000_000:
            continue
        data = open(path, "rb").read()
        for name, rx in forbid:
            if rx.search(data):
                bad.append(f"{rel}: {name}")
        if rel not in PATHS_OK and PATHS.search(data):
            bad.append(f"{rel}: personal machine path")
    if bad:
        print("REFUSING TO PUSH, this repository is public:")
        for b in bad:
            print("  " + b)
        return 1
    print(f"public check passed: {len(files) - 1} tracked files, {'with' if a.held else 'without'} the held-label list")
    return 0


if __name__ == "__main__":
    sys.exit(main())
