// Module: duplication. Within-haplotype paralog pairs with dS/dN, plus tandem-array context.
//
// Scope is stated on the page, because it is easy to over-read: the paralog set is the
// chapter's tier-2 selection (phylostrata 16-18 plus a rank-12 comparator), NOT a genome-wide
// duplication catalog. Tandem-array membership, by contrast, is genome-wide.
import { el, fmt } from '../core/dom.js';
import { loadArrays, getGene } from '../core/data.js';
import { browseHref } from '../core/browse.js';
import { ageBinName, AGE_BINS, paperTop } from '../core/paper.js';

// Paralog-pair provenance, as a reader would say it. The upstream code for the first source is
// "founder" (the gene family's oldest member arises at that stratum); the word explained nothing.
const PAIR_SRC = { founder: 'same gene family', synteny: 'syntenic paralog' };

// The two whole-genome events every Populus gene can carry, oldest last. Codes match g.dup.
const WGD_EVENT = {
  S: { name: 'sWGD', when: 'whole-genome duplication shared by Populus and Salix, about 60 million years ago; anchor-pair Ks peaks at 0.25 in this genome (median 0.27)' },
  A: { name: 'aWGT', when: 'whole-genome triplication shared by all core eudicots, about 120 million years ago; anchor-pair Ks peaks near 1.7 in this genome (median 1.90), a range where synonymous sites are saturated, so read it as "very old" rather than as a clock' },
};

const STRATUM = { 12: 'Pentapetalae', 16: 'Salicaceae', 17: 'Saliceae', 18: 'Populus', 19: 'hybrid' };

const DUP_CODE = { S: 'sWGD', A: 'aWGT', T: 'tandem', D: 'dispersed' };

// Exported so the gene page's overview strip names the classes with this exact
// vocabulary rather than growing a second one that can drift from it.
export function dupTypeLabel(d) {
  if (!d) return null;
  if (d.t === 'C') return 'no duplication detected';
  const parts = [];
  if (d.s) parts.push(DUP_CODE.S);
  if (d.a) parts.push(DUP_CODE.A);
  if (d.td) parts.push(DUP_CODE.T);
  if (d.d) parts.push(DUP_CODE.D);
  return parts.join(' + ') || d.t;
}

// Every duplicate table on this card answers "who" and, until now, at most one of "what kind",
// "how diverged" and "is it expressed". A reader comparing copies needs all three in the same
// row -- flipping to each partner's own page to read its class and its peak TPM is exactly the
// comparison this card exists to save.
//
// The class and the expression live on the PARTNER's record, not on this gene's, so they are
// filled in after a shard fetch per partner rather than blocking the card. The cells start as
// an ellipsis and become either a value or an explicit dash; a cell never silently stays blank,
// because a blank in a numeric column reads as a zero.
function partnerCells() {
  return {
    type: el('td', { class: 'mono muted', style: 'font-size:11.5px' }, '…'),
    max: el('td', { class: 'num muted' }, '…'),
    top: el('td', { class: 'muted', style: 'font-size:11.5px' }, '…'),
  };
}

function partnerHeaders() {
  return [
    el('th', { title: 'the partner’s own duplication class letters (A gamma, S salicoid, '
      + 'T tandem, D dispersed, C none)' }, 'Its class'),
    el('th', { class: 'num', title: 'highest TPM the partner reaches in any of the 652 samples '
      + '– raw, not batch-corrected' }, 'Max TPM'),
    el('th', { title: 'tissue group with the partner’s highest mean TPM in the 222-sample reference panel' }, 'Peak tissue'),
  ];
}

/** Fill the deferred cells. One getGene per partner; shards are cached, and tandem members
 *  share a shard with the focal gene, so an array of 8 is usually 1 request. */
function fillPartners(entries) {
  return Promise.all(entries.map(async ({ id, cells }) => {
    let p = null;
    try { p = await getGene(id); } catch { /* fall through to the not-found rendering */ }
    if (!p) {
      for (const c of Object.values(cells)) { c.textContent = '–'; c.title = 'record not found'; }
      return;
    }
    const label = dupTypeLabel(p.dup);
    cells.type.textContent = p.dup ? p.dup.t : '–';
    cells.type.title = label || 'no duplication class on the partner record';
    cells.type.classList.remove('muted');
    const x = p.x;
    // One decimal below 1,000 and a grouped integer above it: fmt() alone rendered 1.0 as
    // "1" in a column whose neighbors read 0.8 and 1.4, which looked like a different unit.
    cells.max.textContent = x && x.max != null
      ? (x.max >= 1000 ? fmt(Math.round(x.max)) : x.max.toFixed(1))
      : '–';
    cells.max.title = x && x.max != null ? '' : 'no expression profile for this gene';
    if (x && x.max != null) cells.max.classList.remove('muted');
    cells.top.textContent = paperTop({ x }) || '–';
  }));
}

// The array's whole duplication history, as text. Same fact the Duplication layers card
// draws, in the one place a reader looks for "what happened to this gene" in words.
//
// The distinction it exists to make: a tandem array can have gone through salicoid WGD or
// gamma while THIS copy retained no partner for it. The gene's class letters describe the
// gene; this line describes the locus. Stating them as the same thing would be wrong in both
// directions, so the line always names whose property it is.
function arrayHistoryLine(g, memberIds) {
  const holder = el('dd', {}, el('span', { class: 'muted' }, 'checking the other members…'));
  const ownEvents = new Set((g.wgd || []).map((p) => (p.e === 'A' ? 'A' : 'S')));
  (async () => {
    // td.mem is display-capped. History must use the complete curated array index.
    const arrays = await loadArrays().catch(() => null);
    const completeIds = arrays && g.td && arrays[g.td.aid];
    if (!completeIds) {
      holder.replaceChildren(el('span', { class: 'muted' },
        'Full array membership could not be read; array-level WGD history is unavailable.'));
      return;
    }
    const otherIds = completeIds.filter((id) => id !== g.id);
    const recs = await Promise.all(otherIds.map((id) => getGene(id).catch(() => null)));
    const via = { S: [], A: [] };
    let unresolved = 0;
    recs.forEach((r, i) => {
      if (!r) { unresolved += 1; return; }
      for (const q of (r.wgd || [])) via[q.e === 'A' ? 'A' : 'S'].push(otherIds[i]);
    });
    const evName = { S: 'sWGD', A: 'aWGT' };
    const present = ['S', 'A'].filter((e) => ownEvents.has(e) || via[e].length);
    if (!present.length) {
      holder.replaceChildren(el('span', { class: 'muted' },
        unresolved
          ? 'No WGD partner was found among the members that could be read; full array history remains unresolved.'
          : 'No member of this array retains a whole-genome duplication partner. That is not '
            + 'evidence the array predates those events, only that no anchor pair was called here.'));
      return;
    }
    const parts = present.map((e) => {
      const mine = ownEvents.has(e);
      const others = [...new Set(via[e])];
      return el('div', { style: 'margin-top:3px' },
        el('strong', {}, evName[e]), ', ',
        mine ? 'this gene retains a partner' : el('span', {}, 'this gene retains ',
          el('strong', {}, 'no'), ' partner'),
        others.length
          ? el('span', { class: 'muted' }, `; ${others.length} other array member`
              + `${others.length === 1 ? '' : 's'} do${others.length === 1 ? 'es' : ''}: `,
              ...others.flatMap((id, i) => [i ? ', ' : '',
                el('a', { href: `#/gene/${id}`, class: 'mono' }, id)]))
          : el('span', { class: 'muted' }, '; no other member does'));
    });
    holder.replaceChildren(...parts,
      el('div', { class: 'muted', style: 'font-size:11.5px;margin-top:5px' },
        'An event listed here means an array member retains a partner from it. The duplication '
        + 'class above is a property of this gene alone, so the two can differ: another member can '
        + 'retain a whole-genome duplication partner while this copy retains none.'
        + (unresolved ? ` ${unresolved} member could not be read.` : '')));
  })();
  return holder;
}

function wgdSection(g) {
  const d = g.dup || {};
  const pairs = g.wgd || [];
  const wrap = el('div', { style: 'margin-top:12px' },
    el('h3', { style: 'font-size:13px;margin:0 0 6px' }, 'Whole-genome duplication'));
  const kv = el('dl', { class: 'kv' });
  for (const code of ['S', 'A']) {
    const ev = WGD_EVENT[code];
    const called = code === 'S' ? !!d.s : !!d.a;
    const mine = pairs.filter((p) => p.e === code);
    kv.append(el('dt', {}, ev.name),
      el('dd', {},
        called ? el('strong', {}, 'retained duplicate') : el('span', { class: 'muted' }, 'not called'),
        mine.length ? el('span', { class: 'muted' }, ` · ${mine.length} anchor partner${mine.length === 1 ? '' : 's'}`) : null,
        el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' }, ev.when)));
  }
  wrap.append(kv);

  // One call. Until 0.18.0 a second, exploratory "topology re-check" was shown beside it and
  // 1,355 genes were advertised as disputed. The adopted call already combines both lines of
  // evidence (anchor-pair Ks and the ancestral-karyotype topology), so there is nothing to dispute.
  wrap.append(el('p', { class: 'muted', style: 'font-size:12px;margin:6px 0 0' },
    'The call combines anchor-pair Ks with the position of the two segments on the ancestral '
    + 'eudicot karyotype; a pair the karyotype places in sWGD is assigned to aWGT when its dS exceeds 1.05. '
    + 'Each anchor pair below carries the same call (dissertation Figure 2.S2).'));

  if (pairs.length) {
    const deferred = [];
    const rows = pairs.map((p) => {
      const cells = partnerCells();
      deferred.push({ id: p.id, cells });
      return el('tr', {},
      el('td', {}, el('a', { href: `#/gene/${p.id}`, class: 'mono' }, p.id)),
      el('td', {}, WGD_EVENT[p.e].name),
      cells.type,
      el('td', { class: 'num' }, p.ks == null ? '–' : p.ks.toFixed(3)),
      el('td', { class: 'num' }, p.ss == null ? '–' : p.ss.toFixed(1)),
      el('td', { class: 'mono' }, p.cp),
      el('td', { class: 'num mono' }, p.m),
      el('td', { class: 'num' }, p.r == null
        ? el('span', { class: 'muted', title: 'not comparable on the batch-corrected matrix' }, 'n/c')
        : el('span', { class: 'mono' }, p.r.toFixed(2))),
      cells.max, cells.top,
      el('td', { class: 'muted', style: 'font-size:11.5px' }, p.c ? 'dS conflict resolved' : ''));
    });
    fillPartners(deferred);
    wrap.append(el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Partner'), el('th', {}, 'Event'),
        partnerHeaders()[0],
        el('th', { class: 'num', title: 'synonymous divergence of the anchor pair' }, 'dS'),
        el('th', { class: 'num', title: 'synonymous sites in the alignment; below 25 the dS is unreliable' }, 'Syn. sites'),
        el('th', {}, 'Chromosomes'),
        el('th', { class: 'num', title: 'collinear block (i-ADHoRe multiplicon) the anchor sits in' }, 'Block'),
        el('th', { class: 'num', title: 'Pearson r on batch-corrected log2 expression, 652 samples' }, 'Expr r'),
        partnerHeaders()[1], partnerHeaders()[2],
        el('th', {}, ''))),
      el('tbody', {}, ...rows))));
    wrap.append(el('p', { class: 'muted', style: 'font-size:11.5px;margin:6px 0 0' },
      'Every anchor pair from the whole-genome duplication analysis is listed, unfiltered. aWGT was a '
      + 'triplication, so a gene can have two aWGT partners; later sWGD duplication of '
      + 'both copies gives more. Expression r uses the same basis as the other duplicate tables; '
      + '"n/c" means not comparable, not uncorrelated.'));
  }
  // The gene-level call and the pair labels are the same frozen call since 0.18.0, and the
  // release gate (check_dissertation.py) requires that they agree for every gene. This box is
  // kept as a tripwire: if a later build breaks that, the page says so rather than hiding it.
  const mismatch = ['S', 'A'].filter((c) =>
    (c === 'S' ? !!d.s : !!d.a) !== pairs.some((p) => p.e === c));
  if (g.dup && mismatch.length) {
    wrap.append(el('div', { class: 'warn' },
      el('strong', {}, 'The call and the anchor table differ for this gene. '),
      `For ${mismatch.map((c) => WGD_EVENT[c].name).join(' and ')}, the curated gene-level `
      + 'call and the anchor-pair label disagree. The call comes first in the pipeline and '
      + 'includes a dS conflict resolution applied per gene; the anchor label is kept as it '
      + 'was published. Neither is overridden here.'));
  }
  return wrap;
}

// Ancestral eudicot karyotype, route C. EXPLORATORY, and labelled so wherever it renders. Copy
// numbers are Wang et al.'s completeness ranks within one ancestral chromosome, never subgenomes,
// and an empty slot means no collinear anchor, never a proven loss.
const AEK_DOI = '10.1186/s12915-022-01420-1';

function slotTable(g, chrom, a) {
  const hap = g.hap === 'hap1' ? 'HAP1' : 'HAP2';
  const cell = (gc, sc) => {
    const ids = (a.sl.find(([x, y]) => x === gc && y === sc) || [])[2] || [];
    return el('td', {}, ids.length
      ? ids.map((id, i) => el('div', { style: i ? 'margin-top:2px' : null }, id === g.id
          ? el('strong', { class: 'mono' }, id)
          : el('a', { href: `#/gene/${id}`, class: 'mono' }, id)))
      : el('span', { class: 'muted' }, 'lost or not detected'));
  };
  return el('div', { style: 'margin-top:10px' },
    el('p', { style: 'font-size:12.5px;margin:0 0 4px' }, 'This gene is a direct collinear anchor of ancestral gene ',
      el('span', { class: 'mono' }, a.id), ` (AEK${chrom}). Its ${hap} descendants that are collinear anchors, by slot:`),
    el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', {}, 'aWGT copy'),
        el('th', {}, 'sWGD copy 1'), el('th', {}, 'sWGD copy 2'))),
      el('tbody', {}, ...[1, 2, 3].map((gc) =>
        el('tr', {}, el('td', { class: 'mono' }, String(gc)), cell(gc, 1), cell(gc, 2)))))));
}

function karyotypeSection(g) {
  const k = g.aek;
  const note = (t) => el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' }, t);
  const wrap = el('div', { style: 'margin-top:14px' },
    el('h3', { style: 'font-size:13px;margin:0 0 6px;display:flex;align-items:center;gap:8px' },
      'Ancestral karyotype', el('span', { class: 'badge', style: 'font-size:11px;padding:0 6px' }, 'exploratory')));
  const kv = el('dl', { class: 'kv' });
  if (!k) {
    // No record: a chromosome gene was assessed and not placed; a scaffold gene was never assessed.
    const onChromosome = /^Chr\d+$/.test(g.chr || '');
    kv.append(el('dt', {}, 'Ancestral chromosome'), el('dd', {},
      onChromosome ? 'not placed' : 'not assessed',
      note(onChromosome
        ? 'No collinear block links this gene to the ancestral karyotype or to P. trichocarpa.'
        : 'The placement covers genes on the 19 chromosomes; this gene is on an unplaced scaffold.')));
  } else {
    kv.append(el('dt', {}, 'Ancestral chromosome'), el('dd', {}, el('strong', {}, `AEK${k.c}`),
      note(k.b ? 'Inside an AEK collinear block.'
        : 'Inherited from the nearest collinear anchors shared with P. trichocarpa; the gene is '
          + 'not inside an AEK block itself.')));
    if (k.g) {
      kv.append(
        el('dt', {}, 'aWGT copy'), el('dd', {}, el('strong', {}, String(k.g)),
          el('span', { class: 'muted' }, ` of AEK${k.c}`)),
        el('dt', {}, 'sWGD copy'), el('dd', {}, el('strong', {}, String(k.s)),
          el('span', { class: 'muted' }, ` within aWGT copy ${k.g}`)),
        el('dt', {}, 'Label support'), el('dd', {}, `${Math.round(k.sp * 100)}%`,
          el('span', { class: 'muted' }, ' of the 10 nearest collinear anchors shared with P. trichocarpa '
            + 'agree on this label')));
    } else {
      kv.append(el('dt', {}, 'aWGT and sWGD copy'), el('dd', {}, 'not assigned', note(k.x
        ? 'The AEK block and the P. trichocarpa naming point to different ancestral chromosomes.'
        : 'No collinear block shared with P. trichocarpa names a copy here.')));
    }
  }
  wrap.append(kv);
  const anchors = (k && k.an) || [];
  for (const a of anchors) wrap.append(slotTable(g, k.c, a));
  if (anchors.length) {
    wrap.append(el('p', { class: 'muted', style: 'font-size:11.5px;margin:6px 0 0' },
      '"Lost or not detected" means no collinear anchor in this haplotype carries that slot. '
      + 'It is not evidence that the gene was lost.'));
  }
  wrap.append(el('p', { class: 'muted', style: 'font-size:11.5px;margin:8px 0 0' },
    'Exploratory. AEK1 to AEK7 are the seven chromosomes of the ancestral eudicot karyotype of '
    + 'Wang et al. 2022, BMC Biology 20:216, ',
    el('a', { href: `https://doi.org/${AEK_DOI}`, target: '_blank', rel: 'noopener' }, `doi:${AEK_DOI}`),
    '. The ancestral chromosome is a positional label: the 717 genome segment this gene sits in is '
    + 'collinear with that ancestral chromosome. It describes the region, not the gene\u2019s own '
    + 'descent, so a gene younger than the event (for example a lineage-specific or transposed '
    + 'gene) can still carry one. It comes from collinearity with the ancestral '
    + 'karyotype genes (for a gene outside those blocks, from its nearest anchors shared with '
    + 'P. trichocarpa). aWGT and sWGD copy names come from collinear blocks shared with '
    + 'P. trichocarpa v3.1, using Wang et al.\'s published P. trichocarpa painting. aWGT copy (1 to 3) '
    + 'and sWGD copy (1 to 2) numbers are completeness ranks from Wang et al.\'s karyotype '
    + 'projection, not subgenomes. A copy names the ancestral copy this segment is collinear with, '
    + 'not whether the gene\u2019s duplicate survived; that is the WGD call above.'));
  return wrap;
}

function geneCard(g) {
  const para = g.para;
  const inArray = !!((g.syn || {}).flags || {}).ar;
  if (!para && !inArray && !g.dup && !g.te && !g.wgd && !g.aek) return null;

  const card = el('div', { class: 'card', 'data-view-group': 'duplication',
    'data-view-key': 'details', 'data-view-label': 'Partners & evidence',
    'data-view-tag': 'duplication set' },
    el('h2', {}, 'Duplication', el('span', { class: 'tag' }, 'duplication set')));

  if (g.dup) {
    const kv = el('dl', { class: 'kv' });
    kv.append(el('dt', {}, 'Duplication class'),
      el('dd', {}, el('strong', {}, dupTypeLabel(g.dup)),
        el('span', { class: 'muted mono', style: 'font-size:11.5px' }, `  ${g.dup.t}`),
        el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
          'A gene can belong to several duplication modes at once; the code concatenates them.')));
    if (g.te && g.te.all != null) {
      const near = Object.entries(g.te).filter(([k]) => k !== 'all')
        .sort((a, b) => a[1] - b[1]).slice(0, 3);
      // 0 is not missing data and not "adjacent": it means a repeat annotation overlaps the
      // gene body. Saying "0 bp" left a reader to guess which, and most guessed wrong.
      const overlaps = g.te.all === 0;
      kv.append(el('dt', {}, overlaps ? 'Transposable element' : 'Nearest transposable element'),
        el('dd', {},
          overlaps
            ? el('span', {}, el('strong', {}, 'overlaps this gene'),
                el('span', { class: 'muted' }, ', a repeat annotation falls inside the gene body'))
            : el('span', {}, el('span', { class: 'mono' }, fmt(g.te.all)),
                ' bp away from the gene'),
          el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
            'nearest of each superfamily: '
            + near.map(([k, v]) => `${k} ${v === 0 ? 'overlapping' : fmt(v) + ' bp'}`).join(' · '))));
    }
    card.append(kv);
  }

  if (g.dup || g.wgd) card.append(wgdSection(g));
  card.append(karyotypeSection(g));

  const td = g.td;
  if (td) {
    const kv = el('dl', { class: 'kv' });
    kv.append(el('dt', {}, 'Tandem array'),
      el('dd', {}, td.aid
        ? el('a', { href: `#/array/${td.aid}`, class: 'mono', 'data-array-link': td.aid,
            title: 'open the array page: members to scale, divergence, expression' }, td.aid)
        : el('span', { class: 'mono' }, '–'),
        el('span', { class: 'muted' }, `  ${td.n} member${td.n === 1 ? '' : 's'}`),
        td.age ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
          `age bin: ${ageBinName(td.age)}${td.ks != null ? ` · array median Ks ${td.ks}` : ''}`) : null));
    // The card named the array and counted it, so a reader could see "7 members" and never
    // learn which seven.
    //
    // dS per member is NEW and is the per-PAIR value from the TD union rebuild
    // (sources/td_pair_ks.tsv.gz -> td.pks), not td.ks. td.ks is the ARRAY MEDIAN and printing
    // it in this column would read as that pair's divergence -- the reason this column did not
    // exist before. It covers about half the member entries: `td.mem` lists every other member
    // of the array, the dS table holds the DETECTED EDGES, so a dash means "this pair was never
    // scored", never "these two are identical". `td.pks_n` counts it out below the table.
    if (td.mem && td.mem.length) {
      const pks = td.pks || {};
      const deferred = [];
      const rows = td.mem.map(([id, r]) => {
        const cells = partnerCells();
        deferred.push({ id, cells });
        return el('tr', {},
          el('td', {}, el('a', { href: `#/gene/${id}`, class: 'mono' }, id)),
          cells.type,
          el('td', { class: 'num' }, pks[id] == null
            ? el('span', { class: 'muted', title: 'this pair was not scored as a detected '
                + 'tandem edge, it is not a dS of zero' }, '–')
            : el('span', { class: 'mono' }, pks[id].toFixed(4))),
          el('td', { class: 'num' }, r == null
            ? el('span', { class: 'muted', title: 'not comparable on the batch-corrected matrix' }, 'n/c')
            : el('span', { class: 'mono' }, r.toFixed(2))),
          cells.max, cells.top);
      });
      fillPartners(deferred);
      const scored = td.pks_n ? td.pks_n[0] : Object.keys(pks).length;
      kv.append(el('dt', {}, 'This array\u2019s history'),
        arrayHistoryLine(g, td.mem.map((m) => m[0])));
      kv.append(el('dt', {}, 'Other members'),
        el('dd', {},
          el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Gene'),
              partnerHeaders()[0],
              el('th', { class: 'num', title: 'synonymous divergence of THIS pair, from the '
                + 'tandem union rebuild, not the array median above' }, 'Pair dS'),
              el('th', { class: 'num', title: 'Pearson r on batch-corrected log2 expression, '
                + '652 samples' }, 'Expr r'),
              partnerHeaders()[1], partnerHeaders()[2])),
            el('tbody', {}, ...rows))),
          el('div', { class: 'muted', style: 'font-size:11.5px;margin-top:5px' },
            `Pair dS is the divergence of this gene against that member specifically, scored for `
            + `${scored} of the ${td.mem.length} member${td.mem.length === 1 ? '' : 's'} listed. `
            + 'It is not the array median above, and a dash means the pair was never scored as a '
            + 'detected tandem edge rather than that the two copies are identical.'),
          td.more
            ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' },
                `and ${td.more} more, not listed.`)
            : null,
          el('div', { class: 'muted', style: 'font-size:11.5px;margin-top:5px' },
            'Expression r is a plain Pearson correlation across the 652 samples, on the '
            + 'batch-corrected matrix, the same basis as the neighbor co-expression on the '
            + 'expression card, because a 652-sample correlation spans 28 studies. It is a '
            + 'descriptive number, not a divergence model, and "n/c" means the pair cannot be '
            + 'compared on that matrix rather than that the two are uncorrelated.')));
    }
    if (td.pseudo || td.removed || td.note) {
      kv.append(el('dt', {}, 'Curation'),
        el('dd', {},
          td.removed ? el('div', {}, el('strong', {}, 'removed from the curated set'),
            td.why ? el('span', { class: 'muted' }, `, ${td.why}`) : null) : null,
          td.pseudo ? el('div', {}, el('span', { class: 'badge' }, 'pseudogene-like')) : null,
          td.note ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' }, td.note) : null));
    }
    if (g.fam) {
      // The layers card draws one hop. The family is the transitive closure of that, which is
      // where "a relative of a relative" lives -- and it is a different question.
      kv.append(el('dt', {}, 'Descent group'),
        el('dd', {}, el('a', { href: `#/family/${g.id}` },
          'Every gene reachable from this one \u2192'),
          el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
            'Tandem, whole-genome-duplication, allele and paralog edges, walked to exhaustion.')));
    }
    const members = el('div', { style: 'margin-top:4px' });
    kv.append(el('dt', {}, 'Array members'), el('dd', {}, members));
    if (td.aid) {
      loadArrays().then((all) => {
        const ids = all[td.aid] || [];
        members.append(...ids.map((id, i) => el('span', {},
          i ? ' · ' : '',
          id === g.id ? el('strong', { class: 'mono' }, id)
                      : el('a', { href: `#/gene/${id}`, class: 'mono' }, id))));
      }).catch(() => members.append(el('span', { class: 'muted' }, 'unavailable')));
    }
    card.append(kv);
  } else if (inArray) {
    card.append(el('dl', { class: 'kv' },
      el('dt', {}, 'Tandem array'),
      el('dd', {}, el('span', { class: 'badge' }, el('i', { class: 'dot tandem' }), 'array placement'),
        el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px' },
          'GENESPACE placed this gene in a tandem array, but it is not in the curated union '
          + 'tandem set, so no array identity or age is available for it.'))));
  }

  // PAV / hemizygosity: a candidate set (6,092 genes from an asymmetric HAP1/HAP2


  if (para && para.length) {
    const deferredPara = [];
    const rows = para.map((p) => {
      const cells = partnerCells();
      deferredPara.push({ id: p.id, cells });
      return el('tr', {},
      el('td', {}, el('a', { href: `#/gene/${p.id}`, class: 'mono' }, p.id)),
      cells.type,
      el('td', { class: 'num' }, p.ks0 ? el('span', { class: 'muted' }, '0 *')
        : p.ks == null ? '–' : p.ks.toFixed(4)),
      el('td', { class: 'num' }, p.ka == null ? '–' : p.ka.toFixed(4)),
      el('td', { class: 'num' }, p.w == null ? el('span', { class: 'muted' }, '–') : p.w.toFixed(3)),
      // absence is "not comparable on the batch-corrected matrix", NOT "uncorrelated"
      el('td', { class: 'num' }, p.r == null
        ? el('span', { class: 'muted', title: 'one partner is outside the batch-corrected '
            + 'matrix, so the pair is not comparable, this is not a correlation of zero' }, 'n/c')
        : el('span', { class: 'mono' }, p.r.toFixed(2))),
      cells.max, cells.top,
      el('td', { class: 'muted', style: 'font-size:11.5px' },
        (PAIR_SRC[p.src] || p.src) + (p.sat ? ' · saturated' : '')));
    });
    fillPartners(deferredPara);
    card.append(
      el('h3', { style: 'font-size:13px;margin:14px 0 6px' }, `Paralog pairs (${para.length})`),
      el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Paralog'),
          partnerHeaders()[0],
          el('th', { class: 'num' }, 'dS'),
          el('th', { class: 'num' }, 'dN'), el('th', { class: 'num' }, 'ω'),
          el('th', { class: 'num', title: 'Pearson r on batch-corrected log2 expression, '
            + '652 samples' }, 'Expr r'),
          partnerHeaders()[1], partnerHeaders()[2],
          el('th', {}, 'Source'))),
        el('tbody', {}, ...rows))));
    if (para.some((p) => p.ks0)) {
      card.append(el('p', { class: 'muted', style: 'font-size:11.5px;margin:8px 0 0' },
        '* dS is 0, identical at synonymous sites, so ω is undefined rather than zero.'));
    }
    if (para.some((p) => p.sat)) {
      card.append(el('p', { class: 'muted', style: 'font-size:11.5px;margin:4px 0 0' },
        'Saturated pairs have too many synonymous substitutions for a reliable estimate.'));
    }
    // Two different definitions sit in one card and can legitimately disagree. Say so, or a
    // reader sees "no duplication detected" directly above a list of paralogs.
    if (g.dup && g.dup.t === 'C') {
      card.append(el('div', { class: 'warn' },
        el('strong', {}, 'These two rows use different definitions. '),
        'The class above asks whether the gene falls in a collinear WGD block, a tandem array, '
        + 'or a dispersed duplicate pair. The paralogs here come from gene-family membership. '
        + 'A gene can have a family paralog without meeting any of those structural criteria, '
        + 'that is a difference in question asked, not a contradiction.'));
    }
  }
  return card;
}

const HAPS = ['HAP1', 'HAP2'];
const expandCode = (code) => (code === 'C' ? 'singleton (no paralog detected)'
  : [...code].map((ch) => DUP_CODE[ch] || ch).join(' + '));

/** Class codes per haplotype on quality-filtered genes: the basis of the dissertation's
 *  Table 2.1 and Figure 2.1. Recomputed from the gene records at build. */
function dupClassChart(man) {
  const by = (man.dissertation || {}).class_codes_quality_filtered || {};
  const codes = [...new Set(HAPS.flatMap((h) => Object.keys(by[h] || {})))]
    .sort((a, b) => ((by.HAP1 || {})[b] || 0) - ((by.HAP1 || {})[a] || 0));
  if (!codes.length) return el('p', { class: 'muted' }, 'Distribution not built.');
  return el('div', { class: 'scroll-x' }, el('table', { class: 'data', 'data-class-codes': '' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Code'), el('th', {}, 'Evidence'),
      el('th', { class: 'num' }, 'HAP1'), el('th', { class: 'num' }, 'HAP2'))),
    el('tbody', {}, ...codes.map((code) => el('tr', {},
      el('td', { class: 'mono' }, el('b', {}, code)), el('td', { class: 'muted' }, expandCode(code)),
      ...HAPS.map((h) => el('td', { class: 'num' }, fmt((by[h] || {})[code] || 0))))))));
}

/** The dissertation's Table 2.1, from the same records. */
function table21(man) {
  const t = (man.dissertation || {}).table_2_1 || {};
  if (!t.HAP1) return el('p', { class: 'muted' }, 'Summary not built.');
  const rows = [['sWGD', 'sWGD (salicoid whole-genome duplication)', { wgd9: 'salicoid' }],
    ['aWGT', 'aWGT (ancient whole-genome triplication)', { wgd9: 'gamma' }],
    ['tandem', 'Tandem duplicate (TD)', { tandem: 'yes' }],
    ['dispersed_only', 'Dispersed duplicate only', { dup: 'D' }],
    ['singleton', 'Singleton', { dup: 'C' }]];
  const cell = (h, k, params) => {
    const n = t[h][k], tot = t[h].quality_filtered_genes;
    return el('td', { class: 'num' }, el('a', {
      href: browseHref({ hap: h.toLowerCase(), qc: 'no', ...params }),
      title: `Browse these ${fmt(n)} genes` }, fmt(n)),
      el('span', { class: 'muted' }, ` (${(100 * n / tot).toFixed(1)}%)`));
  };
  return el('div', { class: 'scroll-x' }, el('table', { class: 'data', 'data-table-2-1': '' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Duplication class'),
      el('th', { class: 'num' }, 'HAP1, n (%)'), el('th', { class: 'num' }, 'HAP2, n (%)'))),
    el('tbody', {},
      el('tr', {}, el('td', {}, 'Quality-filtered genes'),
        ...HAPS.map((h) => el('td', { class: 'num' }, fmt(t[h].quality_filtered_genes)))),
      ...rows.map(([k, label, params]) => el('tr', {}, el('td', {}, label),
        ...HAPS.map((h) => cell(h, k, params)))))));
}

function wgdOverview(man) {
  const d = man.dissertation || {};
  const t = d.table_2_1 || {}, pr = d.wgd_anchor_pairs || {};
  const stat = (n, label, params) => el('a', { href: browseHref(params), class: 'stat',
    style: 'text-decoration:none;color:inherit', title: `Browse these ${fmt(n)} genes` },
    el('div', { class: 'n' }, fmt(n)), el('div', { class: 'l' }, label));
  return el('div', { class: 'card' },
    el('h2', {}, 'Whole-genome duplication events', el('span', { class: 'tag' }, 'click to browse')),
    el('div', { class: 'stat-row' },
      ...HAPS.flatMap((h) => [
        stat(t[h].sWGD, `${h} sWGD genes`, { hap: h.toLowerCase(), qc: 'no', wgd9: 'salicoid' }),
        stat(t[h].aWGT, `${h} aWGT genes`, { hap: h.toLowerCase(), qc: 'no', wgd9: 'gamma' }),
        stat(t[h].sWGD_and_aWGT, `${h} retained from both`, { hap: h.toLowerCase(), qc: 'no', wgd9: 'both' })])),
    el('p', { style: 'font-size:13px;margin:8px 0' },
      `Anchor pairs: sWGD ${fmt(pr.HAP1.sWGD)} HAP1 and ${fmt(pr.HAP2.sWGD)} HAP2; `
      + `aWGT ${fmt(pr.HAP1.aWGT)} HAP1 and ${fmt(pr.HAP2.aWGT)} HAP2. aWGT was a triplication, `
      + 'observed here as pairwise relationships among its surviving copies.'),
    el('dl', { class: 'kv' },
      ...['S', 'A'].flatMap((c) => [el('dt', {}, WGD_EVENT[c].name), el('dd', {}, WGD_EVENT[c].when)])),
    el('p', { class: 'muted', style: 'font-size:12.5px;margin:8px 0 0' },
      'Events are not exclusive. Counts are quality-filtered genes, each haplotype separately. Each gene '
      + 'page lists every WGD anchor partner with its dS, block and expression correlation.'));
}

function ageBinCard() {
  return el('div', { class: 'card' },
    el('h2', {}, 'Tandem-array age bins'),
    el('p', { class: 'muted', style: 'font-size:12.5px;margin:0 0 8px' },
      'A tandem array is dated by the median Ks of its member pairs. Limits are closed on the right; '
      + 'pairs with Ks = 0 are not dated.'),
    el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Age bin'), el('th', {}, 'Ks'))),
      el('tbody', {}, ...AGE_BINS.filter(([k]) => k !== 'not datable').map(([, name, ks]) =>
        el('tr', {}, el('td', {}, name), el('td', { class: 'mono' }, ks)))))));
}

async function overview(man) {
  const d = man.duplication;
  if (!d) return el('div', { class: 'empty' }, 'Duplication data not built.');
  const t = (man.dissertation || {}).table_2_1 || { HAP1: {}, HAP2: {} };
  const qf = (man.dissertation || {}).quality_flagged_gene_models || {};
  return el('div', {},
    el('h1', {}, 'Duplication'),
    el('p', { class: 'sub' },
      'Duplication class of every gene, whole-genome duplication anchor pairs, tandem arrays, and a '
      + 'set of paralog pairs with synonymous divergence.'),
    el('div', { class: 'card' },
      el('h2', {}, 'Duplication class', el('span', { class: 'tag' }, 'quality-filtered genes, per haplotype')),
      el('p', { class: 'muted', style: 'font-size:12.5px;margin:0 0 12px' },
        'Number of quality-filtered genes in each duplication class, as in the dissertation (Table 2.1, '
        + `Figure 2.1). ${fmt(qf.HAP1)} HAP1 and ${fmt(qf.HAP2)} HAP2 gene models flagged by quality control `
        + 'are left out. sWGD, aWGT and tandem overlap, because a gene can carry evidence from more than '
        + 'one event, so the rows do not sum to the total. Haplotypes are reported separately.'),
      table21(man),
      el('h3', { style: 'font-size:13px;margin:16px 0 6px' }, 'By class code'),
      el('p', { class: 'muted', style: 'font-size:12.5px;margin:0 0 8px' },
        'The same genes by their full code. Codes concatenate: S sWGD, A aWGT, T tandem, D dispersed; '
        + 'C is a singleton. Each gene has exactly one code.'),
      dupClassChart(man)),
    wgdOverview(man),
    ageBinCard(),
    el('div', { class: 'card' },
      el('h2', {}, 'Paralog pairs with dS', el('span', { class: 'tag' }, 'a selected set')),
      el('div', { class: 'warn' },
        el('strong', {}, 'This paralog set is not genome-wide. '),
        'The pairs were selected for the gene-age analysis and are concentrated at phylostrata '
        + '16 to 18, with a rank-12 Pentapetalae comparator set. Any dS distribution here describes '
        + 'that selection, not the genome.'),
      el('div', { class: 'stat-row' },
        el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(d.n_pairs)), el('div', { class: 'l' }, 'paralog pairs')),
        el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(d.n_genes)), el('div', { class: 'l' }, 'genes with a pair')),
        el('div', { class: 'stat' }, el('div', { class: 'n' }, `${fmt(t.HAP1.tandem)} / ${fmt(t.HAP2.tandem)}`),
          el('div', { class: 'l' }, 'tandem-array genes, HAP1 / HAP2 (genome-wide)')),
        el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(d.n_ks_undefined)), el('div', { class: 'l' }, 'pairs with dS = 0')))),
    el('div', { class: 'card' },
      el('h2', {}, 'What is not here'),
      el('ul', { style: 'margin:0;padding-left:18px;font-size:13.5px;color:var(--ink-2);line-height:1.6' },
        el('li', {}, el('strong', {}, 'The dS panel and the duplication class are different things. '),
          'The class (sWGD / aWGT / tandem / dispersed) is genome-wide, from the '
          + 'duplication analysis. The dS pairs below are a subset selected by phylostratum for the gene-age analysis. '
          + 'Do not read a dS distribution from the latter as a property of the former.'),
        el('li', {}, el('strong', {}, 'No genome-wide dS landscape. '),
          `The ${fmt(d.n_pairs)} pairs here were chosen for the gene-age analysis. A `
          + 'genome-wide all-by-all paralog scan is a separate computation.'),
        el('li', {}, el('strong', {}, 'Tandem calls come from the curated union set. '),
          'The lab\u2019s hand-curated union of 13,663 genes in 4,371 detected arrays replaces '
          + 'its earlier tandem tables and carries array identity, age bin and the curator\'s '
          + 'verdict; the 13,048 that passed the pseudogene screen are the ones counted. Genes GENESPACE places in an array but which are absent from that set '
          + 'are shown without an array id rather than given a synthetic one.'))),
  );
}

export default {
  id: 'duplication',
  label: 'Duplication',
  geneCard,
  overview,
  filters: [
    { id: 'wgd_event', label: 'WGD event', options: ['salicoid', 'gamma'],
      test: (g, v) => !!(g.dup && (v === 'salicoid' ? g.dup.s : g.dup.a)) },
    { id: 'aek_chromosome', label: 'Ancestral chromosome (exploratory)',
      options: ['AEK1', 'AEK2', 'AEK3', 'AEK4', 'AEK5', 'AEK6', 'AEK7'],
      test: (g, v) => !!(g.aek && `AEK${g.aek.c}` === v) },
    { id: 'has_paralog', label: 'Has a scored paralog', options: ['yes', 'no'],
      test: (g, v) => (g.para && g.para.length ? 'yes' : 'no') === v },
  ],
};
