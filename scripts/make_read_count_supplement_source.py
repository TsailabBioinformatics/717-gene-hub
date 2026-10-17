#!/usr/bin/env python3
"""Regenerate sources/expr_read_count_supplement.tsv: sequencing depth and library layout from NCBI
SRA for the samples whose upstream column-level metadata leaves them blank.

The dissertation's COLUMN_LEVEL_sample_metadata.csv has no total_read_count for studies 26 (18
samples) and 30 (9), and no library_layout for study 30; its RUN_LEVEL table lists study 26's
read_count as 0. The study pages then printed "–" in the Reads column. SRA's run record is the
primary source for both values. `reads` is SRA `spots`, which is what every other sample's
total_read_count already is (checked on SRR1293453: 14,545,716 in both).

Not a stage: it reaches the network. Run it by hand when a study is added, commit the TSV, then
run patch_read_counts.py.
"""
import roots
import csv
import io
import os
import sys
import urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLUMN_LEVEL = roots.path('scratch', 'ms2_genespace/expression/COLUMN_LEVEL_sample_metadata.csv')
OUT = os.path.join(ROOT, 'sources', 'expr_read_count_supplement.tsv')


def main():
    rows = list(csv.DictReader(open(COLUMN_LEVEL)))
    need = [r for r in rows if not r['total_read_count'].strip() or not r['library_layout'].strip()]
    runs = sorted({run for r in need for run in r['runs'].split(';') if run})
    url = 'https://trace.ncbi.nlm.nih.gov/Traces/sra-db-be/runinfo?acc=' + ','.join(runs)
    info = {r['Run']: r for r in csv.DictReader(io.StringIO(urllib.request.urlopen(url, timeout=120).read().decode()))
            if r.get('Run')}
    missing = [r for r in runs if r not in info]
    assert not missing, f'SRA returned no record for {missing}'
    out = []
    for r in need:
        rr = [info[x] for x in r['runs'].split(';') if x]
        layouts = {x['LibraryLayout'] for x in rr}
        assert len(layouts) == 1, (r['sample_label'], layouts)
        out.append({'sample_label': r['sample_label'], 'study': r['study'], 'runs': r['runs'],
                    'reads': sum(int(x['spots']) for x in rr), 'layout': layouts.pop(),
                    'source': 'NCBI SRA runinfo (spots)', 'retrieved': date.today().isoformat()})
    with open(OUT, 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[0]), delimiter='\t')
        w.writeheader(); w.writerows(out)
    print(f'wrote {len(out)} samples from {len(runs)} SRA runs to {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
