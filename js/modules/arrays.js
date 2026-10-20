// Routes: #/array/<id> and #/arrays -- a curated tandem array as its own page.
//
// Membership comes ONLY from data/index/arrays.json, the curated union tandem set (the same
// 13,048 genes as dup.td and the Duplication card). GENESPACE's `tandem_array_member` synteny
// class is a different, looser call; it is shown per member as a synteny class and never used
// to decide who is in the array.
//
// Everything here is computed in the browser from committed files: member records (getGene),
// the locus tiles (exon features, neighbors, allele ids) and arrays.json. No new index.
import { el, fmt } from '../core/dom.js';
import { getGene, hapLabel, loadArrays, loadFacets, loadGeneIndex } from '../core/data.js';
import { saveSet } from '../core/geneset.js';
import { browseHref } from '../core/browse.js';
import { genesIn, matchingRegion, tissueList, tissueN } from '../core/locusfig.js';
import { chromosomeBrowser } from '../core/locusbrowser.js';
import { loadArrayStatus, statusName, STATUS_ORDER } from '../core/relationship.js';
import { paperTau, paperTop, ageBinName } from '../core/paper.js';

const HAP_OF = (aid) => (aid.startsWith('HAP2') ? 'hap2' : 'hap1');
const CHR_RE = /^PtXa(?:TreH|AlbH)\.(\d+)G/;
const chrOf = (id) => { const m = CHR_RE.exec(id); return m ? `Chr${m[1]}` : 'scaffold'; };
const v9Dup = (d) => {
  if (!d) return null;
  const w = [d.s ? 'sWGD' : null, d.a ? 'aWGT' : null].filter(Boolean);
  return w.length ? w.join(' + ') : 'no WGD partner';
};
const synWords = (g) => (g.syn && g.syn.cls ? g.syn.cls.replace(/_/g, ' ') : null);
const psWords = (g) => (g.ps && g.ps.rank != null ? `PS${g.ps.rank} · ${g.ps.name}` : null);
const na = (t = 'not measured') => el('span', { class: 'muted' }, t);

function download(name, text) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/tab-separated-values' })), download: name });
  document.body.append(a); a.click(); a.remove();
}

/** Every member pair with what the release holds for it. Ks from the tandem union rebuild
 *  (td.pks, per detected edge); Ka/Ks/omega from the paralog-pair table (g.para) when that
 *  table happens to list the pair. Two sources, labelled separately, never merged. */
function pairTable(genes) {
  const byId = new Map(genes.map((g) => [g.id, g]));
  const out = [];
  for (let i = 0; i < genes.length; i += 1) {
    for (let j = i + 1; j < genes.length; j += 1) {
      const a = genes[i];
      const b = genes[j];
      const pks = ((a.td || {}).pks || {})[b.id] ?? ((b.td || {}).pks || {})[a.id] ?? null;
      const para = (a.para || []).find((p) => p.id === b.id) || (b.para || []).find((p) => p.id === a.id) || null;
      const r = (((a.td || {}).mem || []).find((m) => m[0] === b.id) || [])[1] ?? null;
      out.push({ a: a.id, b: b.id, ks: pks, para, r });
    }
  }
  return { out, byId };
}

function divergenceCard(genes) {
  const { out } = pairTable(genes);
  const n = genes.length;
  const withKs = out.filter((p) => p.ks != null).length;
  const withW = out.filter((p) => p.para && p.para.w != null).length;
  // Matrix: upper triangle Ks, cell shade in 5 bins of Ks over the array's own max.
  const maxKs = Math.max(0.0001, ...out.filter((p) => p.ks != null).map((p) => p.ks));
  const at = new Map(out.map((p) => [`${p.a}|${p.b}`, p]));
  const short = (id) => id.replace(/^PtXa(TreH|AlbH)\./, '');
  const matrix = el('table', { class: 'arr-matrix', 'data-arr-matrix': '' },
    el('thead', {}, el('tr', {}, el('th', {}, ''), ...genes.map((g) => el('th', { class: 'mono' }, short(g.id))))),
    el('tbody', {}, ...genes.map((g, i) => el('tr', {},
      el('th', { class: 'mono' }, short(g.id)),
      ...genes.map((h, j) => {
        if (j <= i) return el('td', { class: 'arr-mx-off' }, '');
        const p = at.get(`${g.id}|${h.id}`);
        if (!p || p.ks == null) return el('td', { class: 'arr-mx-na', title: 'no Ks estimate for this pair' }, '·');
        const bin = Math.min(4, Math.floor((p.ks / maxKs) * 5));
        return el('td', { class: `arr-mx b${bin}`, title: `${g.id} × ${h.id}: Ks ${p.ks.toFixed(4)}` }, p.ks.toFixed(3));
      })))));
  const rows = out.map((p) => el('tr', {},
    el('td', {}, el('a', { href: `#/gene/${p.a}`, class: 'mono' }, short(p.a)), ' × ',
      el('a', { href: `#/gene/${p.b}`, class: 'mono' }, short(p.b))),
    el('td', { class: 'num' }, p.ks == null ? na('–') : p.ks.toFixed(4)),
    el('td', { class: 'num' }, p.para && p.para.ks != null ? p.para.ks.toFixed(4) : na('–')),
    el('td', { class: 'num' }, p.para && p.para.ka != null ? p.para.ka.toFixed(4) : na('–')),
    el('td', { class: 'num' }, p.para && p.para.w != null ? p.para.w.toFixed(3) : na('–')),
    el('td', { class: 'num' }, p.r == null ? na('–') : p.r.toFixed(2))));
  return el('div', { class: 'card', 'data-arr-div': '' },
    el('h2', {}, 'Divergence among members', el('span', { class: 'tag' }, `${out.length} member pairs`)),
    el('p', { class: 'arr-note' },
      `${withKs} of the ${out.length} pairs among ${n} members have a Ks estimate from the tandem `
      + `analysis; ${out.length - withKs} have none, because only detected tandem edges were `
      + `scored. A missing value means "not scored", never "identical". ${withW} pair${withW === 1 ? '' : 's'} `
      + 'also appear in the paralog-pair table with Ka and ω; that table is a separate source and '
      + 'its Ks can differ from the tandem analysis.'),
    n > 2 ? el('div', { class: 'scroll-x' }, matrix) : null,
    n > 2 ? el('p', { class: 'arr-note' }, `Matrix: Ks per pair (upper triangle), shaded in five equal bins `
      + `of this array's maximum Ks (${maxKs.toFixed(3)}); a dot is a pair with no estimate.`) : null,
    el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Pair'),
        el('th', { class: 'num', title: 'from the tandem analysis, per detected tandem pair' }, 'Ks (tandem)'),
        el('th', { class: 'num', title: 'paralog-pair table' }, 'Ks (paralog)'),
        el('th', { class: 'num' }, 'Ka'), el('th', { class: 'num' }, 'ω'),
        el('th', { class: 'num', title: 'Pearson r, batch-corrected log2 expression, 652 samples' }, 'Expr r'))),
      el('tbody', {}, ...rows))));
}

function exprCard(genes) {
  const tissues = tissueList(genes);
  const withX = genes.filter((g) => g.x && g.x.t);
  if (!tissues.length) {
    return el('div', { class: 'card' }, el('h2', {}, 'Expression'),
      el('p', { class: 'arr-note' }, `None of the ${genes.length} members has an expression profile.`));
  }
  const { n, disagree } = tissueN(genes, tissues);
  const lg = (v) => Math.log2(v + 1);
  const max = Math.max(0.01, ...withX.flatMap((g) => tissues.map((t) => lg(g.x.t[t] || 0))));
  const short = (id) => id.replace(/^PtXa(TreH|AlbH)\./, '');
  const table = el('table', { class: 'arr-heat', 'data-arr-heat': '' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Member'),
      ...tissues.map((t) => el('th', {}, el('div', {}, t.replace(/_/g, ' ')),
        el('div', { class: 'arr-n' }, n[t] == null ? 'n –' : `n ${n[t]}`))),
      el('th', { title: 'tissue specificity: mean TPM in 9 tissue groups of the 222-sample reference panel' }, 'τ'))),
    el('tbody', {}, ...genes.map((g) => el('tr', { 'data-arr-heat-row': g.id },
      el('th', {}, el('a', { href: `#/gene/${g.id}`, class: 'mono' }, short(g.id))),
      ...tissues.map((t) => {
        const v = g.x && g.x.t ? g.x.t[t] : null;
        if (v == null) return el('td', { class: 'arr-h-na', title: 'no value' }, '–');
        const bin = Math.min(5, Math.floor((lg(v) / max) * 6));
        return el('td', { class: `arr-h h${bin}`, title: `${g.id} ${t}: median ${v} TPM` },
          v >= 100 ? v.toFixed(0) : v.toFixed(1));
      }),
      el('td', { class: 'num' }, paperTau(g) != null ? paperTau(g).toFixed(2) : '–')))));
  return el('div', { class: 'card', 'data-arr-expr': '' },
    el('h2', {}, 'Expression by tissue', el('span', { class: 'tag' }, 'median TPM, WT controls')),
    el('div', { class: 'scroll-x' }, table),
    el('p', { class: 'arr-note' },
      `${withX.length} of ${genes.length} members have a profile. Each cell is the member's median TPM in `
      + 'that tissue; n under each tissue is the number of samples the median is taken over'
      + (disagree ? ' (members disagree on n; the first is shown)' : '')
      + `. Shading is log2(TPM + 1) in six equal bins of this array's maximum; the number is the TPM. `
      + 'Raw TPM on a combined-transcriptome quantification: reads shared between near-identical '
      + 'copies are not resolved, so similar values across members partly reflect that.'),
    el('div', { class: 'arr-legend' }, 'Shade: ',
      ...[0, 1, 2, 3, 4, 5].map((b) => el('span', { class: `arr-h h${b} arr-sw` }, '')),
      el('span', { class: 'muted' }, ' low → high')));
}

function memberTable(genes, other) {
  const rows = genes.map((g, i) => el('tr', { 'data-arr-member': g.id },
    el('td', { class: 'num' }, i + 1),
    el('td', {}, el('a', { href: `#/gene/${g.id}`, class: 'mono' }, g.id),
      g.dup && g.dup.td ? null : el('div', { class: 'arr-small muted' }, 'removed by the screen')),
    el('td', {}, g.strand || '–'),
    el('td', { class: 'num' }, ((g.end - g.start) / 1000).toFixed(2)),
    el('td', { class: 'num' }, g.gs ? g.gs.ex : '–'),
    el('td', {}, psWords(g) || na()),
    el('td', {}, synWords(g) || na()),
    el('td', {}, v9Dup(g.dup) || na()),
    el('td', {}, g.allele ? el('span', {}, el('a', { href: `#/gene/${g.allele.id}`, class: 'mono' }, g.allele.id),
      ' ', el('a', { href: `#/pair/${g.id}`, class: 'arr-small' }, 'pair')) : na('none called')),
    el('td', {}, paperTop(g) || na('–')),
    el('td', { class: 'arr-desc' }, ((g.ann || {}).d) || na('no description'))));
  return el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, el('th', { class: 'num' }, '#'), el('th', {}, 'Gene'), el('th', {}, 'Strand'),
      el('th', { class: 'num' }, 'Length kb'), el('th', { class: 'num' }, 'Exons'),
      el('th', {}, 'Phylostratum'), el('th', { title: 'GENESPACE synteny class: a different call from the curated tandem set' }, 'Synteny class'),
      el('th', { title: 'whole-genome duplication partners, the primary call' }, 'WGD'),
      el('th', {}, `Allele (${hapLabel(other)})`), el('th', {}, 'Peak tissue'), el('th', {}, 'Description'))),
    el('tbody', {}, ...rows)));
}

function tsv(genes) {
  const head = ['gene', 'haplotype', 'chr', 'start', 'end', 'strand', 'exons', 'phylostratum_rank',
    'phylostratum_name', 'synteny_class_GENESPACE', 'wgd_events', 'duplication_class_code', 'allele', 'peak_tissue_reference_panel', 'tau_reference_panel', 'description'];
  const lines = [head.join('\t')];
  for (const g of genes) {
    lines.push([g.id, g.hap, g.chr, g.start, g.end, g.strand, g.gs ? g.gs.ex : '',
      g.ps && g.ps.rank != null ? g.ps.rank : '', g.ps ? g.ps.name || '' : '', (g.syn || {}).cls || '',
      v9Dup(g.dup) || '', (g.dup || {}).t || '', g.allele ? g.allele.id : '', paperTop(g) || '',
      paperTau(g) != null ? paperTau(g) : '', ((g.ann || {}).d || '').replace(/[\t\n]/g, ' ')].join('\t'));
  }
  return lines.join('\n');
}

export async function arrayView(aid) {
  const all = await loadArrays();
  const ids = all[aid];
  if (!ids) {
    return el('div', { class: 'empty' }, el('h2', {}, 'No such tandem array'), el('p', { class: 'mono' }, aid),
      el('p', {}, el('a', { href: '#/arrays' }, 'All tandem arrays →')));
  }
  const hap = HAP_OF(aid);
  const other = hap === 'hap1' ? 'hap2' : 'hap1';
  const genes = (await Promise.all(ids.map((id) => getGene(id)))).filter(Boolean)
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  const chr = genes[0].chr;
  const from = Math.min(...genes.map((g) => g.start));
  const to = Math.max(...genes.map((g) => g.end));
  const withAllele = genes.filter((g) => g.allele);

  // Locus: the shared two-haplotype browser, opened on the array with room either side. Only
  // the members (top) and their OWN alleles (bottom) are highlighted; other tandem arrays on
  // the other haplotype are drawn but not marked, because nothing links them to this one.
  const pad = Math.max(15000, (to - from) * 0.6);
  const figHolder = el('div', { 'data-arr-locus': '' }, el('p', { class: 'muted' }, 'Drawing the locus…'));
  const linkBox = el('div', { class: 'lb-linkbox', 'data-arr-linked': '' }, el('p', { class: 'muted' }, 'Finding the matching array…'));
  (async () => {
    const alleleIds = withAllele.map((g) => g.allele.id);
    const alleles = (await Promise.all(alleleIds.map((id) => getGene(id).catch(() => null)))).filter(Boolean);
    let anchors = new Set();
    let otherChr = null;
    let region = null;
    if (alleles.length) {
      const c = new Map();
      alleles.forEach((o) => c.set(o.chr, (c.get(o.chr) || 0) + 1));
      otherChr = [...c.entries()].sort((x, y) => y[1] - x[1])[0][0];
    } else {
      const wide = await genesIn(hap, chr, from - 3e5, to + 3e5);
      region = await matchingRegion(hap, wide, ids, 12, 2);
      if (region) { anchors = new Set(region.anchors.map(([a]) => a)); otherChr = region.chr; }
    }
    const otherL = hapLabel(other);
    const st = (await loadArrayStatus())[aid] || null;
    const lines = [];
    // First: how the array relates to the other haplotype, from the syntenic group as a whole.
    if (st) {
      lines.push(el('p', { 'data-arr-rel': st.k },
        el('strong', {}, statusName(st.k)), st.dt ? `: ${st.dt}.` : '.',
        ` Its syntenic group holds ${st.n1} HAP1 and ${st.n2} HAP2 quality-filtered genes.`));
      if (st.o.length) {
        lines.push(el('p', { 'data-arr-linked-array': st.o[0] },
          `Matching array${st.o.length > 1 ? 's' : ''} on ${otherL}: `,
          ...st.o.flatMap((k, i) => [i ? ', ' : '', el('a', { href: `#/array/${k}`, class: 'mono' }, k)]),
          '. Its genes are outlined in the figure.'));
      } else if (st.og.length) {
        lines.push(el('p', {}, `On ${otherL} the group is ${st.og.length} gene${st.og.length === 1 ? '' : 's'} outside any tandem array `
          + '(outlined in the figure): ', ...st.og.flatMap((g2, i) => [i ? ', ' : '', el('a', { href: `#/gene/${g2}`, class: 'mono' }, g2)])));
      }
    } else {
      lines.push(el('p', {}, 'This detected array is not counted (the pseudogene screen removed its members), so it has no relationship status.'));
    }
    // Then: the members' own allele calls, which are what the solid lines draw.
    if (alleles.length) {
      lines.push(el('p', {}, `${withAllele.length} of ${genes.length} members ${withAllele.length === 1 ? 'has its' : 'have their'} own allele on ${otherL}; `
        + 'those alleles are filled and joined by solid lines.'));
    } else if (region) {
      lines.push(el('p', {}, `No member has its own allele on ${otherL}. The view is lined up by the alleles of `
        + `${anchors.size} neighboring gene${anchors.size === 1 ? '' : 's'} (dashed lines).`));
    } else {
      lines.push(el('p', {}, `No member and no gene within 300 kb has an allele on ${otherL}, so the matching region cannot be placed.`));
    }
    const outline = st ? new Set(st.og) : new Set();
    linkBox.replaceChildren(...lines);
    figHolder.replaceChildren(await chromosomeBrowser({
      hap, chr, otherChr: otherChr || chr, start: Math.max(0, from - pad), end: to + pad, embed: true,
      focus: new Set(ids), linked: new Set(alleleIds), anchors,
      outline,
      outlineLabel: outline.size ? `the syntenic group on ${hapLabel(other)}` : null,
      focusLabel: 'array member and its own allele' }));
  })().catch((e) => { figHolder.replaceChildren(el('p', { class: 'muted' }, `Locus unavailable: ${e.message}`)); });

  const saveBtn = el('button', { class: 'btn', type: 'button', 'data-arr-save': '',
    onclick: () => {
      try { saveSet(`array ${aid}`, ids, { source: `tandem array ${aid}` }); saveBtn.textContent = 'Saved as a gene set ✓'; }
      catch (e) { saveBtn.textContent = `Could not save: ${e.message}`; }
    } }, 'Save members as a gene set');
  const psSet = [...new Set(genes.map((g) => (g.ps && g.ps.rank != null ? g.ps.rank : null)).filter((v) => v != null))];
  // arrays.json lists every DETECTED array; the pseudogene screen then removed members, and the
  // manuscript counts only members that passed (dup.td; master v11 counted_in_manuscript).
  const nCounted = genes.filter((g) => g.dup && g.dup.td).length;
  const status = nCounted === genes.length ? null
    : el('div', { class: 'warn', 'data-arr-status': nCounted ? 'reduced' : 'removed' },
      nCounted
        ? `${nCounted} of ${genes.length} members are counted in the curated tandem set; the pseudogene `
          + `screen removed ${genes.length - nCounted}. Counts in the manuscript use the ${nCounted}.`
        : `Not counted in the manuscript: the pseudogene screen removed ${genes.length === 1 ? 'its member' : 'every member'}`
          + ' or left too few to form an array. It is listed because it was detected; its members '
          + 'appear as dispersed or single-copy elsewhere on this site.');

  return el('div', { class: 'arr-page', 'data-arr-page': aid, 'data-arr-n': genes.length },
    el('div', { class: 'page-head' },
      el('div', { class: 'kicker' }, `Tandem array · ${hapLabel(hap)}`),
      el('h1', { class: 'mono-h' }, aid),
      el('p', { class: 'sub' },
        `${genes.length} members in genomic order on ${chr}:${fmt(from)}–${fmt(to)} `
        + `(${((to - from) / 1000).toFixed(1)} kb). Membership is the curated union tandem set, the same `
        + 'one the Duplication card uses; GENESPACE’s looser tandem placement is not used here.')),
    status,
    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' }, el('div', { class: 'n' }, genes.length), el('div', { class: 'l' }, 'members')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, `${withAllele.length}/${genes.length}`), el('div', { class: 'l' }, `with an allele on ${hapLabel(other)}`)),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, genes[0].td && genes[0].td.ks != null ? genes[0].td.ks : '–'), el('div', { class: 'l' }, 'array median Ks')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, (genes[0].td && genes[0].td.age ? ageBinName(genes[0].td.age) : '–')), el('div', { class: 'l' }, 'age bin'))),
    el('div', { class: 'arr-actions' },
      el('a', { class: 'btn', href: '#', 'data-arr-tsv': '', onclick: (e) => { e.preventDefault(); download(`717atlas_${aid}_members.tsv`, tsv(genes)); } }, 'Download members (TSV)'),
      saveBtn,
      el('a', { class: 'btn ghost', href: browseHref({ hap, chr, tandem: 'yes' }) }, `Tandem genes on ${chr} in Browse`),
      el('a', { class: 'btn ghost', href: '#/arrays' }, 'All arrays')),
    el('div', { class: 'card' },
      el('h2', {}, `This array on both haplotypes`, el('span', { class: 'tag' }, `n = ${genes.length} members`)),
      linkBox,
      figHolder),
    el('div', { class: 'card' },
      el('h2', {}, 'Members', el('span', { class: 'tag' }, `${genes.length} genes, genomic order`)),
      memberTable(genes, other),
      el('p', { class: 'arr-note' },
        `Phylostratum: ${psSet.length} distinct rank${psSet.length === 1 ? '' : 's'} among the members. `
        + 'Synteny class is GENESPACE’s call and can read "tandem array member" or not independently of '
        + 'this array. The WGD column is the primary call, not the exploratory topology re-check.')),
    divergenceCard(genes),
    exprCard(genes));
}

// ---------------------------------------------------------------------------------------------
export async function arraysIndexView() {
  const [all, facets, geneIds, ast] = await Promise.all([loadArrays(), loadFacets(), loadGeneIndex(), loadArrayStatus()]);
  // Counted = passed the pseudogene screen (dup.td, the facet index's `tandem` column). arrays.json lists every DETECTED array, so 167 of its 4,371 have no
  // counted member at all and 89 lost some.
  const ti = facets.cols.indexOf('tandem');
  const td = new Map(geneIds.map((id, i) => [id, facets.rows[i][ti] === 1]));
  const rows = Object.keys(all).sort().map((aid) => {
    const ids = all[aid];
    const k = ids.filter((id) => td.get(id)).length;
    return { aid, hap: HAP_OF(aid), chr: chrOf(ids[0]), n: ids.length, k,
      status: k === 0 ? 'removed' : k < ids.length ? 'reduced' : 'counted',
      rel: (ast[aid] || {}).k || null,
      first: ids[0], last: ids[ids.length - 1] };
  });
  const state = { sort: 'n', dir: -1, hap: '', chr: '', status: '', rel: '', shown: 150 };
  const body = el('tbody');
  const count = el('p', { class: 'arr-note', 'data-arrays-count': '' });
  const more = el('button', { class: 'btn', type: 'button', onclick: () => { state.shown += 300; render(); } }, 'Show more');
  const cmp = {
    n: (a, b) => a.n - b.n, aid: (a, b) => (a.aid < b.aid ? -1 : 1),
    hap: (a, b) => (a.hap < b.hap ? -1 : a.hap > b.hap ? 1 : 0), chr: (a, b) => (a.chr < b.chr ? -1 : a.chr > b.chr ? 1 : 0),
  };
  function render() {
    const list = rows.filter((r) => (!state.hap || r.hap === state.hap) && (!state.chr || r.chr === state.chr)
      && (!state.status || (state.status === 'in' ? r.k > 0 : r.status === state.status))
      && (!state.rel || r.rel === state.rel))
      .sort((a, b) => state.dir * cmp[state.sort](a, b) || (a.aid < b.aid ? -1 : 1));
    body.replaceChildren(...list.slice(0, state.shown).map((r) => el('tr', { 'data-arrays-row': r.aid },
      el('td', {}, el('a', { href: `#/array/${r.aid}`, class: 'mono' }, r.aid)),
      el('td', {}, hapLabel(r.hap)), el('td', {}, r.chr), el('td', { class: 'num' }, r.n),
      el('td', { class: 'num' }, r.k === r.n ? r.k : el('span', { title: 'members that passed the pseudogene screen' },
        `${r.k} of ${r.n}`)),
      el('td', { 'data-arrays-rel': r.rel || '' }, r.rel ? statusName(r.rel) : el('span', { class: 'muted' }, 'not counted')),
      el('td', { class: 'mono arr-desc' }, `${r.first} … ${r.last}`))));
    const byHap = (h) => list.filter((r) => r.hap === h);
    count.textContent = `Showing ${Math.min(state.shown, list.length)} of ${list.length} arrays `
      + `(${hapLabel('hap1')}: ${byHap('hap1').length} arrays, ${byHap('hap1').reduce((s, r) => s + r.n, 0)} genes; `
      + `${hapLabel('hap2')}: ${byHap('hap2').length} arrays, ${byHap('hap2').reduce((s, r) => s + r.n, 0)} genes).`;
    more.hidden = list.length <= state.shown;
  }
  const sortBtn = (key, label) => el('button', { class: 'arr-sort', type: 'button', 'data-arrays-sort': key,
    onclick: () => { state.dir = state.sort === key ? -state.dir : (key === 'n' ? -1 : 1); state.sort = key; render(); } }, label);
  const chrs = [...new Set(rows.map((r) => r.chr))].sort();
  const hapSel = el('select', { 'data-arrays-hap': '', onchange: (e) => { state.hap = e.target.value; render(); } },
    el('option', { value: '' }, 'Both haplotypes'), el('option', { value: 'hap1' }, hapLabel('hap1')), el('option', { value: 'hap2' }, hapLabel('hap2')));
  const statusSel = el('select', { 'data-arrays-status': '', onchange: (e) => { state.status = e.target.value; render(); } },
    el('option', { value: '' }, 'Every detected array'),
    el('option', { value: 'in' }, 'Counted'),
    el('option', { value: 'reduced' }, 'Counted, some members removed'),
    el('option', { value: 'removed' }, 'Not counted (removed by the screen)'));
  const relSel = el('select', { 'data-arrays-rel-filter': '', onchange: (e) => { state.rel = e.target.value; render(); } },
    el('option', { value: '' }, 'Any relationship to the other haplotype'),
    ...STATUS_ORDER.map((k) => el('option', { value: k }, statusName(k))));
  const chrSel = el('select', { onchange: (e) => { state.chr = e.target.value; render(); } },
    el('option', { value: '' }, 'All chromosomes'), ...chrs.map((c) => el('option', { value: c }, c)));
  // Size histogram, one bar per size, per haplotype -- never summed.
  const sizes = [...new Set(rows.map((r) => Math.min(r.n, 10)))].sort((a, b) => a - b);
  const hist = el('table', { class: 'data arr-hist' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Members'), el('th', { class: 'num' }, hapLabel('hap1')), el('th', { class: 'num' }, hapLabel('hap2')))),
    el('tbody', {}, ...sizes.map((s) => el('tr', {}, el('td', {}, s === 10 ? '10 or more' : s),
      el('td', { class: 'num' }, rows.filter((r) => r.hap === 'hap1' && Math.min(r.n, 10) === s).length),
      el('td', { class: 'num' }, rows.filter((r) => r.hap === 'hap2' && Math.min(r.n, 10) === s).length)))));
  render();
  return el('div', { class: 'arr-page', 'data-arrays-index': '' },
    el('div', { class: 'page-head' },
      el('div', { class: 'kicker' }, 'Duplication'),
      el('h1', {}, 'Tandem arrays'),
      el('p', { class: 'sub' }, 'Every array in the curated union tandem set, per haplotype. Pick one to see its members '
        + 'to scale, their divergence, expression and the matching region on the other haplotype.'),
      el('p', { class: 'arr-note', 'data-arrays-counted': '' },
        `Counted: ${fmt(rows.filter((r) => r.hap === 'hap1' && r.k > 0).length)} ${hapLabel('hap1')} and `
        + `${fmt(rows.filter((r) => r.hap === 'hap2' && r.k > 0).length)} ${hapLabel('hap2')} arrays. The list also holds `
        + `${rows.filter((r) => r.k === 0).length} detected arrays the pseudogene screen removed; use the filter to hide them.`)),
    el('div', { class: 'card' }, el('h2', {}, 'Array sizes', el('span', { class: 'tag' }, 'count of arrays per haplotype')), hist),
    el('div', { class: 'card', 'data-arrays-rel-table': '' },
      el('h2', {}, 'Relationship to the other haplotype', el('span', { class: 'tag' }, 'counted arrays, per haplotype')),
      relTable(rows)),
    el('div', { class: 'card' },
      el('div', { class: 'arr-actions' }, hapSel, chrSel, statusSel, relSel),
      count,
      el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, sortBtn('aid', 'Array')), el('th', {}, sortBtn('hap', 'Haplotype')),
          el('th', {}, sortBtn('chr', 'Chromosome')), el('th', { class: 'num' }, sortBtn('n', 'Members')),
          el('th', { class: 'num', title: 'members that passed the pseudogene screen' }, 'Counted'),
          el('th', {}, 'Relationship to the other haplotype'), el('th', {}, 'First … last member'))),
        body)),
      more));
}

/** Counted arrays by relationship status, one column per haplotype, n and % of that
 *  haplotype's counted arrays. Never pooled. */
function relTable(rows) {
  const tot = (h) => rows.filter((r) => r.hap === h && r.rel).length;
  const T = { hap1: tot('hap1'), hap2: tot('hap2') };
  const cell = (h, k) => {
    const n = rows.filter((r) => r.hap === h && r.rel === k).length;
    const p = 100 * n / T[h];
    return el('td', { class: 'num' }, n ? `${fmt(n)} (${p < 0.1 ? p.toFixed(2) : p.toFixed(1)}%)` : '0');
  };
  return el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Status'),
      el('th', { class: 'num' }, `${hapLabel('hap1')} (n = ${fmt(T.hap1)})`),
      el('th', { class: 'num' }, `${hapLabel('hap2')} (n = ${fmt(T.hap2)})`))),
    el('tbody', {}, ...STATUS_ORDER.map((k) => el('tr', { 'data-arrays-rel-row': k },
      el('td', {}, statusName(k)), cell('hap1', k), cell('hap2', k))))));
}

export default { id: 'arrays', label: 'Tandem arrays' };
