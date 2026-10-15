// How each RNA-seq study's design is laid out on its study page. Presentation only: which
// metadata factor runs across (cols), which down (rows), which splits the drawing into
// side-by-side panels, the order of ordered levels (times, dates, leaf positions) and the
// reader's name for a level. Every factor that varies in a study but is not named here is
// added to the columns, so no group can be merged away by an incomplete entry; studydesign.js
// checks that and that an `implied` factor really is fixed by the others.
//
// Factor keys are the sample metadata fields: tissue_analysis, treatment, growth, additional,
// genotype. Level names are written from the metadata values themselves, not from the papers.
//
// `siteFromLabel`: the tissue fields say only "xylem" for studies 2 and 3, because ArrayExpress
// files every sample under organism part "xylem" and keeps developing versus mature xylem in a
// separate "sampling site" factor (E-MTAB-7288, E-MTAB-7587, checked 2026-10-15: 8 groups of 4
// and 6 groups of 4). The sample label is the one field that kept the site, so the design reads
// the tissue from it there; without this each drawn group was two sites pooled (n=8, n=8).
const T = 'tissue_analysis', TR = 'treatment', G = 'growth', A = 'additional', GE = 'genotype';

const LPI = (v) => v.replace(/^LPI\s*/, 'leaf position ');
// `time` lays the column factor out on a time axis instead of a grid, for the studies whose
// metadata states the time of each sample. `at` maps a level to hours; `dates: true` parses the
// level itself as a calendar date range; `bands` names a factor whose levels shade spans of the
// axis (study 17's seasons). No treatment window is drawn: the metadata does not say how long
// a treatment lasted.

export const DESIGNS = {
  1: { rows: T, cols: [G, TR], panels: [A],
    order: { [TR]: ['control', 'periodic drought', 'chronic drought'], [A]: ['None', 'recovered'] },
    names: { [G]: { '380CO2': '380 ppm CO2', '500CO2': '500 ppm CO2' },
      [A]: { None: 'no recovery phase', recovered: 'after recovery' } } },
  2: { rows: G, cols: [TR], panels: [T], siteFromLabel: true,
    order: { [T]: ['developing xylem', 'mature xylem'], [G]: ['long day', 'short day'] } },
  3: { rows: T, cols: [TR], siteFromLabel: true,
    order: { [T]: ['developing xylem', 'mature xylem'], [TR]: ['control', 'continuous abscisic acid', 'discontinuous abscisic acid'] } },
  4: { rows: T, cols: [TR] },
  8: { rows: T, cols: [TR] },
  10: { rows: TR, cols: [A],
    order: { [A]: ['Normal_Wood_side_A', 'Normal_Wood_side_B', 'Tension_Wood', 'Opposite_Wood'] },
    names: { [A]: { Normal_Wood_side_A: 'normal wood, side A', Normal_Wood_side_B: 'normal wood, side B',
      Tension_Wood: 'tension wood', Opposite_Wood: 'opposite wood' } } },
  12: { rows: TR, cols: [A], time: { scale: 'log', axis: 'hours (sample time point)',
      at: { '0hr': 0, '2hr': 2, '8hr': 8, '24hr': 24, '48hr': 48, '96hr': 96, '336hr': 336 } },
    order: { [TR]: ['control', 'Tension wood', 'Opposite wood'],
      [A]: ['0hr', '2hr', '8hr', '24hr', '48hr', '96hr', '336hr'] },
    names: { [A]: { '0hr': '0 h', '2hr': '2 h', '8hr': '8 h', '24hr': '24 h', '48hr': '48 h', '96hr': '96 h', '336hr': '336 h' } } },
  16: { cols: [TR], time: { scale: 'log', axis: 'hours after LCO treatment (control: untreated)',
      at: { control: 0, LCO_15min: 0.25, LCO_30min: 0.5, LCO_1hr: 1, LCO_2hr: 2, LCO_4hr: 4, LCO_8hr: 8, LCO_24hr: 24 } },
    order: { [TR]: ['control', 'LCO_15min', 'LCO_30min', 'LCO_1hr', 'LCO_2hr', 'LCO_4hr', 'LCO_8hr', 'LCO_24hr'] },
    names: { [TR]: { LCO_15min: 'LCO 15 min', LCO_30min: 'LCO 30 min', LCO_1hr: 'LCO 1 h', LCO_2hr: 'LCO 2 h',
      LCO_4hr: 'LCO 4 h', LCO_8hr: 'LCO 8 h', LCO_24hr: 'LCO 24 h' } } },
  17: { rows: T, cols: [A], implied: [G], time: { dates: true, axis: 'sampling dates', bands: G },
    order: { [A]: ['Nov 7-15, 2014', 'Nov 21-29, 2014', 'Dec 5-12, 2014', 'Dec 19, 2014 - Jan 3, 2015',
      'Jan 9-17, 2015', 'Jan 13-20, 2015', 'Jan 27-Feb 10, 2015', 'Jan 30- Feb 12, 2015', 'Feb 17-24, 2015',
      'Feb 19-26, 2015', 'Mar 3-10, 2015', 'Mar 5-12, 2015', 'Mar 17-31, 2015', 'Mar 21-26, 2015',
      'Apr 1-9, 2015', 'Apr 7-14, 2015'] },
    names: { [A]: { 'Dec 19, 2014 - Jan 3, 2015': 'Dec 19, 2014 to Jan 3, 2015', 'Jan 30- Feb 12, 2015': 'Jan 30-Feb 12, 2015' } } },
  18: { rows: G, cols: [A], order: { [G]: ['young', 'old'] } },
  19: { rows: G, cols: [GE], order: { [G]: ['LPI5', 'LPI15', 'LPI25'], [GE]: ['WT', 'SUT1_8', 'SUT1_12'] },
    names: { [G]: { LPI5: LPI('LPI5'), LPI15: LPI('LPI15'), LPI25: LPI('LPI25') } } },
  20: { rows: T, cols: [GE] },
  22: { cols: [GE], order: { [GE]: ['POPLAR_GFP', 'P1_LINE1_Mlp729', 'P1_LINE3_729', 'P1_LINE4_521', 'P1_LINE8_521'] } },
  23: { rows: T, cols: [GE], order: { [GE]: ['WT', 'Cas9-16', 'Cas9-18', 'Cas9-39', '4cl1-13', '4cl1-21',
    '4cl1-39', '4cl1-50', '4cl1-58', '4cl1-61'] } },
  24: { cols: [GE], implied: [TR], order: { [GE]: ['WT', 'Cas9', 'SUT4'] } },
  26: { cols: [GE], order: { [GE]: ['WT-717-FT', 'AP2-1-OE', 'AP2-2-OE', 'ap2-1', 'ap2-2', 'ap2-1_ap2-2'] } },
  // Leaf samples are all leaf position 15 and no other tissue has a position, so position is a
  // property of the leaf row, not a condition.
  27: { rows: T, cols: [TR, A], implied: [G], panels: [GE], order: { [GE]: ['WT', 'SUT4-RNAi'], [A]: ['None', 'recovered'] },
    names: { [A]: { None: 'no recovery phase', recovered: 'after recovery' }, [T]: { leaf: 'leaf (position 15)' } } },
  28: { rows: GE, cols: [TR], order: { [GE]: ['WT', 'TUA1dY', 'TUA1dEY'] } },
  29: { cols: [GE], order: { [GE]: ['WT', 'vector control', 'trichomeless-KO'] } },
  30: { cols: [G], order: { [G]: ['LPI1', 'LPI5', 'LPI15'] },
    names: { [G]: { LPI1: LPI('LPI1'), LPI5: LPI('LPI5'), LPI15: LPI('LPI15') } } },
  31: { rows: T, cols: [A], order: { [T]: ['leaf', 'stem', 'bud', 'xylem', 'bark', 'root', 'callus'],
    [A]: ['LPI1-2', 'LPI5-6', 'LPI15-16', 'internodes 3-6', 'internodes 12-15', 'None'] },
    names: { [A]: { 'LPI1-2': 'leaf positions 1-2', 'LPI5-6': 'leaf positions 5-6', 'LPI15-16': 'leaf positions 15-16',
      None: 'no position given' } } },
};

export const FACTOR_LABEL = { [T]: 'tissue', [TR]: 'treatment', [G]: 'growth', [A]: 'condition', [GE]: 'genotype' };
export const FACTORS = [T, TR, G, A, GE];

/** A sample's tissue as its study page should show it: the sampling site from the label where the
 *  tissue fields lost it (see `siteFromLabel`), otherwise the analysis tissue. */
export function sampleTissue(s) {
  if ((DESIGNS[s.study] || {}).siteFromLabel) {
    const site = String(s.label || '').split('_')[1];
    if (site) return site;
  }
  return s.tissue_analysis || s.tissue_full || s.tissue;
}
