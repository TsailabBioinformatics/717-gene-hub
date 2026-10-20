# Maintaining the Poplar 717 gene atlas

For whoever looks after the site in the Tsai lab. You do not need to be a programmer for most of it,
and most of the time nothing needs doing at all.

## What it is

A static website: HTML, CSS, JavaScript and data files, served free by GitHub Pages from the `main`
branch of this repository. There is no server, database or account to keep alive. If nobody touches
it, it keeps working.

**Data is frozen at release 0.22.1 (October 2026).** Every number on the site was computed once,
from the analysis behind the dissertation, and committed here.

## Three kinds of work

### 1. Nothing (the normal case)

Check the site loads now and then. GitHub hosts it; there is nothing to renew.

### 2. Small changes: wording, a link, a layout fix, a bug

Good to do with Claude Code, on a Claude Pro plan. `CLAUDE.md` in this folder tells Claude where
things are and keeps it out of the large data folders, so a small task stays small.

1. Clone the repository and start Claude Code in its folder.
2. Ask for one change at a time, and name the page or the file if you know it
   (for example "On the Glossary page, reword the entry for Syntelog to …").
3. Let it run `python3 scripts/check_public.py` and `python3 scripts/check_version.py`, then commit
   and push to `main`.
4. On push, GitHub runs the full set of page tests. If they pass, the site updates within a few
   minutes; if they fail, the live site stays as it was and the failing test is listed under the
   repository's **Actions** tab. Nothing you push can break the live site silently.

Tips for staying within a Pro plan's limits: one task per session, start a new session for an
unrelated task, and do not ask it to "look around the repository".

### 3. Changing the data (rare)

Adding an RNA-seq study, a new annotation, or recomputing a layer means rebuilding `data/`. That
needs the original analysis setup, not just this repository:

- the University of Georgia Sapelo2 cluster (or a machine with about 16 GB of memory and the inputs);
- the analysis repositories the build reads at pinned commits (`sources/upstream_pins.json`);
- the 717 v5 genome and annotation and the RNA-seq expression matrices.

The build is `scripts/build_all.sh`; each stage, its inputs and its checks are listed there, and
`scripts/check_stages.py` verifies the list. A full rebuild takes about 25 minutes. After it,
`python3 scripts/validate_data.py` must report no failed checks before anything is committed.
Rebuilding is a job for someone comfortable with the cluster, ideally with the original author
available to ask.

## Rules that keep it safe

- **The repository is public, including its history.** Never commit passwords, tokens, personal
  file paths or unpublished results. `scripts/check_public.py` refuses the common cases.
- Never use Git LFS, and commit regenerated `data/` only as part of a release.
- A release that changes data updates `VERSION`, `CITATION.cff`, the version tag in `index.html`,
  `data/meta/manifest.json` and `CHANGELOG.md` together; `scripts/check_version.py` checks they agree.

## Who to ask

Questions about the data or the analysis: the contact address on the site's About page.
