import { el, clear, fmt, jumpTo } from './core/dom.js';
import { studyMeta, cleanCitation } from './core/cite.js';
import { getGene, loadManifest, hapLabel, loadExprStudies,
         loadExprSamples, searchGenesRanked, loadFacets, facetRow, arrayAlleles, dataVersion,
         normalizeQuery, loadContrasts, loadExprVector, loadSequences, loadDescIndex, loadGeneIndex } from './core/data.js';
import { fastaRecord, downloadText } from './core/fasta.js';
import { paperExpr, paperHighest, lsgStatus, qcBanner, isQcFlagged, releaseLine, CONTACT, REPO_URL } from './core/paper.js';
import { glossaryView } from './modules/glossary.js';
import { changesView } from './modules/changes.js';
import { downloadsView } from './modules/downloads.js';
import { linkHub, brush } from './core/designmap.js';
import { designOf, designDrawing, contrastList, studyContrasts, sampleSelection } from './core/studydesign.js';
import { FACTOR_LABEL, sampleTissue } from './core/studydesigns.js';
import { MODULES, byId, GENE_SECTIONS, geneSectionModules, CARD_EVIDENCE,
         EVIDENCE_TIERS } from './core/registry.js';
import { dupTypeLabel } from './modules/duplication.js';
import { classBadge } from './modules/synteny.js';
import { route, start, navigate, query } from './core/router.js';
import { disposeTree, onDispose } from './core/lifecycle.js';
import { browseView, browseHref, FILTERS } from './core/browse.js';
import { QUESTIONS, countQuestion } from './core/questions.js';
import { searchResultsView, whyLabel } from './core/search.js';
import { renderMap } from './modules/genomemap.js';
import { pairView } from './modules/pair.js';
import { karyotypeView } from './modules/karyotype.js';
import { familyView } from './modules/family.js';
import { statusView } from './modules/status.js';
import { copiesView } from './modules/copies.js';
import { arrayView, arraysIndexView } from './modules/arrays.js';

const view = () => document.getElementById('view');
const mountView = (node, navigation) => {
  if (navigation && !navigation.isCurrent()) {
    // The route may have finished building a detached view after the reader navigated away.
    // Dispose it here too; otherwise observers installed during construction leak globally.
    disposeTree(node);
    return false;
  }
  const v = view();
  disposeTree(v, { includeRoot: false });
  clear(v);
  v.append(node);
  window.scrollTo(0, 0);
  return true;
};
const scopedView = (navigation) => {
  const setView = (node) => mountView(navigation?.track?.(node) || node, navigation);
  const loading = (msg = 'Loading…') => setView(el('div', { class: 'empty' }, msg));
  return { setView, loading };
};

/* ---------- search: dropdown preview, with a hand-off to a full results page when a
   query is too broad to disambiguate from 24 rows of "id + one-line description" ---------- */
const DROPDOWN_SHOWN = 24;

function initSearch() {
  const input = document.getElementById('q');
  const hits = document.getElementById('hits');
  const status = document.getElementById('hits-status');
  let seq = 0;
  let timer = null;
  let active = -1;
  let lastQuery = '';
  let lastTotal = 0;

  const options = () => [...hits.querySelectorAll('[role=option]')];
  const setActive = (k) => {
    const o = options();
    o.forEach((x, j) => x.setAttribute('aria-selected', j === k ? 'true' : 'false'));
    active = k;
    if (k >= 0 && o[k]) { input.setAttribute('aria-activedescendant', o[k].id); o[k].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const close = () => {
    hits.style.display = 'none';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    delete hits.dataset.query;
    clear(hits);
  };
  const invalidateAndClose = () => { ++seq; lastQuery = ''; lastTotal = 0; clearTimeout(timer); close(); };
  // Focus stays in the input (the combobox pattern), so leaving the input closes the list unless
  // the pointer went down on an option (handled by mousedown preventDefault below).
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) invalidateAndClose(); }, 120));
  hits.addEventListener('mousedown', (e) => e.preventDefault());

  const goToResults = (q) => { invalidateAndClose(); input.blur(); navigate(`/search/${encodeURIComponent(q)}`); };
  const open = (href) => { invalidateAndClose(); input.value = ''; navigate(href.slice(1)); };

  async function run(q, mine) {
    try {
      const [res, desc, geneIdx] = await Promise.all([searchGenesRanked(q), loadDescIndex(), loadGeneIndex()]);
      if (mine !== seq || input.value.trim() !== q) return;
      const pos = new Map(geneIdx.map((id, i) => [id, i]));
      lastQuery = q; lastTotal = res.total;
      clear(hits);
      if (res.corrected.length) {
        hits.append(el('span', { class: 'muted hits-note' }, `Showing close spellings: ${res.corrected.map(([w, t]) => `${w} → ${t}`).join(', ')}`));
      }
      if (res.partial) hits.append(el('span', { class: 'muted hits-note' }, res.missing.length
        ? `No gene matches every word (not found anywhere: ${res.missing.join(', ')}); showing genes that match the others.`
        : 'No single gene matches every word; showing genes that match the most of them.'));
      if (!res.total) {
        hits.append(el('span', { class: 'muted hits-note' }, `Nothing matches “${q}”. Try a gene ID, a P. trichocarpa or Arabidopsis ID, a gene name or a word from a description.`));
      }
      res.ids.slice(0, DROPDOWN_SHOWN).forEach((id, k) => {
        const d = desc[pos.get(id)] || '';
        const w = whyLabel(res.why.get(id));
        hits.append(el('a', { href: '#/gene/' + id, id: `hit-${k}`, role: 'option', 'aria-selected': 'false',
          onclick: (e) => { e.preventDefault(); open('#/gene/' + id); } },
          el('span', { class: 'mono' }, id),
          el('span', { class: 'hit-desc' }, w ? el('strong', {}, w + (d ? '. ' : '')) : null, d.slice(0, 80))));
      });
      if (res.total > DROPDOWN_SHOWN) {
        hits.append(el('a', { href: `#/search/${encodeURIComponent(q)}`, id: `hit-all`, role: 'option', 'aria-selected': 'false', class: 'hits-all',
          onclick: (e) => { e.preventDefault(); goToResults(q); } }, `All ${fmt(res.total)} results for “${q}”, compared side by side →`));
      }
      hits.dataset.query = q;     // which query this list answers (a slower, older search never overwrites it)
      hits.style.display = 'block';
      input.setAttribute('aria-expanded', 'true');
      setActive(-1);
      status.textContent = res.total ? `${fmt(res.total)} result${res.total === 1 ? '' : 's'}; use the arrow keys to choose` : 'no results';
    } catch {
      if (mine !== seq) return;
      clear(hits).append(el('span', { class: 'muted hits-note' }, 'Search is unavailable. Try again.'));
      hits.style.display = 'block';
    }
  }

  // A short pause before searching, so typing "dehydrin" runs one search, not six.
  input.addEventListener('input', () => {
    const q = input.value.trim();
    const mine = ++seq;
    lastQuery = ''; lastTotal = 0;
    clearTimeout(timer);
    if (q.length < 3) return close();
    // A complete 717 gene ID needs no search: Enter opens it straight away.
    timer = setTimeout(() => run(q, mine), 120);
  });

  input.addEventListener('keydown', (e) => {
    const o = options();
    if (e.key === 'ArrowDown' && o.length) { e.preventDefault(); setActive(Math.min(o.length - 1, active + 1)); return; }
    if (e.key === 'ArrowUp' && o.length) { e.preventDefault(); setActive(Math.max(-1, active - 1)); return; }
    if (e.key === 'Escape') { invalidateAndClose(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = input.value.trim();
    if (active >= 0 && o[active]) { o[active].click(); return; }
    const id = normalizeQuery(q);
    if (/^PtXa(Tre|Alb)H\.\w+$/.test(id)) { open('#/gene/' + id); return; }
    if (q.length < 3) return invalidateAndClose();
    // One unambiguous hit opens; anything else goes to the comparison page.
    if (lastQuery === q && lastTotal === 1) { const a = hits.querySelector('a[href^="#/gene/"]'); if (a) { a.click(); return; } }
    goToResults(q);
  });
  window.addEventListener('hashchange', () => { if (document.activeElement !== input) invalidateAndClose(); });
}

function markNav() {
  const p = location.hash.slice(1) || '/';
  document.querySelectorAll('header.top nav a').forEach((a) => {
    const h = a.getAttribute('href').slice(1);
    a.classList.toggle('on', h === p || (h !== '/' && p.startsWith(h)));
  });
  // A grouped tab must show that the page you are on lives inside it; otherwise the header
  // says nothing is selected on five of the site's pages.
  document.querySelectorAll('header.top .navmenu').forEach((d) => {
    d.classList.toggle('on', [...d.querySelectorAll('a')].some((a) => a.classList.contains('on')));
  });
}
addEventListener('hashchange', markNav);

/* ---------- views ---------- */
route(/^\/$/, async (navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading();
  const man = await loadManifest();
  const s = man.summary;
  const e = man.expression || {};
  const a = man.annotation || {};
  const ps = man.phylostrat || {};
  // Per haplotype, never one summed figure: the lab rule is that HAP1 and HAP2 are reported
  // separately, and the pool is 776 vs 835. Read from the ladder, which validate_data.py holds
  // equal to the shard ranks stratum by stratum.
  const poolOf = (rows) => (rows || []).filter((r) => r.rank >= 18).reduce((acc, r) => acc + r.n, 0);
  const lsgH1 = poolOf((ps.ladder || {}).hap1);
  const lsgH2 = poolOf((ps.ladder || {}).hap2);
  const dz = man.dissertation || {};
  const lsgFin = (h) => ((dz.lsg || {})[h] || {}).final;

  // What each module ANSWERS, in a reader's terms -- not its filter count.
  const MODULE_BLURB = {
    annotation: 'What the gene is: description, Arabidopsis hit, Pfam, GO, and its allele in the other haplotype.',
    synteny: 'Whether it has orthologs, in how many of 12 genomes, and how that changed when the panel was completed.',
    phylostrat: 'How old it is, which phylostratum, and whether genEra was confident about it.',
    duplication: 'Its duplicate partners with divergence, and tandem-array membership.',
    expression: `Where it is expressed, across ${fmt(e.n_samples)} samples from ${e.n_studies} curated studies.`,
    about: 'Provenance, known limitations, and how to cite this.',
  };

  // A search box that belongs to the page, not the header: a first-time reader's first act.
  // It submits to the same #/search route the header box uses, so there is one search.
  const heroInput = el('input', {
    type: 'search', placeholder: 'Gene ID, gene name, Potri ID, Arabidopsis locus, Pfam or keyword',
    'aria-label': 'Search genes', autocomplete: 'off', spellcheck: 'false',
  });
  const heroSearch = el('form', {
    class: 'hero-search', role: 'search',
    onsubmit: (ev) => {
      ev.preventDefault();
      const q = heroInput.value.trim();
      if (q) location.hash = '#/search/' + encodeURIComponent(q);
    },
  }, heroInput, el('button', { type: 'submit', class: 'btn primary' }, 'Search'));
  const EXAMPLES = [['PtXaTreH.05G120200', '#/gene/PtXaTreH.05G120200'],
    ['CCoAOMT1', '#/search/CCoAOMT1'], ['Potri.010G150700', '#/search/Potri.010G150700'],
    ['arabinogalactan', '#/search/arabinogalactan'], ['AT1G20440', '#/search/AT1G20440'],
    ['PF00249', '#/search/PF00249']];

  // Where to go next, as places rather than as the module list: each tile is a page.
  const EXPLORE = [
    ['#/browse', 'Browse', 'Filter every gene across every layer; export or save the set.'],
    ['#/map', 'Genome map', 'Both haplotypes chromosome by chromosome, down to single genes.'],
    ['#/karyotype', 'Ancestral karyotype', 'Each gene placed on the ancestral eudicot karyotype (dissertation Figure 2.S2).'],
    ['#/module/expression', 'Expression', `${fmt(e.n_samples)} samples from ${e.n_studies} curated studies.`],
    ['#/module/duplication', 'Duplication', 'Tandem arrays and whole-genome duplication partners.'],
    ['#/module/phylostrat', 'Gene age', 'Phylostrata and the lineage-specific gene set.'],
    ['#/arrays', 'Tandem arrays', 'Every curated array, per haplotype, with divergence and expression.'],
    ['#/glossary', 'Glossary', 'The terms used on this site, as the dissertation defines them.'],
    ['#/downloads', 'Downloads', 'The master tables, data dictionary and supplementary tables, with checksums.'],
  ];

  setView(el('div', { class: 'home' },
    el('section', { class: 'hero' },
      el('div', { class: 'kicker' }, 'Clone INRA 717-1B4 · assembly v5.1 · two phased haplotypes'),
      el('h1', {}, 'Hybrid poplar 717 gene atlas'),
      el('p', { class: 'lede' },
        `${fmt(man.n_genes)} gene models across the two phased haplotypes of `,
        el('em', {}, 'Populus tremula'), ' × ', el('em', {}, 'P. alba'),
        '. Each gene page draws on synteny across a 12-genome panel, a phylostratum, functional '
        + 'annotation, its allele, and an expression profile. Coverage varies by layer; the ',
        el('a', { href: '#/module/about' }, 'About page'), ' gives it for each.'),
      heroSearch,
      el('p', { class: 'hero-eg' }, 'Try ',
        ...EXAMPLES.flatMap(([t, h]) => [el('a', { href: h, class: 'mono' }, t), ' ']))),

    el('div', { class: 'stat-row home-stats' },
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(man.n_genes)), el('div', { class: 'l' }, 'gene models')),
      // n_allele counts GENES carrying an allele (both members of each pair), so pairs = half.
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(Math.round((a.n_allele || 0) / 2))),
        el('div', { class: 'l' }, 'HAP1↔HAP2 syntelog pairs: 22,704 in 1:1 groups, the rest paired inside N:N and CNV groups')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(e.n_samples)), el('div', { class: 'l' }, `RNA-seq samples, ${e.n_studies} studies`)),
      el('div', { class: 'stat', 'data-home-lsg': '' }, el('div', { class: 'n' }, `${fmt(lsgFin('HAP1'))} / ${fmt(lsgFin('HAP2'))}`),
        el('div', { class: 'l' }, `lineage-specific genes, HAP1 / HAP2 (final set, from ${fmt(lsgH1)} / ${fmt(lsgH2)} candidates at PS ≥ 18)`)),
    ),

    questionsCard(),

    el('section', { class: 'home-explore' },
      el('h2', {}, 'Explore'),
      el('div', { class: 'tiles' }, ...EXPLORE.map(([h, t, d]) =>
        el('a', { class: 'tile', href: h }, el('span', { class: 'tile-t' }, t), el('span', { class: 'tile-d' }, d))))),

    el('div', { class: 'home-cols' },
      el('div', { class: 'card' },
        el('h2', {}, 'Start here'),
        el('div', { class: 'kv' },
          el('dt', {}, el('a', { href: '#/browse' }, 'Browse all genes')),
          el('dd', { class: 'muted' }, 'Filter across every module at once, then export or save the selection.'),
          // Was "PS18 Populus, drought-responsive in bark": "drought-responsive" rested on a
          // descriptive n=3 ratio the Contrasts view itself says is not a test. The pool is the
          // rerun that added Idesia (C5, Chen 2026-09-21 evening), in which this gene is PS17 and
          // out of the pool; the frozen call had it at PS18, and its page says so.
          el('dt', {}, el('a', { href: '#/gene/PtXaTreH.05G120200' }, 'PtXaTreH.05G120200')),
          el('dd', { class: 'muted' }, 'An example gene page, and one the current genEra call moved: '
            + 'PS18 in the frozen genEra call, PS17 Saliceae in the current one.'),
          // Three examples, chosen because each shows a DIFFERENT shape of duplication rather
          // than three views of the same one. Every claim below is read off the shipped record.
          el('dt', {}, el('a', { href: '#/gene/PtXaTreH.08G070200' }, 'PtXaTreH.08G070200')),
          el('dd', { class: 'muted' }, 'All four duplication types at one locus: four tandem MYB '
            + 'copies, an sWGD partner and an aWGT partner. The other haplotype carries two '
            + 'tandem copies, not four.'),
          el('dt', {}, el('a', { href: '#/gene/PtXaTreH.10G046700' }, 'PtXaTreH.10G046700')),
          el('dd', { class: 'muted' }, 'A seven-copy nucleoredoxin array on HAP1 with a single '
            + 'copy at the matching locus on HAP2: a HAP1-specific expansion (TD-associated CNV).'))),

      el('div', { class: 'card' },
        el('h2', {}, 'Modules'),
        el('p', { class: 'muted', style: 'margin:0 0 10px;font-size:13px' },
          'Each gene page is built from these layers.'),
        el('div', { class: 'kv' }, ...MODULES.filter((m) => MODULE_BLURB[m.id]).flatMap((m) => [
          el('dt', {}, m.overview
            ? el('a', { href: `#/module/${m.id}` }, m.label)
            : el('span', {}, m.label)),
          el('dd', { class: 'muted' }, MODULE_BLURB[m.id])])),
        el('p', { class: 'muted', style: 'margin:12px 0 0;font-size:12px' },
          'Allele-specific expression is not yet included.'))),

    el('div', { class: 'card cite-card' },
      el('h2', {}, 'Before you cite anything'),
      el('p', { style: 'margin:0;font-size:14px;color:var(--ink-2)' },
        'Private-gene calls depend on which genomes are in the panel, HAP2 domain annotation is '
        + 'thinner than HAP1 for release reasons, and expression is raw TPM. A gene with no allele '
        + 'partner is not by itself absent from the other haplotype; its relationship category says more. '
        + 'Chromatin marks are measured on the P. trichocarpa ortholog, not on 717, and peptide '
        + 'evidence comes from public mass spectra, often from other Populus species. The ',
        el('a', { href: '#/module/about' }, 'provenance page'),
        ' states each limitation with its numbers.')),
  ));
  markNav();
});

/** Questions the shipped layers can answer, each one a real Browse query.
 *
 *  Counts are filled in AFTER first paint, from the facet index, using Browse's own filter
 *  predicates. Two reasons this is not precomputed into the manifest: a baked aggregate goes
 *  stale the moment a patcher runs without its owning stage (TODO 25 -- and this very page
 *  shipped a withdrawn LSG count for two days that way), and computing it here makes the
 *  number and the page it links to the same calculation rather than two that can disagree.
 *
 *  Never blocks the home page: if the facet index is slow or fails, every question still
 *  links correctly and simply shows no count. */
function questionsCard() {
  const counts = QUESTIONS.map(() => el('span', { class: 'q-n' }, ''));
  const card = el('div', { class: 'card qcard' },
    el('h2', {}, 'Start from a question', el('span', { class: 'tag' }, 'live counts')),
    el('div', { class: 'qgrid' }, ...QUESTIONS.map((q, i) =>
      el('a', { class: 'qtile', href: browseHref(q.params) },
        el('span', { class: 'q-q' }, q.q),
        el('span', { class: 'q-sub' }, q.sub),
        counts[i]))),
    el('p', { class: 'muted', style: 'margin:12px 0 0;font-size:11.5px' },
      'Every cutoff is stated in the question, because "expressed" and "tissue-specific" are '
      + 'not absolute properties. Each link opens Browse with those filters already set, and '
      + 'the count beside it is computed with the same predicates that page uses.'));

  (async () => {
    try {
      const facets = await loadFacets();
      const rows = facets.rows.map((_, i) => facetRow(facets, i));
      QUESTIONS.forEach((q, i) => {
        // Per haplotype wherever the question is about a biological set (lab rule: HAP1 and
        // HAP2 are reported separately, never summed).
        if (q.byHap) {
          const a = countQuestion(q, rows, FILTERS, 'hap1'), b = countQuestion(q, rows, FILTERS, 'hap2');
          if (a != null) counts[i].textContent = `· ${fmt(a)} HAP1 / ${fmt(b)} HAP2 genes`;
          return;
        }
        const n = countQuestion(q, rows, FILTERS);
        if (n != null) counts[i].textContent = '· ' + fmt(n) + ' genes';
      });
    } catch { /* counts are a bonus; the links work regardless */ }
  })();
  return card;
}

/* ---------------------------------------------------------------------------------------
 *  The gene page got long. Fourteen or more cards now, and before this the running order was
 *  whatever order the modules were imported in -- so a predicted promoter motif could sit
 *  above the duplication class, and the expression summary landed near the bottom.
 *
 *  Two things fix that, and they are deliberately different:
 *    glanceCard()  answers "what am I looking at" in one card, so a reader who reads nothing
 *                  else still leaves with the duplication class, the syntelogs and the peak
 *                  tissue. It states only fields already on the record -- it computes nothing
 *                  new, so it cannot disagree with the card it summarises.
 *    sectionNav()  is built FROM THE CARDS THAT ACTUALLY RENDERED, not from a fixed list, so
 *                  a band that produced nothing for this gene never appears as a dead link.
 * ------------------------------------------------------------------------------------- */

function glanceCard(g, man) {
  const bits = [];

  const dt = dupTypeLabel(g.dup);
  if (dt) {
    bits.push(['Duplication', el('span', {}, dt,
      g.dup && g.dup.td ? el('span', { class: 'muted' }, ' · in a tandem array') : null)]);
  }

  // NOT a syntelog count. `syn.n` is how many of the 12 panel genomes the orthogroup spans,
  // which is what synteny.js calls it; the only literal list of syntelogs on the record is
  // aek.an[].sl, and that is shipped `exploratory`, so it stays in the card that carries its
  // caveat rather than being promoted to a summary strip.
  const s = g.syn;
  if (s && s.cls) {
    bits.push(['Synteny', el('span', {}, classBadge(s.cls),
      s.n != null ? el('span', { class: 'muted' }, `  orthogroup spans ${s.n} of 12 genomes`) : null,
      s.stable === false ? el('span', { class: 'badge', style: 'margin-left:6px' },
        '\u26a0 sensitivity-unstable') : null)]);
  }

  const x = g.x;
  const px = paperExpr(g);
  if (px && px.top) {
    bits.push(['Expression', el('span', {},
      el('strong', {}, px.top), ` ${fmt(Math.round(px.t[px.top]))} TPM`,
      el('span', { class: 'muted' }, ` mean · τ ${px.tau.toFixed(2)}`
        + (px.tau >= 0.85 && px.ok ? ' (tissue-specific)' : '')))]);
  } else if (px) {
    const hi = paperHighest(g);
    bits.push(['Expression', el('span', {},
      el('strong', {}, hi.tissue), ` ${fmt(Math.round(hi.v))} TPM`,
      el('span', { class: 'muted' }, ' mean, its highest tissue group · under 5 TPM in every group of the '
        + 'reference panel, so no peak tissue or τ is called'))]);
  }
  if (g.resp && g.resp.v != null) {
    bits.push(['Responsiveness', el('span', {},
      el('span', { class: 'mono' }, g.resp.v.toFixed(3)),
      el('span', { class: 'muted' }, ` median |log2FC|${g.resp.n ? ` over ${g.resp.n} of the dissertation’s curated perturbation contrasts` : ''}`))]);
  }
  if (g.allele && g.allele.id) {
    bits.push(['Allele', el('span', {},
      el('a', { href: `#/gene/${g.allele.id}`, class: 'mono' }, g.allele.id),
      el('span', { class: 'muted' }, ' · '),
      el('a', { href: `#/pair/${g.id}` }, 'side by side'))]);
  } else if (g.dup && g.dup.td) {
    // No allele of its own: the Allele card says what the array reaches; this row points at it.
    const holder = el('span', { class: 'muted', 'data-glance-array-allele': '' }, 'none of its own; checking its tandem array…');
    bits.push(['Allele', holder]);
    arrayAlleles(g).then((r) => {
      const w = r ? r.members.filter((x) => x.id !== g.id && x.allele) : [];
      holder.textContent = '';
      holder.className = '';
      if (!w.length) { holder.append(el('span', { class: 'muted' }, 'none of its own, and none in its tandem array')); return; }
      // Native append prints a null as the word 'null', so drop the absent parts first.
      holder.append(...['none of its own; array-level link via ',
        el('a', { href: `#/array/${r.arrayId}`, class: 'mono' }, r.arrayId), ': ',
        el('a', { href: `#/gene/${w[0].allele}`, class: 'mono' }, w[0].allele),
        el('span', { class: 'muted' }, ' (not a 1:1 call)'),
        w.length > 1 ? el('span', { class: 'muted' }, ` and ${w.length - 1} more`) : null,
        r.counted === false ? el('span', { class: 'muted' }, ' (array removed by the pseudogene screen)') : null].filter(Boolean));
    }).catch(() => { holder.textContent = 'none of its own'; });
  }
  // A gene in a copy-search panel: the route to the other haplotype's copies, which the allele
  // map cannot give when the array has no assigned allele (NRX1: none of its 7 copies has one).
  const cp = man && man.copies && man.copies.genes && man.copies.genes[g.id];
  if (cp) {
    const L = man.copies.loci[cp];
    const s1 = L.summary.hap1 || {}, s2 = L.summary.hap2 || {};
    const side = (h, s) => (s.pieces == null ? `${h}: nothing found`
      : h === (L.hap === 'hap1' ? 'HAP1' : 'HAP2')
        ? `${h}: ${s.annotated + s.unannotated} copies, ${s.unannotated} not annotated`
        : `${h}: ${s.pieces} piece${s.pieces === 1 ? '' : 's'}, the longest ${Math.round(s.max_cov_pct)}% of the protein`);
    bits.push(['Both haplotypes', el('span', {},
      `${L.name} · ${side('HAP1', s1)} · ${side('HAP2', s2)} `,
      el('a', { href: `#/copies/${cp}`, onclick: (ev) => {
        const c = document.querySelector('[data-card="copies"]');
        if (c) { ev.preventDefault(); jumpTo(c); }
      } }, 'see the copies \u2193'))]);
  }
  if (!bits.length) return null;

  return el('div', { class: 'card glance' },
    el('h2', {}, 'At a glance'),
    el('dl', { class: 'kv' }, ...bits.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
    el('p', { class: 'muted', style: 'margin:11px 0 0;font-size:11.5px' },
      'Every value here is repeated in full, with its caveats, in the card it came from. '
      + 'Nothing is computed for this strip.'));
}

/** Cards that answer the SAME question in different forms are merged into one card with a
 *  view switch. The Duplication card and the Duplication layers figure named exactly the
 *  same partners -- the figure draws every gene the card lists, in position -- so they ran
 *  as two cards, 645px and 1422px, saying the same thing twice.
 *
 *  This is presentational only. Each module still builds its own complete card; the merge
 *  moves their contents into panels and never touches what either one drew. That matters
 *  because modules may not import one another, so neither could host the other's view.
 *
 *  The first view is rendered VISIBLE and the rest are display:none. That order is load
 *  bearing: the layers figure measures its container to size an SVG, and a panel that is
 *  hidden at draw time has zero width. Hidden panels here hold tables, which do not measure.
 */
function mergeViewGroups(cards) {
  const groups = new Map();
  cards.querySelectorAll('.card[data-view-group]').forEach((c) => {
    const k = c.getAttribute('data-view-group');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });

  groups.forEach((members) => {
    if (members.length < 2) return;            // nothing to merge; leave the card alone
    const titleText = (members[0].querySelector('h2')?.childNodes[0]?.textContent || '').trim()
      .replace(/\s+layers$/i, '');             // "Duplication layers" -> "Duplication"
    const tagSpan = el('span', { class: 'tag' }, members[0].getAttribute('data-view-tag') || '');
    const tabs = el('div', { class: 'viewtabs', role: 'tablist' });
    const host = el('div', {
      class: 'card viewgroup',
      'data-card': members[0].getAttribute('data-view-group'),
    }, el('h2', {}, titleText, tagSpan), tabs);

    members[0].replaceWith(host);

    const panels = members.map((m, i) => {
      m.querySelector('h2')?.remove();          // the group heading replaces it
      // NOT display:none. This site is one people Ctrl+F for a gene id in, and find-in-page
      // cannot see display:none -- merging the two duplication cards into tabs made every
      // partner id in the tables view unfindable, which the render checks caught because
      // innerText excludes it for exactly the same reason. `hidden="until-found"` keeps the
      // panel collapsed but findable: the browser reveals it and fires beforematch, which
      // switches the tab below. Browsers without support treat the attribute as plain
      // `hidden`, i.e. what it did before, so this only ever adds.
      const panel = el('div', {
        class: 'viewpanel', role: 'tabpanel',
        id: `vp-${m.getAttribute('data-view-group')}-${m.getAttribute('data-view-key')}`,
      });
      if (i) panel.setAttribute('hidden', 'until-found');
      panel.dataset.view = m.getAttribute('data-view-key') || String(i);
      // Move the CARD ELEMENT itself, not its children. Moving the children detaches the
      // card, and a module that mutates its own card after construction -- card.append(...)
      // from a button handler -- then writes into a node no longer in the document. The
      // Expression card does exactly that: "Show all 652 samples" appends a holder to
      // `card`, so with the children moved the button silently did nothing. Keeping the card
      // in the tree keeps every such closure valid, and its data-card stamp comes along.
      panel.append(m);
      host.append(panel);
      return panel;
    });

    const btns = members.map((m, i) => {
      const b = el('button', {
        class: 'viewtab' + (i ? '' : ' on'), type: 'button', role: 'tab',
        'aria-selected': i ? 'false' : 'true',
        'aria-controls': panels[i].id,
        onclick: () => show(i),
      }, m.getAttribute('data-view-label') || `View ${i + 1}`);
      tabs.append(b);
      return b;
    });

    function show(i) {
      panels.forEach((pn, j) => {
        if (j === i) pn.removeAttribute('hidden');
        else pn.setAttribute('hidden', 'until-found');
      });
      btns.forEach((b, j) => {
        b.classList.toggle('on', j === i);
        b.setAttribute('aria-selected', j === i ? 'true' : 'false');
      });
      tagSpan.textContent = members[i].getAttribute('data-view-tag') || '';
    }

    // Find-in-page revealed a collapsed panel: make its tab the selected one, or the card
    // would show the found text while the tab strip still claims another view is current.
    panels.forEach((pn, i) => pn.addEventListener('beforematch', () => show(i)));

    // Left/Right move between tabs, which is what a tablist is expected to do.
    tabs.addEventListener('keydown', (e) => {
      const i = btns.findIndex((b) => b === document.activeElement);
      if (i < 0) return;
      const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
      if (j < 0 || j >= btns.length) return;
      e.preventDefault(); btns[j].focus(); show(j);
    });
  });
}

/** Sticky in-page nav. `bands` is the list that actually produced cards. */
function sectionNav(bands) {
  if (bands.length < 2) return null;
  const links = bands.map((b) => el('a', { href: `#/gene/${b.gene}`, 'data-sec': b.id,
    class: 'secnav-link' }, b.label));
  const nav = el('nav', { class: 'secnav' }, ...links);

  // Anchor scrolling by hash would fight the hash router, so move the page directly.
  links.forEach((a, i) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    jumpTo(document.getElementById('sec-' + bands[i].id));
  }));

  // Mark the band the reader is currently inside: the LAST heading that has passed under the
  // sticky bars. Positions are read live on each frame rather than cached from an
  // IntersectionObserver entry -- an entry's boundingClientRect is a snapshot from when it
  // fired, so headings that did not change state keep reporting where they used to be, and
  // scrolling back to the top left the last band still marked.
  let queued = false;
  let frame = null;
  const spy = () => {
    frame = null;
    queued = false;
    if (!nav.isConnected) {                       // view replaced by the router
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      return;
    }
    // Must sit BELOW where scroll-margin-top parks a heading (--top-h + 54px in app.css),
    // or jumping to a band marks the one before it: the heading lands at 107px while the
    // line was at 96px, so it never counted as reached. The slack is that difference plus
    // room for the nav wrapping to two rows on a narrow screen.
    const line = (parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--top-h')) || 47) + nav.offsetHeight + 36;
    let current = bands[0] && bands[0].id;
    bands.forEach((b) => {
      const h = document.getElementById('sec-' + b.id);
      if (h && h.getBoundingClientRect().top <= line) current = b.id;
    });
    const changed = links.some((a) => a.classList.contains('on') !== (a.dataset.sec === current));
    links.forEach((a) => a.classList.toggle('on', a.dataset.sec === current));

    // Below 640px the nav is one swipeable row, so the active chip can sit off-screen.
    // Bring it into the nav's own scroll box -- set scrollLeft rather than calling
    // scrollIntoView, which would also scroll the PAGE and fight the reader.
    if (changed && nav.scrollWidth > nav.clientWidth + 2) {
      const on = links.find((a) => a.classList.contains('on'));
      if (on) {
        const pad = 12;
        if (on.offsetLeft < nav.scrollLeft + pad) nav.scrollLeft = Math.max(0, on.offsetLeft - pad);
        // Align the chip's START, not its end: the row snaps to chip starts (scroll-snap-align),
        // so an end-aligned scrollLeft was pulled back by the snap and left the chip half off.
        else if (on.offsetLeft + on.offsetWidth > nav.scrollLeft + nav.clientWidth - pad)
          nav.scrollLeft = on.offsetLeft;
      }
    }
  };
  const onScroll = () => { if (!queued) { queued = true; frame = requestAnimationFrame(spy); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
  onDispose(nav, () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (frame !== null) cancelAnimationFrame(frame);
    queued = false;
  });
  return nav;
}

/** Stamp every top-level card with its evidence tier (registry.js CARD_EVIDENCE): a class
 *  that draws the left rule, and a chip that says it in words. A folded card carries both on
 *  the fold, whose summary is what a reader sees. A card with no entry is a console error --
 *  which fails the render checks -- rather than a card that silently reads as tier 1. */
function applyEvidence(cards) {
  const missing = [];
  for (const top of [...cards.children]) {
    if (top.matches('h2.sect')) continue;
    const card = top.matches('details.card-fold') ? top.querySelector(':scope > .card') : top;
    const key = card && card.dataset.card;
    const ev = key && CARD_EVIDENCE[key];
    if (!ev) { missing.push(key || '(unstamped card)'); continue; }
    const [tier, words] = ev;
    top.classList.add(`ev-${tier}`);
    top.dataset.evidence = String(tier);
    const head = top.matches('details') ? top.querySelector(':scope > summary')
      : top.querySelector(':scope > h2');
    (head || top).append(el('span', { class: `ev-chip ev-chip-${tier}`, title: EVIDENCE_TIERS[tier] }, words));
  }
  if (missing.length) {
    console.error(`evidence: no tier declared for card(s) ${missing.join(', ')} -- add them to `
      + 'CARD_EVIDENCE in js/core/registry.js');
  }
}

/** One line under the section nav decoding the three rule styles. The words come from the same
 *  table the chips do, so the key cannot list a label no card carries. */
function evidenceKey() {
  const words = (t) => [...new Set(Object.values(CARD_EVIDENCE).filter(([k]) => k === t).map(([, w]) => w))];
  return el('p', { class: 'ev-key' },
    el('span', { class: 'ev-key-item' }, el('i', { class: 'ev-sw ev-1' }), words(1).join(' or ')),
    el('span', { class: 'ev-key-item' }, el('i', { class: 'ev-sw ev-2' }), words(2).join(' or ')),
    el('span', { class: 'ev-key-item' }, el('i', { class: 'ev-sw ev-3' }), words(3).join(', ')),
    el('span', { class: 'ev-key-note' }, 'Cards run from the strongest evidence to the weakest.'));
}

/** The specimen label at the top of a gene page: what it is, where it is, and where to go
 *  next. It restates only fields already on the record (description, rank, class, allele) --
 *  the cards below carry each one with its caveats, so nothing here is computed. */
function geneHeader(g, kb) {
  const ann = g.ann || {};
  const desc = ann.d || (ann.atd ? `similar to ${ann.at || 'Arabidopsis'}: ${ann.atd}` : null);
  const ps = g.ps || {};
  const facts = [];
  const used = (ps.fin && ps.fin.u) || ps.rank;
  if (ps.rank != null) facts.push(el('span', { class: 'gh-fact' }, `PS${used}`,
    used !== ps.rank ? el('span', { class: 'muted' }, ' Populus (reassigned from PS19)')
      : (ps.name ? el('span', { class: 'muted' }, ` ${ps.name}`) : null)));
  const lsg = lsgStatus(g);
  if (lsg) facts.push(el('span', { class: 'gh-fact', 'data-lsg-chip': lsg.final ? 'final' : 'excluded' }, lsg.text));
  if (isQcFlagged(g)) facts.push(el('span', { class: 'gh-fact', 'data-qc-chip': '' },
    'gene model flagged by quality control, not in the dissertation\u2019s counts'));
  if (g.syn && g.syn.cls) facts.push(el('span', { class: 'gh-fact' }, g.syn.cls.replace(/_/g, ' ')));
  // Same form as the allele chip: the label, then the ID as a link. Every gene of a counted
  // tandem array gets it (genes of hemizygous TD arrays included); the size is the number of
  // members counted in the array, filled in once its members are read.
  if (g.dup && g.dup.td && g.td && g.td.aid) {
    const size = el('span', { class: 'muted', 'data-array-chip-size': '' }, '');
    facts.push(el('span', { class: 'gh-fact', 'data-array-chip': g.td.aid }, 'tandem array ',
      el('a', { href: `#/array/${g.td.aid}`, class: 'mono', title: 'open the array page' }, g.td.aid), size));
    arrayAlleles(g).then((r) => {
      const n = r ? r.members.filter((m) => m.td).length : 0;
      if (n) size.textContent = ` · ${n} genes`;
    }).catch(() => {});
  }
  if (g.allele && g.allele.id) facts.push(el('span', { class: 'gh-fact' }, 'allele ',
    el('a', { href: `#/gene/${g.allele.id}`, class: 'mono' }, g.allele.id)));
  else {
    const chip = el('span', { class: 'gh-fact muted' },
      g.rel && g.rel.c === '1:1' ? '1:1 group; the partner is not named on record' : 'no 1:1 allele called');
    facts.push(chip);
    if (g.dup && g.dup.td) {
      arrayAlleles(g).then((r) => {
        const n = r ? r.members.filter((x) => x.id !== g.id && x.allele).length : 0;
        if (n) chip.textContent = `no 1:1 allele; its array reaches ${n} on the other haplotype`;
      }).catch(() => {});
    }
  }

  const copyBtn = el('button', { type: 'button', class: 'btn' }, 'Copy ID');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(g.id); copyBtn.textContent = 'Copied'; }
    catch { copyBtn.textContent = g.id; }
    setTimeout(() => { copyBtn.textContent = 'Copy ID'; }, 1600);
  });
  // The whole published record for this gene, exactly as the page read it.
  const dlBtn = el('button', { type: 'button', class: 'btn' }, 'Download record');
  dlBtn.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(g, null, 2) + '\n'],
      { type: 'application/json;charset=utf-8' }));
    const a = el('a', { href: url, download: `${g.id}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  // Protein sequence: the ESMFold input sequence carried in the structure buckets (40,685 genes).
  // Fetched only on click; a gene without a model says so instead of downloading nothing.
  const faBtn = el('button', { type: 'button', class: 'btn', 'data-protein-fasta': '' }, 'Protein FASTA');
  faBtn.addEventListener('click', async () => {
    faBtn.disabled = true;
    faBtn.textContent = 'Fetching…';
    try {
      const s = await loadSequences(g);
      if (!s) { faBtn.textContent = 'No sequence record for this gene'; return; }
      downloadText(`${g.id}.protein.faa`, fastaRecord(g, 'p', s.p));
      faBtn.textContent = `Protein FASTA (${s.p.length} aa)`;
      faBtn.disabled = false;
    } catch { faBtn.textContent = 'Could not fetch the sequence'; }
  });

  return el('header', { class: 'gene-head', 'data-gene-head': g.id },
    el('div', { class: 'kicker' }, `Gene model · ${g.hap === 'hap1' ? 'P. tremula haplotype' : 'P. alba haplotype'}`),
    el('h1', { class: 'mono' }, g.id),
    desc ? el('p', { class: 'gh-desc' }, desc.toLowerCase()) : el('p', { class: 'gh-desc muted' }, 'no functional description'),
    el('p', { class: 'sub' }, `${hapLabel(g.hap)} · ${g.chr} · ${kb} kb`,
      el('span', { class: 'mono muted' }, `   ${g.chr}:${fmt(g.start)}–${fmt(g.end)} (${g.strand || '?'})`)),
    el('div', { class: 'gh-facts' }, ...facts),
    el('div', { class: 'gh-actions' },
      el('a', { class: 'btn', href: `#/pair/${g.id}` }, g.allele && g.allele.id ? 'Compare alleles' : 'Allele pair'),
      el('a', { class: 'btn', href: `#/map/${g.hap}/${g.chr}` }, 'Genome map'),
      el('a', { class: 'btn', href: browseHref({ hap: g.hap, chr: g.chr }) }, `Browse ${g.chr}`),
      faBtn, copyBtn, dlBtn));
}

route(/^\/gene\/(.+)$/, async (rawId, navigation) => {
  const { setView, loading } = scopedView(navigation);
  // A pasted ID often carries a transcript suffix or the wrong case; both resolve.
  const id = normalizeQuery(decodeURIComponent(rawId));
  loading(`Loading ${id}…`);
  const [g, man] = await Promise.all([getGene(id).catch(() => null), loadManifest()]);
  if (!g) {
    // Not a 717 gene ID: a P. trichocarpa ID or a gene name goes to search, which knows both.
    const { total } = await searchGenesRanked(id).catch(() => ({ total: 0 }));
    if (total) return navigate('/search/' + encodeURIComponent(id));
    return setView(el('div', { class: 'empty' },
      el('h2', {}, 'No such gene'), el('p', { class: 'mono' }, id),
      el('p', { class: 'muted' }, 'IDs look like PtXaTreH.01G000100 (HAP1) or PtXaAlbH.01G000100 (HAP2). '
        + 'A transcript suffix (.1) and lower case are accepted. Unplaced-scaffold genes exist on HAP1 only (PtXaTreH.T…).')));
  }

  const kb = ((g.end - g.start) / 1000).toFixed(2);
  const cards = el('div', { class: 'cards' },
    // built here rather than by a module, so it is stamped by hand like the rest
    el('div', { class: 'card', 'data-card': 'location' },
      el('h2', {}, 'Location', el('span', { class: 'tag' }, 'v5.1')),
      el('dl', { class: 'kv' },
        el('dt', {}, 'Haplotype'), el('dd', {}, hapLabel(g.hap)),
        el('dt', {}, 'Position'), el('dd', { class: 'mono' }, `${g.chr}:${fmt(g.start)}–${fmt(g.end)}`),
        el('dt', {}, 'Strand'), el('dd', {}, g.strand
          ? el('span', {}, el('span', { class: 'mono' }, g.strand), ' ', el('span', { class: 'muted' }, g.strand === '+' ? 'forward' : 'reverse'))
          : el('span', { class: 'muted' }, 'unknown')),
        el('dt', {}, 'Span'), el('dd', {}, `${kb} kb`),
        ...(g.gs ? [el('dt', {}, 'Structure'),
          el('dd', {}, g.gs.ex === 1 ? el('span', {}, el('strong', {}, 'single exon'),
              el('span', { class: 'muted' }, ' · intronless'))
            : el('span', {}, `${g.gs.ex} exons`,
                g.gs.in != null ? el('span', { class: 'muted' }, ` · ${g.gs.in} introns`) : null))] : []))));
  navigation?.track?.(cards);

  if (g.org) {
    cards.firstChild.append(el('div', { class: 'warn' },
      el('strong', {}, `Homologous to the ${g.org.o} genome. `),
      'Organelle-derived sequence in the nuclear assembly is a known source of false '
      + '"novel gene" calls. Treat any lineage-specific claim for this gene with care.'));
  }

  // The Location card built above belongs to Identity, so that band opens already non-empty.
  const glance = glanceCard(g, man);
  const bands = [];
  for (const sec of GENE_SECTIONS) {
    const made = [];
    for (const m of geneSectionModules(sec)) {
      const c = m.geneCard(g, man);   // an element, or a fragment of several cards
      if (!c) continue;
      // Stamp which module drew each card. Checks kept identifying cards by their HEADING
      // TEXT or by position ("the first .locus-canvas", "canvases[1]"), and both broke this
      // week -- headings move when cards merge, and a shared style class is not identity.
      // Stamped BEFORE appending, because appending a fragment empties it.
      const nodes = c.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? [...c.children] : [c];
      nodes.forEach((n) => {
        if (n.classList && n.classList.contains('card') && !n.dataset.card) n.dataset.card = m.id;
      });
      made.push(c);
    }
    const opensWithLocation = sec.id === 'identity';
    if (!made.length && !opensWithLocation) continue;   // no dead band, and no dead nav link

    const head = el('h2', { class: 'sect', id: 'sec-' + sec.id },
      el('span', { class: 'sect-label' }, sec.label),
      sec.blurb ? el('span', { class: 'sect-blurb' }, sec.blurb) : null);
    if (opensWithLocation) cards.prepend(head); else cards.append(head);
    made.forEach((c) => cards.append(c));
    bands.push({ id: sec.id, label: sec.label, gene: g.id });
  }

  // Two cards that answer the same question in different forms become one card with a view
  // switch. Runs BEFORE the fold pass so a merged card can still be marked secondary later.
  mergeViewGroups(cards);

  // A card marked data-secondary duplicates something already drawn above and folds shut.
  // Done after appending because a module may return a fragment of several cards, and only
  // some of them carry the mark. The canvas inside starts at zero width while folded; the
  // locus module observes its CONTAINER with a ResizeObserver, so it paints on first open.
  cards.querySelectorAll('.card[data-secondary]').forEach((c) => {
    const why = c.getAttribute('data-secondary');
    const title = (c.querySelector('h2') || {}).textContent || 'More';
    const d = el('details', { class: 'card-fold' },
      el('summary', {}, el('span', { class: 'fold-title' }, title),
        why ? el('span', { class: 'fold-why' }, why) : null));
    c.replaceWith(d);
    c.querySelector('h2')?.remove();   // the summary is the heading now
    d.append(c);
  });

  applyEvidence(cards);

  const ord = g.ord || {};
  setView(el('div', {},
    geneHeader(g, kb),
    qcBanner(g),
    (ord.p || ord.n) ? el('p', { class: 'gh-nb' },
      ord.p ? el('a', { href: `#/gene/${ord.p}`, class: 'mono' }, '← ' + ord.p) : null,
      (ord.p && ord.n) ? el('span', { class: 'muted' }, '   neighbors on the chromosome   ') : null,
      ord.n ? el('a', { href: `#/gene/${ord.n}`, class: 'mono' }, ord.n + ' →') : null) : null,
    glance,
    sectionNav(bands),
    evidenceKey(),
    cards));
  markNav();
});

// #/copies/<locus> -- a copy-search panel on its own page, for linking.
route(/^\/copies\/(.+)$/, async (slug, navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading(`Loading ${slug}\u2026`);
  setView(await copiesView(slug, await loadManifest()));
  markNav();
});

// #/array/<id> and #/arrays -- a curated tandem array on its own page, and the list of them.
route(/^\/array\/(.+)$/, async (aid, navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading(`Loading tandem array ${aid}\u2026`);
  setView(await arrayView(aid));
  markNav();
});
route(/^\/arrays$/, async (navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading('Loading the tandem arrays\u2026');
  setView(await arraysIndexView());
  markNav();
});

// #/pair/<id> -- the allele pair as one page. Takes EITHER haplotype's id and always
// presents HAP1 on the left, so two readers arriving from opposite alleles see the same
// picture rather than mirror images of it.
route(/^\/pair\/(.+)$/, async (id, navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading(`Loading the allele pair for ${id}\u2026`);
  setView(await pairView(id));
  markNav();
});

// #/karyotype -- the ancestral genome as a navigable surface. The grid is reduced in the
// browser from the `aek` facet column; precomputing it would create another aggregate a build
// stage owns and can leave stale, for a table that takes milliseconds to derive.
route(/^\/karyotype$/, async (navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading('Reducing the ancestral karyotype\u2026');
  setView(await karyotypeView());
  markNav();
});

// #/family/<gene id> -- the whole descent group, entered from any member. Clicking a member
// recentres on it, so "steps from here" always means steps from the gene you are looking at.
route(/^\/family\/(.+)$/, async (id, navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading(`Walking the descent group of ${id}\u2026`);
  setView(await familyView(id));
  markNav();
});

// #/status -- the gates this build passed, as a boot log. The verdicts are published by
// validate_data.py as each gate executes; nothing here is written after the fact.
route(/^\/status$/, async (navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading('Loading data checks\u2026');
  setView(await statusView());
  markNav();
});

route(/^\/changes$/, async (navigation) => {
  const { setView } = scopedView(navigation);
  setView(changesView());
  markNav();
});

route(/^\/glossary$/, async (navigation) => {
  const { setView } = scopedView(navigation);
  setView(glossaryView(await loadManifest()));
  markNav();
});

route(/^\/downloads$/, async (navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading('Loading the file list\u2026');
  setView(await downloadsView(await loadManifest()));
  markNav();
});

route(/^\/browse$/, async (navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading('Loading the gene index…');
  setView(await browseView(navigation));
  markNav();
});

route(/^\/map(?:\/(hap[12]))?(?:\/(\w+))?$/, async (hapArg, chrArg, navigation) => {
  const { setView, loading } = scopedView(navigation);
  const hap = hapArg || 'hap1';
  loading('Loading the genome map…');
  const hapBtn = (h, label) => el('button', {
    class: 'locus-btn', type: 'button',
    style: h === hap ? 'background:var(--accent);color:var(--on-accent);border-color:var(--accent)' : '',
    'aria-pressed': h === hap ? 'true' : 'false',
    // Keep the zoom window (?start=&end=) when switching haplotype on a chromosome view; the
    // track browser draws both haplotypes and states its own coordinates, so the window is
    // a place to land, not a claim that the two coordinate systems agree.
    onclick: () => {
      const q = chrArg ? (location.hash.split('?')[1] || '') : '';
      location.hash = (chrArg ? `#/map/${h}/${chrArg}` : `#/map/${h}`) + (q ? '?' + q : '');
    },
  }, label);
  const body = await renderMap(hap, chrArg || null);
  setView(el('div', {},
    el('h1', {}, 'Genome map'),
    el('p', { class: 'sub' }, 'Semantic zoom from all 19 chromosomes to one gene\'s neighborhood.'),
    el('div', { style: 'display:flex;gap:8px;margin:10px 0 14px' },
      hapBtn('hap1', 'HAP1 (TreH)'), hapBtn('hap2', 'HAP2 (AlbH)')),
    body));
  markNav();
});

route(/^\/search\/(.+)$/, async (q, navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading('Searching…');
  setView(await searchResultsView(decodeURIComponent(q)));
  markNav();
});

route(/^\/module\/(.+)$/, async (id, navigation) => {
  const { setView, loading } = scopedView(navigation);
  const m = byId(id);
  if (!m || !m.overview) return setView(el('div', { class: 'empty' }, el('h2', {}, 'No such module'), el('p', { class: 'mono' }, id)));
  loading();
  setView(await m.overview(await loadManifest()));
  markNav();
});

route(/^\/study\/(\d+)$/, async (idStr, navigation) => {
  const { setView, loading } = scopedView(navigation);
  loading();
  const id = +idStr;
  const studies = await loadExprStudies();
  const s = studies[id];
  if (!s) return setView(el('div', { class: 'empty' }, el('h2', {}, 'No such study'), el('p', {}, `study ${id}`)));

  const factorRow = (label, vals) => (vals && vals.length
    ? el('span', {}, el('strong', {}, label + ': '), vals.join(', '), '  ')
    : null);

  // samples.json carries tissue / treatment / genotype / growth / reads / % aligned / notes
  // per sample; the page used to show only the label, which threw all of it away.
  const all = await loadExprSamples();
  const mine = all.filter((x) => x.study === id).sort((a, b) => a.label.localeCompare(b.label));
  const anyNotes = mine.some((x) => x.notes);
  const cell = (v) => (v == null || v === '' ? el('span', { class: 'muted' }, '–') : v);
  const sampleCard = el('div', { class: 'card' },
    el('h2', {}, `Samples (${mine.length})`),
    el('div', { class: 'scroll-x' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Sample'), el('th', {}, 'Tissue'), el('th', {}, 'Treatment'),
        el('th', {}, 'Genotype'), el('th', {}, 'Growth'), el('th', {}, 'Role'),
        el('th', {}, 'Layout'), el('th', { class: 'num' }, 'Reads'),
        el('th', { class: 'num' }, 'Aligned %'),
        anyNotes ? el('th', {}, 'Notes') : null)),
      el('tbody', {}, ...mine.map((x) => el('tr', { 'data-i': all.indexOf(x) },
        el('td', { class: 'mono', style: 'font-size:11.5px' }, x.label),
        el('td', {}, cell(sampleTissue(x))),
        el('td', {}, cell(x.treatment)),
        el('td', {}, cell(x.genotype)),
        el('td', {}, cell(x.growth)),
        el('td', {}, x.ctrl === 'control'
          ? el('span', { class: 'badge', style: 'font-size:11px' }, 'control')
          : el('span', { class: 'muted' }, 'perturbation')),
        el('td', { class: 'muted', style: 'font-size:11.5px' }, x.layout || '–'),
        el('td', { class: 'num' }, x.reads == null ? '–' : (x.reads / 1e6).toFixed(1) + 'M'),
        el('td', { class: 'num' }, x.pct_aligned == null ? '–' : x.pct_aligned.toFixed(1)),
        anyNotes ? el('td', { class: 'muted', style: 'font-size:11px;max-width:230px' },
          cell(x.notes)) : null))))),
    el('p', { class: 'muted', style: 'margin:11px 0 0;font-size:12px' },
      `${mine.filter((x) => x.ctrl === 'control').length} control, `
      + `${mine.filter((x) => x.ctrl === 'perturbation').length} perturbation. `
      + 'Only WT controls contribute to the per-tissue medians shown on the array and allele-pair pages.'));

  // The design, drawn. With ?gene=<id> the same drawing carries that gene's values.
  const hub = linkHub();
  const d = designOf(id, all);
  const geneId = (query().gene || '').trim();
  let gene = null, vec = null, geneNote = null;
  if (geneId) {
    try { gene = await getGene(geneId); } catch { gene = null; }
    vec = gene ? await loadExprVector(gene).catch(() => null) : null;
    if (!vec) geneNote = el('p', { class: 'warn' }, `No expression profile for “${geneId}”.`);
  }
  const cs = studyContrasts(await loadContrasts(), d);
  const geneBox = el('form', { class: 'sd-genebox', onsubmit: (e) => {
    e.preventDefault();
    const v = e.target.elements.g.value.trim();
    navigate(`/study/${id}${v ? '?gene=' + encodeURIComponent(v) : ''}`);
  } },
    el('label', { for: 'sd-g' }, vec ? 'Showing ' : 'Show one gene on this design '),
    el('input', { id: 'sd-g', name: 'g', value: vec ? gene.id : '', placeholder: 'PtXaTreH.05G120200',
      autocomplete: 'off', spellcheck: 'false' }),
    el('button', { type: 'submit', class: 'btn' }, vec ? 'Change' : 'Show'),
    vec ? el('a', { href: `#/gene/${gene.id}` }, 'gene page') : null,
    vec ? el('a', { href: `#/study/${id}` }, 'design only') : null);
  const designCard = el('div', { class: 'card', 'data-card': 'study-design' },
    el('h2', {}, vec ? `${gene.id} across this study` : 'Design'),
    el('p', { class: 'sd-lede' }, `${fmt(d.ids.length)} samples in ${d.groups.length} group${d.groups.length === 1 ? '' : 's'}`
      + (d.varying.length ? ` that differ by ${[...d.panels, d.rows, ...d.cols].filter(Boolean).map((f) => FACTOR_LABEL[f]).join(', ')}` : '')
      + '. A filled group is wild-type control samples.'),
    geneBox, geneNote,
    designDrawing(d, all, studies, hub, vec, vec ? gene.id : ''));
  const comparisonsCard = cs.length ? el('div', { class: 'card', 'data-card': 'study-comparisons' },
    el('h2', {}, `Comparisons in this study (${cs.length})`),
    el('p', { class: 'sd-lede' }, 'Point at or tap a comparison to mark its two groups in the design; '
      + 'the group it is compared with is dashed.'),
    contrastList(cs, all, hub, vec, d)) : null;
  // On a phone the design scrolls away; a button brings back a copy of it, kept in step by the
  // same selection, in a sheet (a dialog: focus stays inside, Escape closes it).
  const sheet = el('dialog', { class: 'sd-sheet', 'aria-label': 'Study design' },
    el('div', { class: 'sd-sheet-head' }, el('strong', {}, vec ? `${gene.id} across this study` : 'Study design'),
      el('button', { type: 'button', class: 'btn', onclick: () => sheet.close() }, 'Close')),
    designDrawing(d, all, studies, hub, vec, vec ? gene.id : ''));
  const sheetBtn = el('button', { type: 'button', class: 'sd-sheet-btn', hidden: '', onclick: () => sheet.showModal() }, 'Design');

  // Lead with the paper, not the serial number; the number stays in the subtitle.
  const meta = studyMeta(s.citation);
  setView(el('div', {},
    el('div', { class: 'kicker' }, 'RNA-seq study'),
    el('h1', { class: meta.title ? 'study-title' : null }, meta.title || `Study ${id}`),
    el('p', { class: 'sub' }, `Study ${id}`,
      meta.firstAuthor ? ` · ${meta.firstAuthor}${meta.year ? ' ' + meta.year : ''}` : '',
      meta.journal ? ` · ${meta.dataset ? 'data set, ' : ''}${meta.journal}` : '',
      ` · ${fmt(mine.length)} samples · `,
      ...s.bioprojects.map((b) =>
        el('a', { href: `https://www.ebi.ac.uk/ena/browser/view/${b}`, target: '_blank', rel: 'noopener', class: 'mono' }, b)
      ).flatMap((a, i) => i ? [', ', a] : [a])),
    s.flags.includes('prefer_counts_over_tpm') && el('div', { class: 'warn' },
      'This study\'s single-end fragment length was not individually calibrated. Effective-length ',
      'inflation is measurable here, prefer est_counts over TPM/FPKM for this study.'),
    el('div', { class: 'sd-layout' },
      el('div', { class: 'sd-railcol' }, designCard),
      el('div', { class: 'sd-flow' }, comparisonsCard, sampleCard, el('div', { class: 'card' },
      el('h2', {}, 'Factors and source'),
      el('p', {}, factorRow('Tissue', s.tissues), factorRow('Panel', s.panel_type),
        factorRow('Genotype', s.genotypes), factorRow('Treatment', s.treatments),
        factorRow('Growth', s.growth_conditions), factorRow('Additional', s.additional_conditions)),
      s.citation && el('p', { class: 'muted', style: 'font-size:12.5px;margin-top:10px' }, cleanCitation(s.citation)),
      s.doi.length ? el('p', {}, ...s.doi.map((d) => el('a', { href: d, target: '_blank', rel: 'noopener' }, d)))
        : el('p', { class: 'muted', style: 'font-size:12.5px' },
          'No paper is listed for this study; the reference is its deposited data set',
          meta.url ? [' (', el('a', { href: meta.url, target: '_blank', rel: 'noopener' }, meta.journal || 'link'), ')'] : '', '.')))),
    sheetBtn, sheet,
  ));
  // The sheet button shows only on a narrow screen, and only while less than 120 px of the
  // design is on screen (an edge touching the viewport still counts as visible to an observer).
  {
    const wide = window.matchMedia('(min-width: 1200px)');
    let queued = false;
    const sync = () => {
      queued = false;
      if (!designCard.isConnected) { window.removeEventListener('scroll', ask); return; }
      const r = designCard.getBoundingClientRect();
      const shown = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      sheetBtn.hidden = wide.matches || shown >= 120;
      if (wide.matches && sheet.open) sheet.close();
    };
    const ask = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask);
    wide.addEventListener('change', ask);
    ask();
  }
  // Sample rows join the same selection as the drawing.
  sampleCard.querySelectorAll('tbody tr[data-i]').forEach((tr) => {
    const i = +tr.dataset.i;
    tr.tabIndex = 0;
    brush(tr, hub, sampleSelection(all, i, vec, vec ? gene.id : ''));
  });
  hub.on((sel) => {
    sampleCard.toggleAttribute('data-sel', !!sel);
    sampleCard.querySelectorAll('tbody tr[data-i]').forEach((tr) => {
      tr.dataset.hot = sel && sel.ids.has(+tr.dataset.i) ? 'all' : '';
    });
  });
  markNav();
});

/* ---------- boot ---------- */
(async function boot() {
  // The header carried ten flat tabs in MODULES order -- an accident of the import list, not
  // a choice, and on a phone it wrapped to three rows (170px of sticky chrome before any
  // content). It is now two kinds of thing:
  //
  //   always visible   ways IN to the data      Home / Browse / Map / Karyotype
  //   grouped          per-topic overviews      Layers > Duplication / Synteny / ...
  //   last             provenance               About
  //
  // The Layers order matches the gene page's bands, so the two do not disagree about which
  // evidence comes first.
  const nav = document.querySelector('header.top nav');
  // Karyotype is a route, not a module (it has no per-gene card), so it is appended by hand.
  nav.append(el('a', { href: '#/karyotype' }, 'Karyotype'));

  const LAYER_ORDER = ['duplication', 'synteny', 'expression', 'protein', 'phylostrat'];
  const layers = LAYER_ORDER.map(byId).filter((m) => m && m.overview);
  if (layers.length) {
    const panel = el('div', { class: 'navmenu-panel' },
      ...layers.map((m) => el('a', { href: `#/module/${m.id}` }, m.label)));
    const menu = el('details', { class: 'navmenu' }, el('summary', {}, 'Layers'), panel);
    // Close after a choice, and on Escape or a click elsewhere -- a <details> menu that
    // stays open over the page is worse than the flat row it replaced.
    panel.addEventListener('click', () => { menu.open = false; });
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.open = false; });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });
    nav.append(menu);
  }

  // Any module with an overview that is NOT in the list above still gets its own tab rather
  // than silently disappearing from the site when someone adds one.
  const placed = new Set([...LAYER_ORDER, 'about']);
  MODULES.filter((m) => m.overview && !placed.has(m.id))
    .forEach((m) => nav.append(el('a', { href: `#/module/${m.id}` }, m.label)));

  const about = byId('about');
  nav.append(el('a', { href: '#/glossary' }, 'Glossary'), el('a', { href: '#/downloads' }, 'Downloads'));
  if (about && about.overview) nav.append(el('a', { href: '#/module/about' }, about.label));
  initSearch();
  // Skip link: the hash belongs to the router, so it moves focus itself.
  document.querySelector('.skip')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    const v = document.getElementById('view');
    jumpTo(v.querySelector('h1') || v);
  });
  start();
  markNav();
  // Stamp the data version into the footer so a reader can tell which build they are looking at.
  try {
    const man = await loadManifest();
    const f = document.querySelector('footer.bot');
    if (f && man.data_version) {
      f.append(el('div', { style: 'margin-top:5px', 'data-release-line': '' },
        releaseLine(man),
        ' · ', el('a', { href: '#/downloads' }, 'downloads'),
        ' · ', el('a', { href: '#/glossary' }, 'glossary'),
        ' · ', el('a', { href: `mailto:${CONTACT}?subject=Poplar%20717%20gene%20atlas` }, 'contact / report a problem'),
        ' · ', el('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'repository'),
        ' · ', el('a', { href: '#/module/about' }, 'provenance'),
        // The footer already states which build you are reading; the gates that build passed
        // belong next to it, not two clicks away inside another page.
        ' · ', el('a', { href: '#/status' }, 'data checks')));
    }
    // A cached script against fresh data is the dangerous combination: every column this code
    // reads by name still resolves, just to the wrong thing, so the page renders a confident
    // number instead of failing. GitHub Pages caps caching at 10 minutes and offers no way to
    // purge, so the only honest move is to say so rather than to let it pass silently.
    const built = (document.querySelector('meta[name="atlas-build-version"]') || {}).content;
    if (built && man.data_version && built !== man.data_version) {
      const bar = el('div', {
        role: 'status',
        style: 'position:sticky;top:0;z-index:50;padding:9px 14px;font-size:13px;'
          + 'background:#8a5a00;color:#fff;display:flex;gap:12px;align-items:center;flex-wrap:wrap',
      },
        el('span', {}, `You are viewing a cached build (v${built}) of a site now serving `
          + `data v${man.data_version}. Numbers on this page may not match the current data.`),
        el('button', {
          onclick: () => location.reload(true),
          style: 'font:inherit;padding:3px 10px;border:1px solid #fff;border-radius:5px;'
            + 'background:transparent;color:#fff;cursor:pointer',
        }, 'Reload'));
      document.body.prepend(bar);
    }
  } catch { /* footer stamp is cosmetic; never block boot on it */ }
})();

/* The gene page's section nav sticks directly under the site header, and header.top wraps to
   two rows on a narrow screen -- a hard-coded offset would leave the nav hidden behind it.
   Measure it instead, and keep it right through rotation and font-size changes. */
(function trackHeaderHeight() {
  const top = document.querySelector('header.top');
  if (!top) return;
  const set = () => document.documentElement.style.setProperty('--top-h', `${top.offsetHeight}px`);
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(top);
  else window.addEventListener('resize', set);
})();
