# Retired provenance sidecars

Sidecars of layers that no longer exist in `data/`. Kept for history; not published (the site serves only
`sources/*.provenance.json` at the top level).

- `dup_v9_and_pav.provenance.json`: the v9 duplication class and the DIAMOND candidate PAV layer written by
  `scripts/patch_dup_v9_and_pav.py`. Retired in data 0.17.0, when `patch_syntelog_categories.py` replaced both
  and the DIAMOND record was removed from every gene. Its `confirmed_totals` (805 HAP1 / 859 HAP2) count the
  DIAMOND candidate call, NOT the dissertation's strict PAV. Moved here 2026-10-14 because the published copy was
  still downloadable from the site and stated those superseded numbers.
