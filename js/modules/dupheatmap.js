// Module: duplicates across every sample. One row per duplicate of this gene, 652 columns,
// the same shape the manuscript case studies use (ms1_talk_20260918/case_studies/*_heatmap_
// 652samples.png, drawn by heatmap_helper.py): a correlation strip on the left, the expression
// matrix in the middle, a tissue colour track underneath instead of 652 unreadable labels.
//
// What it is FOR: the Duplication card can tell you a gene has six tandem copies and a
// salicoid partner, and the tissue-baseline bars can tell you what the focal gene does. Until
// now nothing put the copies side by side over the same samples, which is the only view in
// which "one copy carries the expression and the rest are quiet" is visible rather than
// inferred.
//
// THE LOW-EXPRESSION TOGGLE IS OFF BY DEFAULT, and that is a decision, not a default. A
// silent copy is the interesting result in a duplicate family, so a view that hides quiet
// rows before the reader has seen them would hide the finding. The toggle exists because a
// 20-row array of which 14 are flat is genuinely hard to read; when it is on, the control
// states the cutoff and the number of rows removed, and no row leaves without being counted.
//
// PCC PROVENANCE. The correlation shown is the value already shipped on the gene record
// (`td.mem[i][1]`, `wgd[i].r`) -- Pearson r on log2(ComBat TPM + 1) across the 652 samples.
// It is NOT recomputed here from the raw vectors the heatmap draws, because then the site
// would show two different numbers for the same pair on two cards. A blank means the pair is
// not comparable on the ComBat matrix (one partner is outside its 59,599 genes), never that
// the two are uncorrelated. The HAP1<->HAP2 allele has no shipped r and so shows none.
import { el } from '../core/dom.js';
import { getGene, loadExprSamples, loadExprVector } from '../core/data.js';
import { palette } from '../core/palette.js';
import { onDispose } from '../core/lifecycle.js';

const MAX_ROWS = 24;
const ROW_H = 22;
const LABEL_W = 190;
const PCC_W = 42;
const STRIP_H = 14;
const MAX_DPR = 2;
const TPM_CUTOFF = 1;      // stated in the toggle's own label; see the header note
const short = (id) => id.split('.')[1] || id;

// Viridis, sampled at 9 stops. Sequential and colourblind-safe (dataviz house rule); the
// hex values are the convention, so they are fixed rather than theme tokens.
const VIRIDIS = ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c',
                 '#28ae80', '#5ec962', '#addc30', '#fde725'];
const ramp = (t) => {
  const x = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const hx = (s) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16));
  const a = hx(VIRIDIS[i]), b = hx(VIRIDIS[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
};
// Diverging, centred on zero, for the correlation strip only -- a correlation has a true
// zero, which is the one case the house rules allow a diverging ramp.
const rdbu = (r) => (r >= 0
  ? `rgb(${Math.round(255 - 152 * r)},${Math.round(255 - 205 * r)},${Math.round(255 - 148 * r)})`
  : `rgb(${Math.round(255 + 52 * r)},${Math.round(255 + 145 * r)},${Math.round(255 + 76 * r)})`);

const TISSUE_COLOUR = {
  leaf_young: '#7fc97f', leaf: '#2c7a3f', leaf_old: '#16513a', xylem: '#d95f02',
  bark: '#8c564b', root: '#7570b3', stem: '#e7298a', bud: '#66a61e',
  catkin: '#e6ab02', gall: '#a6761d', callus: '#666666',
};

/** The rows, in layer order, with the role and the shipped correlation for each. */
function plan(g) {
  const rows = [{ id: g.id, role: 'focal', layer: 'this gene', r: null }];
  const seen = new Set([g.id]);
  const td = g.td || {};
  for (const m of (td.mem || [])) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    rows.push({ id: m[0], role: 'tandem', layer: 'tandem', r: m.length > 1 ? m[1] : null,
                ds: (td.pks || {})[m[0]] });
  }
  if (g.allele && !seen.has(g.allele.id)) {
    seen.add(g.allele.id);
    rows.push({ id: g.allele.id, role: 'allele', layer: 'other haplotype', r: null });
  }
  for (const e of ['S', 'A']) {
    for (const p of (g.wgd || [])) {
      if (p.e !== e || seen.has(p.id)) continue;
      seen.add(p.id);
      rows.push({ id: p.id, role: e === 'S' ? 'salicoid' : 'gamma',
                  layer: e === 'S' ? 'sWGD' : 'aWGT', r: p.r == null ? null : p.r,
                  ds: p.ks });
    }
  }
  const dropped = Math.max(0, rows.length - MAX_ROWS);
  return { rows: rows.slice(0, MAX_ROWS), dropped };
}

/** Column order: study, then tissue, then the sample's own label. Block boundaries are the
 *  study changes -- the only grouping a reader can follow without per-column text. */
function orderColumns(samples) {
  const idx = samples.map((s, i) => i);
  idx.sort((a, b) => {
    const A = samples[a], B = samples[b];
    return A.study - B.study
      || (A.tissue_analysis || A.tissue || '').localeCompare(B.tissue_analysis || B.tissue || '')
      || A.label.localeCompare(B.label);
  });
  const breaks = [];
  for (let k = 1; k < idx.length; k += 1) {
    if (samples[idx[k]].study !== samples[idx[k - 1]].study) breaks.push(k);
  }
  return { idx, breaks };
}

function draw(ctx, view, state) {
  const { dpr } = view;
  const P = palette();
  const cssW = view.w / dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.panel;
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { rows, vecs, order, samples, vmax } = state;
  const x0 = LABEL_W + PCC_W;
  const gridW = Math.max(60, cssW - x0 - 6);
  const cw = gridW / order.idx.length;

  rows.forEach((row, ri) => {
    const y = ri * ROW_H;
    const v = vecs.get(row.id);
    if (v) {
      order.idx.forEach((si, ci) => {
        ctx.fillStyle = ramp(Math.log2(v[si] + 1) / vmax);
        ctx.fillRect(x0 + ci * cw, y + 1, Math.max(cw, 0.6), ROW_H - 2);
      });
    } else {
      ctx.fillStyle = P.line;
      ctx.fillRect(x0, y + 1, gridW, ROW_H - 2);
    }
    // correlation strip
    ctx.fillStyle = row.r == null ? P.panel : rdbu(row.r);
    ctx.fillRect(LABEL_W, y + 1, PCC_W - 4, ROW_H - 2);
    if (row.r == null) {
      ctx.strokeStyle = P.line; ctx.lineWidth = 1;
      ctx.strokeRect(LABEL_W + 0.5, y + 1.5, PCC_W - 5, ROW_H - 3);
    }
    ctx.fillStyle = row.r != null && Math.abs(row.r) > 0.55 ? '#fff' : P.ink;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    // The focal row reads "self", not a dash: a dash in this column means "not comparable",
    // and a gene's correlation with itself is neither that nor a missing value.
    const rTxt = row.role === 'focal' ? 'self' : (row.r == null ? '–' : row.r.toFixed(2));
    if (row.role === 'focal') ctx.fillStyle = P.ink3;
    ctx.fillText(rTxt, LABEL_W + (PCC_W - 4) / 2, y + ROW_H / 2 + 3.5);
    // label
    ctx.textAlign = 'left';
    ctx.fillStyle = row.role === 'focal' ? P.ink : P.ink3;
    ctx.font = `${row.role === 'focal' ? '600 ' : ''}11px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillText(`${row.role === 'focal' ? '▸ ' : '  '}${short(row.id)}`, 2, y + ROW_H / 2 + 4);
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = P.ink3;
    ctx.textAlign = 'right';
    ctx.fillText(row.layer, LABEL_W - 6, y + ROW_H / 2 + 4);
  });

  // study boundaries
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 1;
  for (const k of order.breaks) {
    const x = x0 + k * cw;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rows.length * ROW_H); ctx.stroke();
  }

  // tissue track
  const ty = rows.length * ROW_H + 4;
  order.idx.forEach((si, ci) => {
    const t = samples[si].tissue_analysis || samples[si].tissue;
    ctx.fillStyle = TISSUE_COLOUR[t] || '#bbb';
    ctx.fillRect(x0 + ci * cw, ty, Math.max(cw, 0.6), STRIP_H);
  });
  ctx.fillStyle = P.ink3;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('tissue', LABEL_W - 6, ty + STRIP_H - 3);
  return { x0, cw, ty: rows.length * ROW_H };
}

/** A colour scale is not decoration here: without it the reader can see that one row is
 *  brighter than another and cannot say by how much. Ticks are TPM, the unit of the data,
 *  not the log2 the colour is computed on. */
function scaleBar(topTpm) {
  const strip = el('span', { style: 'display:inline-block;width:150px;height:10px;border-radius:2px;'
    + `background:linear-gradient(to right,${VIRIDIS.join(',')})` });
  // The bar is linear in log2(TPM + 1), so its VISUAL midpoint is not half the top TPM.
  // Printing topTpm / 4 there (the first draft) understated the low end by a factor of two.
  const mid = 2 ** (Math.log2(topTpm + 1) / 2) - 1;
  const fmtv = (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
  return el('span', { style: 'display:inline-flex;align-items:center;gap:6px;font-size:11px' },
    el('span', {}, '0'), strip, el('span', {}, `${fmtv(topTpm)} TPM`),
    el('span', { class: 'muted' }, `(the bar's midpoint is ${fmtv(mid)} TPM, it is log2, not linear)`));
}

function swatchLegend(samples, order) {
  const seen = [];
  for (const i of order.idx) {
    const t = samples[i].tissue_analysis || samples[i].tissue;
    if (t && !seen.includes(t)) seen.push(t);
  }
  return el('p', { class: 'muted', style: 'font-size:11px;margin:6px 0 0;display:flex;flex-wrap:wrap;gap:4px 12px' },
    ...seen.map((t) => el('span', { style: 'display:inline-flex;align-items:center;gap:4px' },
      el('span', { style: `width:12px;height:9px;border-radius:2px;background:${TISSUE_COLOUR[t] || '#bbb'}` }),
      el('span', {}, t))));
}

function geneCard(g) {
  const p = plan(g);
  if (p.rows.length < 2) return null;

  const card = el('div', { class: 'card' },
    el('h2', {}, 'The copies, over all 652 samples',
      el('span', { class: 'tag' }, `${p.rows.length} copies incl. this gene`)));
  const body = el('div', {});
  card.append(body);

  const load = el('button', { class: 'btn' }, 'Load the heatmap →');
  body.append(
    el('p', { class: 'muted', style: 'font-size:12px;margin:0 0 10px' },
      `This gene and ${p.rows.length - 1} of its duplicates over every sample in the atlas, `
      + 'tandem copies, the other haplotype’s allele, and the sWGD and aWGT partners. '
      + `Each row is one full 652-value profile, fetched on demand (${p.rows.length} requests).`),
    load);

  load.onclick = async () => {
    load.disabled = true;
    load.textContent = 'Loading…';
    try {
      const samples = await loadExprSamples();
      const order = orderColumns(samples);
      const recs = await Promise.all(p.rows.map((r) => (r.id === g.id ? g : getGene(r.id))));
      const vecs = new Map();
      await Promise.all(recs.map(async (rec, i) => {
        if (!rec) return;
        const v = await loadExprVector(rec);
        if (v) vecs.set(p.rows[i].id, v);
      }));
      const missing = p.rows.filter((r) => !vecs.has(r.id));

      const maxOf = (id) => {
        const v = vecs.get(id);
        return v ? Math.max(...v) : 0;
      };
      const quiet = p.rows.filter((r) => vecs.has(r.id) && maxOf(r.id) < TPM_CUTOFF);
      let hideQuiet = false;

      const state = { rows: p.rows, vecs, order, samples, vmax: 1 };
      const stage = el('div', { style: 'position:relative;margin-top:10px' });
      const canvas = el('canvas', { style: 'display:block;width:100%', role: 'img',
        'aria-label': 'Heatmap of each copy\u2019s expression across all samples' });
      stage.append(canvas);
      const ctx = canvas.getContext('2d', { alpha: false });
      let view = { w: 0, h: 0, dpr: 0 };

      const visible = () => (hideQuiet
        ? p.rows.filter((r) => r.role === 'focal' || !quiet.includes(r))
        : p.rows);

      function render() {
        state.rows = visible();
        const shown = state.rows.filter((r) => vecs.has(r.id));
        const top = Math.max(...shown.map((r) => maxOf(r.id)), 1);
        state.vmax = Math.log2(top + 1);
        const h = state.rows.length * ROW_H + 4 + STRIP_H + 2;
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const w = Math.round(stage.getBoundingClientRect().width);
        if (!w) return;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.height = h + 'px';
        view = { w: canvas.width, h: canvas.height, dpr };
        draw(ctx, view, state);
        scaleNote.replaceChildren(scaleBar(top),
          el('span', { class: 'muted', style: 'margin-left:10px' },
            'log2(TPM + 1), one scale shared by every row, so rows are comparable.'));
      }

      const scaleNote = el('p', { class: 'muted',
        style: 'font-size:11.5px;margin:8px 0 0;display:flex;align-items:center;flex-wrap:wrap;gap:4px' });
      const toggle = el('label', { style: 'display:inline-flex;align-items:center;gap:7px;font-size:12px;cursor:pointer' },
        el('input', {
          type: 'checkbox',
          onchange: (ev) => { hideQuiet = ev.target.checked; render(); },
        }),
        el('span', {}, `Hide copies that never reach ${TPM_CUTOFF} TPM in any of the 652 samples`
          + ` (${quiet.length} row${quiet.length === 1 ? '' : 's'})`));

      const notes = [];
      notes.push('Left strip is the Pearson correlation to this gene on log2(ComBat TPM + 1) '
        + 'across the same 652 samples, the same number the Duplication card shows. A dash '
        + 'means the pair is not comparable on that matrix, not that the two are uncorrelated.');
      if (missing.length) notes.push(`${missing.length} row${missing.length === 1 ? '' : 's'} `
        + 'had no expression profile and are drawn flat grey.');
      if (p.dropped) notes.push(`${p.dropped} further duplicate${p.dropped === 1 ? '' : 's'} `
        + `not drawn (capped at ${MAX_ROWS} rows).`);
      if (quiet.length) notes.push(`${quiet.length} of ${p.rows.length} copies never reach `
        + `${TPM_CUTOFF} TPM in any sample; they are shown by default because a silent copy is `
        + 'a result, not noise.');
      notes.push('Columns are grouped by study, then tissue; vertical rules are study '
        + 'boundaries. Values are raw TPM, not batch-corrected, compare within a study block.');

      body.replaceChildren(
        el('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;align-items:center' },
          quiet.length ? toggle : el('span', { class: 'muted', style: 'font-size:12px' },
            `Every copy reaches ${TPM_CUTOFF} TPM somewhere, so there is nothing to filter.`)),
        stage, scaleNote, swatchLegend(samples, order),
        el('p', { class: 'muted', style: 'font-size:11.5px;margin:8px 0 0' }, notes.join(' ')));

      const ro = new ResizeObserver(render);
      ro.observe(stage);
      onDispose(stage, () => ro.disconnect());
      render();
    } catch (e) {
      load.disabled = false;
      load.textContent = 'Load the heatmap →';
      body.append(el('p', { class: 'muted', style: 'font-size:12px' }, `Heatmap unavailable: ${e.message}`));
    }
  };
  return card;
}

export default { id: 'dupheatmap', label: 'Copies across samples', geneCard };
