// Sample design map: a tissue-by-study grid of the expression samples, linked to the charts
// beside it. Pointing at (or tabbing to, or tapping) a cell lights up the same samples in every
// linked view, and pointing at a chart element lights up its cells. Brushing and linking, in
// visualisation terms (Becker & Cleveland 1987).
//
// Why it exists: every expression number on a gene page rests on a different set of samples,
// and the sets are very uneven (stem is 2 samples from one study, leaf is 55 from 11). A table
// of n per tissue states that; the grid SHOWS which studies are behind each bar, so a reader
// sees that a "stem-specific" gene is a one-study observation before reading any caveat.
//
// Shared by the gene page and the allele pair page. Modules may import core, not each other.
//
// A selection is { key, label, ids: Set<sample index> }. A hub holds one pinned selection (a
// tap or Enter) and one preview (hover or focus); the preview wins while it lasts. Every view
// subscribes and paints itself from the current selection, so views never talk to each other.
import { el, fmt } from './dom.js';
import { studyMeta } from './cite.js';

export const TISSUE_ORDER = ['leaf_young', 'leaf', 'leaf_old', 'xylem', 'bark', 'root', 'stem',
  'bud', 'catkin', 'gall', 'callus'];
// Same tissue codes as the bars and the rest of the site; a plain-name pass is site-wide work.
export const tissueName = (t) => t;
export const tissueOf = (s) => s.tissue_analysis || s.tissue;
/** Wild-type control samples: the set behind the per-tissue medians on the allele pair page
 *  (the shard's x.t / x.n). The gene page's tissue table is the dissertation's 222-sample
 *  reference panel instead, which the sample metadata does not identify. */
export const isBaseline = (s) => s.genotype === 'WT' && s.ctrl === 'control';

export function linkHub() {
  const subs = new Set();
  let pinned = null, preview = null;
  const emit = () => { const s = preview || pinned; subs.forEach((f) => f(s, pinned)); };
  return {
    on(fn) { subs.add(fn); fn(preview || pinned, pinned); },
    preview(sel) { preview = sel; emit(); },
    end(sel) { if (!sel || (preview && preview.key === sel.key)) { preview = null; emit(); } },
    toggle(sel) { pinned = pinned && pinned.key === sel.key ? null : sel; preview = null; emit(); },
    clear() { pinned = null; preview = null; emit(); },
    repaint: emit,
  };
}

/** Wire one element as a brushing source: hover, focus, tap/click, Enter/Space, Escape. */
export function brush(node, hub, sel) {
  const s = typeof sel === 'function' ? sel : () => sel;
  node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hub.preview(s()); });
  node.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hub.end(s()); });
  node.addEventListener('focus', () => hub.preview(s()));
  node.addEventListener('blur', () => hub.end(s()));
  // A link inside a source (a study number in a table row) keeps doing its own job.
  node.addEventListener('click', (e) => { if (e.target.closest('a')) return; e.preventDefault(); hub.toggle(s()); });
  node.addEventListener('keydown', (e) => {
    if (node.tagName !== 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); hub.toggle(s()); }
    if (e.key === 'Escape') hub.clear();
  });
  return node;
}

/** Selection: the wild-type control samples behind one per-tissue median. */
export function baselineSel(samples, t) {
  const ids = new Set();
  samples.forEach((s, i) => { if (tissueOf(s) === t && isBaseline(s)) ids.add(i); });
  return { key: `base:${t}`, label: `${tissueName(t)}, wild-type controls`, ids };
}

const studyLabel = (studies, sid) => {
  const m = studyMeta((studies[sid] || {}).citation || '');
  return m.firstAuthor ? `${m.firstAuthor}${m.year ? ' ' + m.year : ''}` : '';
};

/** Upper middle for even n: the same rule the per-tissue medians use, so the two never disagree. */
const median = (v) => { const a = [...v].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const tpm = (v) => (v >= 100 ? fmt(Math.round(v)) : v.toFixed(v >= 10 ? 1 : 2));

/** One-line description of a selection, with this gene's values (each vector named). */
export function describe(sel, samples, studies, vecs) {
  const ids = [...sel.ids];
  const base = ids.filter((i) => isBaseline(samples[i])).length;
  const nst = new Set(ids.map((i) => samples[i].study)).size;
  const many = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const from = `from ${nst} stud${nst === 1 ? 'y' : 'ies'}`;
  const head = base === ids.length
    ? `${sel.label}: ${many(ids.length, 'wild-type control sample')} ${from}.`
    : `${sel.label}: ${many(ids.length, 'sample')} ${from}, ${base} of them wild-type controls.`;
  const vals = vecs.filter((v) => v.vec).map(({ name, vec }) => {
    const x = ids.map((i) => vec[i]).filter((v) => v != null);
    if (!x.length) return null;
    const what = x.length <= 4 ? `${x.length === 1 ? 'value' : 'values'} ${x.map(tpm).join(', ')} TPM`
      : `median ${tpm(median(x))} TPM, range ${tpm(Math.min(...x))} to ${tpm(Math.max(...x))}`;
    return `${name}: ${what}`;
  }).filter(Boolean);
  return [head, vals.length ? vals.join('; ') + '.' : null].filter(Boolean).join(' ');
}

/**
 * The grid. `vecs` = [{ name, vec }] (one per haplotype on the pair page), used for the readout
 * only. Returns the element; it subscribes itself to `hub`.
 */
export function designGrid(samples, studies, hub, vecs = [], geneId = '') {
  const present = new Set(samples.map(tissueOf));
  const tissues = TISSUE_ORDER.filter((t) => present.has(t))
    .concat([...present].filter((t) => !TISSUE_ORDER.includes(t)).sort());
  const sids = [...new Set(samples.map((s) => s.study))].sort((a, b) => a - b);
  const cell = new Map();                       // "t|sid" -> sample indices
  samples.forEach((s, i) => {
    const k = `${tissueOf(s)}|${s.study}`;
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(i);
  });

  const cellSel = (t, sid) => ({ key: `cell:${t}|${sid}`,
    label: `${tissueName(t)}, study ${sid}${studyLabel(studies, sid) ? ' (' + studyLabel(studies, sid) + ')' : ''}`,
    ids: new Set(cell.get(`${t}|${sid}`)) });
  const colSel = (sid) => ({ key: `study:${sid}`,
    label: `study ${sid}${studyLabel(studies, sid) ? ' (' + studyLabel(studies, sid) + ')' : ''}`,
    ids: new Set(samples.map((s, i) => (s.study === sid ? i : -1)).filter((i) => i >= 0)) });
  const rowSel = (t) => ({ key: `tissue:${t}`, label: `${tissueName(t)}, every study and condition`,
    ids: new Set(samples.map((s, i) => (tissueOf(s) === t ? i : -1)).filter((i) => i >= 0)) });

  const grid = el('div', { class: 'dmap-grid', role: 'group',
    'aria-label': `Sample design: ${samples.length} samples in ${tissues.length} tissues and ${sids.length} studies`,
    style: `grid-template-columns:auto repeat(${sids.length}, var(--dmap-cell))` });
  grid.append(el('span', { class: 'dmap-corner' }, 'study'));
  const painted = [];                             // [node, ids[]]
  for (const sid of sids) {
    const ids = [...colSel(sid).ids];
    const b = brush(el('button', { type: 'button', class: 'dmap-col',
      'aria-label': `Study ${sid} ${studyLabel(studies, sid)}, ${ids.length} samples` }, String(sid)), hub, () => colSel(sid));
    painted.push([b, ids]);
    grid.append(b);
  }
  for (const t of tissues) {
    const rids = [...rowSel(t).ids];
    const rh = brush(el('button', { type: 'button', class: 'dmap-row',
      'aria-label': `${tissueName(t)}, ${rids.length} samples` }, tissueName(t)), hub, () => rowSel(t));
    painted.push([rh, rids]);
    grid.append(rh);
    for (const sid of sids) {
      const ids = cell.get(`${t}|${sid}`);
      if (!ids) { grid.append(el('span', { class: 'dmap-empty', 'aria-hidden': 'true' })); continue; }
      const nb = ids.filter((i) => isBaseline(samples[i])).length;
      const c = brush(el('button', {
        type: 'button', class: 'dmap-cell' + (nb ? ' base' : ''),
        'aria-label': `${tissueName(t)}, study ${sid}: ${ids.length} samples, ${nb} wild-type controls`,
      }, String(ids.length)), hub, () => cellSel(t, sid));
      painted.push([c, ids]);
      grid.append(c);
    }
  }

  const readout = el('p', { class: 'dmap-readout', 'aria-live': 'polite' });
  const clearBtn = el('button', { type: 'button', class: 'dmap-clear', hidden: '', onclick: () => hub.clear() }, 'Clear');
  // A selection inside one study offers that study's own design page, carrying the gene.
  const studyLink = el('a', { class: 'dmap-study', hidden: '' });
  const idle = 'Point at, tap or tab to a cell, a tissue or a study number to light up the same '
    + 'samples everywhere on this card.';
  const wrap = el('div', { class: 'dmap', 'data-dmap': '' },
    el('h3', { class: 'dmap-title' }, 'Where the samples come from'),
    el('p', { class: 'dmap-sub' },
      `${samples.length} samples: rows are tissues, columns are studies, each number is a count of samples. `,
      el('span', { class: 'dmap-key base' }), ' includes wild-type control samples; ',
      el('span', { class: 'dmap-key' }), ' treatments or transgenic lines only. A selected cell is outlined; a '
      + 'dashed outline means only some of its samples are in the selection.'),
    el('div', { class: 'dmap-scroll' }, grid),
    el('div', { class: 'dmap-foot' }, readout, studyLink, clearBtn));

  hub.on((sel, pinned) => {
    wrap.toggleAttribute('data-sel', !!sel);
    for (const [n, ids] of painted) {
      const hot = sel ? ids.filter((i) => sel.ids.has(i)).length : 0;
      n.dataset.hot = !sel ? '' : hot === ids.length ? 'all' : hot ? 'part' : '';
    }
    readout.textContent = sel ? describe(sel, samples, studies, vecs) : idle;
    clearBtn.hidden = !pinned;
    const sids = sel ? new Set([...sel.ids].map((i) => samples[i].study)) : new Set();
    if (sids.size === 1) {
      const sid = [...sids][0];
      studyLink.href = `#/study/${sid}${geneId ? '?gene=' + geneId : ''}`;
      studyLink.textContent = `Study ${sid} design${geneId ? ' with this gene' : ''}`;
      studyLink.hidden = false;
    } else studyLink.hidden = true;
    // On a phone the grid scrolls sideways; a tap must not light a cell the reader cannot see.
    // Only for a pinned selection: following the mouse would make the grid jump under it.
    if (sel && pinned && sel.key === pinned.key) {
      const hot = painted.find(([n]) => n.classList.contains('dmap-cell') && n.dataset.hot);
      const sc = wrap.querySelector('.dmap-scroll');
      if (hot && sc.scrollWidth > sc.clientWidth) {
        const lab = wrap.querySelector('.dmap-row').offsetWidth;
        // Position inside the scrolled grid; offsetLeft is relative to the page here, because
        // no ancestor is positioned.
        const x = hot[0].getBoundingClientRect().left - sc.getBoundingClientRect().left + sc.scrollLeft;
        if (x < sc.scrollLeft + lab || x + hot[0].offsetWidth > sc.scrollLeft + sc.clientWidth) {
          sc.scrollLeft = Math.max(0, x - lab - 8);
        }
      }
    }
  });
  return wrap;
}

/** Paint any element carrying data-ids="1,2,3" (or data-i="7") inside `root`. Idempotent;
 *  call after a view re-renders. */
export function paintLinked(root, sel) {
  root.toggleAttribute('data-sel', !!sel);
  root.querySelectorAll('[data-ids],[data-i]').forEach((n) => {
    const ids = n.dataset.i != null ? [+n.dataset.i] : n.dataset.ids.split(',').map(Number);
    const hot = sel ? ids.filter((i) => sel.ids.has(i)).length : 0;
    n.dataset.hot = !sel ? '' : hot === ids.length ? 'all' : hot ? 'part' : '';
  });
}
