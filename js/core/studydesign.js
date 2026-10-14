// A study's design, drawn: one cell per group of samples that share every varying factor, laid
// out as columns x rows, split into panels (layout spec in studydesigns.js). Each replicate is a
// dot. With a gene chosen the same drawing becomes the chart: every dot sits at that sample's
// value on one shared axis for the whole study, with the group median as a tick.
//
// Linked to the contrasts list and the sample table through a designmap hub, so pointing at a
// contrast lights up the two groups it compares, and pointing at a cell lights up its rows.
import { el, fmt } from './dom.js';
import { DESIGNS, FACTORS, FACTOR_LABEL } from './studydesigns.js';
import { brush, describe, isBaseline, paintLinked } from './designmap.js';
import { contrastRows } from './contrastscore.js';

const lev = (s, f) => (s[f] == null ? 'None' : String(s[f]));
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

/**
 * Groups and layout for one study. `samples` is the full 652-sample table; indices stay global.
 * Returns { groups, rows, cols, panels, factors, name(f, v), problems }.
 */
export function designOf(studyId, samples) {
  const spec = DESIGNS[studyId] || {};
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
  return { ids, varying, rows, cols, panels, colKeys, panelKeys, rowKeys, groups: [...groups.values()],
    name, problems, label: (fs, key) => key.split('\u0001').map((v, j) => name(fs[j], v)).filter(Boolean).join(', ') };
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

  const wrap = el('div', { class: 'sd' + (vec ? ' sd-gene' : ''), 'data-study-design': '' });
  for (const pk of d.panelKeys) {
    const panel = el('div', { class: 'sd-panel' });
    const plabel = d.panels.length ? d.label(d.panels, pk) : '';
    if (plabel) panel.append(el('h3', { class: 'sd-ptitle' }, plabel));
    const grid = el('div', { class: 'sd-grid', role: 'group',
      'aria-label': `${plabel ? plabel + ': ' : ''}${d.colKeys.length} columns by ${d.rowKeys.length} rows`,
      style: vec ? `grid-template-columns:auto 34px repeat(${d.colKeys.length}, var(--sd-gcell))`
        : `grid-template-columns:auto repeat(${d.colKeys.length}, minmax(var(--sd-cell), 6.5em))` });
    grid.append(el('span', { class: 'sd-corner' }, d.rows ? FACTOR_LABEL[d.rows] : ''));
    if (vec) grid.append(el('span', {}));
    for (const ck of d.colKeys) grid.append(el('span', { class: 'sd-col' }, d.label(d.cols, ck) || 'all'));
    for (const rk of d.rowKeys) {
      if (!d.colKeys.some((ck) => byKey.has(`${pk}|${rk}|${ck}`))) continue;
      grid.append(el('span', { class: 'sd-row' }, d.rows ? d.name(d.rows, rk) : ''));
      if (vec) {
        const ax = svgEl('svg', { class: 'sd-axis', viewBox: `0 0 34 ${H}`, 'aria-hidden': 'true' });
        ticks.forEach((t) => ax.append(svgEl('text', { x: 30, y: Y(t) + 3.5, 'text-anchor': 'end' }, fmt(t))));
        grid.append(ax);
      }
      for (const ck of d.colKeys) {
        const g = byKey.get(`${pk}|${rk}|${ck}`);
        if (!g) { grid.append(el('span', { class: 'sd-empty', 'aria-hidden': 'true' })); continue; }
        const n = g.ids.length;
        const cell = el('button', { type: 'button', class: 'sd-cell' + (g.base ? ' base' : ''), 'data-ids': g.ids.join(','),
          'aria-label': `${cellSel(g).label}: ${n} sample${n === 1 ? '' : 's'}` });
        if (vec) {
          const svg = svgEl('svg', { viewBox: `0 0 80 ${H}`, 'aria-hidden': 'true' });
          ticks.forEach((t) => svg.append(svgEl('line', { x1: 0, x2: 80, y1: Y(t), y2: Y(t), class: 'sd-grid-line' })));
          const xs = g.ids.map((i) => vec[i]);
          const sorted = [...xs].sort((a, b) => a - b);
          const med = sorted[Math.floor(sorted.length / 2)];
          svg.append(svgEl('line', { x1: 14, x2: 66, y1: Y(med), y2: Y(med), class: 'sd-med' }));
          g.ids.forEach((i, j) => {
            const x = n === 1 ? 40 : 18 + (44 * j) / (n - 1);
            svg.append(svgEl('circle', { cx: x, cy: Y(vec[i]), r: 3.2, class: 'sd-dot', 'data-i': i },
              svgEl('title', {}, `${samples[i].label}: ${vec[i]} TPM`)));
          });
          cell.append(svg);
        } else {
          const dots = el('span', { class: 'sd-dots' });
          g.ids.forEach((i) => dots.append(el('i', { 'data-i': i, title: samples[i].label })));
          cell.append(dots, el('span', { class: 'sd-n' }, `n=${n}`));
        }
        brush(cell, hub, () => cellSel(g));
        grid.append(cell);
      }
    }
    panel.append(el('div', { class: 'sd-scroll' }, grid));
    wrap.append(panel);
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
  const rows = cs.map((c) => {
    const r = scored.get(c.id);
    const sel = { key: `con:${c.id}`, ids: new Set([...c.ctrl, ...c.pert]), ctrl: new Set(c.ctrl), pert: new Set(c.pert),
      text: `${levelName(c.pert_label)} compared with ${levelName(c.control_label)} in ${c.tissue}`
        + `${within(c) ? ', ' + within(c) : ''}: ${c.pert.length} against ${c.ctrl.length} samples. `
        + 'The dashed group is the one it is compared with.'
        + (r ? ` This gene: log2 fold change ${r.lfc >= 0 ? '+' : '−'}${Math.abs(r.lfc).toFixed(2)}.` : '') };
    const weak = c.ctrl.length < 2 || c.pert.length < 2;
    return brush(el('tr', { tabindex: '0', 'data-ids': [...c.ctrl, ...c.pert].join(',') },
      el('td', {}, levelName(c.pert_label)), el('td', {}, levelName(c.control_label)),
      el('td', {}, c.tissue), showWithin ? el('td', {}, within(c) || el('span', { class: 'muted' }, '–')) : null,
      el('td', { class: 'num' + (weak ? ' warn-n' : '') }, `${c.pert.length} vs ${c.ctrl.length}`),
      vec ? el('td', { class: 'num mono' }, r ? (r.lfc >= 0 ? '+' : '−') + Math.abs(r.lfc).toFixed(2) : '–') : null), hub, sel);
  });
  return el('div', { class: 'scroll-x sd-cscroll' }, el('table', { class: 'data sd-contrasts' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Compared'), el('th', {}, 'with'), el('th', {}, 'Tissue'), showWithin ? el('th', {}, 'Within') : null,
      el('th', { class: 'num' }, 'Samples'), vec ? el('th', { class: 'num' }, 'log2 FC') : null)),
    el('tbody', {}, ...rows)));
}
