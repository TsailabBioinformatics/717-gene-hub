// Shared two-haplotype locus browser. The genome map's chromosome view, the array page, the
// pair page and the gene page all draw a locus with THIS component, so they look and handle
// the same way: drag to zoom (mouse) or pan (touch), buttons for both, and the same tracks.
// What differs is only the window, and resolution follows from it: zoomed in far enough,
// each gene shows its exon structure and its ID.
//
// Highlighting is explicit, so a reader can tell which genes and links matter:
//   focus   -- genes on the top haplotype the page is about (the query gene, the array members)
//   linked  -- their own alleles on the other haplotype
//   anchors -- neighboring genes whose alleles are used ONLY to line the two haplotypes up,
//              when the focus genes have no allele of their own (dashed links)
// Every other allele link in view is drawn thin and grey.
//
// Data: data/locus/index/<hap>/<chr>.json for position and class, and the 1 Mb tiles for
// synteny, allele id and exon structure, fetched only for the window in view.
import { el } from './dom.js';
import { loadLocusIndex, loadLocusTile } from './data.js';
import { onDispose } from './lifecycle.js';
import { query, setQuery } from './router.js';

export const HAP_LABEL = { hap1: 'HAP1 (TreH)', hap2: 'HAP2 (AlbH)' };
const MAX_DPR = 2;
const PAD_X = 10;
const MIN_SPAN = 20000; // bp; about four average genes -- labels are readable well before this

export function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (v) => cs.getPropertyValue(v).trim();
  return {
    panel: g('--panel'), panel2: g('--panel-2'), line: g('--line'), line2: g('--line-2'),
    ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'),
    accent: g('--accent'), accentInk: g('--accent-ink'), accentSoft: g('--accent-soft'),
    hap1: g('--hap1'), hap2: g('--hap2'),
    core: g('--c-core'), disp: g('--c-disp'), nonsyn: g('--c-nonsyn'),
    priv: g('--c-priv'), tandem: g('--c-tandem'),
    mono: g('--mono') || 'monospace', sans: g('--sans') || 'sans-serif',
  };
}

/** A single canvas stage. `onDraw(ctx, view)` returns hit-test boxes for the frame.
 *  `refresh()` re-measures (resize, DPR); `redraw()` repaints at the current size. */
export function makeStage(height, extraClass = '') {
  const stage = el('div', { class: `locus-stage map-stage ${extraClass}`, style: `height:${height}px` });
  const canvas = el('canvas', { class: 'locus-canvas map-canvas' });
  stage.append(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  let view = { w: 0, h: 0, dpr: 0 };
  let onDraw = () => [];
  let boxes = [];

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const r = stage.getBoundingClientRect();
    if (!r.width) return false;
    const w = Math.round(r.width * dpr), h = Math.round(height * dpr);
    if (w === view.w && h === view.h && dpr === view.dpr) return false;
    canvas.width = w; canvas.height = h;
    canvas.style.width = (w / dpr) + 'px';
    canvas.style.height = (h / dpr) + 'px';
    view = { w, h, dpr };
    return true;
  }
  function redraw() { if (view.w) boxes = onDraw(ctx, view) || []; }
  function refresh() { fit(); redraw(); }

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
  // Theme flips: system preference, or the site's own data-theme toggle.
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => redraw();
  mqDark.addEventListener('change', onTheme);
  const mo = new MutationObserver(onTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  onDispose(stage, () => {
    ro.disconnect(); dropDpr?.(); mo.disconnect(); mqDark.removeEventListener('change', onTheme);
  });

  return {
    stage, canvas,
    setDraw(fn) { onDraw = fn; redraw(); },
    refresh, redraw,
    get cssW() { return view.dpr ? view.w / view.dpr : stage.getBoundingClientRect().width; },
    pointIn(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      return { x: (clientX - r.left) * (canvas.width / r.width) / view.dpr,
               y: (clientY - r.top) * (canvas.height / r.height) / view.dpr };
    },
    get boxes() { return boxes; },
  };
}

/** "Nice" tick step for a span in bp, aiming at roughly `target` ticks. */
export function tickStep(span, target) {
  const raw = span / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
export function fmtBp(bp, step) {
  if (step >= 1e6) return `${(bp / 1e6).toFixed(0)} Mb`;
  if (step >= 1e5) return `${(bp / 1e6).toFixed(1)} Mb`;
  if (step >= 1e4) return `${(bp / 1e6).toFixed(2)} Mb`;
  return `${(bp / 1e3).toFixed(0)} kb`;
}
export const fmtMb = (bp, d = 2) => `${(bp / 1e6).toFixed(d)}`;

// Duplication class letters, first match wins -- the same precedence as the locus card.
const DUP = [
  { k: 'T', label: 'tandem', tok: 'tandem' },
  { k: 'A', label: 'aWGT', tok: 'priv' },
  { k: 'S', label: 'sWGD', tok: 'core' },
  { k: 'D', label: 'dispersed', tok: 'disp' },
  { k: 'C', label: 'none detected', tok: 'nonsyn' },
];
const dupOf = (c) => (c ? DUP.find((d) => c.includes(d.k)) : null);

const SYN = [
  { k: 'core_syntenic', label: 'core syntenic', tok: 'core' },
  { k: 'dispensable_syntenic', label: 'dispensable', tok: 'disp' },
  { k: 'non_syntenic_ortholog', label: 'non-syntenic', tok: 'nonsyn' },
  { k: 'private_no_ortholog', label: 'private', tok: 'priv' },
  { k: 'tandem_array_member', label: 'tandem array', tok: 'tandem' },
];

const TRACKS = [
  { id: 'plus', label: 'genes +', h: 24 },
  { id: 'minus', label: 'genes −', h: 24 },
  { id: 'dup', label: 'duplication', h: 12 },
  { id: 'syn', label: 'synteny', h: 12 },
  { id: 'tau', label: 'τ', h: 20 },
  { id: 'lsg', label: 'LSG pool', h: 10 },
];
const TRACK_GAP = 3;
const HEAD_H = 16, RULER_H = 22, LINK_H = 46, GUTTER = 80, PAD_R = 10;
const BLOCK_H = HEAD_H + RULER_H + TRACKS.reduce((a, t) => a + t.h + TRACK_GAP, 0);
const CHR_H = BLOCK_H * 2 + LINK_H + 8;

const inWin = (g, a, b) => g.e >= a && g.s <= b;

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Lay out one haplotype block. `dir` = +1 draws top-down (header, ruler, then tracks
 *  from LSG down to the gene rows), -1 mirrors it so the gene rows face the link band. */
function blockLayout(top, dir) {
  const order = dir > 0 ? [...TRACKS].reverse() : TRACKS;
  const rows = {};
  let y;
  if (dir > 0) {
    const head = top, ruler = top + HEAD_H;
    y = ruler + RULER_H;
    for (const t of order) { rows[t.id] = { y, h: t.h, label: t.label }; y += t.h + TRACK_GAP; }
    return { head, ruler, rows, y0: top, y1: y };
  }
  y = top;
  for (const t of order) { rows[t.id] = { y, h: t.h, label: t.label }; y += t.h + TRACK_GAP; }
  const ruler = y, head = y + RULER_H;
  return { head, ruler, rows, y0: top, y1: head + HEAD_H };
}

function drawChrView(ctx, view, M) {
  const { w, h, dpr } = view;
  const T = tokens();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = T.panel;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cssW = w / dpr;
  const plotW = cssW - GUTTER - PAD_R;
  const boxes = [];

  const A = blockLayout(4, +1);
  const B = blockLayout(A.y1 + LINK_H, -1);
  const blocks = [
    { hap: M.hap, chr: M.chr, L: A, win: M.win, genes: M.inView[M.hap], dir: +1, mark: M.focus },
    { hap: M.other, chr: M.otherChr, L: B, win: M.otherWin, genes: M.inView[M.other], dir: -1, mark: M.linked },
  ];
  const xOf = (win, bp) => GUTTER + ((bp - win.start) / (win.end - win.start)) * plotW;
  const pxPerBp = plotW / (M.win.end - M.win.start);
  const geneLevel = pxPerBp * 4000 >= (plotW < 400 ? 12 : 24); // an average 4 kb gene gets >= 24 px

  // Allele links first, behind everything. Three kinds, so the one that matters is legible:
  // the focus genes' own alleles (solid accent), alignment anchors (dashed accent) and every
  // other allele pair in view (thin grey).
  const linkTop = A.y1 - TRACK_GAP, linkBot = B.y0;
  const kindOf = (L) => (M.focus.has(L.a.g) ? 'focus' : M.anchors.has(L.a.g) ? 'anchor' : 'other');
  const order = { other: 0, anchor: 1, focus: 2 };
  for (const L of [...M.links].sort((p, q) => order[kindOf(p)] - order[kindOf(q)])) {
    const xa = xOf(M.win, (L.a.s + L.a.e) / 2), xb = xOf(M.otherWin, (L.b.s + L.b.e) / 2);
    const hovered = M.hover && (M.hover === L.a.g || M.hover === L.b.g);
    const kind = kindOf(L);
    ctx.setLineDash(kind === 'anchor' ? [5, 4] : []);
    ctx.strokeStyle = hovered ? T.ink : kind === 'other' ? T.line2 : T.accent;
    ctx.lineWidth = hovered ? 2.4 : kind === 'focus' ? 2.2 : kind === 'anchor' ? 1.6 : 1;
    ctx.globalAlpha = hovered || kind !== 'other' ? 1 : M.focus.size ? 0.45 : 0.6;
    ctx.beginPath();
    ctx.moveTo(xa, linkTop + 1);
    ctx.bezierCurveTo(xa, (linkTop + linkBot) / 2, xb, (linkTop + linkBot) / 2, xb, linkBot - 1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  for (const blk of blocks) {
    const { L, win, genes, hap, mark } = blk;
    const hapCol = hap === 'hap1' ? T.hap1 : T.hap2;
    // header
    ctx.textBaseline = 'middle';
    ctx.font = `600 11.5px ${T.sans}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = T.ink;
    ctx.fillText(`${HAP_LABEL[hap]} · ${blk.chr}:${fmtMb(Math.max(0, win.start))}–${fmtMb(win.end)} Mb · ${genes.length} genes`,
      GUTTER, L.head + HEAD_H / 2);
    ctx.fillStyle = hapCol;
    ctx.fillRect(PAD_X, L.head + 4, 8, HEAD_H - 8);

    // ruler
    const step = tickStep(win.end - win.start, plotW < 300 ? 3 : 8);
    const rTop = blk.dir > 0 ? L.ruler + RULER_H - 6 : L.ruler + 6;
    ctx.strokeStyle = T.ink;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(GUTTER, rTop + 0.5); ctx.lineTo(GUTTER + plotW, rTop + 0.5); ctx.stroke();
    ctx.font = `10px ${T.mono}`;
    ctx.fillStyle = T.ink2;
    ctx.textAlign = 'center';
    for (let bp = Math.ceil(win.start / step) * step; bp <= win.end; bp += step) {
      const tx = Math.round(xOf(win, bp)) + 0.5;
      const lab = fmtBp(bp, step);
      ctx.textAlign = tx + ctx.measureText(lab).width / 2 > cssW - 2 ? 'right'
        : tx - ctx.measureText(lab).width / 2 < GUTTER - 20 ? 'left' : 'center';
      ctx.beginPath();
      ctx.moveTo(tx, rTop); ctx.lineTo(tx, rTop + (blk.dir > 0 ? -4 : 4)); ctx.stroke();
      ctx.fillText(lab, ctx.textAlign === 'right' ? cssW - 2 : tx, blk.dir > 0 ? rTop - 10 : rTop + 11);
    }
    // track labels + baselines
    ctx.font = `10px ${T.mono}`;
    ctx.textAlign = 'right';
    for (const t of TRACKS) {
      const r = L.rows[t.id];
      ctx.fillStyle = T.ink2;
      ctx.fillText(r.label, GUTTER - 6, r.y + r.h / 2);
      ctx.fillStyle = T.panel2;
      ctx.fillRect(GUTTER, r.y, plotW, r.h);
    }

    // genes
    const lastLabelEnd = { plus: -Infinity, minus: -Infinity };
    for (const g of genes) {
      const x0 = Math.max(GUTTER, xOf(win, g.s)), x1 = Math.min(GUTTER + plotW, xOf(win, g.e));
      const gw = Math.max(1.2, x1 - x0);
      const hov = M.hover === g.g;
      const marked = mark.has(g.g);
      const anchor = blk.dir > 0 ? M.anchors.has(g.g) : M.anchorAlleles.has(g.g);
      const tile = M.tiles[hap].get(g.g);
      const boxed = blk.dir < 0 && M.outline.has(g.g);
      if (marked || anchor || boxed) {
        // a soft band through every track, so the gene stays findable at any zoom
        const yT = Math.min(...TRACKS.map((t) => L.rows[t.id].y)) - 2;
        const yB = Math.max(...TRACKS.map((t) => L.rows[t.id].y + L.rows[t.id].h)) + 2;
        if (marked) {
          ctx.fillStyle = T.accentSoft || T.panel2;
          ctx.fillRect(x0 - 2, yT, gw + 4, yB - yT);
        }
        if (boxed) {
          ctx.strokeStyle = T.accent; ctx.lineWidth = 1.5;
          ctx.strokeRect(x0 - 2.5, yT + 0.5, gw + 5, yB - yT - 1);
        } else if (!marked) {
          ctx.strokeStyle = T.accent; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.strokeRect(x0 - 2.5, yT + 0.5, gw + 5, yB - yT - 1);
          ctx.setLineDash([]);
        }
      }
      const rowId = g.d < 0 ? 'minus' : 'plus';
      const r = L.rows[rowId];
      const boxY = geneLevel ? r.y + r.h - 10 : r.y + 3;
      const boxH = geneLevel ? 8 : r.h - 6;
      ctx.fillStyle = hov ? T.ink : marked ? T.accent : T.ink2;
      if (geneLevel && tile && tile.f && gw > 16) {
        // exon structure: thin intron line, UTR half-height, CDS full height
        ctx.fillRect(x0, boxY + boxH / 2 - 0.5, gw, 1);
        for (const [off, len, cds] of tile.f) {
          const ex0 = Math.max(GUTTER, xOf(win, g.s + off)), ex1 = Math.min(GUTTER + plotW, xOf(win, g.s + off + len));
          if (ex1 <= ex0) continue;
          const eh = cds ? boxH : boxH / 2;
          ctx.fillRect(ex0, boxY + (boxH - eh) / 2, Math.max(1, ex1 - ex0), eh);
        }
      } else {
        ctx.fillRect(x0, boxY, gw, boxH);
      }
      if (geneLevel) {
        const full = g.g, short = g.g.split('.')[1] || g.g;
        ctx.font = `10px ${T.mono}`;
        ctx.textAlign = 'left';
        const text = ctx.measureText(full).width + 6 < Math.max(gw, 90) ? full : short;
        const tw = ctx.measureText(text).width;
        const lx = Math.max(GUTTER, Math.min(x0, GUTTER + plotW - tw));
        if (lx > lastLabelEnd[rowId] + 4) {
          ctx.fillStyle = hov || marked ? T.accentInk : T.ink;
          ctx.fillText(text, lx, r.y + 6);
          lastLabelEnd[rowId] = lx + tw;
        }
      }
      // dup class
      const d = dupOf(g.c);
      if (d) {
        const rr = L.rows.dup;
        ctx.fillStyle = T[d.tok];
        ctx.fillRect(x0, rr.y + 1, gw, rr.h - 2);
      }
      // synteny
      const sy = tile && SYN.find((x) => x.k === tile.y);
      if (sy) {
        const rr = L.rows.syn;
        ctx.fillStyle = T[sy.tok];
        ctx.fillRect(x0, rr.y + 1, gw, rr.h - 2);
      }
      // tau
      if (g.t != null) {
        const rr = L.rows.tau;
        const bh = Math.max(1, g.t * (rr.h - 2));
        ctx.fillStyle = T.ink3;
        ctx.fillRect(x0, rr.y + rr.h - 1 - bh, gw, bh);
      }
      // LSG
      if (g.l) {
        const rr = L.rows.lsg;
        ctx.fillStyle = T.accent;
        ctx.fillRect(x0, rr.y + 1, Math.max(3, gw), rr.h - 2);
      }
      const yTop = Math.min(...TRACKS.map((t) => L.rows[t.id].y));
      const yBot = Math.max(...TRACKS.map((t) => L.rows[t.id].y + L.rows[t.id].h));
      if (hov) {
        ctx.strokeStyle = T.ink;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 - 1.5, yTop - 1, gw + 3, yBot - yTop + 2);
      }
      boxes.push({ g: g.g, hap, x0, x1: x0 + gw, y0: yTop, y1: yBot, rec: g, rowY: r.y + r.h / 2 });
    }
  }

  // brush
  if (M.brush) {
    const a = Math.min(M.brush.x0, M.brush.x1), b = Math.max(M.brush.x0, M.brush.x1);
    ctx.fillStyle = T.accent;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(a, A.y0, b - a, B.y1 - A.y0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(a + 0.5, A.y0 + 0.5, b - a, B.y1 - A.y0 - 1);
  }
  return boxes;
}

// Tiles are keyed by floor(gene start / 1 Mb) (scripts/build_locus.py), so the tiles that exist
// are exactly those the index's own starts imply -- no probing, no 404s. Only the tiles under
// the genes in the current window are fetched; the whole chromosome is the same path.
const tileMbs = (genes) => [...new Set(genes.map((g) => Math.floor(g.s / 1e6)))];

/** The two-haplotype browser. Options:
 *   hap, chr          top haplotype and chromosome
 *   start, end        initial window (default: the URL's ?start&end on the map, else whole)
 *   otherChr          chromosome on the other haplotype (default: same name)
 *   focus, linked, anchors   Sets of gene ids, see the header of this file
 *   embed             true on gene/array/pair pages: no back button, the URL is left alone,
 *                     and a link opens the same window in the genome map
 *   onBack            the map's "back to genome" handler */
export async function chromosomeBrowser(opts) {
  const { hap, chr, onBack, embed = false } = opts;
  const other = hap === 'hap1' ? 'hap2' : 'hap1';
  const otherChr = opts.otherChr || chr;
  const [idxA, idxB] = await Promise.all([loadLocusIndex(hap, chr), loadLocusIndex(other, otherChr)]);
  const idx = { [hap]: idxA, [other]: idxB };
  const len = { [hap]: Math.max(...idxA.map((g) => g.e), 1), [other]: Math.max(...idxB.map((g) => g.e), 1) };
  const byId = { [hap]: new Map(idxA.map((g) => [g.g, g])), [other]: new Map(idxB.map((g) => [g.g, g])) };
  const tiles = { [hap]: new Map(), [other]: new Map() };

  const q = embed ? {} : query();
  let start = Number(opts.start ?? q.start), end = Number(opts.end ?? q.end);
  if (!(end > start)) { start = 0; end = len[hap]; }
  const focus = opts.focus || new Set();
  const anchors = opts.anchors || new Set();
  const M = {
    hap, other, chr, otherChr, tiles, win: { start, end }, otherWin: { start, end },
    inView: {}, links: [], hover: null, brush: null, offset: 0,
    focus, linked: opts.linked || new Set(), anchors, anchorAlleles: new Set(), outline: opts.outline || new Set(),
  };

  const s = makeStage(CHR_H, embed ? 'map-chr-stage lb-embed' : 'map-chr-stage');
  s.stage.dataset.locusBrowser = embed ? 'embed' : 'map';
  const readout = el('div', { class: 'locus-readout map-readout muted', 'data-map-readout': '' }, ' ');
  const summary = el('p', { class: 'map-count', 'data-map-summary': '' });
  const legend = el('div', { class: 'map-legend', 'data-map-legend': 'chromosome' });
  const regionLabel = el('span', { class: 'mono map-region' });

  function clampWin(a, b) {
    let span = Math.max(MIN_SPAN, b - a);
    span = Math.min(span, len[hap]);
    let s0 = Math.round(a), s1 = Math.round(a + span);
    if (s0 < 0) { s0 = 0; s1 = span; }
    if (s1 > len[hap]) { s1 = len[hap]; s0 = Math.max(0, s1 - span); }
    return { start: s0, end: s1 };
  }

  function recompute() {
    const { start: a, end: b } = M.win;
    const genesA = idx[hap].filter((g) => inWin(g, a, b));
    // Other haplotype's window: same bp span, shifted by the median allele offset of the
    // genes in view (the two haplotypes are independently coordinated).
    // Preference: the focus genes' own alleles, then the anchors', then every gene in view --
    // so the region the page is about stays lined up while the reader pans.
    const diffsFor = (keep) => {
      const d = [];
      for (const g of genesA) {
        if (!keep(g)) continue;
        const t = tiles[hap].get(g.g);
        const o = t && t.al && byId[other].get(t.al);
        if (o) d.push(o.s - g.s);
      }
      return d;
    };
    let diffs = diffsFor((g) => focus.has(g.g));
    if (!diffs.length) diffs = diffsFor((g) => anchors.has(g.g));
    if (!diffs.length) diffs = diffsFor(() => true);
    const off = median(diffs);
    if (off != null) M.offset = off;
    else if (M.win.end - M.win.start >= len[hap] * 0.999) M.offset = 0;
    M.otherWin = { start: a + M.offset, end: b + M.offset };
    const genesB = idx[other].filter((g) => inWin(g, M.otherWin.start, M.otherWin.end));
    M.inView = { [hap]: genesA, [other]: genesB };
    const inB = new Set(genesB.map((g) => g.g));
    M.links = [];
    M.anchorAlleles = new Set();
    for (const g of genesA) {
      const t = tiles[hap].get(g.g);
      if (t && t.al && anchors.has(g.g)) M.anchorAlleles.add(t.al);
      if (t && t.al && inB.has(t.al)) M.links.push({ a: g, b: byId[other].get(t.al) });
    }
    s.stage.dataset.linksFocus = String(M.links.filter((L) => focus.has(L.a.g)).length);
    s.stage.dataset.linksAnchor = String(M.links.filter((L) => !focus.has(L.a.g) && anchors.has(L.a.g)).length);
    s.stage.dataset.linksOther = String(M.links.filter((L) => !focus.has(L.a.g) && !anchors.has(L.a.g)).length);
    ensureTiles();
    const allWhole = M.win.start === 0 && M.win.end === len[hap];
    regionLabel.textContent = `${chr}:${fmtMb(a)}–${fmtMb(b)} Mb`;
    if (mapLink) mapLink.href = `#/map/${hap}/${chr}?start=${Math.round(a)}&end=${Math.round(b)}`;
    summary.textContent = `${HAP_LABEL[hap]} ${chr}:${fmtMb(a)}–${fmtMb(b)} Mb, ${genesA.length} genes; `
      + `${HAP_LABEL[other]} ${fmtMb(Math.max(0, M.otherWin.start))}–${fmtMb(M.otherWin.end)} Mb, ${genesB.length} genes; `
      + `${M.links.length} allele links drawn${tilesReady ? '' : ' (loading allele and synteny tiles…)'}.`;
    if (embed) {
      // the plain count a reader needs first: how much of this window has a partner at all
      const withAl = genesA.filter((g) => (tiles[hap].get(g.g) || {}).al).length;
      summary.textContent = tilesReady
        ? `${genesA.length} genes in view on ${HAP_LABEL[hap]}: ${withAl} with an allele on ${HAP_LABEL[other]}`
          + `${genesA.length - withAl ? `, ${genesA.length - withAl} with none` : ''}.`
        : 'Loading alleles…';
    }
    zoomOut.disabled = allWhole;
    zoomIn.disabled = (b - a) <= MIN_SPAN;
    legend.replaceChildren(...legendRows());
    setProbe();
  }

  function legendRows() {
    const A = M.inView[hap], B = M.inView[other];
    const cnt = (arr, f) => arr.reduce((n, g) => n + (f(g) ? 1 : 0), 0);
    const nums = (f) => `${cnt(A, f)} / ${cnt(B, f)}`;
    const sw = (tok) => el('i', { class: `map-sw map-sw-${tok}`, 'aria-hidden': 'true' });
    const item = (tok, label, n) => el('span', { class: 'map-li' }, sw(tok), `${label} `, el('span', { class: 'mono' }, n));
    const synOf = (h) => (g) => (tiles[h].get(g.g) || {}).y;
    const row = (name, ...items) => el('div', { class: 'map-lrow' }, el('span', { class: 'map-lname' }, name), ...items);
    const synA = synOf(hap), synB = synOf(other);
    return [
      el('p', { class: 'muted map-note' },
        `Counts are genes in the current window, ${HAP_LABEL[hap]} / ${HAP_LABEL[other]}.`),
      row('Genes', item('ink', 'plus strand', nums((g) => g.d >= 0)), item('ink', 'minus strand', nums((g) => g.d < 0))),
      row('Duplication', ...DUP.map((d) => item(d.tok, d.label, nums((g) => dupOf(g.c) === d)))),
      row('Synteny', ...SYN.map((c) => item(c.tok, c.label,
        tilesReady ? `${cnt(A, (g) => synA(g) === c.k)} / ${cnt(B, (g) => synB(g) === c.k)}` : '…'))),
      row('τ', el('span', { class: 'map-li' }, 'bar height = τ (222-sample reference panel), 0 to 1; with a value ',
        el('span', { class: 'mono' }, nums((g) => g.t != null)))),
      row('LSG pool', item('accent', 'in the lineage-specific pool (phylostratum ≥ 18)', nums((g) => g.l))),
      row('Alleles', el('span', { class: 'map-li' }, 'curves join a gene to its allele on the other haplotype; drawn ',
        el('span', { class: 'mono' }, String(M.links.length)))),
    ];
  }

  // A stable, test-readable point: the centre of the first gene in view on the focal row,
  // so a driven check clicks a real gene without knowing the layout.
  function setProbe() {
    requestAnimationFrame(() => {
      const b = s.boxes.find((x) => x.hap === hap && x.x1 - x.x0 >= 1);
      if (b) {
        s.stage.dataset.probeX = String(Math.round((b.x0 + b.x1) / 2));
        s.stage.dataset.probeY = String(Math.round(b.rowY));
        s.stage.dataset.probeGene = b.g;
      }
      // and one on the lower haplotype, preferring the focus gene's own allele
      const o = s.boxes.find((x) => x.hap === other && M.linked.has(x.g))
        || s.boxes.find((x) => x.hap === other && x.x1 - x.x0 >= 1);
      if (o) {
        s.stage.dataset.probeOtherX = String(Math.round((o.x0 + o.x1) / 2));
        s.stage.dataset.probeOtherY = String(Math.round(o.rowY));
        s.stage.dataset.probeOtherGene = o.g;
      }
      s.stage.dataset.genesInView = String(M.inView[hap].length);
    });
  }

  function setWin(a, b) {
    M.win = clampWin(a, b);
    recompute();
    s.redraw();
    if (embed) return;
    const whole = M.win.start === 0 && M.win.end === len[hap];
    setQuery(whole ? {} : { start: M.win.start, end: M.win.end });
  }
  const zoomBy = (f) => {
    const c = (M.win.start + M.win.end) / 2, half = (M.win.end - M.win.start) * f / 2;
    setWin(c - half, c + half);
  };
  const panBy = (f) => {
    const d = (M.win.end - M.win.start) * f;
    setWin(M.win.start + d, M.win.end + d);
  };

  const btn = (label, title, fn, attr) => el('button', {
    class: 'btn map-btn', type: 'button', title, 'aria-label': title, onclick: fn, ...attr,
  }, label);
  const zoomIn = btn('+', 'Zoom in', () => zoomBy(0.5), { 'data-map-zoom': 'in' });
  const zoomOut = btn('−', 'Zoom out', () => zoomBy(2), { 'data-map-zoom': 'out' });
  const mapLink = embed ? el('a', { class: 'lb-maplink', 'data-lb-maplink': '' }, 'Open in the genome map →') : null;
  const focusBtn = embed && opts.start != null
    ? btn('Reset', 'Back to the starting window', () => setWin(opts.start, opts.end), { 'data-map-zoom': 'reset' })
    : null;
  const controls = el('div', { class: 'map-controls' },
    embed ? null : btn('← genome', 'Back to the genome', onBack, { 'data-map-back': '' }),
    el('strong', { class: embed ? 'map-title lb-title' : 'map-title' }, `${chr} · ${HAP_LABEL[hap]}`),
    el('span', { class: 'map-spacer' }),
    btn('◀', 'Pan left', () => panBy(-0.5), { 'data-map-pan': 'left' }),
    zoomOut, zoomIn,
    btn('▶', 'Pan right', () => panBy(0.5), { 'data-map-pan': 'right' }),
    focusBtn || btn('Whole', 'Show the whole chromosome', () => setWin(0, len[hap]), { 'data-map-zoom': 'reset' }),
    regionLabel);

  // pointer: mouse drag = brush-to-zoom; touch drag = pan; a tap/click = open the gene
  const xToBp = (x) => M.win.start + ((x - GUTTER) / (s.cssW - GUTTER - PAD_R)) * (M.win.end - M.win.start);
  let drag = null;
  const pick = (x, y) => {
    let best = null, bd = Infinity;
    for (const b of s.boxes) {
      if (y < b.y0 - 2 || y > b.y1 + 2) continue;
      const d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
      if (d < bd) { bd = d; best = b; }
    }
    return bd <= 6 ? best : null;
  };
  s.canvas.addEventListener('pointerdown', (ev) => {
    const p = s.pointIn(ev.clientX, ev.clientY);
    drag = { x: p.x, y: p.y, type: ev.pointerType, win: { ...M.win }, moved: false };
    try { s.canvas.setPointerCapture(ev.pointerId); } catch { /* synthetic events */ }
  });
  s.canvas.addEventListener('pointermove', (ev) => {
    const p = s.pointIn(ev.clientX, ev.clientY);
    if (drag) {
      if (Math.abs(p.x - drag.x) > 6) drag.moved = true;
      if (!drag.moved) return;
      if (drag.type === 'mouse') {
        M.brush = { x0: Math.max(GUTTER, drag.x), x1: Math.max(GUTTER, Math.min(p.x, s.cssW - PAD_R)) };
        s.redraw();
      } else {
        const bpPerPx = (drag.win.end - drag.win.start) / (s.cssW - GUTTER - PAD_R);
        const d = (drag.x - p.x) * bpPerPx;
        M.win = clampWin(drag.win.start + d, drag.win.end + d);
        recompute(); s.redraw();
      }
      return;
    }
    if (ev.pointerType !== 'mouse') return;
    const hit = pick(p.x, p.y);
    s.canvas.style.cursor = hit ? 'pointer' : (p.x > GUTTER ? 'crosshair' : 'default');
    if (hit) {
      const g = hit.rec, t = tiles[hit.hap].get(g.g) || {};
      const d = dupOf(g.c), sy = SYN.find((x) => x.k === t.y);
      readout.textContent = `${g.g} · ${chr}:${g.s.toLocaleString('en-US')}–${g.e.toLocaleString('en-US')} `
        + `(${g.d < 0 ? '−' : '+'}) · ${d ? d.label : '–'} · ${sy ? sy.label : 'synteny –'} · `
        + `τ ${g.t == null ? '–' : g.t.toFixed(2)}${g.p ? ' · highest in ' + g.p : ''}`
        + `${g.l ? ' · LSG pool' : ''}${t.al ? ' · allele ' + t.al : ''}`;
    } else {
      readout.textContent = p.x > GUTTER
        ? `${chr} ${(Math.max(0, xToBp(p.x)) / 1e6).toFixed(3)} Mb (${HAP_LABEL[hap]}) · drag to zoom` : ' ';
    }
    const next = hit ? hit.g : null;
    if (next !== M.hover) { M.hover = next; s.redraw(); }
  });
  const endDrag = (ev) => {
    if (!drag) return;
    const p = s.pointIn(ev.clientX, ev.clientY);
    const d = drag;
    drag = null;
    if (d.moved && d.type === 'mouse' && M.brush) {
      const a = xToBp(Math.min(M.brush.x0, M.brush.x1)), b = xToBp(Math.max(M.brush.x0, M.brush.x1));
      M.brush = null;
      setWin(a, b);
    } else if (d.moved) {
      setWin(M.win.start, M.win.end);
    } else if (ev.type === 'pointerup') {
      const hit = pick(p.x, p.y);
      if (hit) location.hash = `#/gene/${hit.g}`;
    }
  };
  s.canvas.addEventListener('pointerup', endDrag);
  s.canvas.addEventListener('pointercancel', (ev) => { M.brush = null; endDrag(ev); s.redraw(); });
  s.canvas.addEventListener('pointerleave', () => {
    if (M.hover && !drag) { M.hover = null; readout.textContent = ' '; s.redraw(); }
  });

  let tilesReady = false;
  const asked = { [hap]: new Set(), [other]: new Set() };
  const chrOf = { [hap]: chr, [other]: otherChr };
  function ensureTiles() {
    const want = [[hap, M.win], [other, M.otherWin]].flatMap(([h, w]) =>
      tileMbs(idx[h].filter((g) => inWin(g, w.start, w.end))).filter((m) => !asked[h].has(m)).map((m) => [h, m]));
    if (!want.length) { if (!tilesReady) { tilesReady = true; s.stage.dataset.tiles = 'ready'; } return; }
    tilesReady = false;
    want.forEach(([h, m]) => asked[h].add(m));
    Promise.all(want.map(([h, m]) => loadLocusTile(h, chrOf[h], m).then((rows) => {
      for (const r of rows || []) tiles[h].set(r.g, r);
    }))).catch(() => {}).then(() => { recompute(); s.redraw(); });
  }
  M.tiles = tiles;
  M.win = clampWin(start, end);
  // Probe after EVERY paint, not only after a window change: a card that starts in a closed
  // panel first paints when it is opened, through the resize observer.
  s.setDraw((ctx, view) => { const boxes = drawChrView(ctx, view, M); setProbe(); return boxes; });
  recompute();
  s.redraw();

  if (embed) {
    const key = (cls, text) => el('span', { class: 'lb-key' }, el('i', { class: `lb-sw ${cls}`, 'aria-hidden': 'true' }), text);
    return el('div', { class: 'map-chr lb', 'data-map-view': 'embed' },
      controls,
      el('div', { class: 'map-stage-wrap' }, s.stage),
      readout,
      summary,
      el('div', { class: 'lb-keys' },
        focus.size ? key('lb-focus', opts.focusLabel || 'highlighted gene and its allele') : null,
        anchors.size ? key('lb-anchor', 'neighboring gene used only to line the haplotypes up') : null,
        M.outline.size ? el('span', { class: 'lb-key' }, el('i', { class: 'lb-box', 'aria-hidden': 'true' }), opts.outlineLabel || 'outlined on the lower haplotype') : null,
        key('lb-other', 'other allele pairs in view')),
      el('p', { class: 'muted map-note' },
        'Drag across the tracks to zoom (on a phone, drag to pan); the buttons pan and zoom too. '
        + 'Zoomed in, genes show their exons and IDs. Click a gene to open it. ', mapLink));
  }
  return el('div', { class: 'map-chr', 'data-map-view': 'chromosome' },
    controls,
    summary,
    el('div', { class: 'map-stage-wrap' }, s.stage),
    readout,
    legend,
    el('p', { class: 'muted map-note' },
      'Drag across the tracks to zoom (on a phone, drag to pan and use the buttons to zoom). '
      + 'Zoomed in far enough, each gene shows its exons (coding parts taller) and its ID; click or tap a gene to open '
      + 'its page. The lower haplotype is shifted by the median allele offset of the genes in '
      + 'view, because the two haplotypes are coordinated independently.'));
}

