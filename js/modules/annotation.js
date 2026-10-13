// Module: functional annotation + the HAP1<->HAP2 allele link + panel presence.
// Answers a visitor's first three questions on the gene page: what is this gene, where is
// its other allele, and which genomes have it.
import { el, fmt } from '../core/dom.js';
import { loadTerms, arrayAlleles, getGene } from '../core/data.js';
import { CATEGORY, detailText } from '../core/relationship.js';

const PANEL = ['Ptrxalhap1', 'Ptrxalhap2', 'Pnigra', 'Ptrichocarpa', 'Pdeltoides',
  'Peuphratica', 'Spurpurea', 'Egrandis', 'Vvinifera', 'Athaliana', 'Osativa', 'Ppatens'];
const SHORT = {
  Ptrxalhap1: 'HAP1', Ptrxalhap2: 'HAP2', Pnigra: 'P. nigra', Ptrichocarpa: 'P. trichocarpa',
  Pdeltoides: 'P. deltoides', Peuphratica: 'P. euphratica', Spurpurea: 'S. purpurea',
  Egrandis: 'E. grandis', Vvinifera: 'V. vinifera', Athaliana: 'A. thaliana',
  Osativa: 'O. sativa', Ppatens: 'P. patens',
};
// Genome-report links, verified 2026-09-08 by actually navigating to each of the
// three, not inferred: PHYTOZOME_GENOME's HAP1/HAP2 slugs against a known gene of each
// (Phytozome genome IDs 717/716), PTRICHOCARPA_GENOME against Potri.005G161100. The
// previous constant here ('report-gene/', no genome segment) 404s for every gene -- it
// was never a valid Phytozome URL.
const PHYTOZOME_GENOME = { hap1: 'PtremulaxPopulusalbaHAP1_v5_1', hap2: 'PtremulaxPopulusalbaHAP2_v5_1' };
const PTRICHOCARPA_GENOME = 'Ptrichocarpa_v4_1';
const phytozomeGeneUrl = (genomeId, geneId) =>
  `https://phytozome-next.jgi.doe.gov/report/gene/${genomeId}/${geneId}`;
// Verified against the same known gene: the exact track list is one Chen already uses
// day to day, not a guess at a sensible default -- keep it in step with how she reads
// this view rather than curating a "better" set independently.
const JBROWSE_TRACKS = 'Transcripts,Alt_Transcripts,PASA_assembly,'
  + 'Blatx_BasalMalvidae,Blastx_protein,RNAExpression';
const phytozomeBrowserUrl = (genomeId, chr, start, end) => {
  const q = new URLSearchParams({ data: `genomes/${genomeId}`, loc: `${chr}:${start}..${end}`,
    tracks: JBROWSE_TRACKS, highlight: '' });
  return `https://phytozome-next.jgi.doe.gov/jbrowse/index.html?${q}`;
};

// Term names arrive in one small index. The card can render before it lands, so names are
// filled in when the promise resolves rather than read from a cache that may still be empty
// (that race printed "term name unavailable" beside every GO id).
const termsP = loadTerms().catch(() => null);

function accBadges(list, kind) {
  return list.map((id) => {
    const b = el('span', { class: 'badge', title: id, style: 'font-size:11px' },
      el('span', { class: 'mono' }, id));
    termsP.then((t) => { const name = t && t.acc && t.acc[id]; if (name) b.title = name; });
    return b;
  });
}

function goList(ids) {
  const NS = { P: 'process', F: 'function', C: 'component' };
  const rows = ids.slice(0, 12).map((id) => {
    const name = el('span', { class: 'muted', 'data-go-name': id }, '…');
    termsP.then((terms) => {
      const t = terms && terms.go && terms.go[id];
      name.replaceChildren(...(t ? [el('span', {}, t[0]), el('span', { class: 'muted' }, ` · ${NS[t[1]] || t[1]}`)]
        : ['term name not in the release']));
      if (t) name.classList.remove('muted');
    });
    return el('li', { style: 'margin:0 0 3px' },
      el('a', { href: `https://amigo.geneontology.org/amigo/term/${id}`, target: '_blank',
        rel: 'noopener', class: 'mono', style: 'font-size:11.5px' }, id), ' ', name);
  });
  const ul = el('ul', { style: 'margin:0;padding-left:0;list-style:none' }, ...rows);
  if (ids.length > 12) ul.append(el('li', { class: 'muted', style: 'font-size:12px;margin-top:4px' },
    `+ ${ids.length - 12} more GO terms`));
  return ul;
}

function annotationCard(g) {
  const a = g.ann;
  if (!a) return null;
  const kv = el('dl', { class: 'kv' });
  const add = (k, ...v) => { kv.append(el('dt', {}, k), el('dd', {}, ...v)); };

  if (a.sym && a.sym.length) add('Name', el('strong', { 'data-gene-name': '' }, a.sym.join(', ')),
    el('span', { class: 'muted', style: 'font-size:12px' }, '  gene name or family code from the lab annotation'));
  if (a.d) add('Description', a.d);
  if (a.at) {
    add('Best Arabidopsis hit',
      el('a', { href: `https://www.arabidopsis.org/locus?name=${a.at}`, target: '_blank',
        rel: 'noopener', class: 'mono' }, a.at),
      a.atd ? el('span', {}, ', ', a.atd) : null);
  }
  if (a.pf && a.pf.length) add('Pfam', el('span', { style: 'display:flex;gap:5px;flex-wrap:wrap' }, ...accBadges(a.pf)));
  else if (g.hap === 'hap2') {
    add('Pfam', el('span', { class: 'muted' }, 'not available for HAP2'));
  }
  if (a.pt && a.pt.length) add('PANTHER', el('span', { style: 'display:flex;gap:5px;flex-wrap:wrap' }, ...accBadges(a.pt)));
  if (a.go && a.go.length) add('GO', goList(a.go));

  const card = el('div', { class: 'card' },
    el('h2', {}, 'Function', el('span', { class: 'tag' }, 'Phytozome v5.1, computational')), kv,
    el('p', { class: 'muted', style: 'margin:8px 0 0;font-size:12px' },
      'All of these are computational annotations transferred by sequence similarity, not '
      + 'experimental results for this gene. The best Arabidopsis hit names the closest '
      + 'Arabidopsis sequence, not this gene\u2019s function, and the GO terms carry no '
      + 'evidence codes here, so treat them as inferred from electronic annotation.'));

  // The HAP2 release ships empty Pfam/PANTHER/GO columns; only ~3,200 HAP2 genes recover a
  // Pfam accession from the defline vs 26,132 on HAP1. Say so, or the asymmetry reads as biology.
  if (g.hap === 'hap2' && (!a.pf || !a.pf.length)) {
    card.append(el('div', { class: 'warn' },
      'Domain coverage is thinner on HAP2: the v5.1 release left the Pfam/PANTHER columns empty ',
      'for this haplotype, so only accessions recoverable from the defline are shown. ',
      'An absent domain here does not mean the gene lacks one, check the HAP1 allele.'));
  }
  // The P. trichocarpa ortholog is the key that unlocks the wider Populus resources for
  // someone holding a 717 gene id, so it sits with the other cross-references.
  if (g.ptri && g.ptri.id) {
    const one = !!g.ptri.one2one;
    kv.append(el('dt', {}, 'P. trichocarpa ortholog'),
      el('dd', {},
        el('a', { href: phytozomeGeneUrl(PTRICHOCARPA_GENOME, g.ptri.id), target: '_blank', rel: 'noopener', class: 'mono' }, g.ptri.id),
        one ? el('span', { class: 'muted' }, '  reciprocal 1:1')
            : el('span', { class: 'muted' }, `  ambiguous, ${g.ptri.n ? `${g.ptri.n} syntenic hits` : 'not reciprocal'}`),
        el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
          one ? 'Syntenic ortholog from this atlas’s own GENESPACE run. Use it to look the gene up in PopGenIE or Phytozome.'
              : 'Shown for orientation only, the syntenic relationship is not one-to-one, so this is not an ortholog call.')));
  } else if (g.ptri) {
    kv.append(el('dt', {}, 'P. trichocarpa ortholog'),
      el('dd', { class: 'muted' }, 'no syntenic hit'));
  }
  const ownGenome = PHYTOZOME_GENOME[g.hap];
  card.append(el('p', { style: 'margin:12px 0 0;font-size:12px;display:flex;gap:14px' },
    el('a', { href: phytozomeGeneUrl(ownGenome, g.id), target: '_blank', rel: 'noopener' },
      'View on Phytozome ↗'),
    el('a', { href: phytozomeBrowserUrl(ownGenome, g.chr, g.start, g.end), target: '_blank', rel: 'noopener' },
      'View in genome browser ↗')));
  return card;
}

/** Where a copy search covers this gene, point to the panel that draws its copies on both
 *  haplotypes (with or without an allele: an array's copies are the question either way). */
function copiesLink(g, man) {
  const cp = man && man.copies && man.copies.genes && man.copies.genes[g.id];
  const loc = cp && man.copies.loci[cp];
  if (!loc) return null;
  const unann = Object.values(loc.summary).some((s) => s.unannotated > 0);
  return el('p', { style: 'margin:8px 0 0;font-size:13px' },
    `Its copies on both haplotypes${unann ? ', including pieces the annotation does not call,' : ''} `
    + 'are drawn in the ',
    el('a', { href: `#/copies/${cp}`, onclick: (ev) => {
      const c = document.querySelector('[data-card="copies"]');
      if (c) { ev.preventDefault(); c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    } }, `${loc.name} panel`), ' in the Duplication band.');
}

function alleleCard(g, man) {
  const a = g.allele;
  const other = g.hap === 'hap1' ? 'HAP2' : 'HAP1';
  if (!a) {
    // No allele is exactly where a reader looking for the other haplotype stops.
    // Filled after first paint: the alleles this gene reaches through its tandem array.
    const viaArray = el('div', { 'data-allele-via-array': '' });
    if (g.dup && g.dup.td) {
      arrayAlleles(g).then((r) => {
        if (!r) return;
        const withAllele = r.members.filter((x) => x.id !== g.id && x.allele);
        const aLink = (id) => el('a', { href: `#/array/${id}`, class: 'mono' }, id);
        if (!withAllele.length) {
          viaArray.append(el('p', { style: 'margin:10px 0 0;font-size:13px' },
            'No member of its tandem array ', aLink(r.arrayId), ` has a 1:1 ${other} syntelog either, `
            + 'so the whole array has no called counterpart: an array-level case.'));
          return;
        }
        viaArray.append(
          el('p', { style: 'margin:10px 0 6px;font-size:13.5px' },
            el('strong', {}, 'Through its tandem array. '),
            `This gene has no syntelog of its own, but ${withAllele.length} of the other `
            + `${r.members.length - 1} members of `, aLink(r.arrayId), ` do, so the array region is present on ${other}. `
            + 'This copy itself may have no counterpart: tandem arrays can differ in copy number between haplotypes.'),
          el('dl', { class: 'kv' }, ...withAllele.flatMap((x) => [
            el('dt', {}, el('a', { href: `#/gene/${x.id}`, class: 'mono' }, x.id)),
            el('dd', {}, '→ ', el('a', { href: `#/gene/${x.allele}`, class: 'mono' }, x.allele),
              ' ', el('a', { href: `#/pair/${x.id}`, class: 'muted' }, 'pair'))])),
          r.pairedArrays.length ? el('p', { style: 'margin:6px 0 0;font-size:13px' },
            `Matching ${other} array${r.pairedArrays.length > 1 ? 's' : ''}: `,
            ...r.pairedArrays.flatMap((id, i) => [i ? ', ' : '', aLink(id)])) : null,
          el('p', { class: 'muted', style: 'margin:6px 0 0;font-size:12px' },
            'An array-level link, not a 1:1 call for this gene: which copy corresponds to which is '
            + 'not resolved inside a tandem array.'));
      }).catch(() => {});
    }
    return el('div', { class: 'card', 'data-card': 'allele' },
      el('h2', {}, 'Allele', el('span', { class: 'tag' }, 'syntelog')),
      el('p', { class: 'muted', style: 'margin:0;font-size:13px' },
        `No syntelog partner on ${other}. That is not by itself evidence of absence: the card `
        + `"Relationship to the other haplotype" says what ${other} carries at this locus.`),
      viaArray,
      copiesLink(g, man),
    );
  }
  const kv = el('dl', { class: 'kv' });
  kv.append(el('dt', {}, `${other} allele`),
    el('dd', {}, el('a', { href: `#/gene/${a.id}`, class: 'mono' }, a.id),
      // Following the cross-reference loses the gene you came from. The pair route keeps
      // both on screen, which is the only way to SEE that one allele carries a duplication
      // the other lost, or that they disagree about age.
      el('div', { style: 'margin-top:4px' },
        el('a', { href: `#/pair/${g.id}` }, 'Compare the two alleles side by side \u2192'))));
  if (a.ks0) {
    kv.append(el('dt', {}, 'Divergence'),
      el('dd', {}, el('span', {}, 'identical at synonymous sites (Ks = 0)'),
        el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
          'ω is undefined when Ks is 0, the aligner reports a 99 placeholder, not selection.')));
    if (a.ka != null) kv.append(el('dt', {}, 'Ka'), el('dd', { class: 'mono' }, a.ka.toFixed(4)));
  } else {
    if (a.ks != null) kv.append(el('dt', {}, 'Ks'), el('dd', { class: 'mono' }, a.ks.toFixed(4)));
    if (a.ka != null) kv.append(el('dt', {}, 'Ka'), el('dd', { class: 'mono' }, a.ka.toFixed(4)));
    if (a.w != null) {
      kv.append(el('dt', {}, 'ω (Ka/Ks)'),
        el('dd', {}, el('span', { class: 'mono' }, a.w.toFixed(3)), ' ',
          el('span', { class: 'muted' }, (a.w < 1 ? 'below 1' : 'Ka exceeds Ks')
            + ' (single-gene point estimate; unstable at divergence this low)')));
    }
  }
  return el('div', { class: 'card', 'data-card': 'allele' },
    el('h2', {}, 'Allele', el('span', { class: 'tag' }, 'syntelog')), kv,
    el('p', { class: 'muted', style: 'margin:10px 0 0;font-size:12px' },
      'Yang–Nielsen (yn00) estimates over the HAP1↔HAP2 syntelog map (28,193 pairs). At a median '
      + 'Ks near 0.03 the per-gene ω is noisy; read it as a rough indication, not a test of selection.'),
    copiesLink(g, man));
}

// Ka/Ks against Populus trichocarpa. New in v0.6 -- the allele card above compares two
// haplotypes of ONE clone, which is a different and much shallower comparison than one
// between species.
//
// NG86 is the per-gene value on purpose. On these alignments NG86 and YN00 omega correlate
// at r = 0.07 to 0.36 gene by gene, while their class medians agree to within 0.06: median
// dS is about 0.04, close enough that the maximum-likelihood estimate is unstable per gene.
// The card shows both when they disagree rather than asserting a precision the data has not
// got.
function selectionCard(g) {
  const k = g.ks;
  if (!k) return null;
  if (k.no) {
    const ps = g.ps || {};
    return el('div', { class: 'card', 'data-card': 'selection' },
      el('h2', {}, 'Selection', el('span', { class: 'tag' }, 'vs P. trichocarpa')),
      el('p', { class: 'muted', style: 'margin:0;font-size:13px' },
        'No reciprocal-best P. trichocarpa ortholog, so Ka/Ks is not defined for this gene.',
        (ps.rank != null && ps.rank >= 19)
          ? el('span', {}, ' That is structural rather than missing: this gene is placed in the '
              + 'PS19 stratum (no homolog detected outside this assembly in the searched species '
              + 'panel, which lacks P. alba), so there is nothing to measure against. Almost no '
              + 'gene in that stratum has a pair.')
          : el('span', {}, ' Genes lose their ortholog for ordinary reasons too, such as tandem arrays, '
              + 'broken synteny or assembly gaps, so this is not evidence of absence.')));
  }
  const kv = el('dl', { class: 'kv' });
  kv.append(el('dt', {}, 'Ortholog'),
    el('dd', {}, el('a', {
      href: `https://phytozome-next.jgi.doe.gov/report/gene/Ptrichocarpa_v4_1/${k.id}`,
      target: '_blank', rel: 'noopener', class: 'mono' }, k.id),
      k.ag === 0
        ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
            'This best-hit ortholog is not the one this atlas\u2019s syntenic map names. The two '
            + 'methods agree for 98.7% of genes; read this row with that in mind.')
        : null));
  if (k.n != null) {
    kv.append(el('dt', {}, 'Alignment'),
      el('dd', {}, el('span', { class: 'mono' }, fmt(k.n)), ' codons · ',
        el('span', { class: 'mono' }, k.pid.toFixed(1) + '%'), ' identity'));
  }
  if (k.kss != null) kv.append(el('dt', {}, 'Ks'), el('dd', { class: 'mono' }, k.kss.toFixed(4)));
  if (k.ka != null) kv.append(el('dt', {}, 'Ka'), el('dd', { class: 'mono' }, k.ka.toFixed(4)));
  if (k.w != null) {
    const spread = (k.w2 != null && Math.abs(k.w2 - k.w) > 0.15);
    kv.append(el('dt', {}, '\u03c9 (Ka/Ks)'),
      el('dd', {},
        el('span', { class: 'mono' }, k.w.toFixed(3)), ' ',
        el('span', { class: 'muted' }, k.w < 1
          ? 'below 1, consistent with purifying selection (single-gene point estimate)'
          : 'Ka exceeds Ks (single-gene point estimate)'),
        spread
          ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
              `A second estimator on the same alignment gives ${k.w2.toFixed(3)}. At this `
              + 'divergence the two disagree gene by gene even though they agree on the '
              + 'average, so treat a single gene\u2019s value as approximate.')
          : null));
  }
  return el('div', { class: 'card', 'data-card': 'selection' },
    el('h2', {}, 'Selection', el('span', { class: 'tag' }, 'vs P. trichocarpa')), kv,
    el('p', { class: 'muted', style: 'margin:10px 0 0;font-size:12px' },
      'Nei\u2013Gojobori estimates against the reciprocal-best P. trichocarpa ortholog, over '
      + '52,232 of 63,960 genes. Across the gene set \u03c9 rises with how young a gene is '
      + '\u2013 0.24 for the most ancient, 0.33 conserved, 0.47 rosid-level, 0.57 '
      + 'Salicaceae-level, 0.72 for the Populus-specific pool, while staying well below '
      + 'the 1 that neutral evolution would give. Young genes here are constrained, just less '
      + 'constrained. Note the genes that pair up get fewer as they get younger, so a young '
      + 'stratum\u2019s figure is measured on its more conserved members.'));
}

// How this gene relates to the other haplotype: its relationship category, the unit it is
// counted in (the gene, or its whole tandem array), and the copy number on each side of its
// syntenic group. Every gene has one, except quality-flagged gene models, which say so.
function relationshipCard(g) {
  const rel = g.rel;
  if (!rel) return null;
  const kv = el('dl', { class: 'kv' });
  const add = (k, ...v) => kv.append(el('dt', {}, k), el('dd', {}, ...v));
  if (!rel.c) {
    add('Category', el('span', { class: 'muted' }, 'not classified'),
      el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
        'This gene model is flagged by quality control (a pseudogene-like tandem copy or a short degenerate '
        + 'fragment), so it is outside the set the categories cover and is not counted as a syntelog of another gene.'));
  } else {
    const c = CATEGORY[rel.c];
    add('Category', el('strong', { 'data-rel-category': rel.c }, c.name),
      el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:2px' },
        c.what[0].toUpperCase() + c.what.slice(1) + '.',
        detailText(rel.d) ? ` Here: ${detailText(rel.d)}.` : ''));
    if (rel.ut === 'TD_array' && g.td) {
      add('Counted as', 'its whole tandem array ',
        el('a', { href: `#/array/${g.td.aid}`, class: 'mono' }, g.td.aid),
        `, not this gene alone`);
    } else {
      add('Counted as', 'this gene');
    }
    if (rel.n1 != null && rel.n2 != null) {
      add('Copies in its syntenic group', `HAP1 ${rel.n1}, HAP2 ${rel.n2}`,
        el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' },
          'Quality-filtered genes on each haplotype that share this syntenic locus.'));
    }
    // Two small sets where the category and the allele shown on this page seem to disagree.
    // Both follow from quality filtering, so the page says so instead of leaving a puzzle.
    if (rel.c === '1:1' && !(g.allele && g.allele.id)) {
      add('Allele', el('span', { 'data-rel-note': 'unnamed-partner' },
        'This syntenic group holds one gene on each haplotype, but the member-to-member pairing '
        + 'is not on record for it (28 genes), so no allele is named on this page.'));
    } else if (g.allele && g.allele.id) {
      const note = el('dd', { 'data-rel-note': 'flagged-partner', style: 'display:none' });
      const dt = el('dt', { style: 'display:none' }, 'Allele shown above');
      kv.append(dt, note);
      getGene(g.allele.id).then((p) => {
        if (!p || !(p.rel && p.rel.qc)) return;
        note.append(el('a', { href: `#/gene/${p.id}`, class: 'mono' }, p.id),
          ' sits at the syntenic position but is a gene model flagged by quality control, which is '
          + 'not counted. The category and copy numbers on this card are therefore assessed without it.');
        dt.style.display = ''; note.style.display = '';
      }).catch(() => {});
    }
  }
  return el('div', { class: 'card', 'data-card': 'relationship' },
    el('h2', {}, 'Relationship to the other haplotype',
      el('span', { class: 'tag' }, 'syntenic group')), kv);
}

function presenceCard(g) {
  if (!g.pres || !g.pres.length) return null;
  const have = new Set(g.pres);
  const cells = PANEL.map((p) => el('div', {
    title: `${p}: ${have.has(p) ? 'present' : 'absent'} in this orthogroup`,
    style: `display:flex;flex-direction:column;align-items:center;gap:4px;min-width:58px`,
  },
    el('div', {
      style: `width:100%;height:22px;border-radius:4px;border:1px solid var(--line-2);`
        + `background:${have.has(p) ? 'var(--accent)' : 'transparent'}`,
    }),
    el('span', { style: 'font-size:9.5px;color:var(--ink-2);text-align:center;line-height:1.2' },
      SHORT[p] || p)));
  return el('div', { class: 'card', 'data-card': 'panel-presence' },
    el('h2', {}, 'Panel presence', el('span', { class: 'tag' }, `${g.pres.length} of 12`)),
    el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap' }, ...cells),
    el('p', { class: 'muted', style: 'margin:11px 0 0;font-size:12px' },
      'Genomes whose genes share this OrthoFinder orthogroup. Filled = present. '
      + 'O. sativa and P. patens are orthogroup-only outgroups, excluded from synteny.'));
}

function geneCard(g, man) {
  // Returns a fragment holding several cards; app.js appends whatever geneCard gives it.
  const frag = document.createDocumentFragment();
  [annotationCard(g), alleleCard(g, man), relationshipCard(g), selectionCard(g),
   presenceCard(g)].forEach((c) => c && frag.append(c));
  return frag.childNodes.length ? frag : null;
}

export default {
  id: 'annotation',
  label: 'Function',
  geneCard,
  filters: [
    { id: 'has_at', label: 'Has Arabidopsis hit', options: ['yes', 'no'],
      test: (g, v) => (!!(g.ann && g.ann.at) ? 'yes' : 'no') === v },
    { id: 'has_allele', label: 'Has HAP1↔HAP2 allele', options: ['yes', 'no'],
      test: (g, v) => (!!g.allele ? 'yes' : 'no') === v },
  ],
};
