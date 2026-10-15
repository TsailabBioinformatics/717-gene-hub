// Module: protein — predicted disorder, ESMFold secondary structure, and mass-spec evidence
// that the predicted protein is actually translated.
//
// Two caveats are load-bearing here and are stated on every gene page rather than buried:
//   * coil fraction tracks pLDDT. A high-coil, low-pLDDT model is largely a statement about
//     model confidence, not about the protein being disordered. Reading coil as "unstructured"
//     is the single easiest mistake to make with this table.
//   * ESMFold covers 40,685 of 63,960 genes (64%). Absence is coverage, not a finding.
import { el, fmt, pct } from '../core/dom.js';
import { loadStructure } from '../core/data.js';
import { PLDDT_BANDS, plddtBand } from '../core/palette.js';
import { onDispose } from '../core/lifecycle.js';

// ---- 3D model (TODO 34) ----
// A Calpha trace, not the full-atom model: the genome's full-atom models are 2.3 GB gzipped,
// over what a static Pages site may host. 3Dmol.js is vendored and fetched only when a reader
// asks for a model, so no gene page pays ~540 KB for a viewer it does not open.
let viewerLib = null;
function load3Dmol() {
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol);
  if (!viewerLib) {
    viewerLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/3dmol/3Dmol-min.js';
      s.onload = () => (window.$3Dmol ? resolve(window.$3Dmol)
        : reject(new Error('3Dmol.js loaded but did not register')));
      s.onerror = () => { viewerLib = null; reject(new Error('could not load 3Dmol.js')); };
      document.head.append(s);
    });
  }
  return viewerLib;
}

const AA3 = {
  A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU', G: 'GLY', H: 'HIS',
  I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO', S: 'SER', T: 'THR', W: 'TRP',
  Y: 'TYR', V: 'VAL', X: 'UNK',
};
const SS_NAME = { H: 'helix', E: 'strand', '-': 'coil' };
const rj = (v, w) => String(v).padStart(w);

/** A Calpha-only PDB with pLDDT as the B-factor. No HELIX / SHEET records: 3Dmol's default
 *  cartoon draws NOTHING for a Calpha-only model (found by screenshot, 2026-09-10, after a
 *  check that only asserted a canvas existed had passed), and the 'trace' style that does
 *  draw it ignores secondary structure. The DSSP state is in the hover readout instead. */
function caPdb(m) {
  const out = [];
  for (let i = 0; i < m.n; i++) {
    const f = (v) => rj(v.toFixed(3), 8);
    out.push(`ATOM  ${rj(i + 1, 5)}  CA  ${AA3[m.seq[i]] || 'UNK'} A${rj(i + 1, 4)}    `
      + `${f(m.ca[3 * i])}${f(m.ca[3 * i + 1])}${f(m.ca[3 * i + 2])}`
      + `  1.00${rj(m.pl[i].toFixed(2), 6)}           C`);
  }
  out.push('END');
  return out.join('\n');
}

let liveViewer = null;   // one WebGL context at a time; browsers cap how many a page may hold

function bandCounts(m) {
  const c = PLDDT_BANDS.map(() => 0);
  for (let i = 0; i < m.n; i++) c[plddtBand(m.pl[i])]++;
  return c;
}

async function openModel(geneId, holder) {
  const [lib, m] = await Promise.all([load3Dmol(), loadStructure(geneId)]);
  if (!m) {
    holder.append(el('p', { class: 'muted' }, 'No 3D model is stored for this gene.'));
    return;
  }
  const counts = bandCounts(m);
  const readoutDefault = 'Drag to rotate, scroll or pinch to zoom. Hover a residue for its confidence and DSSP state.';
  const readout = el('div', { class: 'mono struct-readout' }, readoutDefault);
  const stage = el('div', { class: 'struct-stage', role: 'img',
    'aria-label': `C-alpha trace of the ESMFold model, ${m.n} residues, coloured by pLDDT` });
  holder.append(
    stage, readout,
    el('div', { class: 'struct-legend' }, ...PLDDT_BANDS.map((b, k) => el('span', { class: 'struct-key' },
      el('i', { class: 'dot', style: `background:${b.color}` }),
      `${b.label} (${b.range}) `,
      el('span', { class: 'mono' }, `${fmt(counts[k])} · ${((100 * counts[k]) / m.n).toFixed(0)}%`)))),
    el('p', { class: 'muted', style: 'margin:6px 0 0;font-size:12px' },
      `${fmt(m.n)} residues. One point per residue (the C-alpha atom), joined in chain order and `
      + "coloured by the model's own per-residue confidence, pLDDT. Side chains and helix or strand "
      + 'shapes are not drawn; hover a residue for its DSSP state, which is what the bars above '
      + 'count. Where the trace is yellow or orange the model is guessing, and the path of the '
      + 'chain there is not a prediction of shape.'));

  if (liveViewer) { try { liveViewer.clear(); } catch (_) { /* already gone */ } }
  const v = lib.createViewer(stage, { backgroundColor: 'white', backgroundAlpha: 0, antialias: true });
  liveViewer = v;
  stage.__viewer = v;   // read by scripts/check.mjs, which asserts pixels were actually drawn
  v.addModel(caPdb(m), 'pdb');
  v.setStyle({}, { cartoon: { style: 'trace', thickness: 0.5,
    colorfunc: (a) => PLDDT_BANDS[plddtBand(a.b)].color } });
  v.setHoverable({}, true,
    (a) => { readout.textContent = `${a.resn} ${a.resi} · pLDDT ${a.b.toFixed(1)} · ${SS_NAME[m.ss[a.resi - 1]]}`; },
    () => { readout.textContent = readoutDefault; });
  v.zoomTo();
  v.render();
  onDispose(holder, () => {
    try { v.clear(); } catch { /* viewer may already be gone */ }
    if (liveViewer === v) liveViewer = null;
  });
}

// The five re-searched datasets, and the species whose sample the spectra came from. Three
// of them are other Populus species, whose samples contain no 717 protein at all -- a hit
// there says the gene FAMILY is translated somewhere in Populus, not that 717's copy is.
const MS_DATASETS = {
  PXD025636: 'P. trichocarpa',
  PXD020099: 'P. tremula x tremuloides',
  PXD025418: 'P. tomentosa, xylem',
  PXD002544: 'P. x canescens',
  PXD058986: 'P. x canescens',
};

function bar(frac, color) {
  return el('div', { class: 'bartrack', style: 'height:9px' },
    el('div', { class: 'barfill', style: `width:${Math.max(frac * 100, 0)}%;background:${color}` }));
}

// ---- per-residue property curves (TODO 37) ---------------------------------------------
// The card used to show three numbers (mean disorder, three SS fractions, mean pLDDT) and a
// reader could not tell whether a low-confidence stretch and a hydrophobic stretch were the
// SAME stretch. These are drawn on one shared residue axis so overlap is visible.
//
// No new data: the structure bucket already carries per-residue pLDDT, per-residue DSSP and
// the amino-acid SEQUENCE, so hydropathy is computed here rather than stored.
//
// DELIBERATELY ABSENT: a disorder curve. Predicted disorder exists only as a per-gene mean
// on disk, so drawing it per residue would invent data. The card says so rather than leaving
// a reader to assume the tracks are exhaustive.
const KD = { I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7,
             S: -0.8, W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5,
             N: -3.5, K: -3.9, R: -4.5, X: 0 };
const SS_COLOR = { H: 'var(--c-core)', E: 'var(--c-nonsyn)', '-': 'var(--panel-2)' };

function hydropathy(seq, win = 9) {
  const h = new Float32Array(seq.length);
  const half = (win - 1) >> 1;
  for (let i = 0; i < seq.length; i++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(seq.length - 1, i + half); j++) {
      sum += KD[seq[j]] ?? 0; n++;
    }
    h[i] = sum / n;
  }
  return h;
}

function drawCurves(canvas, m, hyd) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 600;
  const H1 = 66, H2 = 66, HSS = 14, GAP = 8, PADL = 34, PADR = 6;
  const cssH = H1 + GAP + H2 + GAP + HSS + 14;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  canvas.style.height = cssH + 'px';
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, cssW, cssH);
  const plotW = cssW - PADL - PADR;
  const X = (i) => PADL + (m.n <= 1 ? 0 : (i / (m.n - 1)) * plotW);
  const axis = getComputedStyle(document.body).getPropertyValue('--line-2') || '#ccc';
  const ink3 = getComputedStyle(document.body).getPropertyValue('--ink-3') || '#888';
  c.font = '9.5px ui-monospace, monospace'; c.textAlign = 'right'; c.textBaseline = 'middle';

  // --- pLDDT, 0..100, with the 70 and 50 band edges marked --------------------------------
  const yP = (v) => GAP + H1 - (v / 100) * H1 + 0.5;
  c.strokeStyle = axis; c.lineWidth = 1;
  for (const t of [0, 50, 70, 100]) {
    c.beginPath(); c.setLineDash(t === 0 || t === 100 ? [] : [2, 3]);
    c.moveTo(PADL, yP(t)); c.lineTo(PADL + plotW, yP(t)); c.stroke();
    c.setLineDash([]); c.fillStyle = ink3; c.fillText(String(t), PADL - 4, yP(t));
  }
  for (let i = 0; i < m.n; i++) {
    c.fillStyle = PLDDT_BANDS[plddtBand(m.pl[i])].color;
    c.fillRect(X(i), yP(m.pl[i]), Math.max(plotW / m.n, 1), yP(0) - yP(m.pl[i]));
  }

  // --- hydropathy, symmetric about 0 ------------------------------------------------------
  const top2 = GAP + H1 + GAP;
  const hMax = 4.5;
  const yH = (v) => top2 + H2 / 2 - (v / hMax) * (H2 / 2) + 0.5;
  c.strokeStyle = axis;
  for (const t of [-4, 0, 4]) {
    c.beginPath(); c.setLineDash(t === 0 ? [] : [2, 3]);
    c.moveTo(PADL, yH(t)); c.lineTo(PADL + plotW, yH(t)); c.stroke();
    c.setLineDash([]); c.fillStyle = ink3; c.fillText(t > 0 ? '+4' : String(t), PADL - 4, yH(t));
  }
  c.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent') || '#2a78d6';
  c.lineWidth = 1.2; c.beginPath();
  for (let i = 0; i < m.n; i++) (i ? c.lineTo(X(i), yH(hyd[i])) : c.moveTo(X(i), yH(hyd[i])));
  c.stroke();

  // --- DSSP track -------------------------------------------------------------------------
  const ySS = top2 + H2 + GAP;
  const cs = getComputedStyle(document.body);
  const ssFill = {};
  for (const [st, v] of Object.entries(SS_COLOR)) {
    ssFill[st] = cs.getPropertyValue(v.replace('var(', '').replace(')', '')).trim() || '#ccc';
  }
  for (let i = 0; i < m.n; i++) {
    c.fillStyle = ssFill[m.ss[i]] || ssFill['-'];
    c.fillRect(X(i), ySS, Math.max(plotW / m.n, 1), HSS);
  }
  c.fillStyle = ink3; c.textAlign = 'right';
  c.fillText('DSSP', PADL - 4, ySS + HSS / 2);
  c.textAlign = 'left';
  c.fillText('1', PADL, cssH - 5);
  c.textAlign = 'right';
  c.fillText(String(m.n), PADL + plotW, cssH - 5);
  return { X, PADL, plotW };
}

async function openCurves(geneId, holder) {
  const m = await loadStructure(geneId);
  if (!m) {
    holder.append(el('p', { class: 'muted' }, 'No per-residue data for this gene.'));
    return;
  }
  const hyd = hydropathy(m.seq);
  const canvas = el('canvas', { style: 'width:100%;display:block', role: 'img',
    'aria-label': 'Per-residue tracks along the protein; the line below gives the values at a position' });
  const readout = el('div', { class: 'mono struct-readout' },
    'Hover a residue to read all three tracks at that position.');
  holder.append(canvas, readout);
  let geom = drawCurves(canvas, m, hyd);
  const onMove = (ev) => {
    const r = canvas.getBoundingClientRect();
    const i = Math.round(((ev.clientX - r.left - geom.PADL) / geom.plotW) * (m.n - 1));
    if (i < 0 || i >= m.n) { readout.textContent = ' '; return; }
    readout.textContent = `${m.seq[i]}${i + 1} · pLDDT ${m.pl[i].toFixed(1)}`
      + ` · hydropathy ${hyd[i].toFixed(2)} · ${SS_NAME[m.ss[i]] || 'coil'}`;
  };
  canvas.addEventListener('pointermove', onMove);
  const ro = new ResizeObserver(() => { geom = drawCurves(canvas, m, hyd); });
  ro.observe(canvas);
  onDispose(holder, () => ro.disconnect());
  holder.append(el('p', { class: 'muted', style: 'margin:7px 0 0;font-size:12px' },
    'Top: the model\u2019s own per-residue confidence, in AlphaFold\u2019s colours. Middle: '
    + 'Kyte\u2013Doolittle hydropathy over a 9-residue window, positive being hydrophobic. '
    + 'Bottom: the DSSP state. They share one residue axis, so a hydrophobic core that is also '
    + 'low-confidence, or a helix that is only predicted where the model is guessing, is '
    + 'visible rather than inferred. There is no disorder track: predicted disorder exists '
    + 'only as a whole-protein average in this dataset, so drawing it per residue would be '
    + 'inventing data.'));
}

function geneCard(g) {
  const p = g.prot;
  if (!p) return null;
  const kv = el('dl', { class: 'kv' });
  const add = (k, ...v) => { kv.append(el('dt', {}, k), el('dd', {}, ...v)); };

  if (p.dis != null) {
    add('Predicted disorder',
      el('span', {}, el('span', { class: 'mono' }, p.dis.toFixed(3)), ' mean · ',
        el('span', { class: 'mono' }, (p.disf * 100).toFixed(0) + '%'), ' of residues predicted disordered'));
  }

  const ss = p.ss;
  if (ss) {
    const rows = [['helix', ss.h, 'var(--c-core)'], ['strand', ss.e, 'var(--c-nonsyn)'],
                  ['coil', ss.c, 'var(--c-priv)']].filter(([, v]) => v != null);
    add('Secondary structure',
      el('div', { class: 'barchart', style: 'margin-top:2px' }, ...rows.map(([name, v, c]) =>
        el('div', { class: 'barrow', style: 'grid-template-columns:56px 1fr 44px' },
          el('span', { class: 'lbl' }, name), bar(v, c),
          el('span', { class: 'val' }, (v * 100).toFixed(0) + '%')))));
    if (ss.plddt != null) {
      add('Model confidence',
        el('span', {}, el('span', { class: 'mono' }, ss.plddt.toFixed(1)), ' mean pLDDT',
          ss.low != null ? el('span', { class: 'muted' }, ` · ${(ss.low * 100).toFixed(0)}% of residues below 70`) : null),
        ss.n ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' }, `${fmt(ss.n)} residues modelled`) : null);
    }
  }

  const ms = p.ms;
  if (ms) {
    const names = Object.keys(MS_DATASETS);
    const hit = new Set(ms.ds || []);
    const undetectable = ms.abl === 0;
    // Only the two P. x canescens datasets share 717's parentage, and even they are not the
    // 717 clone. A match only in the other three is a family-level, other-species match.
    const SAME_CROSS = ['PXD002544', 'PXD058986'];
    const sameCross = [...hit].some((k) => SAME_CROSS.includes(k));
    add('Peptide matches',
      el('div', {},
        el('div', { style: 'margin-bottom:5px' },
          ms.n
            ? el('strong', {}, `peptide match in ${ms.n} of ${ms.of} public datasets`)
            : (undetectable
                ? el('span', {}, el('span', { class: 'badge' }, 'undetectable'),
                    ' this protein has no fully-tryptic peptide in the searchable mass range, '
                    + 'so it could not have been found however abundant it is')
                : el('span', { class: 'muted' }, `no peptide match in any of ${ms.of} datasets`))),
        el('table', { class: 'data' },
          el('tbody', {}, ...names.map((k) => el('tr', {},
            el('td', { class: 'mono', style: 'font-size:11.5px' }, k),
            el('td', { class: 'muted', style: 'font-size:11.5px' }, MS_DATASETS[k]),
            el('td', {}, hit.has(k)
              ? el('span', { class: 'badge' }, el('i', { class: 'dot', style: 'background:var(--c-nonsyn)' }), 'peptide match')
              : el('span', { class: 'muted' }, 'no match')))))),
        ms.n
          ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:5px' },
              `${fmt(ms.pep)} distinct peptide${ms.pep === 1 ? '' : 's'}, `
              + `${fmt(ms.psm)} spectrum match${ms.psm === 1 ? '' : 'es'}`
              + (ms.hs != null ? `, best hyperscore ${ms.hs.toFixed(1)}` : '')
              + (ms.sp ? '. At least one peptide matches 717 proteins and no P. trichocarpa protein.'
                       : '. No peptide here is unique to 717: each also matches a P. trichocarpa protein.'))
          : null,
        ms.n
          ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px' },
              sameCross
                ? 'A peptide match, not proof that 717 makes this protein. The P. x canescens '
                  + 'datasets share 717\u2019s parentage (P. tremula x P. alba) but are not the '
                  + '717 clone, and the other datasets are other Populus species.'
                : 'Every match is in a dataset from another Populus species, so it says a protein '
                  + 'of this family is made somewhere in Populus, not that 717 makes this one.')
          : null,
        (ms.n === 1 && ms.psm === 1)
          ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px' },
              'One spectrum, in one dataset. At a 1% false-discovery rate applied across five '
              + 'searches, singletons like this are expected to occur by chance and should not '
              + 'be cited on their own.')
          : null,
        ms.tw != null
          ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px' },
              `${fmt(ms.tw)} tryptic peptide${ms.tw === 1 ? '' : 's'} fall in the searchable `
              + `range, ${fmt(ms.uq)} of them unique to this gene.`)
          : null));
  }

  // ---- HOW the peptide assignment was made (TODO 37a) ----------------------------------
  // "detected in N of 5 datasets" hid the difference between a peptide unique to this gene
  // and absent from every other species, and a peptide shared with P. trichocarpa and with
  // dozens of other 717 genes. Measured over the deepest dataset: 94.2% of peptides mapping
  // to a 717 gene are also in the trichocarpa proteome, and only 11.9% map to one gene. So
  // for most genes the honest reading is "a peptide consistent with this gene", not "this
  // gene's product was observed", and the card has to let a reader tell which they have.
  if (ms && ms.det) {
    const accs = Object.keys(ms.det).sort();
    const specific = (d) => d.u > 0 && d.o > 0;
    const anySpecific = accs.some((a) => specific(ms.det[a]));
    add('How that was assigned',
      el('div', {},
        el('div', { style: 'margin-bottom:6px' },
          anySpecific
            ? el('span', { class: 'badge' },
                el('i', { class: 'dot', style: 'background:var(--c-nonsyn)' }),
                'at least one peptide is specific to this gene')
            : el('span', {}, el('span', { class: 'badge' }, 'shared peptides only'),
                el('span', { class: 'muted' },
                  ' every peptide below also matches another gene, another species, or both'))),
        el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Dataset'), el('th', { class: 'num' }, 'Peptides'),
            el('th', { class: 'num' }, 'Spectra'), el('th', { class: 'num' }, 'Best score'),
            el('th', { class: 'num', title: 'peptides matching no other 717 gene' }, 'Gene-unique'),
            el('th', { class: 'num', title: 'peptides absent from the P. trichocarpa proteome' }, '717-only'))),
          el('tbody', {}, ...accs.map((a) => {
            const d = ms.det[a];
            return el('tr', {},
              el('td', { class: 'mono', style: 'font-size:11.5px' }, a),
              el('td', { class: 'num' }, fmt(d.p)),
              el('td', { class: 'num' }, fmt(d.s)),
              el('td', { class: 'num mono' }, d.h.toFixed(1)),
              el('td', { class: 'num' }, d.u ? fmt(d.u)
                : el('span', { class: 'muted' }, '0')),
              el('td', { class: 'num' }, d.o ? fmt(d.o)
                : el('span', { class: 'muted' }, '0')));
          })))),
        el('div', { style: 'margin-top:8px' },
          ...accs.flatMap((a) => (ms.det[a].t || []).slice(0, 3).map((t) => {
            const [seq, psm, hs, ngenes, only] = t;
            return el('div', { style: 'font-size:12px;margin-top:3px' },
              el('span', { class: 'mono' }, seq),
              el('span', { class: 'muted' },
                `  ${a} · ${psm} spectr${psm === 1 ? 'um' : 'a'} · score ${hs.toFixed(1)} · `),
              ngenes === 1
                ? el('span', {}, 'maps to this gene only')
                : el('span', { class: 'muted' }, `also maps to ${ngenes - 1} other 717 gene`
                    + `${ngenes === 2 ? '' : 's'}`),
              el('span', { class: 'muted' }, only ? ' · not in P. trichocarpa'
                : ' · also in P. trichocarpa'));
          }))),
        el('p', { class: 'muted', style: 'font-size:11.5px;margin:8px 0 0' },
          'A shared peptide is not a failed measurement. It is consistent with some member of '
          + 'the protein family being translated, but it cannot single out this gene as the source. Across the '
          + 'whole atlas that is the common case: 94% of peptides matching a 717 gene are also '
          + 'in the P. trichocarpa proteome, and only 12% match exactly one 717 gene.')));
  }

  const card = el('div', { class: 'card' },
    el('h2', {}, 'Protein', el('span', { class: 'tag' }, 'predicted')), kv);

  if (p.ss) {
    const holder = el('div', { style: 'margin-top:10px' });
    const btn = el('button', { class: 'locus-btn', type: 'button', style: 'padding:0 12px' },
      'Show per-residue properties');
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Loading…';
      try { await openCurves(g.id, holder); btn.remove(); }
      catch (e) { btn.disabled = false; btn.textContent = 'Show per-residue properties';
        holder.append(el('p', { class: 'muted' }, `Could not load: ${e.message}`)); }
    });
    card.append(btn, holder);
  }

  if (ss) {
    const holder = el('div', { class: 'struct-holder' });
    const btn = el('button', {
      type: 'button', class: 'struct-open',
      onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Loading model…';
        try {
          await openModel(g.id, holder);
          e.target.remove();
        } catch (err) {
          e.target.disabled = false; e.target.textContent = 'Show 3D model';
          holder.append(el('p', { class: 'muted' }, `Could not load the model: ${err.message}`));
        }
      },
    }, 'Show 3D model');
    card.append(btn, holder);
  }

  if (ss) {
    card.append(el('div', { class: 'warn' },
      el('strong', {}, 'Coil fraction tracks model confidence. '),
      'Across all 40,685 modelled genes, coil fraction correlates with mean pLDDT at r = −0.49, '
      + 'compared with only +0.16 for helix. A high-coil, low-pLDDT model says the structure was hard '
      + 'to predict, not that the protein is unstructured. Read coil alongside the pLDDT above, '
      + 'never alone, the disorder prediction is the separate, dedicated signal.'));
  } else if (p.dis != null || ms) {
    card.append(el('p', { class: 'muted', style: 'margin:10px 0 0;font-size:12px' },
      'No ESMFold model for this gene. Structure covers 40,685 of 63,960 genes (64%), '
      + 'absence here is coverage, not a structural claim.'));
  }
  if (ms) {
    card.append(el('p', { class: 'muted', style: 'margin:8px 0 0;font-size:12px' },
      'Five public datasets of raw spectra, re-searched against a database that contains the '
      + '717 proteins, at a 1% false-discovery rate on both peptides and spectra. That is what '
      + 'makes a blank row here mean something: an earlier version of this page matched peptide '
      + 'names against tables built from another species, where a 717-specific peptide could '
      + 'never have appeared and "not detected" carried no information. Each dataset is kept '
      + 'separate (their depths differ by sixteenfold), and the 1% error rate accumulates '
      + 'across the five, so a single match in a single dataset is weak on its own. None of '
      + 'the five is from the 717 clone itself.'));
  }
  return card;
}

async function overview(man) {
  const L = man.layers || {};
  const c = L.coverage || {};
  return el('div', {},
    el('h1', {}, 'Protein'),
    el('p', { class: 'sub' },
      'What the predicted protein looks like, and whether public mass-spec data contain a '
      + 'matching peptide: disorder prediction, ESMFold secondary structure, and peptide matches.'),
    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(c['predicted disorder'])), el('div', { class: 'l' }, 'genes with disorder prediction')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(c['ESMFold structure'])), el('div', { class: 'l' }, 'with an ESMFold model (64%)')),
      el('div', { class: 'stat' }, el('div', { class: 'n' },
        fmt(((man.proteomics || {}).genes_with_a_hit || {}).hap1
            + ((man.proteomics || {}).genes_with_a_hit || {}).hap2)),
        el('div', { class: 'l' }, 'with a peptide match')),
    ),
    el('div', { class: 'card' },
      el('h2', {}, 'How to read this'),
      el('ul', { style: 'margin:0;padding-left:18px;font-size:13.5px;color:var(--ink-2);line-height:1.6' },
        el('li', {}, el('strong', {}, 'Coil fraction is largely a pLDDT proxy. '),
          'Measured on this table: r = −0.49 between coil fraction and mean pLDDT across all '
          + '40,685 modelled genes, compared with +0.16 for helix. High coil with low pLDDT means the '
          + 'model was uncertain, not that the protein is disordered.'),
        el('li', {}, el('strong', {}, 'Aggregate helix is safe; helix RUN LENGTH is not. '),
          'The source analysis states that long-run helix content is exactly what the '
          + 'low-confidence artifact inflates and should not be read as biology. This atlas '
          + 'therefore serves helix_frac only, never max_helix_run.'),
        el('li', {}, el('strong', {}, 'These are predicted structures. '),
          'No claim here is independent of ESMFold.'),
        el('li', {}, el('strong', {}, 'ESMFold coverage is 64%. '),
          'A gene without a model is not a gene without a structure.'),
        el('li', {}, el('strong', {}, 'The 3D model is a C-alpha trace, coloured by pLDDT. '),
          'One point per residue, no side chains, because the full-atom models for the genome '
          + 'are too large for this static site. Yellow and orange mean the model is guessing, '
          + 'and most of a lineage-specific gene\'s model is yellow and orange.'),
        el('li', {}, el('strong', {}, 'Peptide matches are asymmetric evidence. '),
          'A gene-unique peptide, seen in more than one spectrum in a P. x canescens dataset, is '
          + 'good evidence that a predicted protein is translated, which matters most for young, '
          + 'lineage-specific genes whose existence rests on gene prediction. A shared peptide, '
          + 'a single spectrum, or a match only in another species is much weaker. Non-detection '
          + 'is weak too: it also reflects tissue, abundance, and whether the protein yields '
          + 'observable tryptic peptides at all.'),
        el('li', {}, el('strong', {}, 'The five datasets are never pooled. '),
          'Their depths differ by sixteenfold (3,248 to 52,056 peptides), so pooling would '
          + 'let the deepest dataset silently define the answer. The 1% false-discovery rate '
          + 'also accumulates across five searches, so a single match in a single dataset is '
          + 'expected to happen by chance somewhere in the genome.'),
        el('li', {}, el('strong', {}, 'Absence has a denominator, and it is on the page. '),
          'A protein with no fully-tryptic peptide in the searchable mass range cannot be '
          + 'found however abundant it is, and that is a property of its lysine and arginine '
          + 'content and its length, and young genes differ from old ones in exactly that. '
          + `Counting such a gene as "not detected" would inflate the negative. `
          + `${fmt(((man.proteomics || {}).undetectable_by_construction || {}).hap1 || 0)} HAP1 and `
          + `${fmt(((man.proteomics || {}).undetectable_by_construction || {}).hap2 || 0)} HAP2 `
          + 'genes are undetectable this way and say so on their own page.'),
        // Numbers below are per haplotype, recomputed from the shards by
        // scripts/check_prose_numbers.py, and equal to the owning analysis's
        // aspen_detection_by_class.tsv, which ranks genes by the Idesia rerun: the pool's own
        // ranking again since C5 (2026-09-21 evening), so the numbers and the pool agree. Until
        // 2026-09-21 this line gave haplotype-pooled
        // figures ending in "0.12% of the lineage-specific pool" (2 of 1,611): the published
        // Tier 2 count before one of its two hits was withdrawn upstream on 2026-09-09. The
        // shards never carried the withdrawn hit; only this sentence did.
        el('li', {}, el('strong', {}, 'Detection falls monotonically with gene age. '),
          'Strata here are those of the genEra rerun that added Idesia, which defines the pool. '
          + 'In the deepest dataset '
          + '(PXD025636), 41.8% of HAP1 and 41.9% of HAP2 ancient genes '
          + '(PS1-2) are observed, 12.7% and 12.8% of conserved ones (PS3-12), 5.3% and 6.6% '
          + 'of rosid-level ones (PS13-15), 1.3% and 4.6% of Salicaceae-level ones (PS16-17), '
          + 'and 1 of 776 HAP1 and 0 of 835 HAP2 lineage-specific pool genes. Across all five '
          + 'datasets, 2 of 433 HAP1 and 5 of 497 HAP2 PS18 genes and 1 of 343 HAP1 and 0 of '
          + '338 HAP2 PS19 genes carry a peptide. Part of that ordering is built in: the deepest '
          + 'dataset is P. trichocarpa, where a peptide can only match a 717 gene whose sequence '
          + 'is conserved, and young genes are also shorter and less abundant. So the gradient '
          + 'is expected, and it does not show that the low detection of young genes means '
          + 'they are not translated.'),
        el('li', {}, el('strong', {}, 'Three of the five samples contain no 717 protein. '),
          'PXD025636 is P. trichocarpa, PXD020099 is P. tremula × tremuloides and PXD025418 '
          + 'is P. tomentosa. A peptide matching a 717 gene in those says the gene family is '
          + 'translated somewhere in Populus, not that this clone translates its own copy. '
          + 'PXD002544 and PXD058986 are P. × canescens, the same P. tremula × P. alba parentage '
          + 'as 717 but not the 717 clone.'))),
  );
}

export default {
  id: 'protein',
  label: 'Protein',
  geneCard,
  overview,
  filters: [
    { id: 'ms_detected', label: 'Peptide match', options: ['yes', 'no'],
      test: (g, v) => {
        const ms = g.prot && g.prot.ms;
        return ((ms && ms.n > 0) ? 'yes' : 'no') === v;
      } },
    { id: 'has_struct', label: 'Has ESMFold model', options: ['yes', 'no'],
      test: (g, v) => (g.prot && g.prot.ss ? 'yes' : 'no') === v },
  ],
};
