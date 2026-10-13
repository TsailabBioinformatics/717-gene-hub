// Copies of a tandem array on BOTH haplotypes, drawn against one protein.
//
// A gene table can only show annotated genes. NRX1 is the case that exposed what that hides:
// seven annotated copies on HAP1, and on HAP2 one gene model laid over two separate pieces of
// sequence 5 kb apart, plus a more complete piece nobody annotated. No HAP1 copy has an
// assigned HAP2 allele, so from any HAP1 page nothing led to any of it.
//
// The copies come from a search of the genome SEQUENCE (scripts/make_copy_search_source.py),
// so the panel can draw what the annotation missed. Each copy is a row; the bar is the part of
// the reference protein that stretch of genome still encodes; a gene model spanning separate
// pieces is drawn as one bracketed row with a sub-row per piece.
//
// The panel restates no number another card owns. Positions for annotated genes are the gene
// shards' own (patch_copies.py refuses a source that disagrees), and peak TPM is read from each
// gene's record at draw time -- the same value its Expression card prints.
//
// Drawn to the container's real width, so text stays at its true size on a phone. Below 640px
// the label column folds onto its own line above each bar.
import { el, fmt } from '../core/dom.js';
import { getGene, hapLabel, loadCopies } from '../core/data.js';
import { paperHighest } from '../core/paper.js';
import { onDispose } from '../core/lifecycle.js';

const NS = 'http://www.w3.org/2000/svg';
const HAP = (h) => (h === 'hap1' ? 'HAP1' : 'HAP2');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pc = (v) => `${Math.round(v)}%`;
const tpm = (v) => (v == null ? '–' : v < 1 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : fmt(Math.round(v)));

/** Protein positions a set of segments covers (union), as a count. */
function coveredAa(segs) {
  const s = new Set();
  for (const [a, b] of segs) for (let i = a; i <= b; i++) s.add(i);
  return s.size;
}

/** Peak-tissue TPM exactly as the Expression card and the summary strip state it: mean TPM in
 *  the gene's peak tissue group over the 222-sample reference panel (the dissertation's
 *  statistic); the highest group mean where none reaches the 5 TPM floor. null where the gene
 *  has no expression record. */
function peakTpm(rec) {
  return rec ? paperHighest(rec) : null;
}

/** The sentences above the panel, generated from the rows so they cannot drift from the bars. */
function lede(L, recs) {
  const out = [];
  const other = L.hap === 'hap1' ? 'hap2' : 'hap1';
  const rows = (h) => L.rows.filter((r) => r.hap === h);
  const range = (v) => {
    const lo = Math.round(Math.min(...v)), hi = Math.round(Math.max(...v));
    return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
  };

  const own = rows(L.hap);
  const ownAnn = own.filter((r) => r.gene), ownUn = own.filter((r) => !r.gene);
  out.push(el('span', {}, el('b', {}, `${HAP(L.hap)}: ${plural(ownAnn.length, 'annotated copy', 'annotated copies')}`),
    ` covering ${range(ownAnn.map((r) => r.cov_pct))} of the protein`,
    ownUn.length ? `, and ${plural(ownUn.length, 'more', 'more')} the annotation does not call `
      + `(${range(ownUn.map((r) => r.cov_pct))})` : '', '. '));

  const oth = rows(other);
  if (!oth.length) {
    out.push(el('span', {}, el('b', {}, `${HAP(other)}: nothing found`), ' in the syntenic region. '));
  } else {
    const pieces = oth.flatMap((r) => r.pieces.map((p) => ({ r, p, aa: coveredAa(p.segs) })));
    const lo = Math.min(...oth.map((r) => r.start)), hi = Math.max(...oth.map((r) => r.end));
    const best = pieces.reduce((a, b) => (b.aa > a.aa ? b : a));
    out.push(el('span', {}, el('b', {}, `${HAP(other)}: ${plural(pieces.length, 'piece', 'pieces')} of sequence`),
      ` within ${((hi - lo) / 1000).toFixed(0)} kb, the longest covering `,
      `${Math.round((100 * best.aa) / L.reference.aa)}% of the protein. `));
    const fused = oth.filter((r) => r.gene && r.pieces.length > 1);
    const un = oth.filter((r) => !r.gene);
    if (fused.length) {
      out.push(el('span', {}, `The annotation lays ${plural(fused.length, 'gene model', 'gene models')} over `
        + `${fused.map((r) => r.pieces.length).join(' and ')} separate pieces`,
        un.length ? `, and does not call ${best.r.gene ? plural(un.length, 'other piece', 'other pieces')
          : 'the most complete piece'} at all` : '', '. '));
    } else if (un.length) {
      out.push(el('span', {}, `${plural(un.length, 'piece is', 'pieces are')} not annotated as a gene. `));
    }
  }

  // Why the panel is needed at all: the allele map's view of the array.
  const members = L.array.map((id) => recs.get(id)).filter(Boolean);
  const paired = members.filter((g) => g.allele && g.allele.id).length;
  if (members.length === L.array.length) {
    out.push(el('span', {}, paired === 0
      ? `None of the ${members.length} ${HAP(L.hap)} copies has an assigned ${HAP(other)} allele, `
        + `which is why no ${HAP(L.hap)} gene page led to these pieces before this panel.`
      : `${paired} of the ${members.length} ${HAP(L.hap)} copies ${paired === 1 ? 'has' : 'have'} an `
        + `assigned ${HAP(other)} allele.`));
  }
  return el('p', { class: 'cp-lede' }, ...out);
}

/** Draw the panel into `holder` at its current width. */
function draw(holder, L, recs, focalId) {
  const W = Math.max(300, Math.floor(holder.clientWidth));
  const narrow = W < 640;
  const svg = document.createElementNS(NS, 'svg');
  const add = (parent, tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    parent.appendChild(n);
    return n;
  };

  // columns. Wide: label | protein | covers, identity, peak TPM. Narrow: labels move above bars.
  const LBL = narrow ? 0 : 196;
  const X0 = LBL + 26;
  const X1 = narrow ? W - 8 : W - 196;
  // the last column stops short of W so a value never touches a dashed row outline
  const COL = narrow ? null : { cov: W - 140, pid: W - 78, tpm: W - 12 };
  const aaX = (aa) => X0 + ((aa - 1) / (L.reference.aa - 1)) * (X1 - X0);

  // ---- ruler
  let y = 16;
  add(svg, 'text', { x: narrow ? 8 : 8, y: y, class: 'cp-head' },
    `${L.name} protein, ${L.reference.aa} aa`);
  if (!narrow) {
    add(svg, 'text', { x: COL.cov, y, class: 'cp-head', 'text-anchor': 'end' }, 'covers');
    add(svg, 'text', { x: COL.pid, y, class: 'cp-head', 'text-anchor': 'end' }, 'identity');
    add(svg, 'text', { x: COL.tpm, y, class: 'cp-head', 'text-anchor': 'end' }, 'peak TPM');
  } else {
    add(svg, 'text', { x: W - 8, y, class: 'cp-head', 'text-anchor': 'end' }, 'covers · identity · TPM');
  }
  y += 12;
  add(svg, 'line', { x1: X0, x2: X1, y1: y, y2: y, class: 'cp-axis' });
  const step = L.reference.aa > 400 ? 100 : 50;
  const ticks = [];
  for (let t = step; t < L.reference.aa - step / 2; t += step) ticks.push(t);
  for (const t of [1, ...ticks, L.reference.aa]) {
    add(svg, 'line', { x1: aaX(t), x2: aaX(t), y1: y, y2: y + 4, class: 'cp-axis' });
    if (narrow && t !== 1 && t !== L.reference.aa && t % 200) continue;
    add(svg, 'text', { x: aaX(t), y: y + 15, class: 'cp-tick',
      'text-anchor': t === 1 ? 'start' : t === L.reference.aa ? 'end' : 'middle' }, String(t));
  }
  y += 30;

  // ---- one row per copy
  const stats = (r, top, pidText) => {
    const p = r.gene ? peakTpm(recs.get(r.gene)) : null;
    const tpmText = r.gene ? (p ? tpm(p.v) : 'n/a') : '–';
    // data-tpm-for names the gene whose peak TPM the element ends with, so a check can hold
    // it equal to the number the same gene's summary strip prints.
    if (narrow) {
      add(svg, 'text', { x: W - 12, y: top + 12, class: 'cp-stat', 'text-anchor': 'end',
        'data-tpm-for': r.gene }, `${pc(r.cov_pct)} · ${pidText} · ${tpmText}`);
    } else {
      add(svg, 'text', { x: COL.cov, y: top + 12, class: 'cp-stat', 'text-anchor': 'end' }, pc(r.cov_pct));
      add(svg, 'text', { x: COL.pid, y: top + 12, class: 'cp-stat2', 'text-anchor': 'end' }, pidText);
      const t = add(svg, 'text', { x: COL.tpm, y: top + 12, 'text-anchor': 'end',
        class: r.gene && p ? 'cp-stat' : 'cp-stat3', 'data-tpm-for': r.gene }, tpmText);
      if (p) add(t, 'title', {}, `mean TPM in ${p.tissue}, reference panel`);
    }
  };
  const bars = (segs, top, cls) => {
    add(svg, 'line', { x1: X0, x2: X1, y1: top + 6, y2: top + 6, class: 'cp-track' });
    for (const [a, b] of [...segs].sort((p, q) => p[0] - q[0])) {
      add(svg, 'rect', { x: aaX(a), y: top, width: Math.max(2, aaX(b) - aaX(a)), height: 12, rx: 2, class: cls });
    }
  };
  const label = (r, top) => {
    const focal = r.gene && r.gene === focalId;
    const pos = `${r.chr}:${fmt(r.start)}`;
    if (!r.gene) {
      add(svg, 'text', { x: 12, y: top + 12, class: 'cp-unann' }, 'not annotated as a gene');
    } else if (focal) {
      add(svg, 'text', { x: 12, y: top + 12, class: 'cp-id cp-focal' }, r.gene);
    } else {
      const a = add(svg, 'a', { href: `#/gene/${r.gene}`, class: 'cp-link' });
      add(a, 'text', { x: 12, y: top + 12, class: 'cp-id' }, r.gene);
    }
    // Narrow: the bar sits on the next line, so there is no room for a position here; the row
    // carries it as a tooltip, and the key below states what the highlighted row is.
    if (!narrow) add(svg, 'text', { x: 12, y: top + 26, class: 'cp-pos' }, focal ? `${pos} · this page` : pos);
  };
  const rowBox = (r, top, h) => {
    // Every box spans top-6 .. top+h-2, which clears the position line's descenders (baseline
    // top+26); rows advance by h+6, so two outlined rows in a row never touch.
    const hit = add(svg, 'rect', { x: 0, y: top - 6, width: W, height: h + 4, class: 'cp-hit' });
    add(hit, 'title', {}, `${r.gene || 'not annotated'} · ${r.chr}:${fmt(r.start)}–${fmt(r.end)} (${r.strand})`
      + ` · covers ${r.cov_pct}% of the reference · identity ${r.pid ?? '–'}%`);
    if (r.gene && r.gene === focalId) {
      add(svg, 'rect', { x: 0, y: top - 6, width: W, height: h + 4, class: 'cp-focalbg' });
      add(svg, 'rect', { x: 0, y: top - 6, width: 3, height: h + 4, class: 'cp-focalbar' });
    }
    if (!r.gene) {   // relief rule: the dashed outline never ships without its words
      add(svg, 'rect', { x: 2, y: top - 6, width: W - 4, height: h + 4, rx: 5, class: 'cp-dashed' });
    }
  };
  const note = (text, top) => add(svg, 'text', { x: X0, y: top, class: 'cp-note' }, text);

  const group = (h) => {
    const rs = L.rows.filter((r) => r.hap === h);
    const reg = L.regions[h];
    add(svg, 'text', { x: 8, y: y + 4, class: 'cp-group' }, hapLabel(h));
    const where = `${reg.chr}:${fmt(reg.start)}–${fmt(reg.end)}`;
    const what = rs.length ? `${plural(rs.filter((r) => r.gene).length, 'annotated gene', 'annotated genes')}, `
      + `${rs.filter((r) => !r.gene).length} not annotated` : 'nothing found';
    if (narrow) {   // one line would run off a phone's edge
      add(svg, 'text', { x: 8, y: y + 20, class: 'cp-groupsub' }, where);
      add(svg, 'text', { x: 8, y: y + 35, class: 'cp-groupsub' }, what);
      y += 49;
    } else {
      add(svg, 'text', { x: 8, y: y + 20, class: 'cp-groupsub' }, `${where} · ${what}`);
      y += 34;
    }
    for (const r of rs.sort((a, b) => a.start - b.start)) {
      const pidText = r.pid == null ? '–' : pc(r.pid);
      if (r.pieces.length > 1) {
        // One gene model laid over separate pieces: a sub-row per piece, bracketed as one row.
        const sub = narrow ? 20 : 20;
        const top0 = narrow ? y + 18 : y;
        const h = (narrow ? 18 : 0) + sub * r.pieces.length + 22 + 12;
        rowBox(r, y, h);
        label(r, y);
        // Wide: each piece's identity sits on its own sub-row in the identity column. Narrow:
        // one stats line per row, so it carries the row's weighted identity.
        stats(r, y, narrow ? pc(r.pid) : pc(r.pieces[0].pid));
        r.pieces.forEach((p, i) => {
          const t = top0 + i * sub;
          bars(p.segs, t, 'cp-bar');
          add(svg, 'text', { x: X0 - 8, y: t + 10, class: 'cp-piece', 'text-anchor': 'end' }, 'ABCDEFGH'[i]);
          if (!narrow && i) add(svg, 'text', { x: COL.pid, y: t + 10, class: 'cp-stat2', 'text-anchor': 'end' }, pc(p.pid));
        });
        add(svg, 'path', { d: `M ${X0 - 17} ${top0 + 1} h -4 v ${sub * (r.pieces.length - 1) + 11} h 4`,
          class: 'cp-bracket' });
        const apart = r.pieces.slice(1).map((p, i) => p.start - r.pieces[i].end);
        const kb = apart.map((d) => `${(d / 1000).toFixed(1)} kb`).join(' and ');
        note(narrow ? `one gene model, ${r.pieces.length} pieces ${kb} apart`
          : `one gene model over ${plural(r.pieces.length, 'separate piece', 'separate pieces')}, ${kb} apart`,
          top0 + sub * (r.pieces.length - 1) + 30);
        y += h + 6;
      } else {
        const top = narrow ? y + 18 : y;
        const h = (narrow ? 18 : 0) + 34;
        rowBox(r, y, h);
        label(r, y);
        stats(r, y, pidText);
        bars(r.pieces.length ? r.pieces[0].segs : [], top, 'cp-bar');
        y += h + 6;
      }
    }
  };

  const haps = [L.hap, L.hap === 'hap1' ? 'hap2' : 'hap1'];
  group(haps[0]);
  y += 6;
  add(svg, 'line', { x1: 0, x2: W, y1: y - 8, y2: y - 8, class: 'cp-rule' });
  group(haps[1]);

  svg.setAttribute('viewBox', `0 0 ${W} ${y}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', y);
  svg.setAttribute('class', 'cp-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${L.name}: every copy on both haplotypes, drawn as the part of the `
    + `${L.reference.aa} amino-acid protein each still encodes`);
  holder.replaceChildren(svg);
}

function footnotes(L) {
  const [f1, f2] = L.regions[L.hap].flanks;
  const other = L.hap === 'hap1' ? 'hap2' : 'hap1';
  const [a1, a2] = L.regions[other].flanks;
  const g = (id) => el('a', { href: `#/gene/${id}`, class: 'mono' }, id);
  return el('ul', { class: 'cp-foot' },
    el('li', {}, el('b', {}, 'Found in the sequence, not the annotation: '),
      `tblastn of the ${L.array.length} ${HAP(L.hap)} array proteins against each whole haplotype genome, `
      + 'kept inside the region between the nearest genes that have an allele: ', g(f1), ' and ', g(f2),
      ` on ${HAP(L.hap)}, and their alleles `, g(a1), ' and ', g(a2), ` on ${HAP(other)}. `
      + 'No distance was chosen.'),
    el('li', {}, el('b', {}, 'Coverage ', ), 'is measured against ', g(L.reference.id),
      ` (${L.reference.aa} aa), counting each stretch of genome once: the protein aligns to itself `
      + 'in repeated units, so without that one short stretch could count several times.'),
    el('li', {}, el('b', {}, 'Control, passed: '),
      `the search recovers all ${L.controls.array_members_recovered[1]} annotated ${HAP(L.hap)} copies. `
      + 'Without that, finding nothing else would mean nothing.'),
    el('li', {}, el('b', {}, 'Pieces: '),
      `no annotated copy here spans more than ${(L.max_span_bp / 1000).toFixed(1)} kb of genome, so `
      + 'alignments further apart than that are drawn as separate pieces.'),
    el('li', {}, el('b', {}, 'Identity reads low ', ),
      'wherever an alignment runs across an intron, because tblastn does not model introns: the '
      + `reference against its own gene reads ${pc(L.self_pid)}, not 100%. Coverage is the robust number.`),
    el('li', {}, el('b', {}, 'Peak TPM ', ),
      'is the mean TPM in the gene’s peak tissue group over the 222-sample reference panel, the number its own '
      + 'Expression card shows. A piece that is not annotated has no expression value: the expression '
      + 'index holds annotated transcripts only, so its silence is unmeasured, not measured.'));
}

/** The panel card. `focalId` is highlighted; null on the locus's own page. */
function panelCard(slug, meta, focalId) {
  const holder = el('div', { class: 'cp-holder' });
  const status = el('p', { class: 'muted', style: 'font-size:12.5px;margin:0' }, 'Loading the copies…');
  const card = el('div', { class: 'card' },
    el('h2', {}, `${meta.name} on both haplotypes`, el('span', { class: 'tag' }, 'sequence search')),
    status, holder);

  (async () => {
    const L = await loadCopies(slug);
    const ids = [...new Set([...L.rows.map((r) => r.gene).filter(Boolean), ...L.array])];
    const recs = new Map((await Promise.all(ids.map((id) => getGene(id).catch(() => null))))
      .map((g, i) => [ids[i], g]));
    status.replaceWith(el('p', { class: 'sub', style: 'margin:0 0 6px' },
      `Each row is one copy of ${meta.name} (${meta.desc}); the bar is the part of the protein that `
      + 'stretch of genome still encodes, so a truncated copy shows as missing protein.',
      focalId ? el('span', {}, ' ', el('a', { href: `#/copies/${slug}` }, 'Open on its own page →')) : null),
      lede(L, recs));
    let lastW = -1;
    const ro = new ResizeObserver(() => requestAnimationFrame(redraw));
    function redraw() {
      if (!holder.isConnected && lastW >= 0) { ro.disconnect(); return; }   // view replaced
      const w = Math.floor(holder.clientWidth);
      if (w && w !== lastW) { lastW = w; draw(holder, L, recs, focalId); }
    }
    ro.observe(holder);
    onDispose(holder, () => ro.disconnect());
    redraw();
    card.append(
      el('div', { class: 'cp-key' },
        el('span', {}, el('i', { class: 'cp-sw' }), ' protein still encoded'),
        el('span', {}, el('i', { class: 'cp-sw cp-sw-dashed' }), ' dashed outline = ', el('b', {}, 'not annotated as a gene')),
        el('span', {}, el('b', {}, 'A, B'), ' = separate pieces under one gene model'),
        focalId ? el('span', {}, el('i', { class: 'cp-sw cp-sw-focal' }), ' highlighted row = this page') : null),
      footnotes(L));
  })().catch((e) => { status.textContent = `Copies unavailable: ${e.message}`; });
  return card;
}

function geneCard(g, man) {
  const slug = man && man.copies && man.copies.genes && man.copies.genes[g.id];
  if (!slug) return null;
  return panelCard(slug, man.copies.loci[slug], g.id);
}

/** #/copies/<slug>: the panel on its own, for linking. */
export async function copiesView(slug, man) {
  const meta = man && man.copies && man.copies.loci && man.copies.loci[slug];
  if (!meta) {
    return el('div', { class: 'empty' }, el('h2', {}, 'No such copy search'),
      el('p', { class: 'mono' }, slug),
      el('p', { class: 'muted' }, 'Searched so far: ',
        ...Object.keys((man && man.copies && man.copies.loci) || {}).flatMap((s, i) => [
          i ? ', ' : '', el('a', { href: `#/copies/${s}` }, s)])));
  }
  return el('div', {},
    el('h1', {}, `${meta.name} (${meta.desc})`),
    el('p', { class: 'sub' }, 'Every copy found in the genome sequence, annotated or not. The same '
      + 'panel sits on the gene page of each annotated copy.'),
    panelCard(slug, meta, null));
}

export default { id: 'copies', label: 'Copies on both haplotypes', geneCard };
