// A study's design, drawn: one cell per group of samples that share every varying factor, laid
// out as columns x rows, split into panels (layout spec in studydesigns.js). Each replicate is a
// dot. With a gene chosen the same drawing becomes the chart: every dot sits at that sample's
// value on one shared axis for the whole study, with the group median as a tick.
//
// Linked to the contrasts list and the sample table through a designmap hub, so pointing at a
// contrast lights up the two groups it compares, and pointing at a cell lights up its rows.
import { el, fmt } from './dom.js';
import { DESIGNS, FACTORS, FACTOR_LABEL, sampleTissue } from './studydesigns.js';
import { brush, describe, isBaseline, paintLinked } from './designmap.js';
import { contrastRows } from './contrastscore.js';

const levOf = (s, f) => (s[f] == null ? 'None' : String(s[f]));
const tidy = (v) => v.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  kids.forEach((c) => n.append(c));
  return n;
};

/** Natural order for a level when the spec gives none: controls and wild type first. */
const FIRST = ['control', 'WT', 'None'];
function orderLevels(levels, given) {
  const rest = [...levels].filter((v) => !(given || []).includes(v)).sort((a, b) => {
    const fa = FIRST.indexOf(a), fb = FIRST.indexOf(b);
    if (fa !== fb) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
    return a.localeCompare(b, 'en', { numeric: true });
  });
  return (given || []).filter((v) => levels.has(v)).concat(rest);
}

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** "Nov 7-15, 2014", "Jan 27-Feb 10, 2015", "Dec 19, 2014 - Jan 3, 2015" -> [start, end] in ms. */
export function parseDateRange(v) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?\s*-\s*(?:([A-Z][a-z]{2})\s*)?(\d{1,2}), (\d{4})$/.exec(v.trim());
  if (!m || !(m[1] in MON) || (m[4] && !(m[4] in MON))) return null;
  const y2 = +m[6], m2 = m[4] ? MON[m[4]] : MON[m[1]], m1 = MON[m[1]];
  const y1 = m[3] ? +m[3] : (m1 > m2 ? y2 - 1 : y2);
  return [Date.UTC(y1, m1, +m[2]), Date.UTC(y2, m2, +m[5])];
}

/** A validated time axis for a one-factor column layout, or null (with the reason in problems). */
function timeAxis(t, cols, colKeys, ids, samples, problems) {
  if (!t) return null;
  if (cols.length !== 1) { problems.push('time axis needs exactly one column factor'); return null; }
  const pos = new Map(), span = new Map();
  for (const k of colKeys) {
    if (t.dates) {
      const r = parseDateRange(k);
      if (!r) { problems.push(`date not parsed: ${k}`); return null; }
      const day = 86400000;
      pos.set(k, (r[0] + r[1]) / 2 / day); span.set(k, [r[0] / day, r[1] / day]);
    } else {
      if (!(k in t.at)) { problems.push(`no time for level ${k}`); return null; }
      pos.set(k, t.at[k]);
    }
  }
  const bands = [];
  if (t.bands) {
    const by = new Map();
    for (const i of ids) {
      const b = String(samples[i][t.bands] || '').replace(/_[a-z]$/, '');
      const k = String(samples[i][cols[0]]);
      if (!b || !span.has(k)) continue;
      const [s0, s1] = span.get(k);
      const cur = by.get(b) || [Infinity, -Infinity];
      by.set(b, [Math.min(cur[0], s0), Math.max(cur[1], s1)]);
    }
    for (const [name, [a, b]] of by) bands.push({ name, a, b });
    bands.sort((x, y) => x.a - y.a);
  }
  return { ...t, pos, span, bands };
}

/**
 * Groups and layout for one study. `samples` is the full 652-sample table; indices stay global.
 * Returns { groups, rows, cols, panels, factors, name(f, v), problems }.
 */
export function designOf(studyId, samples) {
  const spec = DESIGNS[studyId] || {};
  // the tissue factor reads the sampling site where the metadata lost it (studydesigns.js)
  const lev = (s, f) => (f === 'tissue_analysis' && spec.siteFromLabel ? sampleTissue(s) : levOf(s, f));
  const ids = samples.map((s, i) => (s.study === studyId ? i : -1)).filter((i) => i >= 0);
  const levels = Object.fromEntries(FACTORS.map((f) => [f, new Set(ids.map((i) => lev(samples[i], f)))]));
  const varying = FACTORS.filter((f) => levels[f].size > 1);
  const problems = [];
  const rows = spec.rows && varying.includes(spec.rows) ? spec.rows : null;
  const panels = (spec.panels || []).filter((f) => varying.includes(f) && f !== rows);
  let cols = (spec.cols || []).filter((f) => varying.includes(f) && f !== rows && !panels.includes(f));
  // An implied factor must really be fixed by the others; if not, it becomes a column.
  const implied = (spec.implied || []).filter((f) => varying.includes(f));
  for (const f of varying) {
    if (f === rows || panels.includes(f) || cols.includes(f)) continue;
    if (implied.includes(f)) {
      const by = new Map();
      for (const i of ids) {
        const k = [rows, ...panels, ...cols].map((g) => g && lev(samples[i], g)).join('|');
        if (!by.has(k)) by.set(k, new Set());
        by.get(k).add(lev(samples[i], f));
      }
      if ([...by.values()].every((s) => s.size === 1)) continue;
      problems.push(`${f} is not implied by the layout; drawn as a column`);
    }
    cols = cols.concat(f);
  }
  const order = (f) => orderLevels(levels[f], (spec.order || {})[f]);
  const names = spec.names || {};
  const name = (f, v) => {
    const n = (names[f] || {})[v];
    return n != null ? n : v === 'None' ? '' : tidy(v);
  };

  const keyOf = (i, fs) => fs.map((f) => lev(samples[i], f)).join('\u0001');
  const groups = new Map();
  for (const i of ids) {
    const k = keyOf(i, varying);
    if (!groups.has(k)) {
      groups.set(k, { key: k, ids: [], row: rows ? lev(samples[i], rows) : '', col: keyOf(i, cols),
        panel: keyOf(i, panels), levels: Object.fromEntries(varying.map((f) => [f, lev(samples[i], f)])) });
    }
    groups.get(k).ids.push(i);
  }
  // Column and panel keys in the order of their factors' levels, keeping only combinations
  // that occur, so a crossed layout shows only the cells the experiment has.
  const combos = (fs) => {
    let out = [[]];
    for (const f of fs) out = out.flatMap((p) => order(f).map((v) => [...p, v]));
    const seen = new Set(ids.map((i) => keyOf(i, fs)));
    return out.map((p) => p.join('\u0001')).filter((k) => seen.has(k));
  };
  const colKeys = combos(cols);
  const panelKeys = combos(panels);
  const rowKeys = rows ? order(rows) : [''];
  for (const g of groups.values()) g.base = g.ids.every((i) => isBaseline(samples[i]));
  const time = timeAxis(spec.time, cols, colKeys, ids, samples, problems);
  return { ids, varying, rows, cols, panels, colKeys, panelKeys, rowKeys, groups: [...groups.values()], time,
    name, problems, label: (fs, key) => key.split('\u0001').map((v, j) => name(fs[j], v)).filter(Boolean).join(', ') };
}

/** One sample, described in full: what a pointed-at dot or sample row says. */
export function sampleSelection(samples, i, vec = null, geneLabel = '') {
  const s = samples[i];
  const conds = [s.treatment, s.growth, s.additional].filter((v) => v && v !== 'None').map(tidy);
  const reads = s.reads ? `${(s.reads / 1e6).toFixed(1)} M reads` : null;
  const al = s.pct_aligned != null ? `${s.pct_aligned.toFixed(1)}% aligned` : null;
  const v = vec && vec[i] != null ? ` ${geneLabel}: ${vec[i]} TPM.` : '';
  return { key: `s:${i}`, ids: new Set([i]), label: s.label,
    text: `${s.label}: ${sampleTissue(s)}${conds.length ? ', ' + conds.join(', ') : ''}, `
      + `${s.genotype || 'genotype not given'}${isBaseline(s) ? ' (wild-type control)' : ''}. `
      + [reads, al].filter(Boolean).join(', ') + (reads || al ? '.' : '') + v };
}

/** Contrasts whose samples belong to this study. */
export const studyContrasts = (contrasts, d) => {
  const mine = new Set(d.ids);
  return (contrasts || []).filter((c) => (c.ctrl || []).length && c.ctrl.every((i) => mine.has(i))
    && (c.pert || []).every((i) => mine.has(i)));
};

const ylog = (v) => Math.log2(v + 1);
const TICKS = [0, 1, 10, 100, 1000, 10000];

/**
 * The drawing. `vec` (optional) is one gene's 652-sample vector. Subscribes to `hub`.
 */
export function designDrawing(d, samples, studies, hub, vec = null, geneLabel = '') {
  const vals = vec ? d.ids.map((i) => vec[i]).filter((v) => v != null) : [];
  const ymax = vals.length ? Math.max(ylog(Math.max(...vals)), ylog(10)) : 1;
  const H = 96, PAD = 8;
  const Y = (v) => PAD + (H - 2 * PAD) * (1 - ylog(v) / ymax);
  // Drop a tick that would print on top of the one below it (0 and 1 are 1 log2 unit apart).
  const ticks = TICKS.filter((t) => ylog(t) <= ymax + 1e-9)
    .filter((t, j, a) => j === 0 || Y(a[j - 1]) - Y(t) >= 11);
  const byKey = new Map(d.groups.map((g) => [`${g.panel}|${g.row}|${g.col}`, g]));
  const cellSel = (g) => ({ key: `grp:${g.key}`, ids: new Set(g.ids),
    label: d.varying.map((f) => d.name(f, g.levels[f])).filter(Boolean).join(', ') || 'all samples' });

  const wrap = el('div', { class: 'sd' + (vec ? ' sd-gene' : '') + (d.time ? ' sd-time' : ''), 'data-study-design': '' });

  const sampleSel = (i) => sampleSelection(samples, i, vec, geneLabel);

  /** One group: a button holding its replicate dots, or with a gene, a small dot chart. */
  function buildCell(g) {
    const n = g.ids.length;
    const cell = el('button', { type: 'button', class: 'sd-cell' + (g.base ? ' base' : ''), 'data-ids': g.ids.join(','),
      'aria-label': `${cellSel(g).label}: ${n} sample${n === 1 ? '' : 's'}` });
    const dotsOf = [];
    if (vec) {
      const svg = svgEl('svg', { viewBox: `0 0 80 ${H}`, 'aria-hidden': 'true' });
      ticks.forEach((t) => svg.append(svgEl('line', { x1: 0, x2: 80, y1: Y(t), y2: Y(t), class: 'sd-grid-line' })));
      const sorted = g.ids.map((i) => vec[i]).sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      svg.append(svgEl('line', { x1: 14, x2: 66, y1: Y(med), y2: Y(med), class: 'sd-med' }));
      g.ids.forEach((i, j) => {
        const x = n === 1 ? 40 : 18 + (44 * j) / (n - 1);
        const c = svgEl('circle', { cx: x, cy: Y(vec[i]), r: 3.6, class: 'sd-dot', 'data-i': i, 'data-v': vec[i] });
        svg.append(c); dotsOf.push([c, i]);
      });
      cell.append(svg);
    } else {
      const dots = el('span', { class: 'sd-dots' });
      g.ids.forEach((i) => { const d0 = el('i', { 'data-i': i }); dots.append(d0); dotsOf.push([d0, i]); });
      cell.append(dots, el('span', { class: 'sd-n' }, `n=${n}`));
    }
    brush(cell, hub, () => cellSel(g));
    // A dot names its own sample under a mouse; leaving it hands back to its group.
    for (const [node, i] of dotsOf) {
      node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hub.preview(sampleSel(i)); });
      node.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'mouse') return;
        if (cell.contains(e.relatedTarget)) hub.preview(cellSel(g)); else hub.end(sampleSel(i));
      });
    }
    return cell;
  }
  const axisSvg = () => {
    const ax = svgEl('svg', { class: 'sd-axis', viewBox: `0 0 34 ${H}`, 'aria-hidden': 'true' });
    ticks.forEach((t) => ax.append(svgEl('text', { x: 30, y: Y(t) + 3.5, 'text-anchor': 'end' }, fmt(t))));
    return ax;
  };

  for (const pk of d.panelKeys) {
    const panel = el('div', { class: 'sd-panel' });
    const plabel = d.panels.length ? d.label(d.panels, pk) : '';
    if (plabel) panel.append(el('h3', { class: 'sd-ptitle' }, plabel));
    const rowsHere = d.rowKeys.filter((rk) => d.colKeys.some((ck) => byKey.has(`${pk}|${rk}|${ck}`)));
    if (d.time) { panel.append(timelinePanel(pk, rowsHere)); wrap.append(panel); continue; }
    const grid = el('div', { class: 'sd-grid', role: 'group',
      'aria-label': `${plabel ? plabel + ': ' : ''}${d.colKeys.length} columns by ${d.rowKeys.length} rows`,
      style: vec ? `grid-template-columns:auto 34px repeat(${d.colKeys.length}, var(--sd-gcell))`
        : `grid-template-columns:auto repeat(${d.colKeys.length}, minmax(var(--sd-cell), 6.5em))` });
    grid.append(el('span', { class: 'sd-corner' }, d.rows ? FACTOR_LABEL[d.rows] : ''));
    if (vec) grid.append(el('span', {}));
    for (const ck of d.colKeys) grid.append(el('span', { class: 'sd-col' }, d.label(d.cols, ck) || 'all'));
    for (const rk of rowsHere) {
      grid.append(el('span', { class: 'sd-row' }, d.rows ? d.name(d.rows, rk) : ''));
      if (vec) grid.append(axisSvg());
      for (const ck of d.colKeys) {
        const g = byKey.get(`${pk}|${rk}|${ck}`);
        grid.append(g ? buildCell(g) : el('span', { class: 'sd-empty', 'aria-hidden': 'true' }));
      }
    }
    panel.append(el('div', { class: 'sd-scroll' }, grid));
    wrap.append(panel);
  }

  /** Columns placed on a time axis: one lane per row level, each group at its time point. */
  function timelinePanel(pk, rowsHere) {
    const t = d.time;
    const cellW = vec ? 76 : 64, gap = 8;
    const xs = d.colKeys.map((k) => t.pos.get(k));
    // Log of time in units of the earliest nonzero time point, so 0, 15 min and 30 min stay
    // apart while 24 h still fits.
    const res = Math.min(...xs.filter((v) => v > 0));
    const f = t.scale === 'log' ? (v) => Math.log2(v / res + 1) : (v) => v;
    const lo = Math.min(...xs.map(f)), hi = Math.max(...xs.map(f));
    // Width: enough that the two closest groups in any lane do not touch.
    let minGap = Infinity;
    for (const rk of rowsHere) {
      const here = d.colKeys.filter((ck) => byKey.has(`${pk}|${rk}|${ck}`)).map((k) => f(t.pos.get(k))).sort((a, b) => a - b);
      for (let j = 1; j < here.length; j++) minGap = Math.min(minGap, here[j] - here[j - 1]);
    }
    const span = hi - lo || 1;
    const W = Math.max(560, minGap < Infinity ? Math.ceil((span / minGap) * (cellW + gap)) + cellW : cellW + 40);
    const X = (v) => cellW / 2 + ((f(v) - lo) / span) * (W - cellW);
    const box = el('div', { class: 'sd-tl', role: 'group', style: `--sd-tlw:${W}px`,
      'aria-label': `Time course, ${t.axis}: ${d.colKeys.length} time points, ${rowsHere.length} lane${rowsHere.length === 1 ? '' : 's'}` });
    const grid = el('div', { class: 'sd-tlgrid', style: `grid-template-columns:auto${vec ? ' 34px' : ''} ${W}px` });
    // Season bands (study 17) span every lane; drawn once behind the lanes.
    const bandRow = (cls) => {
      const strip = el('div', { class: cls });
      for (const b of t.bands) {
        strip.append(el('span', { class: 'sd-band', style: `left:${X(b.a) - cellW / 2 + cellW / 2}px;width:${Math.max(4, X(b.b) - X(b.a))}px` },
          el('b', {}, b.name)));
      }
      return strip;
    };
    grid.append(el('span', { class: 'sd-corner' }, d.rows ? FACTOR_LABEL[d.rows] : ''));
    if (vec) grid.append(el('span', {}));
    grid.append(t.bands.length ? bandRow('sd-bandlabels') : el('span', {}));
    for (const rk of rowsHere) {
      grid.append(el('span', { class: 'sd-row' }, d.rows ? d.name(d.rows, rk) : ''));
      if (vec) grid.append(axisSvg());
      const lane = el('div', { class: 'sd-lane' });
      if (t.bands.length) lane.append(bandRow('sd-bands'));
      for (const ck of d.colKeys) {
        const g = byKey.get(`${pk}|${rk}|${ck}`);
        if (!g) continue;
        const c = buildCell(g);
        c.style.left = `${X(t.pos.get(ck)) - cellW / 2}px`;
        c.style.width = `${cellW}px`;
        lane.append(c);
        // A sampling window (study 17) is drawn as a bar under its group, and every group carries
        // its own time label: lanes can interleave dates a few days apart, so one shared axis
        // would print labels on top of each other, while groups in one lane never overlap.
        if (t.span.size) {
          const [a, b] = t.span.get(ck);
          lane.append(el('i', { class: 'sd-window', style: `left:${X(a)}px;width:${Math.max(2, X(b) - X(a))}px` }));
        }
        const lab = t.dates ? ck.replace(/, \d{4}/g, '').replace(/\s*-\s*/, '-') : (d.label(d.cols, ck) || ck);
        lane.append(el('span', { class: 'sd-tlab', style: `left:${X(t.pos.get(ck)) - cellW / 2}px;width:${cellW}px` }, lab));
      }
      grid.append(lane);
    }
    box.append(el('div', { class: 'sd-scroll' }, grid), el('p', { class: 'sd-taxlabel' },
      t.axis + (t.scale === 'log' ? ', spaced on a log scale' : ', spaced by calendar date')));
    return box;
  }

  const readout = el('p', { class: 'dmap-readout sd-readout', 'aria-live': 'polite' });
  const clearBtn = el('button', { type: 'button', class: 'dmap-clear', hidden: '', onclick: () => hub.clear() }, 'Clear');
  const idle = vec
    ? `Each dot is one sample's ${geneLabel} TPM (log scale, one axis for the whole study); the tick is the group median. Point at or tap a group.`
    : 'Each dot is one sample. Point at or tap a group, a comparison or a sample row.';
  wrap.append(el('div', { class: 'dmap-foot' }, readout, clearBtn));
  hub.on((sel, pinned) => {
    paintLinked(wrap, sel);
    wrap.querySelectorAll('.sd-cell').forEach((c) => {
      const ids = c.dataset.ids.split(',').map(Number);
      c.dataset.role = sel && sel.ctrl ? (ids.every((i) => sel.ctrl.has(i)) ? 'ctrl'
        : ids.every((i) => sel.pert.has(i)) ? 'pert' : '') : '';
    });
    readout.textContent = !sel ? idle : sel.text || describe(sel, samples, studies, vec ? [{ name: geneLabel, vec }] : []);
    clearBtn.hidden = !pinned;
  });
  return wrap;
}

/** The comparisons shipped for this study, each one a brushing source for its two groups. */
export function contrastList(cs, samples, hub, vec = null, d = null) {
  if (!cs.length) return null;
  const scored = vec ? new Map(contrastRows(vec, cs).map((r) => [r.id, r])) : new Map();
  // What both groups share, other than tissue (its own column): this is what tells apart two
  // rows that compare the same two levels under different conditions.
  const name = (f, v) => (d ? d.name(f, v) : v === 'None' ? '' : tidy(v));
  // A contrast label is usually one level of one factor ("500CO2"); give it the drawing's name.
  const levelName = (v) => {
    if (d) for (const f of [...d.cols, ...d.panels, d.rows].filter(Boolean)) {
      if (d.groups.some((g) => g.levels[f] === v)) return name(f, v) || tidy(v);
    }
    return tidy(v);
  };
  const within = (c) => {
    const ids = [...c.ctrl, ...c.pert];
    return ['treatment', 'growth', 'additional', 'genotype'].map((f) => {
      const vs = new Set(ids.map((i) => (samples[i][f] == null ? 'None' : String(samples[i][f]))));
      if (vs.size !== 1) return null;
      if (d && ![...d.cols, ...d.panels, d.rows].includes(f)) return null;
      return name(f, [...vs][0]);
    }).filter(Boolean).join(', ');
  };
  const showWithin = cs.some((c) => within(c));
  // A comparison whose arms span more than one tissue of the drawing pools them; say so, with
  // the per-tissue counts, rather than print one tissue and a combined n.
  const tissueOf = (c, long = false) => {
    const n = new Map();
    for (const i of c.ctrl) { const t = sampleTissue(samples[i]); n.set(t, (n.get(t) || 0) + 1); }
    if (n.size < 2) return c.tissue;
    return long ? `${[...n.keys()].join(' and ')} pooled (${[...n.values()].join(' + ')} samples per group)`
      : `${[...n.keys()].join(' + ')}, pooled`;
  };
  const rows = cs.map((c) => {
    const r = scored.get(c.id);
    const sel = { key: `con:${c.id}`, ids: new Set([...c.ctrl, ...c.pert]), ctrl: new Set(c.ctrl), pert: new Set(c.pert),
      text: `${levelName(c.pert_label)} compared with ${levelName(c.control_label)} in ${tissueOf(c, true)}`
        + `${within(c) ? ', ' + within(c) : ''}: ${c.pert.length} against ${c.ctrl.length} samples. `
        + 'The dashed group is the one it is compared with.'
        + (r ? ` This gene: log2 fold change ${r.lfc >= 0 ? '+' : '−'}${Math.abs(r.lfc).toFixed(2)}.` : '') };
    const weak = c.ctrl.length < 2 || c.pert.length < 2;
    return brush(el('tr', { tabindex: '0', 'data-ids': [...c.ctrl, ...c.pert].join(',') },
      el('td', {}, levelName(c.pert_label)), el('td', {}, levelName(c.control_label)),
      el('td', {}, tissueOf(c)), showWithin ? el('td', {}, within(c) || el('span', { class: 'muted' }, '–')) : null,
      el('td', { class: 'num' + (weak ? ' warn-n' : '') }, `${c.pert.length} vs ${c.ctrl.length}`),
      vec ? el('td', { class: 'num mono' }, r ? (r.lfc >= 0 ? '+' : '−') + Math.abs(r.lfc).toFixed(2) : '–') : null), hub, sel);
  });
  return el('div', { class: 'scroll-x sd-cscroll' }, el('table', { class: 'data sd-contrasts' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Compared'), el('th', {}, 'with'), el('th', {}, 'Tissue'), showWithin ? el('th', {}, 'Within') : null,
      el('th', { class: 'num' }, 'Samples'), vec ? el('th', { class: 'num' }, 'log2 FC') : null)),
    el('tbody', {}, ...rows)));
}
