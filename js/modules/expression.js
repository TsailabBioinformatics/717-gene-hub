// Module: expression atlas. 652 samples, 28 curated studies, kallisto k21 TPM.
// Two-level data: gene.x is a baseline SUMMARY already in the shard (free); the full
// 652-sample vector is a second fetch via loadExprVector(gene) -- see core/data.js.
import { el, clear, fmt, pct } from '../core/dom.js';
import { studyMeta } from '../core/cite.js';
import { paperExpr, PAPER_TAU_HOW, TAU_SPECIFIC } from '../core/paper.js';
import { browseHref } from '../core/browse.js';
import { loadExprSamples, loadExprStudies, loadExprVector, loadCombatVector,
  loadContrasts } from '../core/data.js';
import { linkHub, brush, designGrid, paintLinked, tissueOf } from '../core/designmap.js';
import { contrastRows } from '../core/contrastscore.js';

const TISSUE_ORDER = ['leaf_young', 'leaf', 'leaf_old', 'xylem', 'bark', 'root', 'stem', 'bud', 'catkin', 'gall', 'callus'];
const orderTissues = (keys) => TISSUE_ORDER.filter((t) => keys.includes(t)).concat(keys.filter((t) => !TISSUE_ORDER.includes(t)));

// Number of distinct studies contributing WT-control samples to each tissue, counted from
// data/expr/samples.json (genotype WT, ctrl control) on 2026-09-30. Hardcoded because the
// data layer is frozen and the sample table is a 225 kB fetch the gene page otherwise never
// needs. Regenerate if the expression release changes.
const TISSUE_STUDIES = { leaf_young: 1, leaf_old: 1, bark: 7, root: 6, xylem: 10, leaf: 11,
  bud: 3, catkin: 1, stem: 1, callus: 1 };
/* ---------------------------------------------------------------------------------------
 *  Response by contrast.
 *
 *  The Expression card states one number for this -- `resp.v`, the median |log2FC| across
 *  eligible contrasts -- and until now there was no way to see WHICH comparison moved the
 *  gene. That number is the summary of a distribution the reader could not reach.
 *
 *  Nothing new is built or shipped for this. data/expr/contrasts.json already names each
 *  comparison's control and perturbation SAMPLE INDICES, and loadExprVector already returns
 *  this gene's 652 values; the fold change is those two facts multiplied out in the browser.
 *  The reverse question -- "which genes respond to drought" -- is NOT answerable this way,
 *  because it needs every gene's vector, and it is deliberately not attempted here.
 *
 *  WHY EVERY BAR CARRIES ITS SAMPLE COUNTS. The median contrast in this panel is n=3 per
 *  side and some are n=1. A fold change from single samples has no dispersion estimate and
 *  cannot be told from noise, so ranking by |log2FC| alone puts those beside a real result.
 *  They are drawn (hiding them would misrepresent what the panel contains) and dimmed, and
 *  the counts are printed rather than implied. This is the |effect|-is-biased-at-low-n trap
 *  in its natural habitat.
 * ------------------------------------------------------------------------------------- */
const LFC_MAX = 6.5;          // axis half-range; values beyond are clamped and marked
// The curated set's own category order (its numbers 1-9; the first seven are the perturbation
// contrasts behind responsiveness).
const KIND_ORDER = ['Abiotic stress', 'Mechanical and gravitropic', 'Phytohormone', 'Biotic interaction',
  'Wounding and defoliation', 'Genetic perturbation', 'Genotype x environment', 'Developmental and anatomical',
  'Control vs control (QC)'];

function contrastCard(g) {
  if (!g.x) return null;
  const card = el('div', {
    class: 'card',
    'data-view-group': 'expression',
    'data-view-key': 'contrasts',
    // Deliberately NOT 'Response by contrast': the scrubber card has a button labelled
    // 'By contrast', and any substring selector for one then matches the other.
    'data-view-label': 'Contrasts',
    'data-view-tag': 'computed in the browser',
  }, el('h2', {}, 'Response by contrast'));
  const body = el('div', {});
  const status = el('p', { class: 'muted', style: 'font-size:13px;margin:6px 0 0' },
    'Scoring this gene against every shipped contrast…');
  card.append(body, status);

  (async () => {
    const [vec, contrasts] = await Promise.all([loadExprVector(g), loadContrasts()]);
    if (!vec || !contrasts) { status.textContent = 'No expression vector for this gene.'; return; }
    const rows = contrastRows(vec, contrasts);
    if (!rows.length) { status.textContent = 'No contrast could be scored for this gene.'; return; }

    const sorted = [...rows].sort((a, b) => Math.abs(b.lfc) - Math.abs(a.lfc));
    const absSorted = rows.map((r) => Math.abs(r.lfc)).sort((a, b) => a - b);
    const med = absSorted[Math.floor(absSorted.length / 2)];
    const lowN = rows.filter((r) => r.nc < 2 || r.np < 2).length;
    // The dissertation's responsiveness, as the record carries it (resp): median |log2FC| over
    // the perturbation contrasts where either arm reaches a mean of 5 TPM. These are the same
    // contrasts as the bars; scripts/validate_data.py recomputes it from them on a gene sample.
    const resp = g.resp || null;
    // "Largest" names one contrast in bold, so it must not be a 1-vs-1 comparison when a
    // replicated one exists; the bars above still show every contrast in |log2FC| order.
    const lead = sorted.find((r) => r.nc >= 2 && r.np >= 2) || sorted[0];
    const leadWeak = lead.nc < 2 || lead.np < 2;

    // ---- the list: filter by kind, tissue and three switches; sort five ways ----------------
    // Whole-panel facts below (median, largest, responsiveness) do not move with the filters;
    // the line above the bars says what the filtered list holds.
    const KINDS = [...new Set(rows.map((r) => r.kind))].sort((a, b) =>
      KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
    const TISSUES = [...new Set(rows.map((r) => r.tissue))].sort();
    const st = { kind: '', tissue: '', resp: false, expressed: false, replicated: false, sort: 'abs', all: false };
    const SORTS = {
      abs: ['Largest change', (a, b) => Math.abs(b.lfc) - Math.abs(a.lfc)],
      up: ['Most up', (a, b) => b.lfc - a.lfc],
      down: ['Most down', (a, b) => a.lfc - b.lfc],
      kind: ['By kind', (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || Math.abs(b.lfc) - Math.abs(a.lfc)],
      study: ['By study', (a, b) => a.study - b.study || a.id.localeCompare(b.id)],
      base: ['Highest expression', (a, b) => b.base - a.base],
    };
    const keep = (r, ignoreKind = false) => (ignoreKind || !st.kind || r.kind === st.kind)
      && (!st.tissue || r.tissue === st.tissue) && (!st.resp || r.resp)
      && (!st.expressed || r.base >= 5) && (!st.replicated || (r.nc >= 2 && r.np >= 2));

    const kindRow = el('div', { class: 'cv-kinds', role: 'group', 'aria-label': 'Kind of comparison' });
    const tissueSel = el('select', { 'aria-label': 'Tissue', 'data-cv-tissue': '' },
      el('option', { value: '' }, 'All tissues'), ...TISSUES.map((t) => el('option', { value: t }, t)));
    const sortSel = el('select', { 'aria-label': 'Sort', 'data-cv-sort': '' },
      ...Object.entries(SORTS).map(([k, [name]]) => el('option', { value: k }, name)));
    const sw = (key, text) => {
      const box = el('input', { type: 'checkbox', 'data-cv-switch': key });
      box.addEventListener('change', () => { st[key] = box.checked; st.all = false; draw(); });
      return el('label', { class: 'cv-switch' }, box, ` ${text}`);
    };
    const switches = el('div', { class: 'cv-switches' },
      sw('resp', 'Treatment comparisons only (the 149 behind responsiveness)'),
      sw('expressed', 'Gene reaches 5 TPM in either group'),
      sw('replicated', 'At least 2 samples on each side'));
    tissueSel.addEventListener('change', () => { st.tissue = tissueSel.value; st.all = false; draw(); });
    sortSel.addEventListener('change', () => { st.sort = sortSel.value; draw(); });
    const controls = el('div', { class: 'cv-controls' }, kindRow,
      el('div', { class: 'cv-selects' }, el('label', {}, 'Tissue ', tissueSel), el('label', {}, 'Sort ', sortSel)),
      switches);
    const summary = el('p', { class: 'sub cv-summary', style: 'margin:0 0 9px', 'aria-live': 'polite' });
    const grid = el('div', { class: 'lfc-rows' });
    const more = el('button', { type: 'button', class: 'btn cv-more', hidden: '' });
    more.addEventListener('click', () => { st.all = !st.all; draw(); });

    function draw() {
      // kind chips: counts follow the other filters, so a chip never promises rows it cannot show
      clear(kindRow);
      const base = rows.filter((r) => keep(r, true));
      for (const k of ['', ...KINDS]) {
        const n = k ? base.filter((r) => r.kind === k).length : base.length;
        const b = el('button', { type: 'button', class: 'cv-chip', 'data-cv-kind': k, 'aria-pressed': String(st.kind === k),
          disabled: n === 0 && st.kind !== k ? '' : null }, `${k || 'All'} `, el('span', { class: 'cv-n' }, String(n)));
        b.addEventListener('click', () => { st.kind = k; st.all = false; draw(); });
        kindRow.append(b);
      }
      const list = rows.filter((r) => keep(r)).sort(SORTS[st.sort][1]);
      const shown = st.all ? list : list.slice(0, 10);
      clear(grid);
      if (shown.length) {
        grid.append(el('span', { class: 'lfc-head' }, 'Comparison'), el('span', { class: 'lfc-head lfc-headbar' }, 'log2 fold change'),
          el('span', { class: 'lfc-head num' }, 'log2FC'), el('span', { class: 'lfc-head num' }, 'n'),
          el('span', { class: 'lfc-head num lfc-tpm', title: 'Mean TPM of the control group, then of the treated group' }, 'TPM ctrl → treated'));
      }
      for (const r of shown) {
        const mag = Math.min(Math.abs(r.lfc), LFC_MAX) / LFC_MAX * 50;   // % of full track
        const weak = r.nc < 2 || r.np < 2;
        const bar = el('b', {
          class: 'lfc-fill ' + (r.lfc >= 0 ? 'up' : 'down') + (weak ? ' weak' : ''),
          style: (r.lfc >= 0 ? 'left:50%;' : `right:50%;`) + `width:${mag}%`,
        });
        const fixed = r.within.split('; ').filter((t) => t && t !== 'WT').join('; ');
        const held = fixed ? ` · ${fixed}` : '';
        grid.append(
          el('span', { class: 'lfc-lab', 'data-cv-row': r.id, 'data-kind': r.kind,
            title: `${r.label} · ${r.tissue}${held} · ${r.kind}${r.sub ? ', ' + r.sub : ''} · study ${r.study}` },
            r.study ? el('a', { href: `#/study/${r.study}`, class: 'cv-study' }, r.label) : r.label,
            el('span', { class: 'muted' }, ` · ${r.tissue}${held}`)),
          el('span', { class: 'lfc-track' }, el('i', { class: 'lfc-zero' }), bar),
          el('span', { class: 'lfc-val mono' }, (r.lfc >= 0 ? '+' : '−') + Math.abs(r.lfc).toFixed(2)),
          el('span', { class: 'lfc-n mono' + (weak ? ' warn-n' : '') }, `${r.nc}v${r.np}`),
          el('span', { class: 'lfc-tpm mono', 'data-cv-tpm': '' }, `${tpm(r.mc)} → ${tpm(r.mp)}`),
        );
      }
      const filtered = list.length !== rows.length;
      const abs = list.map((r) => Math.abs(r.lfc)).sort((a, b) => a - b);
      const m = abs.length ? (abs.length % 2 ? abs[(abs.length - 1) / 2] : (abs[abs.length / 2 - 1] + abs[abs.length / 2]) / 2) : null;
      summary.replaceChildren(...(!filtered
        ? [`All ${rows.length} shipped contrasts scored for this gene; the ${shown.length} ${st.sort === 'abs' ? 'largest' : SORTS[st.sort][0].toLowerCase()} shown. Every bar carries its sample counts.`]
        : list.length
          ? [`${list.length} of ${rows.length} contrasts match; ${shown.length} shown, ${SORTS[st.sort][0].toLowerCase()} first. `,
            'Median |log2FC| of these ', el('span', { class: 'mono', 'data-cv-median': m.toFixed(3) }, m.toFixed(3)), '.']
          : ['No contrast matches these filters.']));
      more.hidden = list.length <= 10;
      more.textContent = st.all ? 'Show the first 10' : `Show all ${list.length}`;
    }
    draw();

    body.append(
      controls,
      summary,
      grid,
      el('div', { class: 'lfc-axis' },
        el('span', {}, el('i', {}, `−${LFC_MAX}`), el('i', {}, '0'), el('i', {}, `+${LFC_MAX}`))),
      more,
      el('dl', { class: 'kv', style: 'margin-top:12px' },
        el('dt', {}, 'Median |log2FC|'), el('dd', { class: 'mono' }, med.toFixed(3)),
        el('dt', {}, leadWeak ? 'Largest' : 'Largest, replicated'),
        el('dd', {}, el('span', { class: 'mono' }, lead.lfc.toFixed(2)), ' in ',
          el('strong', {}, lead.tissue), `, ${lead.label} (${lead.nc} vs ${lead.np} samples)`,
          el('span', { class: 'muted' }, `, mean ${fmt(Math.round(lead.base))} TPM on the larger side`
            + (leadWeak ? '; single sample on one side' : ''))),
        el('dt', {}, 'Responsiveness'),
        el('dd', {}, !resp
          ? el('span', { class: 'muted' }, 'not reached 5 TPM in any perturbation contrast')
          : [el('span', { class: 'mono', 'data-resp': resp.v.toFixed(3) }, resp.v.toFixed(3)),
            el('span', { class: 'muted' }, `, median |log2FC| over the ${fmt(resp.n)} of 149 perturbation contrasts where the gene reaches 5 TPM (the dissertation\u2019s measure)`)])),
      lowN ? el('p', { class: 'warn-n-note' },
        el('strong', {}, `${lowN} of these ${rows.length} contrasts have a single sample on one side. `),
        'A fold change from one sample against one sample has no dispersion estimate and cannot '
        + 'be distinguished from noise; those bars are dimmed. Ranking by |log2FC| alone would '
        + 'put them beside a real result.') : null,
      el('p', { class: 'muted', style: 'font-size:12.5px;margin:9px 0 0' },
        'Fold change is mean(perturbation)+1 over mean(control)+1 on the raw TPM vector, using '
        + 'the control and perturbation sample indices shipped in contrasts.json. It is a '
        + 'descriptive ratio, not a differential-expression test: no dispersion model, no '
        + 'multiple-testing correction, and study is not accounted for. The median above is over '
        + 'every contrast; responsiveness keeps only the perturbation contrasts where the gene is '
        + 'expressed, and is the figure the Tissues view quotes.'));
    status.remove();
  })().catch((e) => { status.textContent = `Contrast response unavailable: ${e.message}`; });

  return card;
}

const PAPER_TISSUES = ['leaf_young', 'leaf', 'leaf_old', 'xylem', 'bark', 'root', 'stem', 'bud', 'catkin'];
/** TPM to one decimal (thousands separated), so a column of means lines up. */
const tpm = (v) => (v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/** Tissue specificity exactly as the dissertation computes it. This is the value to quote. */
function paperBlock(g, man) {
  const p = paperExpr(g);
  if (!p) return null;
  const n = (((man || {}).dissertation || {}).tau || {}).panel_n || {};
  const max = Math.max(...PAPER_TISSUES.map((t) => p.t[t] || 0), 0.01);
  const verdict = p.tau == null
    ? el('span', {}, 'No tissue group reaches a mean of 5 TPM, so no τ or peak tissue is computed.')
    : el('span', {}, 'τ = ', el('strong', { 'data-paper-tau': '' }, p.tau.toFixed(3)),
        ', peak tissue ', el('strong', { 'data-paper-top': '' }, p.top), '. ',
        p.tau >= TAU_SPECIFIC && p.ok
          ? el('strong', {}, 'Counted as tissue-specific')
          : el('span', {}, 'Not counted as tissue-specific'),
        ` (τ ≥ ${TAU_SPECIFIC} and mean TPM ≥ 5; this gene’s mean is ${p.m != null ? p.m.toFixed(2) : '–'} TPM).`);
  // Mean is the dissertation's (the record); median, range and studies are filled in from the
  // same reference-panel samples once the vector loads (see geneCard), and the recomputed mean
  // must equal the record's (data-mean-check).
  const tbody = el('tbody', {}, ...PAPER_TISSUES.map((t, k) => el('tr', { 'data-tissue': t, 'data-order': k, 'data-mean': p.t[t] },
    el('td', {}, t === p.top ? el('strong', {}, t) : t),
    el('td', { class: 'num mono' }, tpm(p.t[t])),
    el('td', { class: 'num mono', 'data-stat': 'median' }, ''),
    el('td', { class: 'num mono pt-range', 'data-stat': 'range' }, ''),
    el('td', { class: 'num', 'data-stat': 'n' }, n[t] != null ? fmt(n[t]) : ''),
    el('td', { class: 'num', 'data-stat': 'studies' }, ''),
    el('td', { class: 'pt-barcell' }, el('div', { class: 'bar',
      style: `width:${Math.max((p.t[t] / max) * 100, p.t[t] > 0 ? 1.5 : 0)}%;background:var(--accent)` })))));
  const order = el('div', { class: 'pt-sort', role: 'group', 'aria-label': 'Order of tissue groups' });
  for (const [k, label] of [['panel', 'Panel order'], ['mean', 'Highest mean first']]) {
    const b = el('button', { type: 'button', class: 'cv-chip', 'data-pt-sort': k, 'aria-pressed': String(k === 'panel') }, label);
    b.addEventListener('click', () => {
      order.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const rows = [...tbody.children].sort((a, z) => (k === 'mean' ? +z.dataset.mean - +a.dataset.mean : +a.dataset.order - +z.dataset.order));
      tbody.append(...rows);
    });
    order.append(b);
  }
  return el('div', { 'data-paper-expr': '' },
    el('p', { class: 'sub', style: 'margin:0 0 8px' }, verdict),
    order,
    el('div', { class: 'scroll-x' }, el('table', { class: 'data pt-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Tissue group'), el('th', { class: 'num' }, 'Mean TPM'),
        el('th', { class: 'num' }, 'Median'), el('th', { class: 'num pt-range' }, 'Range'),
        el('th', { class: 'num' }, 'Samples'), el('th', { class: 'num' }, 'Studies'), el('th', { class: 'pt-barcell' }, ''))),
      tbody)),
    el('p', { class: 'muted pt-note' },
      `As in the dissertation: ${PAPER_TAU_HOW}. Leaf ages are kept as separate groups. Median and range `
      + '(lowest to highest sample) are over the same reference-panel samples as the mean.'));
}

function geneCard(g, man) {
  if (!g.x) return null;
  const x = g.x;
  const hub = linkHub();
  const dmapHolder = el('div', { 'data-dmap-holder': '' });
  const card = el('div', {
    class: 'card',
    'data-view-group': 'expression',
    'data-view-key': 'tissues',
    'data-view-label': 'Tissues',
    'data-view-tag': 'kallisto k21',
  },
    el('h2', {}, 'Expression', el('span', { class: 'tag' }, 'kallisto k21')),
    paperBlock(g, man),
    dmapHolder,
    el('p', { class: 'muted', style: 'font-size:12.5px;margin:4px 0 0' },
      'These are TPM for this haplotype’s gene model. Reads were quantified against both '
      + 'haplotypes together, so reads that fit this gene and its allele equally well are divided '
      + 'between them by kallisto’s estimate, not assigned by phasing. This is not '
      + 'allele-specific expression.'),
    g.resp && g.resp.v != null ? el('p', { style: 'font-size:12.5px;margin:9px 0 0' },
      el('strong', {}, 'Responsiveness: '),
      'median |log2 fold-change| across perturbation contrasts is ',
      el('span', { class: 'mono' }, g.resp.v.toFixed(3)),
      g.resp.n ? el('span', { class: 'muted' }, ` over ${g.resp.n} eligible contrasts among the dissertation’s curated perturbation contrasts`) : null,
      el('span', { class: 'muted' }, '. A descriptive number pooled across studies, not a '
        + 'differential-expression test.')) : null,
    g.nb && g.nb.k5 != null ? el('p', { style: 'font-size:12.5px;margin:9px 0 0' },
      el('strong', {}, 'Neighborhood: '),
      'correlation with the 5 nearest genes is ',
      el('span', { class: 'mono' }, g.nb.k5.toFixed(3)),
      g.nb.k10 != null ? el('span', {}, ', with the nearest 10 ', el('span', { class: 'mono' }, g.nb.k10.toFixed(3))) : null,
      el('span', { class: 'muted' }, '. Descriptive only, and not evidence of shared regulation: '
        + 'neighboring similar copies can share reads, and readthrough or a shared open-chromatin '
        + 'domain can also correlate neighbors.')) : null,
  );
  const btn = el('button', {
    style: 'margin-top:10px;font-size:13px;padding:4px 9px;border:1px solid var(--line-2);border-radius:5px;background:var(--panel-2);color:var(--ink);cursor:pointer',
    onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Loading…';
      const holder = el('div', { id: 'expr-profile', style: 'margin-top:12px' });
      card.append(holder);
      e.target.remove();
      const [rawVec, samples, studies] = await Promise.all([loadExprVector(g), loadExprSamples(), loadExprStudies()]);

      // Two views of the same vector. Conditions first, because "does it respond to drought
      // in study 27" is answerable from replicate means and not from 652 individual dots.
      let activeVec = rawVec;
      let combatVec = null; // fetched lazily, only if the toggle is used
      const body = el('div', {});
      const tabs = el('div', { style: 'display:flex;gap:6px;margin-bottom:10px' });
      let renderCurrent = () => {};
      const mk = (label, render) => {
        const b = el('button', {
          onclick: () => {
            [...tabs.children].forEach((c) => { c.dataset.on = 'false'; c.style.background = 'var(--panel-2)'; c.style.color = 'var(--ink)'; });
            b.dataset.on = 'true'; b.style.background = 'var(--accent)'; b.style.color = '#fff';
            renderCurrent = () => { clear(body).append(render()); hub.repaint(); };
            renderCurrent();
          },
          style: 'font-size:13px;padding:4px 10px;border:1px solid var(--line-2);border-radius:5px;background:var(--panel-2);color:var(--ink);cursor:pointer',
        }, label);
        return b;
      };
      const byCond = mk('By condition', () => conditionTable(activeVec, samples, studies, hub, g.id));
      const bySamp = mk('By sample', () => fullProfile(activeVec, samples, studies, hub, g.id));
      tabs.append(byCond, bySamp);
      holder.append(tabs, body);
      hub.on((sel) => paintLinked(body, sel));

      // ComBat-corrected is a SEPARATE toggle, not a third tab -- it swaps which vector feeds
      // the same two views rather than tripling the tab count. Only offered when this gene
      // has one: `x.cb` is absent (not null) for the ~4,360 genes with too little count
      // signal to batch-correct -- see sources/combat_tpm.provenance.json. Never implies the
      // corrected value is more correct; it is a narrower cross-study comparison view only.
      if (g.x.cb) {
        const src = el('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:10px;font-size:13px;color:var(--ink-2)' },
          'Values: ');
        const mkSrc = (label, isRaw) => {
          const b = el('button', {
            onclick: async () => {
              if (isRaw) {
                activeVec = rawVec;
              } else {
                if (!combatVec) {
                  b.textContent = 'Loading…';
                  combatVec = await loadCombatVector(g);
                }
                activeVec = combatVec;
              }
              [...src.querySelectorAll('button')].forEach((c) => { c.dataset.on = 'false'; c.style.background = 'var(--panel-2)'; c.style.color = 'var(--ink)'; });
              b.dataset.on = 'true'; b.style.background = 'var(--accent)'; b.style.color = '#fff';
              b.textContent = label;
              renderCurrent();
            },
            style: 'font-size:13px;padding:3px 8px;border:1px solid var(--line-2);border-radius:5px;background:var(--panel-2);color:var(--ink);cursor:pointer',
          }, label);
          return b;
        };
        const rawBtn = mkSrc('Raw', true);
        const cbBtn = mkSrc('ComBat-corrected (cross-study)', false);
        rawBtn.dataset.on = 'true'; rawBtn.style.background = 'var(--accent)'; rawBtn.style.color = '#fff';
        src.append(rawBtn, cbBtn,
          el('span', { style: 'font-size:12.5px' },
            '– batch-adjusted for comparing this gene ACROSS studies; raw stays primary everywhere else on this site.'));
        holder.insertBefore(src, tabs);
      }

      byCond.click();
    },
  }, `Show all 652 samples →`);
  card.append(btn);

  // The design map loads with the card: 15 KB of sample metadata plus the vector the
  // Contrasts view fetches anyway (the range read is cached). Each row of the tissue table above
  // is one tissue group of the dissertation's 222-sample reference panel (`ref222` on each
  // sample), so a row lights up exactly its samples, and the readout gives their mean TPM: the
  // same statistic as the table, from the same samples.
  Promise.all([loadExprSamples(), loadExprStudies(), loadExprVector(g)]).then(([samples, studies, vec]) => {
    if (!samples) return;
    const table = card.querySelector('[data-paper-expr] table');
    if (table && samples.some((s) => s.ref222 != null)) {
      table.classList.add('dmap-linked');
      table.querySelectorAll('tbody tr[data-tissue]').forEach((tr) => {
        const t = tr.dataset.tissue;
        const ids = samples.map((s, i) => (s.ref222 && s.tissue_analysis === t ? i : -1)).filter((i) => i >= 0);
        if (!ids.length) return;
        const vals = vec ? ids.map((i) => vec[i]) : [];
        const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        const nst = new Set(ids.map((i) => samples[i].study)).size;
        if (vals.length) {
          const sv = [...vals].sort((a, b) => a - b);
          const med = sv.length % 2 ? sv[(sv.length - 1) / 2] : (sv[sv.length / 2 - 1] + sv[sv.length / 2]) / 2;
          tr.querySelector('[data-stat="median"]').textContent = tpm(med);
          tr.querySelector('[data-stat="range"]').textContent = `${tpm(sv[0])} – ${tpm(sv[sv.length - 1])}`;
          tr.dataset.meanCheck = (Math.round(mean * 100) / 100).toFixed(2);
        }
        tr.querySelector('[data-stat="studies"]').textContent = String(nst);
        tr.dataset.ids = ids.join(',');
        tr.tabIndex = 0;
        brush(tr, hub, { key: `ref:${t}`, ids: new Set(ids),
          text: `${t}, reference panel: ${ids.length} samples from ${nst} stud${nst === 1 ? 'y' : 'ies'}.`
            + (mean != null ? ` This gene: mean ${fmt(Math.round(mean * 100) / 100)} TPM, range `
              + `${fmt(Math.min(...vals))} to ${fmt(Math.max(...vals))}.` : '') });
      });
      hub.on((sel) => paintLinked(table, sel));
    }
    dmapHolder.append(designGrid(samples, studies, hub, [{ name: 'This gene', vec }], g.id));
  }).catch(() => {});

  // Two views of one question: where this gene is ON, and what MOVES it. app.js merges
  // cards sharing a data-view-group into one card with a switch.
  const cc = contrastCard(g);
  if (!cc) return card;
  const frag = document.createDocumentFragment();
  frag.append(card, cc);
  return frag;
}

/** Replicate means per experimental condition, grouped by study.
 *  Conditions come from the METADATA fields, not by stripping "_repN" off the label --
 *  study 27 encodes replicates as DR1/DR2/DR3 with no _rep, which would split every one of
 *  its 72 samples into its own group. */
function conditionTable(vec, samples, studies, hub, geneId) {
  const groups = new Map();
  samples.forEach((s, i) => {
    const key = [s.study, s.tissue_analysis || s.tissue, s.treatment, s.growth, s.additional, s.genotype].join('\u0001');
    if (!groups.has(key)) groups.set(key, { s, vals: [], ids: [] });
    groups.get(key).vals.push(vec[i]);
    groups.get(key).ids.push(i);
  });
  const rows = [...groups.values()].map(({ s, vals, ids }) => ({
    s, n: vals.length, ids,
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
  })).sort((a, b) => a.s.study - b.s.study
    || (a.s.tissue_analysis || a.s.tissue || '').localeCompare(b.s.tissue_analysis || b.s.tissue || '')
    || b.mean - a.mean);
  const max = Math.max(...rows.map((r) => r.mean), 0.01);

  const cond = (s) => [s.treatment, s.growth, s.additional].filter(Boolean).join(' · ') || 'baseline';
  return el('div', {},
    el('p', { class: 'muted', style: 'font-size:13px;margin:0 0 8px' },
      `${rows.length} conditions across ${new Set(rows.map((r) => r.s.study)).size} studies, `
      + 'each a mean over its replicates. Bars share one scale.'),
    el('div', { class: 'scroll-x', style: 'max-height:520px;overflow-y:auto' },
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Study'), el('th', {}, 'Tissue'), el('th', {}, 'Condition'),
          el('th', {}, 'Genotype'), el('th', { class: 'num' }, 'n'),
          el('th', { class: 'num' }, 'Mean TPM'), el('th', {}, ''))),
        el('tbody', {}, ...rows.map((r) => brush(el('tr', { 'data-ids': r.ids.join(','), tabindex: '0' },
          el('td', {}, el('a', { href: `#/study/${r.s.study}?gene=${geneId}`, class: 'mono' }, r.s.study)),
          el('td', { style: 'font-size:13px' }, r.s.tissue_analysis || r.s.tissue || '–'),
          el('td', { style: 'font-size:13px' }, cond(r.s)),
          el('td', { style: 'font-size:13px' }, r.s.genotype || '–'),
          el('td', { class: 'num' }, r.n),
          el('td', { class: 'num' }, r.mean.toFixed(2)),
          el('td', { style: 'width:30%' },
            el('div', { class: 'bar', style: `width:${Math.max((r.mean / max) * 100, r.mean > 0 ? 1.5 : 0)}%;`
              + `background:${r.s.ctrl === 'perturbation' ? 'var(--c-disp)' : 'var(--c-core)'}` }))),
          hub, { key: `cond:${r.ids[0]}`, ids: new Set(r.ids),
            label: `study ${r.s.study}, ${tissueOf(r.s)}, ${cond(r.s)}${r.s.genotype && r.s.genotype !== 'WT' ? ', ' + r.s.genotype : ''}` })))))
  );
}

function fullProfile(vec, samples, studies, hub, geneId) {
  const bySt = new Map();
  samples.forEach((s, i) => {
    if (!bySt.has(s.study)) bySt.set(s.study, []);
    bySt.get(s.study).push({ ...s, tpm: vec[i], i });
  });
  const max = Math.max(...vec, 0.01);
  const wrap = el('div', {});
  const legend = el('div', { style: 'display:flex;gap:14px;align-items:center;font-size:13px;margin-bottom:8px;color:var(--ink-2)' },
    el('span', {}, el('i', { class: 'dot', style: 'background:var(--c-core);display:inline-block' }), ' control'),
    el('span', {}, el('i', { class: 'dot', style: 'background:var(--c-disp);display:inline-block' }), ' perturbation'));
  wrap.append(el('h3', { style: 'font-size:13px;margin:0 0 6px' }, 'Every sample'), legend);

  for (const [sid, rows] of [...bySt.entries()].sort((a, b) => a[0] - b[0])) {
    const study = studies[sid];
    const strip = el('div', { style: 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px' });
    rows.sort((a, b) => a.label.localeCompare(b.label)).forEach((r) => {
      const h = Math.max(3, (r.tpm / max) * 30);
      strip.append(brush(el('div', {
        'data-i': r.i,
        class: 'dmap-tick',
        title: `${r.label}\n${r.tpm} TPM\n${r.tissue_analysis || r.tissue}${r.treatment ? ' · ' + r.treatment : ''}${r.genotype ? ' · ' + r.genotype : ''}`,
        style: `width:7px;height:30px;display:flex;align-items:flex-end`,
      }, el('div', { style: `width:100%;height:${h}px;background:${r.ctrl === 'perturbation' ? 'var(--c-disp)' : 'var(--c-core)'};border-radius:1px` })),
      hub, { key: `s:${r.i}`, label: r.label, ids: new Set([r.i]) }));
    });
    wrap.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:4px 0;border-top:1px solid var(--line)' },
      el('a', { href: `#/study/${sid}?gene=${geneId}`, class: 'mono', style: 'font-size:12.5px;width:28px;flex:none' }, sid),
      el('span', { class: 'muted', style: 'font-size:12.5px;width:220px;flex:none' }, study.tissues.join('/')),
      strip));
  }
  return wrap;
}

/* ---------- module overview: study catalogue ---------- */
/** A study's identity is its design and its paper, not its serial number. The number was
 *  the only clickable thing here, and at 11 px it was also the smallest. */
function studyRow(s) {
  // One parser for the list and the study page (core/cite.js). The inline one here printed the
  // whole author list as "first author".
  const meta = studyMeta(s.citation);
  const first = meta.firstAuthor;
  const year = meta.year ? [null, meta.year] : null;
  const title = meta.title;
  const href = `#/study/${s.id}`;
  return el('tr', { style: 'cursor:pointer', onclick: () => { location.hash = href; } },
    el('td', {},
      el('a', { href }, title || `Study ${s.id}`),
      el('div', { class: 'muted', style: 'font-size:13px;margin-top:2px' },
        first ? `${first}${year ? ' ' + year[1] : ''}` : `study ${s.id}`)),
    el('td', { class: 'num' }, fmt(s.n)),
    el('td', {}, s.tissues.join(', ')),
    el('td', {}, s.panel_type.join(', ') || el('span', { class: 'muted' }, '–')),
    el('td', {}, ...s.bioprojects.map((b, i) => el('span', {},
      i ? ', ' : '',
      el('a', { href: `https://www.ebi.ac.uk/ena/browser/view/${b}`, target: '_blank',
                rel: 'noopener', class: 'mono', style: 'font-size:13px',
                onclick: (e) => e.stopPropagation() }, b)))),
    // Five studies have no paper yet (the source table marks them unpublished); their deposited
    // data set is the reference, so link that instead of printing a dash.
    el('td', {}, s.doi && s.doi.length
      ? el('a', { href: s.doi[0], target: '_blank', rel: 'noopener',
                  onclick: (e) => e.stopPropagation() }, 'paper')
      : meta.url
        ? el('a', { href: meta.url, target: '_blank', rel: 'noopener', title: 'No paper listed; the deposited data set',
                    onclick: (e) => e.stopPropagation() }, 'data set')
        : el('span', { class: 'muted' }, 'none listed')),
  );
}

function tissuePanelMatrix(man) {
  const tw = man.expression.tissue_wt_control_n;
  const rows = Object.entries(tw).sort((a, b) => b[1] - a[1]).map(([t, n]) => el('tr', {},
    el('td', {}, t), el('td', { class: 'num' }, n),
    el('td', {}, el('div', { class: 'bar', style: `width:${(n / Math.max(...Object.values(tw))) * 100}%;background:var(--accent)` }))));
  return el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Tissue'), el('th', { class: 'num' }, 'WT-control n'), el('th', {}, ''))),
    el('tbody', {}, ...rows));
}

async function overview(man) {
  const studies = await loadExprStudies();
  const list = Object.values(studies).sort((a, b) => a.id - b.id);
  const e = man.expression;
  return el('div', {},
    el('h1', {}, 'Expression'),
    el('p', { class: 'sub' },
      `${fmt(e.n_samples)} samples, ${e.n_studies} curated studies, ${e.n_bioprojects} BioProjects. `
      + `kallisto k21 pseudoalignment against the combined HAP1+HAP2 v5.1 transcriptome. `
      + `TPM, raw (not batch-corrected), see each study for design and caveats.`),
    (() => {
      const t = ((man.dissertation || {}).tau || {}).per_haplotype;
      if (!t) return null;
      return el('div', { class: 'card', 'data-paper-tau-card': '' },
        el('h2', {}, 'Tissue specificity', el('span', { class: 'tag' }, 'as in the dissertation')),
        el('div', { class: 'stat-row' }, ...['HAP1', 'HAP2'].map((h) => el('a', {
          class: 'stat', style: 'text-decoration:none;color:inherit',
          href: browseHref({ hap: h.toLowerCase(), tau_min: '0.85', tok: 'yes', qc: 'no' }) },
          el('div', { class: 'n' }, fmt(t[h].tissue_specific)),
          el('div', { class: 'l' }, `${h} tissue-specific genes: ${(100 * t[h].tissue_specific / t[h].genes_at_mean_TPM_5_or_more).toFixed(2)}% of `
            + `${fmt(t[h].genes_at_mean_TPM_5_or_more)} quality-filtered genes with mean TPM ≥ 5`)))),
        el('p', { class: 'muted', style: 'font-size:12.5px;margin:8px 0 0' },
          `${PAPER_TAU_HOW[0].toUpperCase()}${PAPER_TAU_HOW.slice(1)}. This τ and its peak tissue are the ones shown first on gene pages and used in Browse.`));
    })(),
    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(e.n_samples)), el('div', { class: 'l' }, 'samples')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, e.n_studies), el('div', { class: 'l' }, 'studies')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, e.n_bioprojects), el('div', { class: 'l' }, 'BioProjects')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(e.n_buckets * e.bucket_size)), el('div', { class: 'l' }, 'gene profiles indexed')),
    ),
    el('div', { class: 'card' },
      el('h2', {}, 'WT-control samples per tissue', el('span', { class: 'tag' }, 'baseline denominator')),
      el('p', { class: 'muted', style: 'font-size:13px;margin:0 0 10px' },
        `The per-tissue tables on the tandem-array and allele-pair pages show the median TPM across these WT-control samples; τ and peak tissue do not use them (see the card above). `
        + `stem, bud, catkin and callus are thin (≤5), read differences with that in mind.`),
      tissuePanelMatrix(man)),
    el('div', { class: 'card' },
      el('h2', {}, 'Studies', el('span', { class: 'tag' }, 'click a row to open it')),
      el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Study'), el('th', { class: 'num' }, 'Samples'),
          el('th', {}, 'Tissue'), el('th', {}, 'Panel'), el('th', {}, 'BioProject'),
          el('th', {}, 'Paper'))),
        el('tbody', {}, ...list.map(studyRow))))),
    el('p', { class: 'muted', style: 'font-size:13px' },
      'Full matrix CSVs (TPM/FPKM/counts, all 652 samples × 63,960 genes) are not on this ',
      'site; the per-gene and per-study pages carry the same values. Ask the author for the raw CSVs.'),
  );
}

export default {
  id: 'expression',
  label: 'Expression',
  geneCard,
  overview,
  filters: [
    { id: 'expr_top_tissue', label: 'Peak tissue', options: TISSUE_ORDER,
      test: (g, v) => g.x && g.x.top === v },
    { id: 'expr_tau', label: 'τ (222-sample reference panel; high = narrow expression)',
      test: (g, v) => g.x && g.x.tau != null && g.x.tau >= parseFloat(v) },
  ],
};
