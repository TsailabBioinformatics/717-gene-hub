// Module: expression scrubber. Plan section 2.3 -- paint the same locus window by
// expression instead of duplication class: a tissue strip (median TPM, already computed
// per gene) and a contrast strip (log2 fold-change, computed live from each gene's own
// raw 652-sample vector against the dissertation's 165 curated contrasts' own sample lists).
//
// No per-gene, per-contrast table exists or is built here -- checked directly, a table
// that looked like one (`log2FC_per_gene_per_contrast_v4.csv`) turned out to predate the
// current contrast panel and cover a different, smaller contrast set (see
// build_contrasts.py). Instead, `data/expr/contrasts.json` names each contrast's control
// and perturbation sample INDICES into the fixed sample order, and the fold-change is a
// few arithmetic operations on a vector the site already fetches for its "Show all 652
// samples" view -- the plan's own "pure client work" framing, taken literally.
//
// A separate card from Locus and Mirror on purpose (same reasoning as Mirror): lower risk
// to the already-shipped, tested Locus canvas than repainting it in place, and it lets a
// reader compare the duplication-class view against the expression view side by side
// rather than losing one to see the other.
import { el, clear } from '../core/dom.js';
import { getGene, loadLocusTile, loadExprVector, loadContrasts } from '../core/data.js';
import { palette } from '../core/palette.js';
import { onDispose } from '../core/lifecycle.js';

const MB = 1_000_000;
const MAX_DPR = 2;
const H = 180;
const PAD_X = 10;
const TISSUES = ['leaf_young', 'leaf', 'leaf_old', 'xylem', 'bark', 'root', 'stem', 'bud', 'catkin', 'callus'];
const KIND_LABEL = { treatment: 'Treatment', genotype: 'Genotype', additional_condition: 'Other condition', growth_condition: 'Growth condition' };
const isNarrow = () => window.matchMedia('(max-width: 640px)').matches;
const defaultFlank = () => (isNarrow() ? 4 : 8);
const short = (id) => id.split('.')[1] || id;

async function loadWindow(hap, chr, start, geneId, flank) {
  const mb = Math.floor(start / MB);
  const tiles = [await loadLocusTile(hap, chr, mb)];
  let genes = tiles[0];
  let i = genes.findIndex((r) => r.g === geneId);
  if (i < 0) return null;
  const need = [];
  if (i < flank && mb > 0) need.push(mb - 1);
  if (i > genes.length - 1 - flank) need.push(mb + 1);
  for (const m of need) {
    try { tiles.push(await loadLocusTile(hap, chr, m)); } catch { /* chromosome edge */ }
  }
  genes = tiles.flat().sort((a, b) => a.s - b.s);
  i = genes.findIndex((r) => r.g === geneId);
  const lo = Math.max(0, i - flank), hi = Math.min(genes.length - 1, i + flank);
  return genes.slice(lo, hi + 1);
}

/** Colour scale: a single hue's opacity for the tissue strip (magnitude only), or a
 *  two-hue diverging pair for the contrast strip (sign + magnitude) -- the same
 *  control/perturbation blue/orange pairing the Expression module's own condition table
 *  already uses, reused here for "shifted from baseline" rather than invented fresh. */
function paintByValue(ctx, x0, x1, y, value, lo, hi, diverging) {
  const P = palette();
  if (value == null) {
    ctx.strokeStyle = P.line; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  let color, alpha;
  if (diverging) {
    const mag = Math.min(1, Math.abs(value) / Math.max(hi, 0.01));
    color = value >= 0 ? P.D : P.S; // P.D (orange, "perturbation") up, P.S (blue, "core") down
    alpha = 0.2 + 0.7 * mag;
  } else {
    const t = hi > lo ? (value - lo) / (hi - lo) : 0.5;
    color = P.accent;
    alpha = 0.15 + 0.75 * t;
  }
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(x0, y - 7, Math.max(x1 - x0, 2), 14);
  ctx.globalAlpha = 1;
}

function draw(ctx, view, genes, values, mode, focalId) {
  const { w, h, dpr } = view;
  const P = palette();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.panel;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cssW = w / dpr, cssH = h / dpr;
  const midY = Math.round(cssH * 0.5) + 0.5;
  const lo = genes[0].s, hi = Math.max(genes[genes.length - 1].e, lo + 1);
  const x = (bp) => PAD_X + ((bp - lo) / (hi - lo)) * (cssW - PAD_X * 2);

  // TPM is heavily right-skewed -- a linear scale leaves most genes near-invisible and
  // only the single loudest one visible. log2(x+1) is the same transform the site's own
  // expression vectors are read in elsewhere, so a gene's shade is comparable window to
  // window, not just within one snapshot. log2FC (contrast mode) is already a log value,
  // so it is used as-is.
  const scaled = mode === 'contrast' ? values : values.map((v) => (v == null ? null : Math.log2(v + 1)));
  const nums = scaled.filter((v) => v != null);
  const vlo = nums.length ? Math.min(...nums) : 0;
  const vhi = nums.length ? Math.max(...nums) : 1;

  ctx.strokeStyle = P.line;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(cssW, midY); ctx.stroke();

  const boxes = [];
  genes.forEach((r, i) => {
    const x0 = x(r.s), x1 = Math.max(x(r.e), x0 + 2);
    paintByValue(ctx, x0, x1, midY, scaled[i], vlo, vhi, mode === 'contrast');
    if (r.g === focalId) {
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2;
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(midY - 8) + 0.5, Math.round(x1 - x0), 16);
    }
    ctx.fillStyle = P.ink3;
    ctx.font = '9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(short(r.g), Math.min(cssW - 20, Math.max(20, (x0 + x1) / 2)), midY + 24);
    boxes.push({ g: r.g, x0, x1, y: midY, v: values[i] });
  });
  return boxes;
}

function geneCard(g) {
  if (!g.x) return null;

  const card = el('div', { class: 'card' },
    el('h2', {}, 'Expression across the neighborhood',
      el('span', { class: 'tag' }, 'neighbors painted by expression')));
  const modeRow = el('div', { style: 'display:flex;gap:6px;margin-bottom:8px' });
  const tissueRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px' });
  const contrastRow = el('div', { style: 'display:none;margin-bottom:8px' });
  const stage = el('div', { class: 'locus-stage', style: `height:${H}px` });
  const canvas = el('canvas', { class: 'locus-canvas', role: 'img',
    'aria-label': 'Drawing of this locus; the line below it gives the values under the pointer' });
  stage.append(canvas);
  const readout = el('div', { class: 'locus-readout muted' }, ' ');
  const legend = el('div', { style: 'margin-top:6px;font-size:11.5px' });
  const caption = el('p', { class: 'muted', style: 'font-size:11.5px;margin:8px 0 0' },
    'Loading the neighborhood…');
  card.append(modeRow, tissueRow, contrastRow, stage, readout, legend, caption);

  /** The card had no legend at all: a reader saw shaded boxes with no idea what shade meant
   *  or what the ends of the scale were. The range is per window, so it has to be drawn from
   *  the values actually painted, not from a fixed scale. Same transform as draw(). */
  function drawLegend() {
    clear(legend);
    const vals = (state.values || []).filter((v) => v != null);
    if (!vals.length) return;
    const diverging = state.mode === 'contrast';
    const t = diverging ? vals : vals.map((v) => Math.log2(v + 1));
    const lo = Math.min(...t), hi = Math.max(...t);
    const swatch = (bg) => el('i', { style: `display:inline-block;width:17px;height:10px;`
      + `background:${bg};border:1px solid var(--line);vertical-align:-1px` });
    if (diverging) {
      const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
      legend.append(
        el('span', { class: 'muted' }, 'log2 fold change  '),
        swatch('var(--accent)'), el('span', { class: 'muted' }, ` down to −${m.toFixed(1)}  `),
        swatch('var(--panel-2)'), el('span', { class: 'muted' }, ' no change  '),
        swatch('var(--c-priv)'), el('span', { class: 'muted' }, ` up to +${m.toFixed(1)}`),
        el('div', { class: 'muted', style: 'margin-top:3px' },
          'A dashed line means the gene has no expression vector, which is not the same as '
          + 'no change.'));
    } else {
      legend.append(
        el('span', { class: 'muted' }, 'median TPM  '),
        swatch('var(--panel-2)'),
        el('span', { class: 'muted' }, ` ${(2 ** lo - 1).toFixed(1)}  `),
        swatch('var(--accent)'),
        el('span', { class: 'muted' }, ` ${(2 ** hi - 1).toFixed(1)}  (shaded on a log scale, `
          + 'rescaled to this window)'));
    }
  }

  const ctx = canvas.getContext('2d', { alpha: false });
  let view = { w: 0, h: 0, dpr: 0 };
  const state = { genes: null, records: null, mode: 'tissue', tissue: 'leaf', contrast: null, values: null };

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const r = stage.getBoundingClientRect();
    if (!r.width) return false;
    const w = Math.round(r.width * dpr), h = Math.round(H * dpr);
    if (w === view.w && h === view.h && dpr === view.dpr) return false;
    canvas.width = w; canvas.height = h;
    canvas.style.width = (w / dpr) + 'px';
    canvas.style.height = (h / dpr) + 'px';
    view = { w, h, dpr };
    return true;
  }
  let boxes = [];
  function redraw() {
    if (!state.genes || !state.values) return;
    boxes = draw(ctx, view, state.genes, state.values, state.mode, g.id);
  }
  function refresh() { fit(); redraw(); drawLegend(); }
  const ro = new ResizeObserver(() => { fit(); redraw(); });
  try { ro.observe(stage, { box: 'device-pixel-content-box' }); }
  catch { ro.observe(stage, { box: 'content-box' }); }
  let dropDpr = null;
  (function watchDpr() {
    dropDpr?.();
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', watchDpr, { once: true });
    dropDpr = () => mq.removeEventListener('change', watchDpr);
    refresh();
  })();
  onDispose(stage, () => { ro.disconnect(); dropDpr?.(); });

  const pick = (clientX) => {
    const r = canvas.getBoundingClientRect();
    const cx = (clientX - r.left) * (canvas.width / r.width) / view.dpr;
    let best = null, bd = Infinity;
    for (const b of boxes) {
      const d = (cx >= b.x0 && cx <= b.x1) ? 0 : Math.min(Math.abs(cx - b.x0), Math.abs(cx - b.x1));
      if (d < bd) { bd = d; best = b; }
    }
    return bd <= 8 ? best : null;
  };
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const b = pick(ev.clientX);
    canvas.style.cursor = b ? 'pointer' : 'default';
    readout.textContent = b
      ? `${b.g}  ${b.v == null ? '(no value)' : state.mode === 'tissue' ? `${b.v.toFixed(2)} TPM` : `log2FC ${b.v.toFixed(3)}`}`
      : ' ';
  });
  canvas.addEventListener('pointerleave', () => { readout.textContent = ' '; });
  canvas.addEventListener('click', (ev) => {
    const b = pick(ev.clientX);
    if (b) location.hash = `#/gene/${b.g}`;
  });

  async function paintTissue(tissue) {
    state.mode = 'tissue'; state.tissue = tissue;
    state.values = state.records.map((rec) => (rec.x && rec.x.t ? rec.x.t[tissue] : null) ?? null);
    caption.textContent = `Median TPM in ${tissue.replace('_', ' ')} across the WT-control subset, `
      + 'the same value shown on each gene\'s own Expression card. Drag between tissues to watch '
      + 'the window light up and go dark.';
    refresh();
  }

  // One range request per gene rather than one bucket per 250. This window holds ~17 genes,
  // so the contrast mode went from pulling up to three 786 KB buckets to about 19 KB total.
  // loadExprVector caches per gene, so dragging between contrasts refetches nothing.
  const vecCache = new Map();
  async function vectorFor(rec) {
    if (!rec.x) return null;
    if (!vecCache.has(rec.id)) {
      vecCache.set(rec.id, loadExprVector(rec).catch(() => null));
    }
    return vecCache.get(rec.id);
  }
  async function paintContrast(contrast) {
    state.mode = 'contrast'; state.contrast = contrast;
    const vecs = await Promise.all(state.records.map(vectorFor));
    state.values = vecs.map((vec) => {
      if (!vec) return null;
      const mean = (idxs) => idxs.reduce((a, i) => a + vec[i], 0) / idxs.length;
      const a = mean(contrast.ctrl), b = mean(contrast.pert);
      return Math.log2((b + 1) / (a + 1));
    });
    caption.textContent = `log2((mean perturbation + 1) / (mean control + 1)) per gene, `
      + `${contrast.pert_label} vs ${contrast.control_label}, ${contrast.tissue} `
      + `(n=${contrast.ctrl.length} control, n=${contrast.pert.length} perturbation). `
      + 'Orange = higher under the perturbation, blue = higher under control.';
    refresh();
  }

  const mkModeBtn = (label, on) => {
    const b = el('button', {
      class: 'locus-btn', type: 'button',
      style: state.mode === (label === 'By tissue' ? 'tissue' : 'contrast') ? 'background:var(--accent);color:#fff' : '',
      onclick: on,
    }, label);
    return b;
  };
  const setActiveMode = (m) => {
    [...modeRow.children].forEach((b) => { b.style.background = ''; b.style.color = ''; });
    tissueRow.style.display = m === 'tissue' ? 'flex' : 'none';
    contrastRow.style.display = m === 'contrast' ? 'block' : 'none';
  };
  const tissueBtn = mkModeBtn('By tissue', () => { setActiveMode('tissue'); tissueBtn.style.background = 'var(--accent)'; tissueBtn.style.color = '#fff'; paintTissue(state.tissue); });
  let sel = null;      // the <select>, built once contrasts.json has loaded (below)
  let byKind = null;   // contrast_id groups, same map the <select>'s own options use
  const contrastBtn = mkModeBtn('By contrast', async () => {
    setActiveMode('contrast'); contrastBtn.style.background = 'var(--accent)'; contrastBtn.style.color = '#fff';
    if (state.contrast) { paintContrast(state.contrast); return; }
    // First switch to this mode: the <select> already shows a value (the browser
    // auto-selects its first option on render, with no 'change' event to hook), but
    // nothing has painted to match it yet. Resolve and paint that value explicitly,
    // the same way the 'change' handler would, so the caption is never stale.
    if (sel && byKind) {
      const [kind, ci] = sel.value.split('|');
      paintContrast(byKind.get(kind)[+ci]);
    }
  });
  modeRow.append(tissueBtn, contrastBtn);

  TISSUES.forEach((t) => {
    const chip = el('button', {
      class: 'locus-btn', type: 'button', style: 'padding:0 10px;font-size:12px',
      onclick: () => {
        [...tissueRow.children].forEach((c) => { c.style.background = ''; c.style.color = ''; });
        chip.style.background = 'var(--accent)'; chip.style.color = '#fff';
        paintTissue(t);
      },
    }, t.replace('_', ' '));
    tissueRow.append(chip);
  });

  (async () => {
    const genes = await loadWindow(g.hap, g.chr, g.start, g.id, defaultFlank());
    if (!genes) { caption.textContent = 'No locus tile for this gene.'; return; }
    const [records, contrasts] = await Promise.all([
      Promise.all(genes.map((r) => getGene(r.g))),
      loadContrasts(),
    ]);
    state.genes = genes; state.records = records;

    sel = el('select', { style: 'width:100%;min-height:40px;padding:0 8px;font-size:13px;border:1px solid var(--line-2);border-radius:8px;background:var(--panel-2);color:var(--ink)' });
    byKind = new Map();
    contrasts.forEach((c) => { if (!byKind.has(c.kind)) byKind.set(c.kind, []); byKind.get(c.kind).push(c); });

    // Contrasts can collide: two genuinely different comparisons render as the same string
    // because the label drops the factor held fixed that separates them (a CO2 level, a day
    // length). The curated table states those factors (`within`). For each colliding group,
    // show exactly the ones that DIFFER between its members -- guaranteed to disambiguate,
    // without guessing which factor matters; the id is the last resort.
    const factors = (c) => (c.within ? c.within.split('; ') : [c.id]).map((t) => t.trim()).filter(Boolean);
    const groups = new Map();
    contrasts.forEach((c) => {
      const k = `${c.tissue}|${c.control_label}|${c.pert_label}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    });
    const extra = new Map();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const counts = new Map();
      list.forEach((c) => new Set(factors(c)).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      list.forEach((c) => extra.set(c.id,
        factors(c).filter((t) => counts.get(t) < list.length).join(', ')));
    }
    const optLabel = (c) => {
      const e = extra.get(c.id);
      return `${c.tissue} · ${c.pert_label} vs ${c.control_label}${e ? `  [${e}]` : ''}`;
    };
    for (const [kind, list] of byKind) {
      const grp = el('optgroup', { label: KIND_LABEL[kind] || kind });
      list.forEach((c, ci) => grp.append(el('option', { value: `${kind}|${ci}` }, optLabel(c))));
      sel.append(grp);
    }
    contrastRow.append(el('p', { class: 'muted', style: 'margin:0 0 6px;font-size:11.5px' },
      'The dissertation\u2019s 165 curated contrasts, grouped by kind; the 149 in the first seven '
      + 'kinds are the perturbation contrasts behind each gene\u2019s responsiveness. Where two '
      + 'contrasts share a label, the factor that separates them is shown in brackets.'));
    sel.addEventListener('change', () => {
      const [kind, ci] = sel.value.split('|');
      const c = byKind.get(kind)[+ci];
      paintContrast(c);
    });
    contrastRow.append(sel);

    // Default view: this gene's own top tissue, so the scrubber opens on something
    // already meaningful rather than an arbitrary first tissue.
    tissueBtn.style.background = 'var(--accent)'; tissueBtn.style.color = '#fff';
    const defaultTissue = (g.x && g.x.top) || 'leaf';
    const chipIdx = TISSUES.indexOf(defaultTissue);
    if (chipIdx >= 0) { tissueRow.children[chipIdx].style.background = 'var(--accent)'; tissueRow.children[chipIdx].style.color = '#fff'; }
    await paintTissue(defaultTissue);
  })().catch((e) => { caption.textContent = `Scrubber unavailable: ${e.message}`; });

  return card;
}

export default { id: 'scrubber', label: 'Expression along the locus', geneCard };
