// Search results / refinement page. #/search/<query>
//
// WHY THIS EXISTS: the header dropdown can show an id and one line of description --
// enough to recognise a gene you already know, not enough to pick the right one out of
// many candidates (searching "MYB" or "dehydrin" returns dozens of paralogs that all
// share the description). This page shows the columns that actually distinguish
// paralogs -- synteny class, duplication class, chromosome, phylostratum, peak tissue --
// side by side, paginated, so choosing among many hits is a comparison, not a guess.
//
// Reuses loadFacets()/facetRow() (browse.js's data source) for the fast columns, and
// fetches full gene shards ONLY for the current page's rows, for the description and
// Arabidopsis/Pfam context a facet row doesn't carry. That mirrors this codebase's rule
// that a filter over 63,960 genes reads the small index, not the shards -- extended here
// so a broad query (which could match thousands) never reads more shards than one page.
import { el, clear, fmt } from './dom.js';
import { loadFacets, facetRow, loadGeneIndex, getGene, searchGenesRanked } from './data.js';

const PAGE = 40;

function rowsTable(page, byId, ann) {
  const body = page.map((id) => {
    const r = byId.get(id);
    const a = ann.get(id) || {};
    return el('tr', {},
      el('td', {}, el('a', { href: `#/gene/${id}`, class: 'mono' }, id)),
      el('td', { style: 'font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis' },
        a.sym && a.sym.length ? el('strong', {}, a.sym.join(', ') + ' ') : null,
        (a.d || a.atd || '') || el('span', { class: 'muted' }, '–')),
      el('td', {}, r ? r.hap.toUpperCase() : '–'),
      el('td', {}, r ? (r.cls ? r.cls.replace(/_/g, ' ') : '–') : '–'),
      el('td', {}, a.dup || '–'),
      el('td', {}, r ? (r.chr || '–') : '–'),
      el('td', { class: 'num' }, r && r.ps != null ? 'PS' + r.ps : '–'),
      el('td', {}, r ? (r.top || '–') : '–'),
      el('td', { class: 'num' }, r && r.tau != null ? r.tau.toFixed(2) : '–'));
  });
  return el('div', { class: 'scroll-x' }, el('table', { class: 'data compare' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Gene'), el('th', {}, 'Description'), el('th', {}, 'Hap'),
      el('th', {}, 'Synteny class'), el('th', {}, 'Dup.'), el('th', {}, 'Chr'),
      el('th', { class: 'num' }, 'PS'), el('th', { title: 'tissue group with the highest mean TPM, 222-sample reference panel' }, 'Peak tissue'),
      el('th', { class: 'num', title: 'tissue specificity as in the dissertation' }, 'τ'))),
    el('tbody', {}, ...body)));
}

export async function searchResultsView(query) {
  const sub = el('p', { class: 'sub' },
    `Comparing matches for `, el('span', { class: 'mono' }, `"${query}"`), '…');
  const root = el('div', {}, el('h1', {}, 'Search results'), sub);

  const statRow = el('div', { class: 'stat-row' });
  const tableHolder = el('div', {});
  const pager = el('div', { style: 'display:flex;gap:9px;align-items:center;margin-top:12px' });
  const card = el('div', { class: 'card' }, tableHolder, pager);
  root.append(statRow, card);

  const [{ ids: matches, total }, facets, geneIndex] = await Promise.all([
    searchGenesRanked(query), loadFacets(), loadGeneIndex(),
  ]);

  const rowOf = new Map();
  const posOf = new Map(geneIndex.map((id, i) => [id, i]));
  for (const id of matches) {
    const i = posOf.get(id);
    if (i != null) rowOf.set(id, facetRow(facets, i));
  }

  sub.replaceChildren(`Comparing matches for `, el('span', { class: 'mono' }, `"${query}"`), '.');
  clear(statRow).append(
    el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(total)),
      el('div', { class: 'l' }, total === 1 ? 'match' : 'matches')));

  let page = 0;
  const pages = Math.max(1, Math.ceil(matches.length / PAGE));

  async function render() {
    const slice = matches.slice(page * PAGE, page * PAGE + PAGE);
    const ann = new Map();
    // Only the page shown is fetched -- see the file header. Parallel, but bounded to PAGE.
    await Promise.all(slice.map(async (id) => {
      const g = await getGene(id);
      if (g) ann.set(id, { d: g.ann && g.ann.d, atd: g.ann && g.ann.atd, dup: g.dup && g.dup.t, sym: g.ann && g.ann.sym });
    }));
    clear(tableHolder).append(matches.length
      ? rowsTable(slice, rowOf, ann)
      : el('p', { class: 'muted', style: 'padding:14px 0' },
          `No gene matches "${query}". Search takes a gene ID (a transcript suffix such as .1 is ignored), a P. trichocarpa ID, a gene name, an Arabidopsis locus, a Pfam accession or a word from the description.`));

    clear(pager);
    if (pages > 1) {
      const btn = (label, to, on) => el('button', {
        onclick: () => { page = to; render(); },
        style: `font-size:12px;padding:4px 10px;border:1px solid var(--line-2);border-radius:5px;`
          + `background:var(--panel-2);color:var(--ink);cursor:${on ? 'pointer' : 'default'};`
          + `opacity:${on ? 1 : 0.4}`,
      }, label);
      pager.append(
        page > 0 ? btn('← Prev', page - 1, true) : btn('← Prev', page, false),
        el('span', { class: 'muted', style: 'font-size:12px' }, `page ${page + 1} of ${fmt(pages)}`),
        page < pages - 1 ? btn('Next →', page + 1, true) : btn('Next →', page, false));
    }
  }
  await render();
  return root;
}
