// Module: duplication layers. Every duplicate this gene has, on one axis, with the three
// layers kept APART -- tandem, salicoid WGD, gamma -- and each link carrying its own dS.
//
// It is the atlas's answer to the question the Duplication card could state but not show:
// the card says "salicoid + tandem" and names partners in a list, so a reader learns that a
// gene has three kinds of duplicate and never sees that two of them sit 40 kb away and the
// third is on another chromosome. This is the figure shape the manuscript uses for a family
// (ms1_talk_20260918/myb_case_20260917/myb_layered_locus_*.png): one short track per locus on
// a shared kilobase scale, anchors joined by labelled arcs.
//
// SVG, not canvas -- a deliberate departure from Locus/Mirror/Genome map, for three reasons
// that all come from this view specifically: the arcs must carry TEXT (a dS beside every
// link) and canvas text cannot be selected or scaled by the reader; the elements number in
// the tens rather than the thousands, so there is no fill-rate argument; and every gene here
// is a link, which as a real <a> gets keyboard focus, a visible focus ring and a 24 px tap
// target for free instead of hit-testing pointer coordinates by hand (WCAG 2.2 SC 2.5.8).
// The canvas modules keep canvas because they paint hundreds of genes and pan continuously.
//
// WHAT EACH NUMBER IS, because three different dS values live on this page and they are not
// interchangeable:
//   tandem link   td.pks[partner] -- the PER-PAIR dS from the TD union rebuild. Absent for
//                 about half of array members; those links are drawn without a number and the
//                 caption says how many were scored. NEVER substitute td.ks, the array MEDIAN.
//   WGD link      wgd[i].ks -- the anchor pair's own dS.
//   allele link   allele.ks -- HAP1 vs HAP2 of the same clone. Drawn in a different style
//                 because it is not a duplication at all; it is the same gene, twice phased.
import { el } from '../core/dom.js';
import { getGene, loadLocusTile, loadFamilies } from '../core/data.js';
import { palette } from '../core/palette.js';
import { onDispose } from '../core/lifecycle.js';

const SVG = 'http://www.w3.org/2000/svg';
const ROW_H = 84;          // px per locus track, label + genes + room for an arc to land
const PAD_X = 14;
const PAD_TOP = 8;
const GENE_H = 15;
const MAX_TD = 12;         // arrays reach 56 members; beyond a dozen the view stops being one
const MAX_SECOND = 8;      // second-order (array-member) WGD partners drawn
// Every track is padded by this much on each side. Without it a row holding ONE gene spans
// only that gene's 3 kb, which becomes the shared scale, and every gene on the card is then
// drawn the full width of the card -- a picture in which a 2 kb gene and a 90 kb array look
// identical. The manuscript figure pads by the same 12 kb for the same reason.
const TRACK_PAD = 12_000;
const MB = 1_000_000;
const CONTEXT = 3;         // flanking genes drawn either side of each anchor, per track
const short = (id) => id.split('.')[1] || id;
const kb = (bp) => `${(bp / 1000).toFixed(0)} kb`;
const LABEL_CH = 6.3;      // px per character at 10.5px in the mono face, measured
const LABEL_GAP = 6;       // minimum clear space between two neighbouring labels

// Layer order is chronological, youngest first, and the allele row sits directly under the
// focal locus because it is the same locus rather than an older event.
const LAYER = {
  F: { key: 'F', label: 'this gene', full: 'this gene' },
  T: { key: 'T', label: 'tandem', full: 'tandem duplication' },
  H: { key: 'H', label: 'other haplotype', full: 'the same locus on the other haplotype' },
  S: { key: 'S', label: 'sWGD', full: 'salicoid whole-genome duplication (sWGD) (~60 Ma)' },
  A: { key: 'A', label: 'aWGT', full: 'ancient whole-genome triplication (aWGT) (~120 Ma)' },
};

const svgEl = (name, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  n.append(...kids.filter(Boolean));
  return n;
};

/** Resolve a partner id to the little it needs to be drawn. One shard fetch each, cached.
 *  `wgd` comes back too: an array member's OWN anchor partners are what make the
 *  second-order (whole-array) history reachable, and they cost no extra request. */
async function place(id) {
  const g = await getGene(id);
  if (!g) return null;
  return { id, hap: g.hap, chr: g.chr, start: g.start, end: g.end, strand: g.strand,
           td: g.td || null, wgd: g.wgd || [] };
}

/** Rows to draw: one per (layer, haplotype, chromosome) group, chronological.
 *  Returns { rows, notes } where notes records what was capped or could not be resolved. */
async function buildRows(g, opts = {}) {
  const notes = [];
  const want = new Map();                       // id -> layer key, deduplicated
  const dsOf = new Map();                       // id -> dS on the link from the focal gene

  const td = g.td || {};
  const mem = (td.mem || []).map((m) => m[0]);
  const pks = td.pks || {};
  // Keep the members with a scored dS first, then fill by array order; a 56-member array
  // truncated to the first dozen by id would hide exactly the pairs that carry a number.
  const ranked = [...mem].sort((a, b) => (pks[b] != null) - (pks[a] != null));
  const tdShown = ranked.slice(0, MAX_TD);
  if (mem.length > tdShown.length) notes.push(`${mem.length - tdShown.length} further array members not drawn`);
  if (td.more) notes.push(`${td.more} more beyond the ${mem.length} the gene record carries`);
  for (const m of tdShown) { want.set(m, 'T'); if (pks[m] != null) dsOf.set(m, pks[m]); }

  for (const p of (g.wgd || [])) {
    if (want.has(p.id)) continue;
    want.set(p.id, p.e === 'A' ? 'A' : 'S');
    if (p.ks != null) dsOf.set(p.id, p.ks);
  }
  // The allele deliberately does NOT get a row here. It is a 1-to-1 relationship, so the row
  // it used to occupy carried a single gene and a long-dashed link across the whole figure --
  // a full track, and one more link crossing every other one, to say "this gene also exists on
  // the other haplotype". Its dS is stated in the caption instead, and the architecture of the
  // other haplotype (which is the genuinely interesting comparison, because the two often
  // carry DIFFERENT numbers of tandem copies) is a view of its own rather than one grey box.
  if (opts.withAllele && g.allele && !want.has(g.allele.id)) {
    want.set(g.allele.id, 'H');
    if (g.allele.ks != null) dsOf.set(g.allele.id, g.allele.ks);
  }

  const placed = await Promise.all([...want.keys()].map(place));
  const unresolved = placed.filter((p) => !p).length;
  if (unresolved) notes.push(`${unresolved} partner${unresolved === 1 ? '' : 's'} could not be resolved`);

  // ---- second order: the WGD history of the ARRAY, not of this gene ---------------------
  //
  // An array member can be a retained salicoid or gamma duplicate where THIS gene is not.
  // That is a real part of the locus's history and it was invisible: a reader had to open
  // each member's page in turn to find it. 3,480 genes reach an event class this way that
  // their own record does not carry.
  //
  // THE OVER-READ THIS MUST NOT CAUSE. A member's salicoid partner is NOT this gene's
  // salicoid partner, and the card must never let the two be confused. So these links
  // originate at the MEMBER, are drawn thinner and paler, and the caption names the event as
  // the ARRAY's rather than the gene's. The gene-level S/A call above is untouched.
  const byId = new Map(placed.filter(Boolean).map((p) => [p.id, p]));
  const ownEvents = new Set((g.wgd || []).map((p) => p.e === 'A' ? 'A' : 'S'));
  const second = [];
  for (const m of tdShown) {
    const mr = byId.get(m);
    if (!mr) continue;
    for (const q of mr.wgd) {
      const layer = q.e === 'A' ? 'A' : 'S';
      if (want.has(q.id) || q.id === g.id) continue;   // already drawn as a first-order anchor
      second.push({ via: m, id: q.id, layer, ks: q.ks, novel: !ownEvents.has(layer) });
    }
  }
  // Prefer the links that tell the reader something new: an event class this gene has no
  // partner for at all. Without this an 8-slot cap could fill with duplicates of a story the
  // first-order arcs already told.
  second.sort((a, b) => (b.novel - a.novel));
  const secondShown = second.slice(0, MAX_SECOND);
  if (second.length > secondShown.length) {
    notes.push(`${second.length - secondShown.length} further array-member WGD partner${
      second.length - secondShown.length === 1 ? '' : 's'} not drawn`);
  }
  const secondPlaced = await Promise.all(secondShown.map((x) => place(x.id)));
  const secondBy = new Map();
  secondShown.forEach((x, i) => {
    const pl = secondPlaced[i];
    if (!pl) return;
    pl.layer = x.layer;
    pl.second = true;
    pl.via = x.via;
    pl.ds = x.ks;
    // A WGD partner that is ITSELF in a tandem array is the "mirrored array" case -- the
    // whole array duplicated at the WGD and both copies expanded. Worth naming; it is free,
    // since place() already read the partner's own td.
    pl.mirrored = !!(pl.td && (pl.td.mem || []).length);
    secondBy.set(pl.id, pl);
  });
  const arrayEvents = new Set(secondShown.map((x) => x.layer));
  const novelEvents = [...arrayEvents].filter((e) => !ownEvents.has(e));

  // ---- links BETWEEN two partners, not just from the focal gene --------------------------
  //
  // Gamma came first, so a gene's salicoid sister and its gamma copy are themselves a gamma
  // pair. Drawing only the focal gene's own links showed a star and hid the triangle -- and
  // the triangle is the point: it is what makes "one locus carries three duplication types"
  // legible as a history rather than a list. 10,436 of 12,198 such third edges are already in
  // the shipped anchor table (86%), so this is a rendering gap, not a data one.
  //
  // Nothing is inferred. An edge is drawn only where the anchor table actually carries it,
  // with that pair's own dS and event. The 14% with no third edge stay open, because drawing
  // a link the table does not contain would be asserting a pair nobody scored.
  const drawn = new Map([...secondBy.values(), ...placed.filter(Boolean)]
    .map((p) => [p.id, p]));
  const between = [];
  const seenEdge = new Set();
  for (const p of drawn.values()) {
    for (const q of (p.wgd || [])) {
      if (!drawn.has(q.id) || q.id === g.id) continue;
      const key = [p.id, q.id].sort().join('|');
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      between.push({ a: p.id, b: q.id, layer: q.e === 'A' ? 'A' : 'S', ds: q.ks });
    }
  }

  // The focal gene is a tandem member only when it actually has array members. Colouring it
  // tandem-pink on a gene with no array would assert a duplication the data does not call.
  const focal = { id: g.id, hap: g.hap, chr: g.chr, start: g.start, end: g.end,
                  strand: g.strand, focal: true, layer: tdShown.length ? 'T' : 'F' };
  const groups = new Map();
  const push = (layer, p) => {
    const key = `${layer}|${p.hap}|${p.chr}`;
    if (!groups.has(key)) groups.set(key, { layer, hap: p.hap, chr: p.chr, genes: [] });
    groups.get(key).genes.push(p);
  };
  // The focal gene's own row is a tandem row even when the gene is in no array -- it is
  // always the anchor every arc leaves from, and labelling it "tandem" when there is no
  // array would be a duplication claim the data does not make. Its label is fixed below.
  push(focal.layer, focal);
  for (const p of placed) {
    if (!p) continue;
    const layer = want.get(p.id);
    p.layer = layer;
    p.ds = dsOf.get(p.id);
    push(layer, p);
  }
  for (const p of secondBy.values()) push(p.layer, p);

  const order = ['F', 'T', 'H', 'S', 'A'];
  const rows = [...groups.values()].sort((a, b) => {
    const d = order.indexOf(a.layer) - order.indexOf(b.layer);
    return d || a.chr.localeCompare(b.chr);
  });
  // Genomic context. Without it every partner track holds ONE gene, that gene is centred by
  // construction, and every arc on the card lands at the same x -- a picture with no
  // horizontal information in it at all. A few real neighbors put each anchor where it
  // actually sits in its own neighborhood, which is what makes the arcs mean something.
  await Promise.all(rows.map(async (r) => {
    const have = new Set(r.genes.map((x) => x.id));
    const extra = [];
    for (const anchor of [...r.genes]) {
      let tile;
      try { tile = await loadLocusTile(r.hap, r.chr, Math.floor(anchor.start / MB)); }
      catch { continue; }
      const i = tile.findIndex((t) => t.g === anchor.id);
      if (i < 0) continue;
      for (const t of tile.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1)) {
        if (have.has(t.g)) continue;
        have.add(t.g);
        extra.push({ id: t.g, hap: r.hap, chr: r.chr, start: t.s, end: t.e, layer: 'X' });
      }
    }
    r.genes.push(...extra);
    r.context = extra.length;
  }));

  for (const r of rows) {
    r.genes.sort((x, y) => x.start - y.start);
    // span is what the label reports: the genes themselves. lo/hi are the DRAWN window,
    // which is padded -- reporting the padded number would overstate every locus by 24 kb.
    const anchors = r.genes.filter((x) => x.layer !== 'X');
    r.span = Math.max(...anchors.map((x) => x.end)) - Math.min(...anchors.map((x) => x.start));
    r.lo = Math.min(...r.genes.map((x) => x.start)) - TRACK_PAD;
    r.hi = Math.max(...r.genes.map((x) => x.end)) + TRACK_PAD;
    r.self = r.genes.some((x) => x.focal);
  }
  return { rows, notes, tdScored: tdShown.filter((m) => pks[m] != null).length,
           tdShown: tdShown.length, memTotal: mem.length,
           second: [...secondBy.values()], novelEvents, ownEvents: [...ownEvents], between };
}

function rowLabel(r, g) {
  // Count ANCHORS, not drawn genes: the context flanks are not array members, and calling
  // them that turned a gene with no array into one with "6 array members".
  const n = r.genes.filter((x) => x.layer !== 'X' && !x.focal).length;
  if (r.self) return `${r.chr} · this gene${n ? ` + ${n} array member${n > 1 ? 's' : ''}` : ''}`;
  const hapTag = r.hap !== g.hap ? ` · ${r.hap === 'hap1' ? 'HAP1' : 'HAP2'}` : '';
  // A row holding ONLY second-order partners is the array's history, not the gene's, and its
  // label has to say so -- "salicoid WGD · Chr11" on a gene with no salicoid partner would
  // be read as this gene having one.
  const anchors = r.genes.filter((x) => x.layer !== 'X');
  const allSecond = anchors.length > 0 && anchors.every((x) => x.second);
  const via = allSecond ? ' of an array member' : '';
  return `${LAYER[r.layer].label}${via} · ${r.chr}${hapTag}`;
}

/** An arc's geometry as a pure function of its two endpoints and a user-supplied `bow`.
 *  `bow` is the only thing dragging changes: the endpoints stay pinned to their genes, so a
 *  reader can route a link around whatever it is covering without the drawing ever claiming
 *  a link between two different genes. Returns the path plus where its dS label wants to sit.
 */
function arcPath(from, to, bow) {
  const dy = to.y - from.y;
  if (dy === 0) {
    // Same track -- a tandem partner a few kb away. A vertical bezier would collapse to a
    // zero-length path, so these bow ABOVE the track instead, height scaled to the horizontal
    // distance so neighboring links do not sit on top of each other.
    const span = Math.abs(to.x - from.x);
    const h = Math.max(6, Math.min(24, 8 + span * 0.18) + bow);
    const top = from.y - GENE_H / 2 - 2 - h;
    return {
      d: `M ${from.x} ${from.y - GENE_H / 2 - 2} C ${from.x} ${top}, ${to.x} ${top}, `
         + `${to.x} ${to.y - GENE_H / 2 - 2}`,
      mx: (from.x + to.x) / 2,
      my: from.y - GENE_H / 2 - 2 - h * 0.75,
    };
  }
  const sgn = Math.sign(dy);
  const lift = Math.min(46, Math.abs(dy) * 0.45 + 12);
  // A dragged bow pushes the two control points sideways, which bends the curve out of the
  // straight line between the genes -- the direction a reader actually wants when a link is
  // covering something.
  const cx1 = from.x + bow;
  const cx2 = to.x + bow;
  return {
    d: `M ${from.x} ${from.y + sgn * (GENE_H / 2 + 2)} `
       + `C ${cx1} ${from.y + sgn * lift}, ${cx2} ${to.y - sgn * lift}, `
       + `${to.x} ${to.y - sgn * (GENE_H / 2 + 2)}`,
    mx: (from.x + to.x) / 2 + bow * 0.75,
    my: (from.y + to.y) / 2,
  };
}

function drawDiagram(g, built, width) {
  const P = palette();
  const COLOUR = { F: P.accent, T: P.T, S: P.S, A: P.A, H: P.ink3, X: P.line };
  const { rows } = built;
  const height = PAD_TOP + rows.length * ROW_H + 8;
  const inner = Math.max(120, width - PAD_X * 2);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, width: '100%', height,
    role: 'group', 'aria-label': `Duplication layers for ${g.id}; each partner gene is a link`,
    style: 'display:block;overflow:visible',
  });

  // Every row shares ONE kilobase scale -- the widest row's span -- so a 40 kb tandem array
  // and a 300 kb WGD neighborhood are not silently drawn the same width. Rows narrower
  // than the widest are centred, exactly as the manuscript figure does it.
  const widest = Math.max(...rows.map((r) => r.hi - r.lo), 1);
  const at = (r, bp) => {
    const off = (widest - (r.hi - r.lo)) / 2;
    return PAD_X + ((bp - r.lo + off) / widest) * inner;
  };
  // 48 px of headroom above every track: a same-row arc rises at most 24, its dS pill adds
  // ~8, and the row label needs 14 above that. Measured against the rendered card, not guessed.
  const yOf = (i) => PAD_TOP + i * ROW_H + 48;

  const anchors = new Map();
  const labelNodes = [];
  const kbNodes = [];
  const links = [];
  const movables = [];
  const pills = [];
  let suppressed = 0;
  let dropped = 0;
  // Three layers, and the order is load-bearing twice over. VISUALLY the arcs belong behind
  // the genes. For POINTER PURPOSES the things you grab must be in front of everything, or
  // the genes' own 24 px tap rectangles swallow the press and nothing drags -- which is
  // exactly what happened the first time this was driven. So the arc strokes stay at the
  // bottom and their invisible grab twins, plus the dS labels, go in a top layer.
  const arcs = svgEl('g');
  const marks = svgEl('g');
  const handles = svgEl('g');
  svg.append(arcs, marks, handles);

  rows.forEach((r, i) => {
    const y = yOf(i);
    marks.append(svgEl('line', { x1: PAD_X, y1: y, x2: width - PAD_X, y2: y,
      stroke: P.line, 'stroke-width': 1 }));
    const labNode = svgEl('text', { x: PAD_X, y: y - 40, fill: P.ink3,
      'font-size': 11 }, rowLabel(r, g));
    labelNodes[i] = labNode;
    marks.append(labNode);
    const kbNode = svgEl('text', { x: width - PAD_X, y: y - 40, fill: P.ink3,
      'font-size': 11, 'text-anchor': 'end' }, kb(r.hi - r.lo));
    kbNodes[i] = kbNode;
    marks.append(kbNode);

    // Which genes get a visible id. An 11-member array on a phone puts eleven 70 px labels
    // into 360 px and they render as one unreadable smear -- seen at 390 px wide, not
    // predicted. So: reserve the focal gene's label, then walk outwards placing a label only
    // where it clears the last one placed. Every gene stays clickable and keeps its
    // aria-label; the Duplication card's table lists all of them by name regardless.
    const labelled = new Set();
    {
      const cands = r.genes.filter((x) => x.layer !== 'X')
        .map((x) => ({ id: x.id, focal: !!x.focal,
                       cx: (at(r, x.start) + Math.max(at(r, x.end), at(r, x.start) + 4)) / 2,
                       w: short(x.id).length * LABEL_CH + LABEL_GAP }));
      const taken = [];
      const fits = (c) => taken.every((t) => Math.abs(t.cx - c.cx) >= (t.w + c.w) / 2);
      const focal = cands.find((c) => c.focal);
      if (focal) { taken.push(focal); labelled.add(focal.id); }
      for (const c of cands) {
        if (c.focal || !fits(c)) continue;
        taken.push(c);
        labelled.add(c.id);
      }
      if (labelled.size < cands.length) suppressed += cands.length - labelled.size;
    }

    for (const gene of r.genes) {
      const x0 = at(r, gene.start);
      const x1 = Math.max(at(r, gene.end), x0 + 4);
      const cx = (x0 + x1) / 2;
      if (gene.layer !== 'X') anchors.set(gene.id, { x: cx, y, layer: gene.layer, ds: gene.ds,
        second: !!gene.second, via: gene.via });
      const a = svgEl('a', { href: `#/gene/${gene.id}`, 'aria-label': gene.id });
      // Tap target: SC 2.5.8 wants 24 px, and a 2 kb gene on a 300 kb scale is 3 px wide.
      // A transparent 24 px rectangle carries the pointer and the focus ring; the visible
      // bar keeps the gene's TRUE width so the drawing does not lie about size.
      a.append(svgEl('rect', { x: cx - 12, y: y - 12, width: 24, height: 24,
        fill: 'transparent' }));
      a.append(svgEl('rect', {
        x: x0, y: y - (gene.layer === 'X' ? 7 : GENE_H) / 2,
        width: x1 - x0, height: gene.layer === 'X' ? 7 : GENE_H, rx: 2,
        fill: COLOUR[gene.layer] || P.ink3,
        stroke: gene.focal ? P.ink : 'none', 'stroke-width': gene.focal ? 1.6 : 0,
      }));
      if (labelled.has(gene.id)) a.append(svgEl('text', {
        x: cx, y: y + GENE_H / 2 + 13, 'text-anchor': 'middle',
        'font-size': 10.5, fill: gene.focal ? P.ink : P.ink3,
        'font-weight': gene.focal ? 600 : 400,
        'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }, short(gene.id)));
      marks.append(a);
    }
  });

  // Arcs. A FIRST-ORDER link leaves the focal gene; a SECOND-ORDER link leaves the array
  // member it actually belongs to, because it is that member's WGD partner and not this
  // gene's. Drawing it from the focal gene would be the one misreading this feature must not
  // cause. Drawn first (behind the genes), in layer order.
  if (anchors.get(g.id)) {
    for (const [id, a] of anchors) {
      if (id === g.id) continue;
      const from = anchors.get(a.second ? a.via : g.id) || anchors.get(g.id);
      const dy = a.y - from.y;
      const { d, mx, my } = arcPath(from, a, 0);
      const spec = { from, to: a, sameRow: dy === 0, bow: 0, layer: a.layer, second: a.second };
      const path = svgEl('path', {
        d, fill: 'none', stroke: COLOUR[a.layer] || P.ink3,
        // Second-order links are thinner and paler on purpose: same colour, because it is the
        // same event, but visibly subordinate, because it is not this gene's partner.
        'stroke-width': a.second ? 1.0 : 1.6,
        'stroke-opacity': a.second ? 0.45 : 0.85,
        'stroke-dasharray': a.layer === 'H' ? '4 3' : (a.second ? '2 2' : null),
      });
      spec.node = path;
      // A wide transparent twin carries the pointer: a 1 px stroke is impossible to grab,
      // and a 14 px invisible one is grabbable without changing what is drawn.
      const grab = svgEl('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14,
        style: 'cursor:ns-resize;touch-action:none' });
      spec.grab = grab;
      links.push(spec);
      arcs.append(path);
      handles.append(grab);
      if (a.ds != null) {
        const label = `dS ${a.ds < 0.1 ? a.ds.toFixed(3) : a.ds.toFixed(2)}`;
        const row = rows.findIndex((_, ri) => yOf(ri) === a.y);
        // WHERE A dS SITS DECIDES WHICH LINK A READER THINKS IT BELONGS TO, and the arc
        // midpoint is the wrong answer for a cross-row link: on a gene with a salicoid and a
        // gamma partner the gamma value landed just above the SALICOID track, which is worse
        // than not showing it. A cross-row dS now sits directly above the partner gene it
        // describes; only a same-row (tandem) arc keeps the apex, where its two ends are the
        // only genes it could refer to.
        pills.push(dy === 0
          ? { mx, my, label, layer: a.layer, w: label.length * 5.6 + 8, row, own: row }
          : { mx: a.x, my: a.y - GENE_H / 2 - 11, label, layer: a.layer,
              w: label.length * 5.6 + 8, row, own: row });
      }
    }
  }

  // Links between two PARTNERS (the third side of the triangle). Same geometry, but the arc
  // leaves one partner and lands on the other, and neither end is the focal gene.
  for (const e of (built.between || [])) {
    const from = anchors.get(e.a);
    const to = anchors.get(e.b);
    if (!from || !to) continue;
    const { d, mx, my } = arcPath(from, to, 0);
    const spec = { from, to, sameRow: from.y === to.y, bow: 0, layer: e.layer, second: true };
    const path = svgEl('path', {
      d, fill: 'none', stroke: COLOUR[e.layer] || P.ink3,
      'stroke-width': 1.2, 'stroke-opacity': 0.6, 'stroke-dasharray': '5 3',
    });
    const grab = svgEl('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14,
      style: 'cursor:ns-resize;touch-action:none' });
    spec.node = path; spec.grab = grab;
    links.push(spec);
    arcs.append(path);
    handles.append(grab);
    if (e.ds != null) {
      // On its own arc, NOT above the target gene. Both the focal gene's gamma link and this
      // one can land on the same partner, and two pills stacked over one gene say nothing
      // about which arc each belongs to -- seen on the Fuzzy MYB locus, where dS 1.21 and
      // dS 1.03 sat one above the other on 17G070400.
      const label = `dS ${e.ds < 0.1 ? e.ds.toFixed(3) : e.ds.toFixed(2)}`;
      const row = rows.findIndex((_, ri) => yOf(ri) === to.y);
      pills.push({ mx, my, label, layer: e.layer, w: label.length * 5.6 + 8, row, own: -1 });
    }
  }

  // Pills are placed in ONE pass, after every arc is known, because two things can collide
  // and neither is visible from inside the arc loop: a pill whose arc spans two rows lands on
  // the row in between (on its gene bars and its label), and at narrow widths two arcs
  // converge until their pills overlap each other. Both were seen on a 390 px render, not
  // predicted. Each pill is pushed vertically to the nearest position clear of every track
  // band and every pill already placed; if no such position exists within a few steps the
  // pill is DROPPED rather than drawn on top of something -- the dS is still in the
  // Duplication card's table, so nothing is lost but the annotation.
  const BAND = GENE_H + 12;          // track line plus its gene bars and id label
  // Obstacles are RECTANGLES, not y-bands. Testing y alone pushed every pill out of the track
  // strip and straight onto the row label above it, because that label was invisible to the
  // test -- and a row label only occupies the left end of its row, so a pill in the middle of
  // the card never actually conflicts with it. Both row label and kb label get a real extent.
  const TEXT_CH = 5.9;               // px per character at 11px in the UI face
  const obstacles = [];
  rows.forEach((r, ri) => {
    const ry = yOf(ri);
    // `row` marks which track this band belongs to, so a pill deliberately parked above its
    // own partner is not treated as colliding with that partner's track.
    obstacles.push({ row: ri, x0: -Infinity, x1: Infinity, y0: ry - BAND, y1: ry + BAND });
    const lab = rowLabel(r, g);
    obstacles.push({ x0: PAD_X - 4, x1: PAD_X + lab.length * TEXT_CH + 4,
                     y0: ry - 52, y1: ry - 34 });
    const rlab = kb(r.hi - r.lo);
    obstacles.push({ x0: width - PAD_X - rlab.length * TEXT_CH - 4, x1: width - PAD_X + 4,
                     y0: ry - 52, y1: ry - 34 });
  });
  const placedPills = [];
  const clash = (mx, my, w, own) =>
    obstacles.some((o) => o.row !== own
      && mx + w / 2 > o.x0 && mx - w / 2 < o.x1 && my + 8 > o.y0 && my - 8 < o.y1)
    || placedPills.some((q) => Math.abs(q.my - my) < 17
                            && Math.abs(q.mx - mx) < (q.w + w) / 2 + 3);
  for (const pill of pills) {
    let my = pill.my;
    let ok = !clash(pill.mx, my, pill.w, pill.own);
    for (let k = 1; !ok && k <= 5; k += 1) {
      for (const dir of [-1, 1]) {
        const cand = pill.my + dir * k * 17;
        if (cand < 10 || cand > height - 10) continue;
        if (!clash(pill.mx, cand, pill.w, pill.own)) { my = cand; ok = true; break; }
      }
    }
    if (!ok) {
      // No clear space for the pill. DO NOT drop the number -- on a phone that discarded
      // every dS on the card. Append it to the label of the row the link lands on, where
      // there is always room and where it is still unambiguously attached to that partner.
      dropped += 1;
      const node = labelNodes[pill.row];
      if (node) node.textContent += ` · ${pill.label}`;
      continue;
    }
    placedPills.push({ mx: pill.mx, my, w: pill.w });
    // Each pill is its own <g> so a drag is one transform, and focusable so it can be moved
    // from the keyboard as well -- WCAG 2.2 SC 2.5.7 wants every dragging movement to have a
    // single-pointer or keyboard alternative, and this one is pure convenience, not essential.
    const grp = svgEl('g', {
      tabindex: 0, role: 'button',
      'aria-label': `${pill.label}. Drag, or use the arrow keys, to move this label`,
      style: 'cursor:grab;touch-action:none',
    });
    grp.append(
      svgEl('rect', { x: pill.mx - pill.w / 2, y: my - 8, width: pill.w, height: 15,
        rx: 3, fill: P.panel, stroke: COLOUR[pill.layer] || P.ink3, 'stroke-opacity': 0.35 }),
      svgEl('text', { x: pill.mx, y: my + 3.5, 'text-anchor': 'middle',
        'font-size': 10.5, fill: P.ink }, pill.label));
    movables.push({ node: grp, dx: 0, dy: 0 });
    handles.append(grp);
  }
  // A row heading that absorbed a dS can grow into the span figure at the right-hand end.
  // The span is the secondary number here -- it is stated again in the Locus card -- so it
  // is the one that goes, rather than letting two labels overprint each other.
  labelNodes.forEach((node, i) => {
    if (!node || !kbNodes[i]) return;
    const labEnd = PAD_X + node.textContent.length * 5.9;
    const kbStart = width - PAD_X - kbNodes[i].textContent.length * 5.9;
    if (labEnd + 8 > kbStart) kbNodes[i].remove();
  });
  // ---- let the reader move anything that is in the way -------------------------------
  //
  // Nothing here changes a number or which two genes a link joins. A pill slides; an arc
  // only bends, because its ends stay pinned to the genes it connects -- an arc that could be
  // dragged off its endpoints would be a drawing that lies about what is duplicated.
  const svgPoint = (ev) => {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { x: (ev.clientX - r.left) * (vb.width / r.width),
             y: (ev.clientY - r.top) * (vb.height / r.height) };
  };
  for (const m of movables) {
    let origin = null;
    const apply = () => m.node.setAttribute('transform', `translate(${m.dx} ${m.dy})`);
    m.node.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const p0 = svgPoint(ev);
      origin = { x: p0.x - m.dx, y: p0.y - m.dy };
      m.node.setPointerCapture(ev.pointerId);
      m.node.style.cursor = 'grabbing';
    });
    m.node.addEventListener('pointermove', (ev) => {
      if (!origin) return;
      const p1 = svgPoint(ev);
      m.dx = p1.x - origin.x;
      m.dy = p1.y - origin.y;
      apply();
    });
    const end = (ev) => {
      if (!origin) return;
      origin = null;
      m.node.style.cursor = 'grab';
      try { m.node.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    };
    m.node.addEventListener('pointerup', end);
    m.node.addEventListener('pointercancel', end);
    m.node.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 12 : 4;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                      ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[ev.key]) {
        m.dx += moves[ev.key][0];
        m.dy += moves[ev.key][1];
        apply();
        ev.preventDefault();
      } else if (ev.key === 'Escape' || ev.key === '0') {
        m.dx = 0; m.dy = 0; apply(); ev.preventDefault();
      }
    });
  }
  for (const L of links) {
    let start = null;
    const redraw = () => {
      const { d } = arcPath(L.from, L.to, L.bow);
      L.node.setAttribute('d', d);
      L.grab.setAttribute('d', d);
    };
    L.grab.setAttribute('tabindex', '0');
    L.grab.setAttribute('role', 'button');
    L.grab.setAttribute('aria-label',
      'Duplication link. Drag, or use the left and right arrow keys, to bend it out of the way');
    // Sideways for a cross-row arc (it bends around what it covers), vertically for a
    // same-row one (it is a bow over a track, so height is the only thing that means anything).
    const axis = (p, s0) => (L.sameRow ? -(p.y - s0.y) : (p.x - s0.x));
    L.grab.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const p0 = svgPoint(ev);
      start = { x: p0.x, y: p0.y, bow: L.bow };
      L.grab.setPointerCapture(ev.pointerId);
    });
    L.grab.addEventListener('pointermove', (ev) => {
      if (!start) return;
      L.bow = start.bow + axis(svgPoint(ev), start);
      redraw();
    });
    const end = (ev) => {
      if (!start) return;
      start = null;
      try { L.grab.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    };
    L.grab.addEventListener('pointerup', end);
    L.grab.addEventListener('pointercancel', end);
    L.grab.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 24 : 8;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { L.bow -= step; redraw(); ev.preventDefault(); }
      else if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { L.bow += step; redraw(); ev.preventDefault(); }
      else if (ev.key === 'Escape' || ev.key === '0') { L.bow = 0; redraw(); ev.preventDefault(); }
    });
  }
  svg.resetLayout = () => {
    for (const m of movables) { m.dx = 0; m.dy = 0; m.node.removeAttribute('transform'); }
    for (const L of links) {
      L.bow = 0;
      const { d } = arcPath(L.from, L.to, 0);
      L.node.setAttribute('d', d);
      L.grab.setAttribute('d', d);
    }
  };
  return { svg, suppressed, dropped };
}

function legend(built, g) {
  const P = palette();
  const seen = new Set(built.rows.map((r) => r.layer));
  const LEG = { F: P.accent, T: P.T, S: P.S, A: P.A, H: P.ink3, X: P.line };
  const items = ['F', 'T', 'H', 'S', 'A'].filter((k) => seen.has(k)).map((k) => el('span',
    { style: 'display:inline-flex;align-items:center;gap:5px;margin-right:14px' },
    el('span', { style: `width:14px;height:10px;border-radius:2px;display:inline-block;background:${LEG[k]}` }),
    el('span', {}, LAYER[k].full)));
  if (built.rows.some((r) => r.context)) {
    items.push(el('span', { style: 'display:inline-flex;align-items:center;gap:5px;margin-right:14px' },
      el('span', { style: `width:14px;height:5px;border-radius:2px;display:inline-block;background:${P.line}` }),
      el('span', {}, 'neighboring gene, for position only')));
  }
  return el('p', { class: 'muted', style: 'font-size:11.5px;margin:8px 0 0' }, ...items);
}

function caption(built, g, suppressed, dropped) {
  const bits = [];
  if (built.rows.some((r) => r.layer === 'T') && built.rows.some((r) => r.layer === 'S' || r.layer === 'A')) {
    bits.push('Rows run from tandem to aWGT, but tandem copies can be of any age, including older '
      + 'than the sWGD, so the row order is not a timeline for them.');
  }
  if (built.memTotal) {
    bits.push(`${built.tdScored} of the ${built.tdShown} tandem link${built.tdShown === 1 ? '' : 's'} drawn `
      + 'carr' + (built.tdScored === 1 ? 'ies' : 'y') + ' a per-pair dS; the rest were never scored as a pair '
      + '(the array is listed member-by-member, the dS table holds detected edges). A link '
      + 'without a number is not a link between identical copies.');
  }
  if ((g.td || {}).ks != null) {
    bits.push(`The array’s MEDIAN dS is ${g.td.ks.toFixed(3)}, a property of the array, not of any link here.`);
  }
  if (g.allele && built.rows.some((r) => r.key === 'H')) {
    bits.push('The long-dashed grey link is the same gene on the other haplotype, not a duplication.');
  }
  // The third side of the triangle. Gamma came first, so this gene's salicoid sister and its
  // gamma copy are a gamma pair in their own right; drawing only the focal gene's links showed
  // a star and hid the history that makes the locus worth looking at.
  if (built.between && built.between.length) {
    const n = built.between.length;
    bits.push(`${n} dashed link${n === 1 ? '' : 's'} join${n === 1 ? 's' : ''} two PARTNERS `
      + 'rather than this gene: aWGT came first, so this gene\u2019s sWGD sister and its '
      + 'aWGT copy are themselves an aWGT pair. Each is drawn only where the anchor table '
      + 'carries that pair, with that pair\u2019s own dS, never inferred from the other two.');
  }
  // The whole-array history, stated as the array's. The distinction carried here is the
  // point of the feature: the array went through the event, this copy did not retain a
  // partner for it, and those are different facts.
  if (built.second.length) {
    const names = (ks) => ks.map((k) => LAYER[k].label).join(' and ');
    bits.push(`Thin dotted links are second order: they are the WGD partners of this gene's `
      + `ARRAY MEMBERS, not of this gene, and each one starts at the member it belongs to.`);
    if (built.novelEvents.length) {
      const orNames = built.novelEvents.map((k) => LAYER[k].label).join(' or ');
      bits.push(`Other members of this array retain a ${names(built.novelEvents)} partner, but this `
        + `gene retains no ${orNames} partner of its own, so its duplication class above does not `
        + `name ${built.novelEvents.length > 1 ? 'them' : 'it'}. The class is a property of this gene alone.`);
    }
    const mirrored = built.second.filter((x) => x.mirrored).length;
    if (mirrored) {
      bits.push(`${mirrored} of those partners ${mirrored === 1 ? 'is' : 'are'} in a tandem `
        + 'array too, so the array itself appears to have been duplicated and both copies then '
        + 'expanded.');
    }
  }
  // Suppressed labels are counted out loud. A gene silently losing its name in a dense array
  // is the same class of problem as a row silently leaving the heatmap: the reader cannot tell
  // an omission from an absence. Every gene here is still a link and still in the table below.
  if (suppressed) {
    bits.push(`${suppressed} gene name${suppressed === 1 ? ' is' : 's are'} not printed at this `
      + 'width because the labels would overlap; those genes are still links, and the '
      + 'Duplication card below names every one of them.');
  }
  if (dropped) {
    bits.push(`${dropped} dS value${dropped === 1 ? '' : 's'} had no clear space beside `
      + `${dropped === 1 ? 'its' : 'their'} link at this width, so ${dropped === 1 ? 'it is' : 'they are'} `
      + 'printed in the row heading instead.');
  }
  if (built.notes.length) bits.push(built.notes.join('; ') + '.');
  return el('p', { class: 'muted', style: 'font-size:11.5px;margin:8px 0 0' }, bits.join(' '));
}

/** The same gene's counterpart on the other haplotype, for the side-by-side comparison.
 *
 *  `g.allele` first -- a curated 1-to-1 call is the best answer when it exists. But the cases
 *  worth comparing most often have NO allele: a tandem array that expanded on one haplotype
 *  frequently has no 1-to-1 partner at all, which is exactly why its architecture differs.
 *  So fall back to the homology family and pick the member on the other haplotype that is the
 *  same KIND of thing: same chromosome first, then tandem, then the largest array. Fuzzy MYB
 *  resolves this way -- PtXaTreH.08G070200 (allele null) to PtXaAlbH.08G073700 (allele null),
 *  both family F10956 -- which no allele-driven lookup could reach.
 */
async function counterpartGene(g) {
  if (g.allele && g.allele.id) {
    const via = await getGene(g.allele.id);
    if (via) return { gene: via, how: 'its allele', heuristic: false };
  }
  if (!g.fam) return null;
  const fams = await loadFamilies().catch(() => null);
  const members = fams && fams[g.fam];
  if (!members) return null;
  const otherHap = g.id.startsWith('PtXaTreH') ? 'PtXaAlbH' : 'PtXaTreH';
  const cands = members.filter((id) => id.startsWith(otherHap)).slice(0, 12);
  if (!cands.length) return null;

  const recs = (await Promise.all(cands.map((id) => getGene(id).catch(() => null)))).filter(Boolean);
  if (!recs.length) return null;
  const score = (r) => {
    const td = ((r.td || {}).mem || []).length;
    return (r.chr === g.chr ? 100 : 0) + (td ? 10 : 0) + td;
  };
  recs.sort((a, b) => score(b) - score(a));
  return { gene: recs[0], heuristic: true,
    how: `a heuristic pick from the ${members.length}-member family ${g.fam} (same chromosome first, `
      + 'then the largest tandem array). It is a stand-in, not an allele, and may be a paralog' };
}

function geneCard(g) {
  const hasAny = (g.td && (g.td.mem || []).length) || (g.wgd || []).length || g.allele;
  if (!hasAny) return null;

  // Same subject as the Duplication card: every partner that card names is drawn here, in
  // position. The gene page merges the two into one card with a view switch rather than
  // running the picture and the tables as two separate cards -- see mergeViewGroups() in
  // app.js. This module still owns its own card entirely; the merge is presentational.
  const card = el('div', {
    class: 'card',
    'data-view-group': 'duplication',
    'data-view-key': 'layers',
    'data-view-label': 'Layers',
    'data-view-tag': 'three layers, kept apart',
  }, el('h2', {}, 'Duplication layers',
      el('span', { class: 'tag' }, 'three layers, kept apart')));
  const stage = el('div', { style: 'margin-top:10px' });
  const status = el('p', { class: 'muted', style: 'font-size:11.5px;margin:8px 0 0' },
    'Resolving partners…');
  card.append(stage, status);

  // Both-haplotypes mode. The allele used to occupy a row of its own to say a 1-to-1 thing;
  // the comparison actually worth drawing is the two haplotypes' ARCHITECTURES side by side,
  // because they frequently differ -- Fuzzy MYB carries four tandem copies on HAP1 and two on
  // HAP2, which no single-haplotype figure can show. Rendered as two stacked blocks (the shape
  // of the manuscript figure) rather than one diagram with twice the links: the two haplotypes
  // share no coordinate system, so a link between them would be crossing nothing meaningful.
  const modeWrap = el('div', { style: 'margin:2px 0 4px' });
  const stage2wrap = el('div', { hidden: true });
  let bothBuilt = null;

  (async () => {
    const built = await buildRows(g);
    // The guard counts GENES, not rows. A gene whose only duplicates are the other members of
    // its own tandem array produces exactly one row -- which is the commonest case on this
    // site and a perfectly good picture. Guarding on row count hid it.
    const nGenes = built.rows.reduce((n, r) => n + r.genes.length, 0);
    if (nGenes < 2) {
      status.textContent = 'No partner could be placed on the genome, so there is nothing to draw.';
      return;
    }
    // The caption's suppressed-label count is WIDTH-DEPENDENT, so it is rebuilt on every
    // redraw rather than written once: a card that says "3 names not printed" after the window
    // widened enough to print them all is a false statement about what is on screen.
    let width = 0;
    let current = null;
    const leg = legend(built, g);
    let cap = caption(built, g, 0, 0);
    // The reset is a real button, not just the Escape key: the keyboard route only reaches a
    // link or label you have already focused, and after moving several the quickest way back
    // to the drawn-as-computed layout should not be to find each one again.
    const reset = el('button', {
      style: 'font-size:11.5px;padding:2px 8px;border:1px solid var(--line-2);border-radius:5px;'
        + 'background:var(--panel-2);color:var(--ink);cursor:pointer;margin-top:8px',
      onclick: () => { if (current && current.resetLayout) current.resetLayout(); },
    }, 'Reset the layout');
    const howto = el('p', { class: 'muted', style: 'font-size:11.5px;margin:8px 0 0' },
      'Any link or dS label in the way can be moved: drag it, or focus it with Tab and use the '
      + 'arrow keys (Shift for bigger steps, Escape to put it back). A link only bends, both '
      + 'ends stay pinned to the genes they join, so moving one cannot change which genes it '
      + 'says are duplicates.');
    const render = () => {
      const w = Math.round(stage.getBoundingClientRect().width);
      if (!w || w === width) return;
      width = w;
      const { svg, suppressed, dropped } = drawDiagram(g, built, w);
      current = svg;
      stage.replaceChildren(svg);
      const next = caption(built, g, suppressed, dropped);
      cap.replaceWith(next);
      cap = next;
    };
    status.replaceWith(leg, cap, howto, reset);
    const ro = new ResizeObserver(render);
    ro.observe(stage);
    onDispose(stage, () => ro.disconnect());
    render();

    // --- the second haplotype, on request -------------------------------------------------
    {
      const hapOf = (id) => (id.startsWith('PtXaTreH') ? 'HAP1' : 'HAP2');
      const btn = el('button', {
        class: 'locus-btn', type: 'button', 'aria-expanded': 'false',
        style: 'padding:0 12px;font-size:12px',
        onclick: async () => {
          const on = stage2wrap.hidden;
          btn.setAttribute('aria-expanded', String(on));
          if (!on) { stage2wrap.hidden = true; btn.textContent = 'Compare the other haplotype'; return; }
          stage2wrap.hidden = false;
          btn.textContent = 'Hide the other haplotype';
          if (bothBuilt) return;                       // already drawn
          btn.disabled = true;
          try {
            const cp = await counterpartGene(g);
            if (!cp) throw new Error('no counterpart on the other haplotype could be identified');
            const other = cp.gene;
            const b2 = await buildRows(other);
            const n2 = b2.rows.reduce((n, r) => n + r.genes.length, 0);
            const head2 = el('p', { class: 'muted', style: 'font-size:11.5px;margin:10px 0 2px' },
              el('strong', {}, `${hapOf(other.id)} · ${other.id}`),
              `, found via ${cp.how}.`,
              n2 < 2 ? ' No partner could be placed, so there is nothing to draw here.' : '');
            const stage2 = el('div', {});
            stage2wrap.replaceChildren(head2, stage2);
            bothBuilt = { other, b2 };
            if (n2 >= 2) {
              let w2 = 0;
              const render2 = () => {
                const w = Math.round(stage2.getBoundingClientRect().width);
                if (!w || w === w2) return;
                w2 = w;
                stage2.replaceChildren(drawDiagram(other, b2, w).svg);
              };
              const ro2 = new ResizeObserver(render2);
              ro2.observe(stage2);
              onDispose(stage2, () => ro2.disconnect());
              render2();
              // The asymmetry is the finding; state it rather than leaving it to be counted.
              // Rows here are LOCI, not layers -- array members share the focal gene's row --
              // so the copy count comes from the record, not from a row lookup.
              const countTd = (rec) => 1 + (((rec.td || {}).mem) || []).length;
              const a = countTd(g), b = countTd(other);
              if (a !== b) {
                stage2wrap.append(el('p', { class: 'muted', style: 'font-size:11.5px;margin:6px 0 0' },
                  `Tandem copies differ between the two drawn loci: ${a} on ${hapOf(g.id)}, `
                  + `${b} on ${hapOf(other.id)}. A count from one haplotype is not the gene's copy number.`
                  + (cp.heuristic ? ' Because the other locus is a heuristic stand-in, this difference is indicative only.' : '')));
              }
            }
          } catch (e) {
            stage2wrap.replaceChildren(el('p', { class: 'muted', style: 'font-size:11.5px' },
              `The other haplotype could not be drawn: ${e.message}`));
          } finally { btn.disabled = false; }
        },
      }, 'Compare the other haplotype');
      modeWrap.append(btn, el('span', { class: 'muted', style: 'font-size:11.5px;margin-left:9px' },
        g.allele && g.allele.id
          ? `the same gene on the other haplotype is ${g.allele.id}`
            + (g.allele.ks != null ? `, dS ${g.allele.ks}` : '') + ', not a duplication'
          : 'this gene has no 1-to-1 allele; the other locus shown is a heuristic stand-in from its family'));
      reset.after(modeWrap, stage2wrap);
    }
  })().catch((e) => { status.textContent = `Duplication layers unavailable: ${e.message}`; });

  return card;
}

export default { id: 'duplayers', label: 'Duplication layers', geneCard };
