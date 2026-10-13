// How a gene, and a tandem array, relates to the other haplotype: the reader's names for the
// syntelog relationship categories and the per-array status. One place, so the gene page, the
// array pages, Browse and the locus card all say the same thing. Codes come from the data
// (rel.c on a gene record, k in data/index/array_status.json) and are never shown raw.
import { loadArrayStatus as load } from './data.js';

export const CATEGORY = {
  '1:1': { name: '1:1', what: 'one gene on each haplotype, and neither is in a tandem array' },
  'N:N_TD': { name: 'TD-associated N:N',
    what: 'the same number of copies on both haplotypes (two or more each), with a tandem array among them' },
  'N:N_nonTD': { name: 'Non-TD N:N',
    what: 'the same number of copies on both haplotypes (two or more each), none in a tandem array' },
  'CNV_TD': { name: 'TD-associated CNV',
    what: 'a different number of copies on the two haplotypes, with a tandem array among them' },
  'CNV_nonTD': { name: 'Non-TD CNV',
    what: 'a different number of copies on the two haplotypes, none in a tandem array' },
  'hemizygous_strict_PAV': { name: 'Strict PAV',
    what: 'no syntelog on the other haplotype and no protein-level match to it anywhere there' },
  'hemizygous_TD_array': { name: 'Hemizygous TD arrays',
    what: 'a tandem array none of whose members has a syntelog on the other haplotype; hemizygous, '
      + 'not absent: most members still have a protein-level match there' },
  'hemizygous_nonPAV': { name: 'Non-PAV hemizygous',
    what: 'no syntelog on the other haplotype, but the sequence is not absent there' },
};
export const CATEGORY_ORDER = Object.keys(CATEGORY);

const DETAIL = {
  HAP1_more_copies: 'HAP1 has more copies',
  HAP2_more_copies: 'HAP2 has more copies',
  protein_homolog_elsewhere: 'a protein homolog sits elsewhere on the other haplotype',
  full_length_DNA_match_at_syntenic_position: 'a near-full-length DNA match sits at the syntenic position',
  protein_homolog_all_members: 'every member has a protein homolog on the other haplotype',
  protein_PAV_all_members: 'no member has a protein homolog on the other haplotype',
  protein_PAV_some_members: 'some members lack a protein homolog on the other haplotype',
};
export const detailText = (d) => (d ? DETAIL[d] || d.replace(/_/g, ' ') : null);

export const categoryName = (c) => (c && CATEGORY[c] ? CATEGORY[c].name : null);

/** Tandem array status, keyed by the data's status key. `hap` is the array's own haplotype. */
export function statusName(k) {
  return ({
    same_copy_number: 'N:N (same copy number)',
    diff_copy_number_arrays_both: 'CNV, arrays in both haplotypes',
    HAP1_specific_expansion: 'CNV, HAP1-specific expansion',
    HAP2_specific_expansion: 'CNV, HAP2-specific expansion',
    TD_associated_PAV: 'Hemizygous (no syntelog)',
    diff_copy_number_array_on_smaller_side: 'CNV, array only on the side with fewer copies',
  })[k] || null;
}
export const STATUS_ORDER = ['same_copy_number', 'diff_copy_number_arrays_both', 'HAP1_specific_expansion',
  'HAP2_specific_expansion', 'diff_copy_number_array_on_smaller_side', 'TD_associated_PAV'];

let _status = null;
export const loadArrayStatus = () => (_status ||= load());
