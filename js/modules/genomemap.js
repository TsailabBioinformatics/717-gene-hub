// The genome map: semantic zoom from 19 chromosomes down to single genes, then a click
// hands off to the locus card (#/gene/<id>). See docs/PLAN_locus_map_and_experimental_ux.md
// section 2.4.
//
// Tier 1 (overview): one row per chromosome, 100 kb bins coloured by a chosen metric, with a
// Mb axis, a legend that states its range and n, and a hover readout.
// Tier 2 (chromosome): a two-haplotype track browser. The route's haplotype is drawn on top,
// the other haplotype below it, mirrored so the two gene rows face each other and the allele
// links between them stay short. Every track is computed in the browser from files already
// shipped: data/locus/index/<hap>/<chr>.json (position, strand, duplication class, tau, peak
// tissue, LSG pool) and data/locus/tile/<hap>/<chr>/<Mb>.json (synteny class, allele id,
// exon structure). Nothing here derives a new number; counts in the legends are counts of
// genes in the current window.
//
// Canvas discipline as locus.js: absolutely-positioned canvas in a sized container,
// DPR-aware fitting. Colours are read from the CSS tokens at every draw (not cached), so a
// theme flip -- system or data-theme -- repaints correctly.
import { el } from '../core/dom.js';
import { loadLocusOverview } from '../core/data.js';
import { tokens, makeStage, tickStep, fmtBp, fmtMb, HAP_LABEL, chromosomeBrowser } from '../core/locusbrowser.js';

const CHROMS = Array.from({ length: 19 }, (_, i) => `Chr${String(i + 1).padStart(2, '0')}`);
const OVERVIEW_H = 470;
const PAD_X = 10;
const ROW_GAP = 4;
const LABEL_W = 46;
const AXIS_H = 30;

// ---------------------------------------------------------------------------------------
// Overview metrics. Bins are [n, tandem, lsg, tau, omega, ms_frac, acr_frac] -- see
// scripts/patch_map_overlays.py.
const METRICS = {
  genes: { label: 'Gene density', get: (b) => b[0], fmt: (v) => `${Math.round(v)} genes` },
  tandem: { label: 'Tandem fraction', get: (b) => (b[0] ? b[1] / b[0] : null), fmt: pctF },
  lsg: { label: 'LSG-pool fraction', get: (b) => (b[0] ? b[2] / b[0] : null), fmt: pctF },
  tau: { label: 'Mean τ', get: (b) => b[3], fmt: (v) => v.toFixed(2) },
  omega: { label: 'Mean ω vs P. trichocarpa', get: (b) => b[4], fmt: (v) => v.toFixed(2) },
  ms: { label: 'Peptide-match fraction', get: (b) => b[5], fmt: pctF },
  acr: { label: 'P. trichocarpa ortholog open chromatin', get: (b) => b[6], fmt: pctF },
};
function pctF(v) { return `${(v * 100).toFixed(1)}%`; }

// Each overlay's denominator differs, and a colour ramp hides that, so the map says it.
const METRIC_NOTE = {
  genes: 'Genes per 100 kb bin.',
  tandem: 'Share of genes in the bin that belong to a tandem array.',
  lsg: 'Share in the lineage-specific pool (PS ≥ 18 in the genEra rerun that added Idesia).',
  tau: 'Mean τ of the genes in the bin that have one: τ over mean TPM in 9 tissue groups of the '
    + '222-sample reference panel, computed where a group mean reaches 5 TPM. Read it as '
    + 'expression breadth, not tissue identity.',
  omega: 'Mean Ka/Ks over the genes in the bin that HAVE a reciprocal-best P. trichocarpa '
    + 'ortholog, 81.7% of genes, and the ones without are the youngest, so a bin’s '
    + 'value describes its pairable genes.',
  ms: 'Share of genes with a matching peptide in any of five public Populus mass-spec datasets, '
    + 'none from the 717 clone. Indirect: most such peptides are shared with P. trichocarpa and '
    + 'with other 717 genes, so a match is not proof that 717 makes the protein.',
  acr: 'Share of leaf-expressed P. trichocarpa ORTHOLOGS with accessible chromatin. This is '
    + 'the ortholog’s chromatin, not this genome’s, and its denominator is only the '
    + 'genes with a 1:1 ortholog expressed in leaf, smaller than the bin. Open chromatin is '
    + 'consistent with an active promoter, not proof of one, and was not measured in 717.',
};

function metricRange(overview, hap, metricKey) {
  const get = METRICS[metricKey].get;
  let lo = Infinity, hi = -Infinity, n = 0, total = 0;
  for (const chr of CHROMS) {
    for (const b of overview.hap[hap][chr] || []) {
      total++;
      const v = get(b);
      if (v == null) continue;
      n++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo <= hi ? { lo, hi, n, total } : { lo: 0, hi: 1, n, total };
}


// ---------------------------------------------------------------------------------------
// Overview tier
function drawOverview(ctx, view, overview, hap, metricKey, hover) {
  const { w, h, dpr } = view;
  const T = tokens();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = T.panel;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cssW = w / dpr, cssH = h / dpr;

  const bin = overview.bin;
  const lengths = CHROMS.map((c) => (overview.hap[hap][c] || []).length * bin);
  const maxLen = Math.max(1, ...lengths);
  const trackW = cssW - PAD_X * 2 - LABEL_W;
  const rowH = Math.max(6, (cssH - PAD_X - AXIS_H) / CHROMS.length - ROW_GAP);
  const { lo, hi } = metricRange(overview, hap, metricKey);
  const get = METRICS[metricKey].get;
  const x0 = PAD_X + LABEL_W;
  const boxes = [];

  CHROMS.forEach((chr, i) => {
    const bins = overview.hap[hap][chr] || [];
    const rowW = (bins.length * bin / maxLen) * trackW;
    const y = PAD_X + i * (rowH + ROW_GAP);
    const focal = hover && hover.chr === chr;

    ctx.fillStyle = focal ? T.accentInk : T.ink2;
    ctx.font = `11px ${T.mono}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(chr, x0 - 6, y + rowH / 2);

    bins.forEach((b, bi) => {
      const v = get(b);
      const t = v == null || hi <= lo ? 0.5 : (v - lo) / (hi - lo);
      ctx.globalAlpha = v == null ? 0.06 : 0.12 + 0.8 * t;
      ctx.fillStyle = T.accent;
      const bx = x0 + (bi * bin / maxLen) * trackW;
      const bw = Math.max(1, (bin / maxLen) * trackW);
      ctx.fillRect(bx, y, bw, rowH);
    });
    ctx.globalAlpha = 1;

    ctx.strokeStyle = focal ? T.ink : T.line2;
    ctx.lineWidth = focal ? 1.6 : 1;
    ctx.strokeRect(x0 + 0.5, y + 0.5, Math.max(1, rowW - 1), rowH - 1);
    if (focal && hover.bin != null) {
      const bx = x0 + (hover.bin * bin / maxLen) * trackW;
      ctx.strokeStyle = T.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, y - 1.5, Math.max(2, (bin / maxLen) * trackW), rowH + 3);
    }
    const nChr = bins.reduce((a, b) => a + b[0], 0).toLocaleString('en-US');
    ctx.font = `10.5px ${T.mono}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = T.ink3;
    if (x0 + rowW + 6 + ctx.measureText(nChr).width < cssW - 2) ctx.fillText(nChr, x0 + rowW + 6, y + rowH / 2);
    boxes.push({ chr, x0, x1: x0 + rowW, y0: y - ROW_GAP / 2, y1: y + rowH + ROW_GAP / 2, bins });
  });

  // Mb axis
  const axisY = PAD_X + CHROMS.length * (rowH + ROW_GAP) + 2;
  const step = tickStep(maxLen, cssW < 500 ? 4 : 10);
  ctx.strokeStyle = T.ink;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, axisY + 0.5); ctx.lineTo(x0 + trackW, axisY + 0.5); ctx.stroke();
  ctx.fillStyle = T.ink2;
  ctx.font = `10.5px ${T.mono}`;
  ctx.textBaseline = 'top';
  for (let bp = 0; bp <= maxLen; bp += step) {
    const tx = Math.round(x0 + (bp / maxLen) * trackW) + 0.5;
    ctx.beginPath(); ctx.moveTo(tx, axisY); ctx.lineTo(tx, axisY + 5); ctx.stroke();
    ctx.textAlign = bp === 0 ? 'left' : 'center';
    ctx.fillText(bp === 0 ? '0 Mb' : fmtBp(bp, step), tx, axisY + 8);
  }
  return boxes;
}

async function renderOverview(hap, onPickChr) {
  const overview = await loadLocusOverview();
  const state = { metric: 'genes', hover: null };
  const s = makeStage(OVERVIEW_H);
  s.setDraw((ctx, view) => drawOverview(ctx, view, overview, hap, state.metric, state.hover));

  const nGenes = CHROMS.reduce((a, c) => a + (overview.hap[hap][c] || []).reduce((x, b) => x + b[0], 0), 0);

  const metricBtns = Object.entries(METRICS).map(([k, v]) => el('button', {
    class: 'btn map-metric', type: 'button', 'data-metric': k, 'aria-pressed': String(k === state.metric),
    onclick: () => { state.metric = k; sync(); s.redraw(); },
  }, v.label));
  const metricNote = el('p', { class: 'muted map-note' });
  const rampLo = el('span', { class: 'mono' });
  const rampHi = el('span', { class: 'mono' });
  const rampN = el('span', { class: 'muted' });
  const legend = el('div', { class: 'map-ramp', 'data-map-legend': 'overview' },
    rampLo, el('span', { class: 'map-ramp-bar', 'aria-hidden': 'true' }), rampHi, rampN);
  const readout = el('div', { class: 'locus-readout map-readout muted', 'data-map-readout': '' }, ' ');

  function sync() {
    metricBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric)));
    const m = METRICS[state.metric];
    const r = metricRange(overview, hap, state.metric);
    metricNote.textContent = METRIC_NOTE[state.metric] || '';
    rampLo.textContent = m.fmt(r.lo);
    rampHi.textContent = m.fmt(r.hi);
    rampN.textContent = `n = ${r.n.toLocaleString('en-US')} of ${r.total.toLocaleString('en-US')} `
      + `100 kb bins carry a value; pale = empty or no value.`;
  }
  sync();

  const hit = (ev) => {
    const { x, y } = s.pointIn(ev.clientX, ev.clientY);
    return s.boxes.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)
      ? { box: s.boxes.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1), x } : null;
  };
  s.canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const h = hit(ev);
    s.canvas.style.cursor = h ? 'pointer' : 'default';
    let next = null;
    if (h) {
      const { box } = h;
      const bi = Math.min(box.bins.length - 1,
        Math.max(0, Math.floor((h.x - box.x0) / (box.x1 - box.x0) * box.bins.length)));
      const b = box.bins[bi];
      const v = METRICS[state.metric].get(b);
      next = { chr: box.chr, bin: bi };
      readout.textContent = `${box.chr} · ${fmtMb(bi * overview.bin, 1)}–${fmtMb((bi + 1) * overview.bin, 1)} Mb`
        + ` · ${b[0]} genes · ${METRICS[state.metric].label}: ${v == null ? 'no value' : METRICS[state.metric].fmt(v)}`;
    } else readout.textContent = ' ';
    if (JSON.stringify(next) !== JSON.stringify(state.hover)) { state.hover = next; s.redraw(); }
  });
  s.canvas.addEventListener('click', (ev) => {
    const h = hit(ev);
    if (h) onPickChr(h.box.chr);
  });

  return el('div', { class: 'map-overview', 'data-map-view': 'overview' },
    el('div', { class: 'map-metrics', role: 'group', 'aria-label': 'Colour by' },
      el('label', { class: 'map-metrics-label' }, 'Colour by:'), ...metricBtns),
    metricNote,
    el('p', { class: 'map-count' },
      `${HAP_LABEL[hap]}: 19 chromosomes, ${nGenes.toLocaleString('en-US')} genes in ${overview.bin / 1000} kb bins.`),
    s.stage, readout,
    legend,
    el('p', { class: 'muted map-note' },
      'Each row is one chromosome, drawn to its own length, with its gene count at the end '
      + 'where it fits; darker = higher value. '
      + 'Click a chromosome to zoom in.'));
}

// ---------------------------------------------------------------------------------------
// Chromosome tier: two-haplotype track browser

/** Top-level entry, called from app.js's #/map route. `chr` is null for the whole-genome
 *  view. Returns a DOM node; the route handler owns the page chrome (title, hap toggle). */
export async function renderMap(hap, chr) {
  return chr
    ? chromosomeBrowser({ hap, chr, onBack: () => { location.hash = `#/map/${hap}`; } })
    : renderOverview(hap, (pickedChr) => { location.hash = `#/map/${hap}/${pickedChr}`; });
}
