#!/usr/bin/env python3
"""Fill the sequencing depth and library layout that the upstream sample metadata leaves blank
(studies 26 and 30) from the committed sources/expr_read_count_supplement.tsv (NCBI SRA spots,
made by make_read_count_supplement_source.py). Only blank fields are filled; a sample that
already carries a value is never changed, and the stage refuses if a listed sample is missing
or if any sample is still blank afterwards."""
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
SRC = os.path.join(ROOT, 'sources', 'expr_read_count_supplement.tsv')


def main():
    path = os.path.join(DATA, 'expr', 'samples.json')
    samples = json.load(open(path))
    by = {s['label']: s for s in samples}
    sup = list(csv.DictReader(open(SRC), delimiter='\t'))
    absent = [r['sample_label'] for r in sup if r['sample_label'] not in by]
    assert not absent, f'supplement names samples not in samples.json: {absent[:5]}'
    filled = 0
    for r in sup:
        s = by[r['sample_label']]
        if s.get('reads') is None:
            s['reads'] = int(r['reads']); filled += 1
        if not s.get('layout'):
            s['layout'] = r['layout']; filled += 1
    blank = [s['label'] for s in samples if s.get('reads') is None or not s.get('layout')]
    assert not blank, f'{len(blank)} samples still without reads or layout, e.g. {blank[:3]}'
    with open(path, 'w') as fh:
        json.dump(samples, fh, separators=(',', ':'))
    print(f'filled {filled} fields on {len(sup)} samples from {os.path.relpath(SRC, ROOT)}; every sample now has reads and layout')
    return 0


if __name__ == '__main__':
    sys.exit(main())
