# Poplar 717 gene atlas: instructions for Claude Code

A static website (no server, no framework, no build step for the site itself) published by GitHub
Pages from this repository's `main` branch. Live at
https://tsailabbioinformatics.github.io/poplar-717-atlas/. **This repository is public**, and so is
its history: anything committed is published.

## Save tokens: what NOT to read

- **Never open, search or list `data/` or `sources/`.** They hold ~600 MB of generated JSON and
  compressed tables; one stray read uses a large part of a session. The settings file blocks it.
  To see a gene's record, open the live page (`#/gene/<ID>`) or ask the user.
- **Do not read `CHANGELOG.md`, `scripts/check.mjs` (3,500 lines) or `scripts/validate_data.py`
  in full.** Read the first 60 lines of the changelog, and search the test file for the one check
  you need.
- Ask for the page or file involved before exploring. Most tasks touch 2-4 files.

## Where things are

| Path | What it is |
|---|---|
| `index.html` | the one page; script and style links, the version stamp |
| `js/app.js` | routes (`#/gene/…`, `#/browse`, `#/study/…`), page headers, footer |
| `js/core/` | shared helpers: data loading (`data.js`), DOM (`dom.js`), Browse, search, citations |
| `js/modules/` | one file per gene card or page (expression, duplication, protein, glossary, about …) |
| `js/core/registry.js` | which cards exist, their order on the gene page, their evidence tier |
| `css/app.css` | all styles; colours are variables at the top |
| `scripts/` | data build stages and checks (most stages need the original analysis machine; see MAINTAINING.md) |
| `data/`, `sources/` | generated data and committed inputs: **do not hand-edit** |

Rules of the code: modules do not import each other (shared code goes in `js/core/`); every gene card
needs an entry in `CARD_EVIDENCE` in `registry.js` or the page logs an error; after adding a module,
run `python3 scripts/sync_preload.py` (it updates the preload list in `index.html`).

## Words on the page

Plain language for biologists. No developer vocabulary in anything a reader sees: no file names,
"build", "manifest", "pipeline", "shipped", "as in the dissertation", "computed here". Numbers come
from the data, never typed into text by hand.

## Check before every push

```bash
python3 scripts/check_version.py        # VERSION, CITATION.cff, CHANGELOG and index.html agree
python3 scripts/validate_data.py        # only if data/ changed
python3 scripts/check_public.py         # refuses credentials and personal paths (repo is public)
```

The full browser test suite runs automatically on every push (`.github/workflows/checks.yml`), and
the site redeploys only if it passes. To run it locally (needs Node and `playwright-core`):

```bash
python3 scripts/serve_ranges.py 8931 . &      # NOT `python -m http.server`: the site needs byte ranges
node scripts/check.mjs http://127.0.0.1:8931
```

If a check fails after an intended change, update that check in `scripts/check.mjs` and say why in
the commit message. Never weaken a check to make an unintended change pass.

## Publishing

Commit to `main` and push. GitHub runs the checks and then deploys. Push once per working session,
not after every edit. A release that changes `data/` bumps `VERSION`, `CITATION.cff` (version and
date), the `atlas-build-version` meta tag in `index.html`, `data_version` in
`data/meta/manifest.json`, and adds a `CHANGELOG.md` entry plus a reader-facing line in
`js/modules/changes.js`. A wording or layout fix needs only the changelog line.

Never: Git LFS, force-push, committing generated data outside a release, or committing anything
from a personal machine path.
