// Route: #/pair/<id> -- the allele PAIR as the primitive, not two independent gene pages.
//
// WHY THIS EXISTS. This is one of very few resources that carries both phased haplotypes of a
// hybrid clone, with per-haplotype expression, duplication calls and allele links. Until now
// that showed up as a cross-reference: a line on the annotation card saying "the other allele
// is X", which a reader follows, losing the first gene from the screen. Every question that is
// actually about the hybrid -- does one allele carry a duplication the other lost, do the two
// disagree about age, is one silent -- required holding two pages in your head.
//
// So: one page, two columns, and a row per property. The comparison IS the page.
//
// ONE RULE THROUGHOUT: a row where the two sides differ is marked, and a row where a side has
// no data says so rather than rendering an empty cell. "HAP2 has no Pfam" is a release gap
// (27,004 genes, see the annotation module), not a biological absence, and a blank cell in a
// two-column layout reads as "nothing there" instead of "not measured".
import { el, fmt } from '../core/dom.js';
import { getGene, hapLabel, loadExprVector, loadExprSamples, loadExprStudies } from '../core/data.js';
import { paperTau, paperTop, ageBinName } from '../core/paper.js';
import { linkHub, brush, baselineSel, designGrid } from '../core/designmap.js';
import { svgEl, genesIn, tileRecord, matchingRegion, tissueList, tissueN } from '../core/locusfig.js';
import { chromosomeBrowser } from '../core/locusbrowser.js';

const pct = (x) => `${(x * 100).toFixed(0)}%`;
// Three significant figures: a dS from one gene pair does not carry four decimals of meaning.
const sig3 = (x) => (x === 0 ? '0' : x.toPrecision(3));
// Median dS of salicoid WGD anchor pairs in this genome (the Duplication card states the same
// value). An "allele" pair more diverged than that is more like a paralog than an allele.
const SALICOID_MEDIAN_DS = 0.27;

/** Both records for a pair, given either member. Returns null if the gene has no allele. */
export async function resolvePair(id) {
  const g = await getGene(id);
  if (!g) return null;
  if (!g.allele) return { solo: g };
  const other = await getGene(g.allele.id);
  if (!other) return { solo: g };
  // Always present HAP1 on the left, whichever side the reader arrived from, so that two
  // readers who came in from opposite alleles are looking at the same picture.
  return g.hap === 'hap1' ? { a: g, b: other, ks: g.allele } : { a: other, b: g, ks: other.allele };
}

const DUP_CODE = { A: 'aWGT', S: 'sWGD', T: 'tandem', D: 'dispersed', C: 'none' };
const dupWords = (d) => (!d ? null : (d.t === 'C' ? 'none detected'
  : [...(d.t || '')].map((c) => DUP_CODE[c]).filter(Boolean).join(' + ')));

/** One comparison row. `get` returns a display value; `differs` decides the marker. */
function row(label, a, b, get, opts = {}) {
  const va = get(a);
  const vb = get(b);
  const missing = (v) => v === null || v === undefined || v === '';
  const differ = opts.differs ? opts.differs(a, b) : (String(va) !== String(vb));
  const cell = (v) => (missing(v)
    ? el('td', { class: 'muted', title: opts.absent || 'not measured for this haplotype' },
        opts.absentLabel || 'not measured')
    : el('td', {}, v));
  return el('tr', { class: differ ? 'pr-differ' : null, 'data-pair-row': label },
    el('th', { style: 'text-align:left;font-weight:500' }, label),
    cell(va), cell(vb),
    el('td', { style: 'width:1%;white-space:nowrap' }, differ && !missing(va) && !missing(vb)
      ? el('span', { class: 'badge', title: 'the two alleles differ here' }, 'differs')
      : ''));
}

function comparisonTable(a, b) {
  const t = (g) => paperTop(g);
  const rows = [
    // Never marked: two alleles have different ids and coordinates BY CONSTRUCTION, and
    // flagging that dilutes the rows where a difference actually means something.
    row('Gene', a, b, (g) => el('a', { href: `#/gene/${g.id}`, class: 'mono' }, g.id),
      { differs: () => false }),
    row('Position', a, b, (g) => `${g.chr}:${fmt(g.start)}–${fmt(g.end)}`,
      { differs: () => false }),
    // A span difference is worth marking only when it is real: 4.46 kb against 4.49 is not
    // a finding, a gene half the length of its allele is.
    row('Span', a, b, (g) => `${((g.end - g.start) / 1000).toFixed(2)} kb`,
      { differs: (x, y) => Math.abs((x.end - x.start) - (y.end - y.start)) > 0.1 * (x.end - x.start) }),
    row('Description', a, b, (g) => ((g.ann || {}).d || null), { absentLabel: 'no description' }),
    row('Exons', a, b, (g) => (g.gs ? g.gs.ex : null)),
    row('Protein length (aa)', a, b, (g) => (g.prot && g.prot.ss && g.prot.ss.n ? g.prot.ss.n : null),
      { absentLabel: 'no protein model' }),
    row('Predicted structure pLDDT', a, b, (g) => (g.prot && g.prot.ss && g.prot.ss.plddt != null ? g.prot.ss.plddt.toFixed(1) : null),
      { absentLabel: 'no protein model', differs: (x, y) => false }),
    row('Disordered fraction', a, b, (g) => (g.prot && g.prot.dis != null ? pct(g.prot.dis) : null),
      { absentLabel: 'no protein model', differs: (x, y) => false }),
    row('Synteny class', a, b, (g) => (g.syn ? (g.syn.cls || '').replace(/_/g, ' ') : null)),
    row('Phylostratum', a, b, (g) => (g.ps && g.ps.rank != null ? `PS${g.ps.rank} · ${g.ps.name}` : null)),
    row('Duplication', a, b, (g) => dupWords(g.dup)),
    row('Tandem array', a, b, (g) => (g.td ? el('a', { href: `#/array/${g.td.aid}`, class: 'mono' }, `${g.td.aid} · ${g.td.n} members`) : 'not in one'),
      { absentLabel: 'not in one',
        // array ids differ by construction (one per haplotype); membership and size do not
        differs: (x, y) => !!x.td !== !!y.td || (!!x.td && x.td.n !== y.td.n) }),
    row('Peak tissue', a, b, t),
    row('τ (tissue specificity)', a, b, (g) => (paperTau(g) != null ? paperTau(g).toFixed(2) : null)),
    row('Max TPM (652 samples)', a, b, (g) => (g.x && g.x.max != null ? g.x.max.toFixed(1) : null)),
    row('Arabidopsis hit', a, b, (g) => ((g.ann || {}).at || null), { absentLabel: 'none' }),
    row('Pfam domains', a, b, (g) => (((g.ann || {}).pf || []).join(', ') || null),
      { absentLabel: 'none recorded' }),
    row('ω vs P. trichocarpa', a, b, (g) => (g.ks && g.ks.w != null ? g.ks.w.toFixed(3) : null),
      { absentLabel: 'no reciprocal-best ortholog found' }),
  ];
  return el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, ''), el('th', {}, hapLabel('hap1')), el('th', {}, hapLabel('hap2')), el('th', {}, ''))),
    el('tbody', {}, ...rows)));
}

/** Per-tissue medians for both alleles on ONE shared linear TPM axis: paired horizontal bars,
 *  HAP1 above HAP2 in each tissue, sample n per tissue beside the label. SVG, classes only. */
function tissueCompare(a, b) {
  const tissues = tissueList([a, b]);
  if (!tissues.length) return null;
  const ta = (a.x || {}).t || {};
  const tb = (b.x || {}).t || {};
  const { n, disagree } = tissueN([a, b], tissues);
  const max = Math.max(0.01, ...tissues.flatMap((k) => [ta[k] || 0, tb[k] || 0]));
  const W = 640;
  const L = 150;
  const R = 70;
  const rowH = 30;
  const H = 18 + tissues.length * rowH + 30;
  const X = (v) => L + (v / max) * (W - L - R);
  // role=group, not img: each tissue row becomes a focusable brushing source for the design
  // map below, and children of an img are hidden from assistive technology.
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pr-expr', role: 'group',
    'aria-label': `Median TPM per tissue for both alleles, ${tissues.length} tissues`, 'data-pair-expr': '' });
  tissues.forEach((t, i) => {
    const y = 14 + i * rowH;
    const g = svgEl('g', { class: 'pr-trow', 'data-tissue': t,
      'aria-label': `${t}: ${hapLabel('hap1')} ${ta[t] ?? 'no value'}, ${hapLabel('hap2')} ${tb[t] ?? 'no value'} TPM` });
    g.append(svgEl('rect', { x: 0, y: y - 2, width: W, height: rowH - 2, class: 'pr-hit' }));
    svg.append(g);
    g.append(svgEl('text', { x: L - 8, y: y + 11, class: 'pr-tl', 'text-anchor': 'end' }, t.replace(/_/g, ' ')));
    g.append(svgEl('text', { x: L - 8, y: y + 23, class: 'pr-tn', 'text-anchor': 'end' }, n[t] == null ? 'n –' : `n ${n[t]}`));
    [[ta[t], 'hap1', 0], [tb[t], 'hap2', 13]].forEach(([v, h, dy]) => {
      if (v == null) {
        g.append(svgEl('text', { x: L + 4, y: y + dy + 10, class: 'pr-tn' }, 'no value'));
        return;
      }
      g.append(svgEl('rect', { x: L, y: y + dy + 1, width: Math.max(v > 0 ? 1.5 : 0, X(v) - L), height: 10, class: `pr-bar ${h}` },
        svgEl('title', {}, `${h === 'hap1' ? a.id : b.id} ${t}: ${v} TPM`)));
      g.append(svgEl('text', { x: X(v) + 4, y: y + dy + 10, class: 'pr-tv' }, v.toFixed(1)));
    });
  });
  const yA = 14 + tissues.length * rowH + 4;
  svg.append(svgEl('line', { x1: L, x2: W - R, y1: yA, y2: yA, class: 'lf-axis' }));
  [0, 0.5, 1].forEach((f) => svg.append(svgEl('text', { x: X(max * f), y: yA + 14, class: 'pr-tn', 'text-anchor': 'middle' },
    (max * f).toFixed(max * f >= 10 ? 0 : 1))));
  svg.append(svgEl('text', { x: W - R, y: yA + 26, class: 'pr-tn', 'text-anchor': 'end' }, 'median TPM (linear, shared axis)'));
  return el('div', {},
    el('div', { class: 'arr-legend' }, el('span', { class: 'arr-key hap1' }, ''), ` ${hapLabel('hap1')} ${a.id}   `,
      el('span', { class: 'arr-key hap2' }, ''), ` ${hapLabel('hap2')} ${b.id}`),
    el('div', { class: 'scroll-x' }, svg),
    el('p', { class: 'arr-note' }, `${tissues.length} tissues; n beside each tissue is the number of samples its median is taken over`
      + (disagree ? ' (the two records disagree on n; the first is shown)' : '')
      + '. Both alleles are drawn on the same axis, never normalised to each other.'));
}

/** Both gene models on one axis, each drawn 5' to 3' from its own start, so exon structure
 *  lines up for comparison regardless of strand. Exon features come from the locus tiles. */
async function modelsFigure(a, b, holder) {
  try {
    const [ra, rb] = await Promise.all([tileRecord(a), tileRecord(b)]);
    const len = (g) => g.end - g.start;
    const span = Math.max(len(a), len(b));
    const W = 760;
    const L = 150;
    const R = 20;
    const X = (v) => L + (v / span) * (W - L - R);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} 110`, class: 'lf-svg', role: 'img', 'data-pair-models': '' });
    const missing = [];
    [[a, ra, 'hap1', 18], [b, rb, 'hap2', 58]].forEach(([g, r, h, y]) => {
      svg.append(svgEl('text', { x: 4, y: y + 10, class: `lf-lab ${h}` }, hapLabel(h).split(' ')[0]));
      svg.append(svgEl('text', { x: 4, y: y + 24, class: 'lf-sub' }, `${g.strand} strand · ${(len(g) / 1000).toFixed(2)} kb`));
      const gg = svgEl('g', { class: 'lf-gene on' });
      gg.append(svgEl('line', { x1: X(0), x2: X(len(g)), y1: y + 8, y2: y + 8, class: 'lf-intron' }));
      let feats = r && r.f && r.f.length ? r.f : null;
      if (!feats) { missing.push(g.id); feats = [[0, len(g), 1]]; }
      for (const [off, l, cds] of feats) {
        // reverse-strand genes are flipped so both read 5' -> 3' left to right
        const s = g.strand === '-' ? len(g) - off - l : off;
        svg.append(gg);
        gg.append(svgEl('rect', { x: X(s), y: cds ? y + 2 : y + 5, width: Math.max(1, X(s + l) - X(s)), height: cds ? 12 : 6,
          class: cds ? 'lf-cds' : 'lf-utr' }));
      }
    });
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: 96, y2: 96, class: 'lf-axis' }));
    svg.append(svgEl('text', { x: L, y: 108, class: 'lf-tick' }, "5′  0 kb"));
    svg.append(svgEl('text', { x: W - R, y: 108, class: 'lf-tick', 'text-anchor': 'end' }, `${(span / 1000).toFixed(2)} kb  3′`));
    holder.replaceChildren(el('div', { class: 'scroll-x' }, svg),
      el('p', { class: 'arr-note' }, 'Both models share one axis in base pairs, each starting at its own 5′ end. Tall blocks are '
        + 'coding exons, short blocks untranslated exon parts, lines introns. '
        + `Exon counts: ${a.gs ? a.gs.ex : '–'} and ${b.gs ? b.gs.ex : '–'}.`
        + (missing.length ? ` No exon structure is available for ${missing.join(' and ')}; drawn as one block.` : '')));
  } catch (e) {
    holder.replaceChildren(el('p', { class: 'muted' }, `Gene models unavailable: ${e.message}`));
  }
}

/** The shared two-haplotype browser around a gene. With an allele, that allele is the linked
 *  gene; without one, the nearest neighbors' alleles line the two haplotypes up (dashed). */
async function locusOnBoth(g, partner, holder) {
  try {
    const pad = Math.max(60000, (g.end - g.start) * 3);
    let anchors = new Set();
    let otherChr = partner ? partner.chr : g.chr;
    let note;
    if (!partner) {
      const wide = await genesIn(g.hap, g.chr, g.start - 3e5, g.end + 3e5);
      const region = await matchingRegion(g.hap, wide, [g.id], 6, 2);
      if (region) {
        anchors = new Set(region.anchors.map(([x]) => x));
        otherChr = region.chr;
        note = `${g.id} has no allele, so the lower haplotype is lined up by the alleles of ${anchors.size} `
          + 'neighboring genes (dashed). Where the gap between them holds no gene, the other parent has '
          + 'nothing annotated in that position.';
      } else {
        note = 'No neighbor within 6 genes has an allele, so the lower haplotype cannot be lined up here.';
      }
    }
    const browser = await chromosomeBrowser({
      hap: g.hap, chr: g.chr, otherChr, start: Math.max(0, g.start - pad), end: g.end + pad, embed: true,
      focus: new Set([g.id]), linked: new Set(partner ? [partner.id] : []), anchors,
      focusLabel: partner ? 'this allele pair' : 'this gene' });
    holder.replaceChildren(...(note ? [el('p', { class: 'arr-note', style: 'margin:0 0 8px' }, note)] : []), browser);
  } catch (e) {
    holder.replaceChildren(el('p', { class: 'muted' }, `Locus unavailable: ${e.message}`));
  }
}
/** Correlation of the two alleles across all 652 samples, computed here from the two vectors.
 *  Stated as what it is: a descriptive number on raw TPM, not an allele-specific expression
 *  result -- ASE needs read-level phasing-aware quantification, which this atlas does not
 *  have (TODO 19, closed deliberately). Saying so here is the point; the number invites
 *  exactly that misreading. */
async function alleleCorrelation(a, b, holder) {
  try {
    const [va, vb] = await Promise.all([loadExprVector(a), loadExprVector(b)]);
    if (!va || !vb || va.length !== vb.length) {
      holder.textContent = 'One allele has no expression profile, so no correlation is shown.';
      return;
    }
    const lg = (v) => v.map((x) => Math.log2(x + 1));
    const xa = lg(va);
    const xb = lg(vb);
    const m = (v) => v.reduce((s, x) => s + x, 0) / v.length;
    const ma = m(xa);
    const mb = m(xb);
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < xa.length; i += 1) {
      const p = xa[i] - ma;
      const q = xb[i] - mb;
      num += p * q; da += p * p; db += q * q;
    }
    const r = (da > 0 && db > 0) ? num / Math.sqrt(da * db) : null;
    const bothOff = xa.reduce((n, _, i) => n + (va[i] < 1 && vb[i] < 1 ? 1 : 0), 0);
    holder.replaceChildren(
      el('span', {}, 'Pearson ', el('strong', {}, r == null ? 'not computable' : r.toFixed(3)),
        ' on log2(TPM + 1) across all 652 samples, computed in your browser from the two '
        + 'profiles this page just fetched. '),
      el('span', { class: 'muted' },
        `${pct(bothOff / xa.length)} of samples have both alleles under 1 TPM, where a `
        + 'correlation is driven by noise. This is raw TPM on a combined-transcriptome '
        + 'quantification, NOT allele-specific expression: reads that map equally well to '
        + 'both alleles are not resolved here, so a high correlation partly reflects that. '
        + 'Read-level ASE is not in this atlas.'));
  } catch (e) {
    holder.textContent = `Correlation unavailable: ${e.message}`;
  }
}

export async function pairView(id) {
  const res = await resolvePair(id);
  if (!res) {
    return el('div', { class: 'empty' }, el('h2', {}, 'No such gene'),
      el('p', { class: 'mono' }, id));
  }
  if (res.solo) {
    const g = res.solo;
    const nb = el('div', { 'data-pair-neighborhood': '' }, el('p', { class: 'muted' }, 'Drawing the neighborhood on both haplotypes…'));
    locusOnBoth(g, null, nb);
    return el('div', { 'data-pair-solo': g.id },
      el('div', { class: 'kicker' }, `Allele pair · ${hapLabel(g.hap)}`),
      el('h1', {}, 'No allele pair'),
      el('p', { class: 'sub' }, el('span', { class: 'mono' }, g.id),
        ' has no syntelog partner on the other haplotype.'),
      el('div', { class: 'card' },
        el('p', { style: 'margin:0;font-size:13.5px' },
          'A missing partner is not by itself a presence/absence call. It can be a genuine '
          + 'difference between the two parent genomes, a tandem array counted as one unit, or a region '
          + 'where synteny breaks down; the gene page\u2019s relationship category says which.'),
        el('p', { style: 'margin:10px 0 0' },
          el('a', { href: `#/gene/${g.id}` }, 'Open the gene page →'), '  ',
          el('a', { href: '#/browse?allele=no', style: 'margin-left:14px' },
            'Browse all genes with no allele →'))),
      el('div', { class: 'card' },
        el('h2', {}, 'Where it sits, on both haplotypes'),
        nb),
      g.td ? el('div', { class: 'card' }, el('p', { style: 'margin:0' }, 'This gene is a member of tandem array ',
        el('a', { href: `#/array/${g.td.aid}`, class: 'mono' }, g.td.aid), ` (${g.td.n} members).`)) : null);
  }

  const { a, b, ks } = res;
  const corr = el('p', { class: 'muted', style: 'font-size:12.5px;margin:0' },
    'Computing the correlation across 652 samples…');
  alleleCorrelation(a, b, corr);

  const tc = tissueCompare(a, b);
  // The same sample design map as the gene page, with both alleles' values in its readout.
  const dmapHolder = el('div', { 'data-dmap-holder': '' });
  if (tc) {
    Promise.all([loadExprSamples(), loadExprStudies(), loadExprVector(a), loadExprVector(b)])
      .then(([samples, studies, va, vb]) => {
        if (!samples) return;
        const hub = linkHub();
        const svg = tc.querySelector('svg[data-pair-expr]');
        svg.querySelectorAll('g.pr-trow').forEach((g) => {
          const sel = baselineSel(samples, g.dataset.tissue);
          g.dataset.ids = [...sel.ids].join(',');
          g.setAttribute('tabindex', '0');
          brush(g, hub, sel);
        });
        hub.on((sel) => {
          svg.toggleAttribute('data-sel', !!sel);
          svg.querySelectorAll('g.pr-trow').forEach((g) => {
            const ids = g.dataset.ids ? g.dataset.ids.split(',').map(Number) : [];
            const hot = sel ? ids.filter((i) => sel.ids.has(i)).length : 0;
            g.dataset.hot = !sel ? '' : hot && hot === ids.length ? 'all' : hot ? 'part' : '';
          });
        });
        dmapHolder.append(designGrid(samples, studies, hub,
          [{ name: `${hapLabel('hap1')} ${a.id}`, vec: va }, { name: `${hapLabel('hap2')} ${b.id}`, vec: vb }], a.id));
      }).catch(() => {});
  }
  const models = el('div', {}, el('p', { class: 'muted' }, 'Drawing both gene models…'));
  modelsFigure(a, b, models);
  const locus = el('div', { 'data-pair-locus': '' }, el('p', { class: 'muted' }, 'Drawing the locus…'));
  locusOnBoth(a, b, locus);
  return el('div', { 'data-pair': `${a.id}|${b.id}` },
    el('div', { class: 'kicker' }, 'Allele pair · HAP1 and HAP2'),
    el('h1', {}, 'Allele pair'),
    el('p', { class: 'sub' },
      el('span', { class: 'mono' }, a.id), ' · ', el('span', { class: 'mono' }, b.id),
      ', a 1:1 syntenic pair between the two phased haplotypes of clone INRA 717-1B4.'),
    ks && ks.ks != null && ks.ks > SALICOID_MEDIAN_DS
      ? el('div', { class: 'warn', 'data-pair-diverged': '' },
          el('strong', {}, 'Possible paralog mis-pairing. '),
          `dS between these two (${sig3(ks.ks)}) is above the median dS of sWGD paralog `
          + `pairs in this genome (${SALICOID_MEDIAN_DS}). True alleles of one clone are usually far `
          + 'less diverged, so this pair may join two paralogs rather than two alleles.')
      : null,

    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' }, el('div', { class: 'n' }, ks && ks.ks != null ? sig3(ks.ks) : '–'),
        el('div', { class: 'l' }, 'dS between alleles')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, ks && ks.ka != null ? sig3(ks.ka) : '–'),
        el('div', { class: 'l' }, 'dN')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, ks && ks.w != null ? sig3(ks.w) : '–'),
        el('div', { class: 'l' }, 'ω')),
    ),
    el('p', { class: 'arr-note' }, 'dS, dN and ω are for this allele pair (HAP1 vs. HAP2). '
      + (ks && ks.w == null ? 'ω is not given where dS is zero or not estimable, since the ratio is undefined. ' : '')
      + 'The per-gene ω against P. trichocarpa is a different comparison and sits in the table below.'),

    el('div', { class: 'card' },
      el('h2', {}, 'Gene models', el('span', { class: 'tag' }, 'shared axis, 5′ to 3′')),
      models),

    el('div', { class: 'card' },
      el('h2', {}, 'The locus on both haplotypes', el('span', { class: 'tag' }, 'drag to zoom')),
      locus),

    el('div', { class: 'card' },
      el('h2', {}, 'Side by side', el('span', { class: 'tag' }, 'rows that differ are marked')),
      comparisonTable(a, b),
      el('p', { class: 'arr-note' },
        'A shaded row means the two alleles differ. "not measured" is not "absent": HAP2 '
        + 'domain annotation is thinner than HAP1 for release reasons, so an empty Pfam cell '
        + 'on the right is a gap in the annotation, not a protein without domains.')),

    tc ? el('div', { class: 'card' },
      el('h2', {}, 'Expression, allele against allele', el('span', { class: 'tag' }, 'median TPM, WT controls')),
      tc,
      dmapHolder,
      el('div', { style: 'margin-top:10px' }, corr)) : null,

    el('div', { class: 'card' },
      el('h2', {}, 'Open either side'),
      el('p', { style: 'margin:0' },
        el('a', { href: `#/gene/${a.id}` }, `${a.id} →`), '  ',
        el('a', { href: `#/gene/${b.id}`, style: 'margin-left:16px' }, `${b.id} →`))));
}

export default { id: 'pair', label: 'Allele pair' };
