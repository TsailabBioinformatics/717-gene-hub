// Route: #/family/<gene id> -- the whole descent group of a gene, in one view.
//
// The atlas holds a homology graph and shows one node of it at a time. "What is the full
// duplication family of this gene, and which relatives are only reachable through another
// member?" currently takes N page loads and a notebook.
//
// MEASURED BEFORE BUILDING: connected components over tandem, WGD, allele and paralog edges
// give 16,266 families over 60,612 genes, median 3 members and largest 85. Had the edges
// chained the genome into one component, this view would have been useless; that was checked
// first, not assumed.
//
// WHY THERE IS NO PICTURE HERE, deliberately. The obvious design is a radial layout with
// radius = dS from the focal gene. It cannot be drawn honestly: most family members have NO
// dS to the focal gene -- they are reached through another member -- so their radius would be
// invented. A force-directed layout is worse: its equilibrium encodes nothing, and a reader
// correctly assumes position in a scientific figure means something. So the family is rendered
// as what the data actually supports: every member, the edge type that FIRST reached it, and
// how many steps from the focal gene it is. Distance here is graph distance, and it is exact.
import { el, fmt } from '../core/dom.js';
import { getGene, hapLabel } from '../core/data.js';
import { paperTop } from '../core/paper.js';

let FAMS = null;
async function loadFamilies() {
  if (!FAMS) {
    const r = await fetch('data/index/families.json');
    if (!r.ok) throw new Error(`${r.status} families.json`);
    FAMS = await r.json();
  }
  return FAMS;
}

const EDGE = {
  tandem: { label: 'tandem', colour: 'var(--c-tandem)' },
  salicoid: { label: 'sWGD', colour: 'var(--c-core)' },
  gamma: { label: 'aWGT', colour: 'var(--c-priv)' },
  allele: { label: 'the other haplotype', colour: 'var(--ink-3)' },
  paralog: { label: 'paralog pair', colour: 'var(--c-disp)' },
};

/** Edges out of one gene record, typed. */
function edgesOf(rec) {
  const out = [];
  for (const q of (rec.wgd || [])) out.push([q.id, q.e === 'A' ? 'gamma' : 'salicoid', q.ks]);
  if (rec.allele) out.push([rec.allele.id, 'allele', rec.allele.ks]);
  for (const m of ((rec.td || {}).mem || [])) {
    out.push([m[0], 'tandem', ((rec.td || {}).pks || {})[m[0]]]);
  }
  for (const q of (rec.para || [])) out.push([q.id, 'paralog', q.ks]);
  return out;
}

/** Breadth-first from the focal gene over the family's own members. Returns, per member, the
 *  step count and the edge type that first reached it -- both exact, neither inferred. */
async function walk(focal, members) {
  const want = new Set(members);
  const recs = new Map();
  const get = async (id) => {
    if (!recs.has(id)) recs.set(id, await getGene(id).catch(() => null));
    return recs.get(id);
  };
  const seen = new Map([[focal.id, { depth: 0, via: null, ds: null, from: null }]]);
  let frontier = [focal.id];
  recs.set(focal.id, focal);
  while (frontier.length) {
    const next = [];
    // one level at a time, so every member's depth is its true shortest path
    const batch = await Promise.all(frontier.map(get));
    batch.forEach((rec, i) => {
      if (!rec) return;
      const fromId = frontier[i];
      for (const [id, type, ds] of edgesOf(rec)) {
        if (!want.has(id) || seen.has(id)) continue;
        seen.set(id, { depth: seen.get(fromId).depth + 1, via: type, ds, from: fromId });
        next.push(id);
      }
    });
    frontier = next;
  }
  // anything the walk never reached is still a member of the component -- say so rather than
  // dropping it, because a missing row would read as a smaller family
  for (const id of members) {
    if (!seen.has(id)) seen.set(id, { depth: null, via: null, ds: null, from: null });
  }
  return { seen, get };
}

export async function familyView(geneId) {
  const focal = await getGene(geneId);
  if (!focal) {
    return el('div', { class: 'empty' }, el('h2', {}, 'No such gene'),
      el('p', { class: 'mono' }, geneId));
  }
  if (!focal.fam) {
    return el('div', {},
      el('h1', {}, 'No descent group'),
      el('p', { class: 'sub' }, el('span', { class: 'mono' }, focal.id),
        ' has no tandem, whole-genome-duplication, allele or paralog partner.'),
      el('div', { class: 'card' },
        el('p', { style: 'margin:0;font-size:13.5px' },
          '3,348 genes are in this state, and it is a real one: a gene with no homology edge '
          + 'is not in a family. It is deliberately not given a family of one, because that '
          + 'would make "this gene has a family" true of every gene in the atlas.'),
        el('p', { style: 'margin:10px 0 0' },
          el('a', { href: `#/gene/${focal.id}` }, 'Open the gene page →'))));
  }

  const fams = await loadFamilies();
  const members = fams[focal.fam] || [focal.id];
  const { seen, get } = await walk(focal, members);

  const rows = [...seen.entries()]
    .sort((a, b) => (a[1].depth ?? 99) - (b[1].depth ?? 99) || a[0].localeCompare(b[0]));

  const byType = {};
  const chrs = new Set();
  let hap1 = 0;
  for (const [id, info] of rows) {
    if (info.via) byType[info.via] = (byType[info.via] || 0) + 1;
    if (id.startsWith('PtXaTreH')) hap1 += 1;
  }

  const body = await Promise.all(rows.map(async ([id, info]) => {
    const r = await get(id);
    if (r) chrs.add(`${r.hap}:${r.chr}`);
    const focalRow = id === focal.id;
    return el('tr', { style: focalRow ? 'background:var(--panel-2)' : null },
      el('td', {}, focalRow
        ? el('strong', { class: 'mono' }, id)
        : el('a', { href: `#/family/${id}`, class: 'mono', title: 'recentre the family on this gene' }, id)),
      el('td', { class: 'num' }, info.depth == null
        ? el('span', { class: 'muted', title: 'a member of the component, but not reachable '
            + 'from this gene through the edges this page walks' }, 'unreached')
        : (focalRow ? el('span', { class: 'muted' }, 'focal') : info.depth)),
      el('td', {}, info.via
        ? el('span', { style: `color:${EDGE[info.via].colour};font-weight:500` }, EDGE[info.via].label)
        : el('span', { class: 'muted' }, '–')),
      el('td', { class: 'num' }, info.ds == null ? el('span', { class: 'muted' }, '–')
        : (info.ds < 0.1 ? info.ds.toFixed(4) : info.ds.toFixed(3))),
      el('td', { class: 'muted', style: 'font-size:12px' }, r ? `${r.chr}` : '–'),
      el('td', { class: 'muted', style: 'font-size:12px' }, r ? hapLabel(r.hap).split(' ')[0] : '–'),
      el('td', { class: 'num' }, r && r.x && r.x.max != null ? r.x.max.toFixed(1) : el('span', { class: 'muted' }, '–')),
      el('td', { class: 'muted', style: 'font-size:12px' }, r ? (paperTop(r) || '–') : '–'),
      el('td', {}, el('a', { href: `#/gene/${id}`, style: 'font-size:12px' }, 'gene →')));
  }));

  const kinds = Object.entries(byType).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${EDGE[k].label}`).join(', ');

  return el('div', {},
    el('h1', {}, 'Descent group'),
    el('p', { class: 'sub' },
      `Every gene reachable from `, el('span', { class: 'mono' }, focal.id),
      ` through tandem, whole-genome-duplication, allele and paralog edges. `,
      el('span', { class: 'mono muted' }, focal.fam)),

    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(rows.length)), el('div', { class: 'l' }, 'genes in the family')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(chrs.size)), el('div', { class: 'l' }, 'chromosome / haplotype locations')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, `${fmt(hap1)} / ${fmt(rows.length - hap1)}`), el('div', { class: 'l' }, 'HAP1 / HAP2 members')),
      el('div', { class: 'stat' }, el('div', { class: 'n' },
        fmt(Math.max(...rows.map(([, i]) => i.depth ?? 0)))), el('div', { class: 'l' }, 'steps to the furthest member')),
    ),

    el('div', { class: 'card' },
      el('h2', {}, 'Members', el('span', { class: 'tag' }, 'ordered by distance from this gene')),
      el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Gene'), el('th', { class: 'num' }, 'Steps'), el('th', {}, 'First reached by'),
          el('th', { class: 'num' }, 'dS on that edge'), el('th', {}, 'Chr'), el('th', {}, 'Hap'),
          el('th', { class: 'num' }, 'Max TPM'), el('th', {}, 'Peak tissue'), el('th', {}, ''))),
        el('tbody', {}, ...body))),
      el('p', { class: 'muted', style: 'font-size:11.5px;margin:10px 0 0' },
        kinds ? `Edges used to reach these members: ${kinds}. ` : '',
        '"Steps" is graph distance from this gene, and "first reached by" is the edge type that '
        + 'reached it at that distance, a member two steps away is a relative of a relative, '
        + 'not a direct partner. The dS column is that edge’s own value, so it is blank '
        + 'wherever the pair was never scored. Click any gene to recentre the family on it.')),

    el('div', { class: 'card' },
      el('h2', {}, 'Why this is a table and not a picture'),
      el('p', { style: 'margin:0;font-size:13.5px;color:var(--ink-2)' },
        'The obvious design is a radial layout with radius = dS from this gene. It cannot be '
        + 'drawn honestly: most members have no dS to this gene at all, they are reached '
        + 'through another member, so their radius would be invented. A force-directed '
        + 'layout is worse, because its equilibrium encodes nothing while a reader correctly '
        + 'assumes that position in a scientific figure means something. Graph distance is what '
        + 'the data supports, and it is exact.'),
      el('p', { class: 'muted', style: 'font-size:12px;margin:10px 0 0' },
        'The ', el('a', { href: `#/gene/${focal.id}` }, 'Duplication layers'),
        ' card on the gene page does draw the geometry, for the one hop where every link has a '
        + 'real dS and a real genomic position.')));
}

export default { id: 'family', label: 'Descent group' };
