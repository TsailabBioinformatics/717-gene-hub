#!/usr/bin/env python3
"""Resolve the atlas and its upstream checkouts from one documented place."""
import json
import os
import subprocess
import sys


HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS = os.path.dirname(HERE)

ROOTS = {
    "atlas": ((), (ATLAS,)),
    "ms1_dup": (("MS1_DUP_ROOT", "MS1_DUP", "MS1_DUP_REPO"),
                ("~/dev/ms1-dup", "/scratch/$USER/ms1-dup", "~/ms1-dup")),
    "ms2_lsg": (("MS2_LSG_ROOT",),
                ("~/dev/ms2-lsg", "~/dev/ms2-scratch/ms2-lsg", "/scratch/$USER/ms2-lsg")),
    "scratch": (("SCRATCH_ROOT",), ("/scratch/$USER",)),
    "work": (("WORK_ROOT",), ("/work/cjtlab",)),
    "onedrive_ms1": (("ONEDRIVE_MS1_ROOT",),
                     ("<onedrive>/01_work/MS1_2026",)),
    "onedrive_work": (("ONEDRIVE_WORK_ROOT",),
                      ("<onedrive>/01_work",)),
}


def _expand(value):
    return os.path.expandvars(os.path.expanduser(value))


def _resolution(name):
    envs, candidates = ROOTS[name]
    for env in envs:
        if env in os.environ:
            return os.environ[env], "env"
    expanded = [_expand(candidate) for candidate in candidates]
    for candidate in expanded:
        if os.path.exists(candidate):
            return candidate, "candidate"
    return expanded[0], "default"


def root(name):
    """Return the configured root, preferring an explicitly-set environment variable."""
    if name not in ROOTS:
        raise KeyError(name)
    return _resolution(name)[0]


def path(name, rel=""):
    """Return a path below a logical root."""
    return os.path.join(root(name), rel)


def upstream_status():
    """Describe whether each pinned upstream checkout is usable and current."""
    with open(path("atlas", "sources/upstream_pins.json")) as fh:
        pins = json.load(fh)
    statuses = []
    for name in ("ms1_dup", "ms2_lsg"):
        resolved = root(name)
        try:
            worktree = subprocess.run(
                ["git", "-C", resolved, "rev-parse", "--is-inside-work-tree"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=False,
            ).stdout.strip() == "true"
        except OSError:
            worktree = False
        ancestor = False
        if worktree:
            ancestor = subprocess.run(
                ["git", "-C", resolved, "merge-base", "--is-ancestor", pins[name], "HEAD"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
            ).returncode == 0
        statuses.append({"name": name, "path": resolved, "worktree": worktree,
                         "pinned_ancestor": ancestor, "ok": worktree and ancestor})
    return statuses


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) == 2 and argv[0] == "--get":
        print(root(argv[1]))
        return 0
    if argv:
        raise SystemExit("usage: roots.py [--get NAME]")
    for name in ROOTS:
        value, source = _resolution(name)
        print(f"{name}: {value} ({source})")
    statuses = upstream_status()
    for status in statuses:
        print("{name}: {path} worktree={worktree} pinned_ancestor={pinned_ancestor} ok={ok}".format(**status))
    return 0 if all(status["ok"] for status in statuses) else 1


if __name__ == "__main__":
    sys.exit(main())
