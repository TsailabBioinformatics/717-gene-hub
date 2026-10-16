// Headless render check. Loads real pages over HTTP (the site fetches JSON, so file:// is
// not a valid test) and fails on any console error or missing expected content.
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
// playwright-core comes from node_modules (CI installs it), or from ATLAS_PLAYWRIGHT, a path
// to a playwright-core index.mjs installed elsewhere on a machine without a local install.
const { chromium } = process.env.ATLAS_PLAYWRIGHT
  ? await import(process.env.ATLAS_PLAYWRIGHT)
  : require_('playwright-core');
import fs from 'fs';

const base = process.argv[2] || 'http://127.0.0.1:8931';
const outdir = process.argv[3] || 'shots';   // relative, so CI can write it too
fs.mkdirSync(outdir, { recursive: true });

// Preflight: refuse to run against a host that ignores Range. Per-gene expression is addressed
// by byte range and the loader requires a 206, so on `python3 -m http.server` every expression
// fetch fails -- and the symptom is a six-minute locator timeout naming a missing .card, not
// the server. CI shipped exactly that. Fail here instead, by name. This also guards the more
// dangerous version of the same mistake: a client that did NOT insist on 206 would inflate the
// first member of the blob and draw another gene's profile without erroring at all.
{
  const probe = `${base}/data/expr/raw_hap1.gzb`;
  const r = await fetch(probe, { headers: { Range: 'bytes=0-99' } }).catch((e) => e);
  if (r instanceof Error) {
    console.log(`!! cannot reach ${probe}: ${r.message}`);
    console.log('!! usage: node scripts/check.mjs [base-url] [outdir] -- is the server up?');
    process.exit(1);
  }
  if (r.status !== 206) {
    console.log(`!! ${base} answered ${r.status} to a Range request, not 206.`);
    console.log('!! That host does not implement Range, so no per-gene expression can load.');
    console.log('!! Serve with:  python3 scripts/serve_ranges.py <port> .');
    process.exit(1);
  }
}

// The browser: CI_CHROME (set by the workflows) or CHROME; otherwise playwright's own download.
const browser = await chromium.launch({
  executablePath: process.env.CI_CHROME || process.env.CHROME || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
let failures = 0;

// A null selector used to throw and kill the run, leaving every later check unrun while the
// process still exited 0 -- which is how a rename passed CI-shaped output while breaking 32
// checks. An abort is now reported and exits non-zero. It deliberately does NOT try to
// continue: a half-run suite should not look like a green one.
process.on('uncaughtException', (e) => {
  console.log(`\n!! ABORTED after ${failures} recorded failure(s): ${e && e.message}`);
  console.log('!! Remaining checks did NOT run. Treat this as a failure, not a pass.');
  process.exit(1);
});

/** The view's rendered text, with every collapsed view panel revealed first.
 *
 *  Cards that merged into one with a view switch keep the inactive panel collapsed, and
 *  innerText cannot see it. These are CONTENT assertions -- "does this page carry this fact"
 *  -- and a collapsed panel is still reachable by a reader, because it is
 *  hidden="until-found" and find-in-page opens it. One check
 *  (genepage:duplication-views-merged) separately asserts the switch works and that the panel
 *  really is until-found rather than display:none, so this is not taken on trust. Without it,
 *  a check spanning BOTH views of one card could never pass at once -- gene-array-history
 *  asserts the array tables AND the layers caption.
 */
/** Reveal every collapsed view panel. Any read that is SCOPED to an element rather than to
 *  the whole view (`h3.parentElement.innerText`, a `.card` locator) must call this first if
 *  its target can live inside a merged card -- viewText covers the whole-view reads only. */
async function revealViewPanels(page) {
  await page.evaluate(() => document.querySelectorAll('.viewpanel[hidden]')
    .forEach((v) => v.removeAttribute('hidden')));
}

async function viewText(page) {
  await revealViewPanels(page);
  // NOT viewText(page) -- the regex that introduced this helper rewrote every
  // `x.evaluate(() => document.getElementById('view').innerText)` in the file, including the
  // one in this function's own body, which made it call itself forever. Cost: a 41-minute
  // node process at 100% CPU producing no output at all, because it never reached a log line.
  return page.evaluate(() => document.getElementById('view').innerText);
}

async function check(name, hash, { expect = [], forbid = [], theme = null, wait = 700 } = {}) {
  const p = await browser.newPage({
    viewport: { width: 1180, height: 900 },
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('requestfailed', (r) => errs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

  await p.goto(base + '/' + hash, { waitUntil: 'networkidle' });
  await p.waitForTimeout(wait);
  // The name becomes a file name, and CI's artifact upload rejects : " < > | * ? -- a check
  // named "copies:absent-elsewhere" passed and then failed the run at the upload step.
  await p.screenshot({ path: `${outdir}/${name.replace(/[:"<>|*?]/g, '-')}.png`, fullPage: true });


  const text = await viewText(p);
  // Case-insensitive: innerText returns RENDERED text, and `table.data th` is
  // text-transform:uppercase, so a header asserted as "% aligned" arrives as "% ALIGNED".
  // Styling should not decide whether a content assertion passes.
  const hay = text.toLowerCase();
  const missing = expect.filter((e) => !hay.includes(e.toLowerCase()));
  // `forbid`: text that must NOT render. Added 2026-09-21 for sentences that were corrected, so
  // the old wording cannot come back through a cached edit or a revert and still pass.
  const present = forbid.filter((f) => hay.includes(f.toLowerCase()));
  const ok = !errs.length && !missing.length && !present.length;
  if (!ok) failures++;
  console.log(`\n### ${name}  ${ok ? 'OK' : 'FAIL'}`);
  errs.forEach((e) => console.log('   !! ' + e));
  missing.forEach((m) => console.log(`   !! expected text not found: "${m}"`));
  present.forEach((f) => console.log(`   !! forbidden text rendered: "${f}"`));
  if (ok) console.log(`   rendered ${text.length} chars`);
  await p.close();
}

await check('home', '#/',
  // the NUMBER, not just the label: the home page showed the withdrawn 1,725 for three
  // versions while every other page said 1,611, and asserting the label caught nothing
  // Per haplotype since 2026-09-21. The pool is the rerun that added Idesia (C5, Chen
  // 2026-09-21 evening); 0.15.0 served the frozen call's 842 / 883 here for five days.
  { expect: ['63,960', 'Start here', 'Browse all genes', 'Modules', 'Before you cite anything',
             // the FINAL lineage-specific gene set of the dissertation leads; the candidates follow
             'lineage-specific genes, HAP1 / HAP2 (final set', '583 / 621', '776 / 835 candidates',
             'PS18 in the frozen genEra call, PS17 Saliceae in the current one'],
    forbid: ['842 / 883', 'carries four evidence flags'] });
await check('gene-ps18-to-ps17', '#/gene/PtXaTreH.05G120200',
  { expect: ['PtXaTreH.05G120200', 'Chr05', 'Synteny', 'Populus', 'Dispensable'] });
await check('gene-private', '#/gene/PtXaTreH.01G006100',
  { expect: ['Private', 'P. alba'] });
await check('gene-hap2', '#/gene/PtXaAlbH.14G133000', { expect: ['HAP2', 'Chr14'] });
await check('gene-missing', '#/gene/PtXaTreH.99G999999', { expect: ['No such gene'] });
await check('module-synteny', '#/module/synteny',
  { expect: ['Class distribution', 'Core syntenic', 'Private', 'Tandem array'] });
await check('module-expression', '#/module/expression',
  { expect: ['652', 'Studies', 'WT-control samples per tissue', 'leaf_young', 'leaf_old'] });
// Study 1 is the leaf_young/leaf_old case: if this ever again shows plain 'leaf' for
// every row, the tissue_analysis join (sources/sample_tissue_analysis.tsv) has regressed.
await check('study-1', '#/study/1',
  { expect: ['Study 1', 'PRJEB22956', 'Georgii', 'Tissue', 'Aligned %', 'control', 'leaf_old', 'leaf_young'], wait: 1000 });
// Two citations in studies.json carry notes to whoever formats the reference list after the
// URL ("Set the title in italics...", "If the lab prefers personal attribution..."). The page
// shows the reference and stops at its link; the paper title leads where one parses cleanly.
await check('study-citation-clean-4', '#/study/4',
  { expect: ['Transcription profiling of Populus', 'Jakobi et al. 2020', 'E-MTAB-8683'],
    forbid: ['If you prefer', 'reverse-italicized', 'Set the title'], wait: 1000 });
await check('study-citation-clean-8', '#/study/8',
  { expect: ['Study 8', 'PRJNA275366'], forbid: ['Asterisks', 'If the lab prefers', 'inferred from'], wait: 1000 });
// Study 29 carries the "prefer counts over TPM" flag (it has no per-sample notes).
await check('study-29', '#/study/29',
  { expect: ['Study 29', 'prefer est_counts'], wait: 1000 });
// Study 10 (Gerttula tension wood) is one of ten studies with per-sample processing notes;
// its note is the documented below-typical alignment rate, surfaced per row.
await check('study-10-notes', '#/study/10',
  { expect: ['Study 10', 'Notes', 'below-typical alignment rate'], wait: 1000 });
// This gene is the manually-verified leaf_young/leaf_old case (13.74 vs 4.52 TPM, was
// pooled to a single 8.12 before the 2026-09-05 fix) -- assert the split is visible.
await check('gene-expr-ps18-to-ps17', '#/gene/PtXaTreH.05G120200',
  { expect: ['Expression', 'Mean TPM', 'catkin', 'Show all 652 samples', 'leaf_young', 'leaf_old',
             '222-sample reference panel'],
    // one tissue-specificity statistic: the wild-type-control view is gone (Chen, 2026-10-13)
    // (the neighborhood card further down still shows per-tissue medians, labelled as such)
    forbid: ['A second view', 'WT-control τ', 'display cutoff'], wait: 900 });

// The header's tandem-array chip is a link to the array page, in the allele chip's form, for every
// gene of a counted array on either haplotype, genes of hemizygous TD arrays included. Followed,
// it must land on an array page that lists the gene. (check_dissertation.py holds that the array
// route exists for every one of the 13,048 tandem genes.)
{
  const cp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const cerrs = [];
  cp.on('pageerror', (e) => cerrs.push(e.message));
  const out = [];
  for (const gid of ['PtXaTreH.01G354100', 'PtXaAlbH.04G053400', 'PtXaTreH.17G058300', 'PtXaTreH.10G125100']) {
    await cp.goto(base + '/#/gene/' + gid, { waitUntil: 'networkidle' });
    await cp.waitForTimeout(1500);
    const chip = await cp.evaluate(() => {
      const c = document.querySelector('.gh-fact[data-array-chip]');
      const al = document.querySelector('.gh-fact a[href^="#/gene/"]');
      const a = c && c.querySelector('a');
      return c ? { aid: c.dataset.arrayChip, text: c.innerText.trim(), href: a && a.getAttribute('href'),
        cls: a && a.className, sameLook: !al || (getComputedStyle(a).color === getComputedStyle(al).color
          && getComputedStyle(a).fontFamily === getComputedStyle(al).fontFamily) } : null;
    });
    let lands = false;
    if (chip && chip.href) {
      await cp.click('.gh-fact[data-array-chip] a');
      await cp.waitForTimeout(2500);
      lands = await cp.evaluate(([aid, g]) => location.hash === '#/array/' + aid
        && !!document.querySelector(`[data-arr-page="${aid}"]`)
        && !!document.querySelector(`a[href="#/gene/${g}"]`), [chip.aid, gid]);
    }
    out.push({ gid, chip, lands });
  }
  // a gene outside any tandem array must carry no such chip
  await cp.goto(base + '/#/gene/PtXaTreH.01G000200', { waitUntil: 'networkidle' });
  await cp.waitForTimeout(1000);
  const none = await cp.evaluate(() => !document.querySelector('.gh-fact[data-array-chip]'));
  const ok = !cerrs.length && none && out.every((o) => o.chip && o.lands && o.chip.sameLook
    && o.chip.href === '#/array/' + o.chip.aid && /^tandem array \S+ · \d+ genes$/.test(o.chip.text));
  if (!ok) failures++;
  console.log(`\n### header:array-chip-links-to-the-array  ${ok ? 'OK' : 'FAIL'}`);
  out.forEach((o) => console.log(`   ${o.gid}: "${o.chip ? o.chip.text : 'no chip'}" -> lands ${o.lands}`));
  console.log(`   non-tandem gene has no chip: ${none}`);
  cerrs.forEach((e) => console.log('   !! ' + e));
  await cp.close();
}
await check('gene-annotated', '#/gene/PtXaTreH.01G000300',
  { expect: ['Function', 'Allele', 'Panel presence', 'AT1G55570'], wait: 1000 });
// A gene with a reciprocal 1:1 P. trichocarpa syntenic ortholog (11,490 genes have none).
await check('gene-crossspecies', '#/gene/PtXaTreH.01G000600',
  { expect: ['P. trichocarpa ortholog', 'Potri.', 'reciprocal 1:1'], wait: 1000 });
// 27,004 HAP2 genes have annotation but no Pfam (release gap); this gene is one of them.
await check('gene-hap2-pfam-gap', '#/gene/PtXaAlbH.01G000200',
  { expect: ['Function', 'Domain coverage is thinner on HAP2', 'AT1G55570'], wait: 1000 });
await check('browse', '#/browse',
  { expect: ['Browse', 'Filters', 'Synteny class', '63,960', 'Export TSV', 'Saved sets'], wait: 1400 });

// UI state: slow routes cannot overwrite a newer page; deep links must visibly select their
// filters; and search must submit only the text currently in its input. These are interaction
// checks rather than text snapshots because every failure here can leave a plausible page under
// the wrong URL.
{
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const p = await context.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/#/browse?hap=hap1', { waitUntil: 'networkidle' });
  await p.waitForSelector('#view .stat .n');
  const r = await p.evaluate(async () => {
    const labels = [...document.querySelectorAll('#view label')];
    const selectFor = (label) => labels.find((n) => n.firstChild.textContent.trim() === label)
      ?.querySelector('select');
    const hap = selectFor('Haplotype');
    const peak = selectFor('Peak tissue');
    const facets = await fetch('data/index/facets.json').then((response) => response.json());
    return {
      hap: hap && hap.value,
      count: document.querySelector('#view .stat .n')?.textContent.trim(),
      top: [...(peak?.options || [])].map((option) => option.value),
      vocab: facets.vocab.top,
    };
  });
  const ok = !errs.length && r.hap === 'hap1' && r.count === '32,137'
    && r.top.slice(1).join('\u0000') === r.vocab.join('\u0000')
    && r.top.includes('leaf_young') && r.top.includes('leaf_old');
  if (!ok) failures++;
  console.log('\n### ui-state:browse-deeplink  ' + (ok ? 'OK' : 'FAIL'));
  console.log('   hap=' + r.hap + '  count=' + r.count + '  peak options=' + r.top.slice(1).join(', '));
  errs.forEach((e) => console.log('   !! ' + e));
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const p = await context.newPage();
  await p.goto(base + '/#/', { waitUntil: 'networkidle' });
  await p.fill('#q', 'kinase');
  await p.waitForSelector('#hits[data-query="kinase"]', { timeout: 20000 });
  await p.fill('#q', 'xy');
  await p.press('#q', 'Enter');
  await p.waitForTimeout(250);
  const staysPut = await p.evaluate(() => location.hash === '#/'
    && !document.querySelector('#hits').dataset.query);
  if (!staysPut) failures++;
  console.log('\n### ui-state:search-current-query  ' + (staysPut ? 'OK' : 'FAIL'));
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const p = await context.newPage();
  let release;
  let seen;
  const held = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { seen = resolve; });
  await p.route('**/data/index/search/k.json*', async (route) => {
    seen();
    await held;
    await route.continue();
  });
  await p.goto(base + '/#/', { waitUntil: 'networkidle' });
  await p.fill('#q', 'kinase');
  await requested;
  await p.fill('#q', 'xylem');
  await p.waitForSelector('#hits[data-query="xylem"]', { timeout: 20000 });
  release();
  await p.waitForTimeout(500);
  const rendered = await p.$eval('#hits', (n) => n.dataset.query || null);
  const ok = rendered === 'xylem';
  if (!ok) failures++;
  console.log('\n### ui-state:search-stale-dropdown  ' + (ok ? 'OK' : 'FAIL') + '  rendered=' + rendered);
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const p = await context.newPage();
  let release;
  let seen;
  const held = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { seen = resolve; });
  await p.route('**/data/genes/hap1/Chr05/4.json*', async (route) => {
    seen();
    await held;
    await route.continue();
  });
  await p.goto(base + '/#/', { waitUntil: 'networkidle' });
  await p.evaluate(() => { location.hash = '#/gene/PtXaTreH.05G120200'; });
  await requested;
  await p.evaluate(() => { location.hash = '#/module/about'; });
  await p.waitForFunction(() => /^About/.test(document.querySelector('#view h1')?.textContent || ''),
    null, { timeout: 20000 });
  release();
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({
    hash: location.hash,
    title: document.querySelector('#view h1')?.textContent || '',
    staleGene: document.querySelector('#view')?.innerText.includes('PtXaTreH.05G120200'),
  }));
  const ok = r.hash === '#/module/about' && /^About/.test(r.title) && !r.staleGene;
  if (!ok) failures++;
  console.log('\n### ui-state:stale-route  ' + (ok ? 'OK' : 'FAIL')
    + '  ' + r.hash + ' / ' + r.title);
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const p = await context.newPage();
  let requests = 0;
  await p.goto(base + '/#/module/about', { waitUntil: 'networkidle' });
  await p.route('**/data/index/facets.json*', async (route) => {
    if (requests++ === 0) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    else await route.continue();
  });
  await p.evaluate(() => { location.hash = '#/browse'; });
  await p.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 20000 });
  const error = await p.locator('#view').innerText();
  await p.getByRole('button', { name: 'Try again' }).click();
  await p.waitForFunction(() => document.querySelector('#view')?.innerText.includes('of 63,960 genes match'),
    null, { timeout: 20000 });
  const ok = requests === 2 && error.includes('Could not load this page')
    && error.includes('Try again') && (await p.locator('#view').innerText()).includes('Browse');
  if (!ok) failures++;
  console.log('\n### ui-state:route-error-retry  ' + (ok ? 'OK' : 'FAIL') + '  requests=' + requests);
  await context.close();
}

// One ladder per haplotype, the pool split by haplotype AND stratum. The pool is the rerun that
// added Idesia and only abSENSE and the synteny window search are QC checks (C5, Chen
// 2026-09-21 evening); the frozen call is named as superseded, with its count.
await check('module-phylostrat', '#/module/phylostrat',
  { expect: ['Genes per stratum', 'ambiguous', 'cellular organisms', 'log-scaled',
             'HAP1 LSG candidates (genEra: 433 PS18 · 343 PS19)', 'HAP2 LSG candidates (genEra: 497 PS18 · 338 PS19)',
             'HAP1 final LSG set: 380 PS18 · 203 PS19', 'HAP2 final LSG set: 418 PS18 · 203 PS19',
             'From candidates to the final LSG set', 'Reassigned from PS19 to PS18',
             'PS ≥ 18 in the genEra rerun that added Idesia polycarpa: 776 HAP1 and 835 HAP2 genes',
             'is 583 HAP1 and 621 HAP2 genes', '104 HAP1 and 100 HAP2 PS19 candidates are reassigned to PS18',
             'superseded as the pool, had 842 HAP1 and 883 HAP2',
             'the 66 HAP1 and 48 HAP2 genes that left', 'unplaced by genEra: 27 HAP1 · 18 HAP2'],
    // '1,725' and '1,611' would be the two haplotypes' pools summed; nothing should do that.
    // the old merged ladder's hand-typed range read "log-scaled — counts run from"; the range is
    // now computed per haplotype ("HAP1 counts run from ..."), so forbid the old wording.
    forbid: ['1,725', '1,611', '12-species', 'Idesia-corrected panel', 'log-scaled, counts run from',
             'pass all four checks', 'and it does not change'] });
await check('gene-ambiguous-ps', '#/gene/PtXaTreH.06G037000',
  { expect: ['genEra flagged this gene as ambiguous'], wait: 900 });
await check('module-duplication', '#/module/duplication',
  { expect: ['Duplication', 'not genome-wide', 'selected by phylostratum', 'Duplication class',
             'sWGD', 'dispersed'] });
await check('gene-paralog', '#/gene/PtXaTreH.01G330600',
  { expect: ['Duplication', 'Paralog pairs'], wait: 900  });
// A curated tandem-array member: array identity, size, age bin and member links.
await check('gene-tandem-array', '#/gene/PtXaTreH.01G330700',
  { expect: ['Tandem array', 'Array members', 'neighbors on the chromosome'], wait: 1400  });
// PAV is the strict, protein-level set (2026-10-03); the superseded DIAMOND candidate card must
// be gone. Per-category rendering is driven in relationship:reader-names below.
await check('gene-strict-pav', '#/gene/PtXaTreH.01G006100',
  { expect: ['Relationship to the other haplotype', 'Strict PAV', 'no protein-level match'],
    forbid: ['DIAMOND PAV', 'not confirmed', 'candidate, DIAMOND-checked'], wait: 900 });
// LSG evidence-quality (TODO 23): a flagged pool gene and a clean one, and -- because the
// forbidden fields are a real publication risk -- assert neither ever appears in the
// rendered page, not just that the two intended checks pass.
await check('gene-lsg-qc-flagged', '#/gene/PtXaTreH.12G056600',
  { expect: ['Evidence quality', 'synteny window', 'contradicts the young call',
             'candidate, excluded from the final set', 'a homolog lies in an outgroup syntenic window',
             'LSG candidate, excluded:', 'four exclusion criteria applied in order',
             // abSENSE cannot run on a PS19 gene, and the page must not say it "supports" or "retracts"
             'abSENSE: no prediction'],
    forbid: ['WGD-era Ks', 'four checks', 'abSENSE retracts', 'abSENSE supports', 'post-QC set', '59 to 61%'], wait: 900 });
await check('gene-lsg-qc-clean', '#/gene/PtXaTreH.01G001500',
  { expect: ['Evidence quality', 'yes, in the final set (PS18)', 'lineage-specific gene (final set)',
             'Neither abSENSE nor the synteny-window search flags this gene',
             'Search of outgroup syntenic windows: no homolog found'],
    forbid: ['No evidence-quality flag raised', 'Passes the QC funnel'], wait: 900 });
// Clean on the funnel's three checks, but synteny-contested (twin route) and a short ORF. Until
// 2026-09-21 a clean gene read "No evidence-quality flag raised" and hid both: 389 pool genes.
await check('gene-lsg-qc-clean-but-flagged', '#/gene/PtXaTreH.08G114000',
  { expect: ['yes, in the final set (PS18)', 'Other evidence, not QC flags',
             'disputes this gene', 'Short ORF (72 aa)'],
    forbid: ['No evidence-quality flag raised'], wait: 900 });
// sens_stable is DIAMOND default vs --ultra-sensitive stability (repro audit E3). The card used
// to say the chapter's headline result depended on the gene. Also the gene-model card's
// forward-looking line, which named a wrong library count and presumed an unmerged PR.
await check('gene-lsg-qc-unstable', '#/gene/PtXaTreH.12G066000',
  { expect: ['differs between the default and --ultra-sensitive DIAMOND runs'],
    forbid: ['headline result', '827-library', 'under review upstream'], wait: 900 });
// A gene that left the pool (C5: the pool is the rerun that added Idesia). Named as leaving by
// a rank change, not as failing a QC check, with no QC record, and with the frozen call named
// as superseded and neutrally (never "withdrawn", never a "12-species panel"; MS2 audit A38).
await check('gene-left-the-pool', '#/gene/PtXaTreH.05G120200',
  { expect: ['no (candidates are PS ≥ 18)', 'Frozen call', 'superseded as the pool, placed this gene at PS18',
             'left the pool', 'not by failing a QC check', 'not always due to Idesia',
             // the family now comes from the same run as the rank: 2 members, same stratum.
             // From the frozen run it read "originates at PS18" beside the gene's PS17.
             '2 members'],
    forbid: ['Evidence quality', 'withdrawn', 'Idesia-corrected panel', 'never evaluated',
             'The gene stays in the pool', 'family originates at PS18', 'not available'], wait: 900 });
// Founder families from the pool's own run (2026-09-26). A moved gene: family read in the same run.
await check('gene-family-same-run', '#/gene/PtXaTreH.01G003100',
  { expect: ['4 members', 'family originates at PS11'],
    // this gene left the pool, so its Frozen call row rightly says "in the frozen call"; only
    // the family row's old qualifier is forbidden
    forbid: ['originates at PS11 in the frozen call', 'not available'], wait: 900 });
// A pool gene in a family from cellular organisms: not a lineage-specific family, and it says so.
await check('gene-family-young-in-old', '#/gene/PtXaTreH.11G057300',
  { expect: ['candidate, excluded from the final set', 'plausible detection failure (abSENSE)', '1,435 members', 'family originates at PS1',
             'A young gene in an older family', 'not a lineage-specific family'], wait: 900 });
// Family origin cannot be shown on 45 unranked genes, two disjoint groups: 39 have a family but
// no gene age (this one), 6 have no family assignment. The card gives the reason true of both.
await check('gene-family-not-shown-no-age', '#/gene/PtXaTreH.01G062500',
  { expect: ['genEra returned no rank', 'Gene family',
             'family origin not shown: the current pool run gives this gene no rank'],
    forbid: ['no family'], wait: 900 });
await check('gene-family-not-shown-no-family', '#/gene/PtXaAlbH.01G053700',
  { expect: ['Gene family', 'family origin not shown: the current pool run gives this gene no rank'],
    wait: 900 });
await check('module-protein-gradient', '#/module/protein',
  { expect: ['1 of 776 HAP1 and 0 of 835 HAP2 lineage-specific pool genes',
             'Strata here are those of the genEra rerun that added Idesia, which defines the pool',
             'PXD025636 is P. trichocarpa, PXD020099 is P. tremula × tremuloides',
             'same P. tremula × P. alba parentage'],
    forbid: ['0.12% of the lineage-specific pool', 'PXD058986 are P. x canescens. A'] });
await check('module-about-numbers', '#/module/about',
  { expect: ['no rank for 27 HAP1 and 18 HAP2 genes in the current call',
             '55 leaf (plus 11 young-leaf and 11 old-leaf)',
             'ComBat-seq', 'the strict, protein-level set', '528 HAP1 and 605 HAP2',
             'Hsieh et al., unpublished. Poplar 717 gene atlas, version', 'https://tsailabbioinformatics.github.io/poplar-717-atlas/',
             'Contact and feedback', 'Chen.Hsieh@uga.edu', 'Data are provided for research use',
             'A manuscript describing this resource will be submitted soon', 'once the manuscript is available, please cite the manuscript',
             'developed with assistance from Claude (Anthropic)',
             'Tissue specificity is the dissertation’s', 'per-gene table of the dissertation'],
    forbid: ['no rank for 50 genes', '77 leaf', 'is not in the mirror', 'v6 master', 'held on v9', 'for browsing, not quoting',
             'chenhsieh.github.io', 'Not for redistribution'] });
{
  const fp = await browser.newPage();
  const ferrs = [];
  fp.on('pageerror', (e) => ferrs.push(e.message));
  await fp.goto(base + '/#/gene/PtXaTreH.12G056600', { waitUntil: 'networkidle' });
  await fp.waitForTimeout(900);
  const ftext = await viewText(fp);
  const clean = !/qc_survivor|in_idesia_corrected_pool/i.test(ftext) && !ferrs.length;
  if (!clean) failures++;
  console.log(`\n### lsg-qc:no-forbidden-fields  ${clean ? 'OK' : 'FAIL'}`);
  await fp.close();
}
// --- v0.6: the pool correction (TODO 26/27), the re-search (28) and Ka/Ks (29) ---------
// Each of these renders something the site did not say before, so each gets a case. The
// pool one matters most: the site published the withdrawn pool for four days, and a check
// that only asserts "a pool number renders" would have passed throughout.
await check('gene-ps19-to-ps18', '#/gene/PtXaAlbH.17G073600',
  { expect: ['yes, in the final set (PS18)', 'Frozen call', 'PS19 (no homolog detected outside this assembly) in the frozen call, PS18 (Populus) in the current one',
             '179 pool genes do this'],
    forbid: ['left the pool'], wait: 900 });
// The abSENSE calibration must travel with the flag, not sit in a doc nobody opens.
// Shown where abSENSE made a prediction (this PS18 gene: a plausible detection failure), and
// not on a PS19 gene, where abSENSE cannot run (asserted on the gene above).
await check('gene-absense-calibration', '#/gene/PtXaTreH.04G037000',
  { expect: ['Evidence quality', 'Salix purpurea', '59 to 61%',
             'that support is too generous', 'abSENSE: the absence of older homologs is a plausible detection failure',
             'candidate, excluded from the final set'],
    forbid: ['abSENSE: abSENSE'], wait: 900 });
await check('gene-peptide-detected', '#/gene/PtXaAlbH.17G050300',
  { expect: ['Peptide matches', 'peptide match in', 'spectrum match',
             'tryptic peptide', 'P. tomentosa'], wait: 1000 });
// A gene that could not have been found is not the same as one that was looked for and
// missed. If these two ever render identically the layer has lost its point.
await check('gene-undetectable', '#/gene/PtXaAlbH.17G041200',
  { expect: ['Peptide matches', 'undetectable',
             'could not have been found however abundant'], wait: 1000 });
await check('gene-selection', '#/gene/PtXaTreH.05G120200',
  { expect: ['Selection', 'vs P. trichocarpa', 'Potri.', 'codons', 'purifying selection',
             'Nei'], wait: 900 });
await check('gene-no-ortholog', '#/gene/PtXaAlbH.17G052200',
  { expect: ['Selection', 'not defined for this gene', 'structural rather than missing',
             'nothing to measure against'], wait: 900 });
await check('browse-omega-column', '#/browse',
  { expect: ['\u03c9', 'MS', 'Peptide match'], wait: 1200 });

// Chromatin (TODO 30). Two cases, and the second is the point of the layer: a gene whose
// ortholog is SILENT in leaf must not render four absent marks, which would read as an
// absence of regulation when it is an absence of relevant data.
await check('gene-chromatin', '#/gene/PtXaTreH.01G000700',
  { expect: ['Chromatin', 'P. trichocarpa leaf', 'Accessible chromatin', 'H3K4me3',
             'RPK', 'never show where transcription starts'], wait: 1000 });
await check('gene-chromatin-silent', '#/gene/PtXaTreH.01G000100',
  { expect: ['Chromatin', 'not expressed in the leaf libraries',
             'would read as an absence of regulation'], wait: 1000 });

await check('module-protein', '#/module/protein',
  { expect: ['Protein', 'ESMFold', 'pLDDT proxy', 'never pooled', 'peptide',
             'r = −0.49', 'run length', 'monotonically with gene age',
             'undetectable this way', 'contain no 717 protein'] });
await check('gene-protein', '#/gene/PtXaTreH.01G000100',
  { expect: ['Protein', 'Predicted disorder', 'Duplication class'], wait: 1000 });
// --- v0.7: the 3D model (TODO 34). Driven, not just rendered: click the button, wait for
// the WebGL canvas, and require the legend's per-band residue counts to sum to the residue
// count the card states -- the on-figure numbers have to add up, not merely appear. One
// confident gene and one PS>=18 gene, whose model is mostly below 70 and must say so.
async function checkModel(name, geneId, { theme = null, expect = [] } = {}) {
  const mp = await browser.newPage({ viewport: { width: 1180, height: 900 },
    colorScheme: theme === 'dark' ? 'dark' : 'light' });
  const errs = [];
  mp.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  mp.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  mp.on('requestfailed', (r) => errs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await mp.goto(base + '/#/gene/' + geneId, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(900);
  const btn = await mp.$('button.struct-open');
  if (!btn) errs.push('no "Show 3D model" button');
  else { await btn.scrollIntoViewIfNeeded(); await btn.click(); }
  await mp.waitForSelector('.struct-stage canvas', { timeout: 20000 }).catch(() => errs.push('no canvas'));
  await mp.waitForTimeout(1000);
  // A canvas existing is not a model being drawn: the first version of this check passed on
  // three blank canvases (3Dmol's default cartoon renders nothing for a Calpha-only model).
  // So re-render through the viewer, and count painted pixels and which pLDDT colours appear.
  // Since 2026-10-15 the ribbon draws helices and strands: the viewer's atoms must carry exactly the
  // helix and strand residue counts of the model's DSSP string.
  const px = await mp.evaluate(async () => {
    const v = document.querySelector('.struct-stage')?.__viewer;
    if (!v) return { painted: 0, bands: [] };
    const atoms = v.getModel().selectedAtoms({ atom: 'CA' });
    const ssSeen = { h: atoms.filter((a) => a.ss === 'h').length, s: atoms.filter((a) => a.ss === 's').length };
    const img = new Image();
    img.src = v.pngURI();
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const want = ['#0053D6', '#65CBF3', '#FFDB13', '#FF7D45']
      .map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
    const seen = want.map(() => 0);
    let painted = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      painted++;
      want.forEach((w, k) => {
        if (Math.abs(d[i] - w[0]) + Math.abs(d[i + 1] - w[1]) + Math.abs(d[i + 2] - w[2]) < 90) seen[k]++;
      });
    }
    return { painted: painted / (d.length / 4), bands: seen, ssSeen };
  });
  const ssWant = await mp.evaluate(async (gid) => {
    const { loadStructure } = await import('./js/core/data.js');
    const m = await loadStructure(gid);
    return { h: [...m.ss].filter((c) => c === 'H').length, s: [...m.ss].filter((c) => c === 'E').length };
  }, geneId);
  const ssOk = px.ssSeen && px.ssSeen.h === ssWant.h && px.ssSeen.s === ssWant.s;
  const r = await mp.evaluate(() => {
    const holder = document.querySelector('.struct-holder');
    const keys = [...document.querySelectorAll('.struct-key .mono')]
      .map((s) => parseInt(s.textContent.replace(/,/g, ''), 10));
    const m = /([\d,]+) residues\./.exec(holder ? holder.innerText : '');
    const c = document.querySelector('.struct-stage canvas');
    return { text: holder ? holder.innerText.toLowerCase() : '', keys,
      sum: keys.reduce((a, b) => a + b, 0), n: m ? parseInt(m[1].replace(/,/g, ''), 10) : null,
      w: c ? c.width : 0, h: c ? c.height : 0 };
  });
  const stage = await mp.$('.struct-stage');
  if (stage) await stage.screenshot({ path: `${outdir}/${name}.png` });
  const missing = expect.filter((e) => !r.text.includes(e.toLowerCase()));
  // every band the legend says has residues must show up as pixels of that colour
  const bandsDrawn = r.keys.every((k, i) => k === 0 || px.bands[i] > 0);
  const ok = !errs.length && !missing.length && r.keys.length === 4 && r.n > 0 && r.sum === r.n
    && r.w > 0 && r.h > 0 && px.painted > 0.005 && bandsDrawn && ssOk;
  if (!ok) failures++;
  console.log(`\n### ${name}  ${ok ? 'OK' : 'FAIL'}  n=${r.n} bands=${JSON.stringify(r.keys)} canvas=${r.w}x${r.h}`
    + ` painted=${(100 * px.painted).toFixed(2)}% band-pixels=${JSON.stringify(px.bands)}`
    + ` helix/strand residues drawn ${JSON.stringify(px.ssSeen)} vs DSSP ${JSON.stringify(ssWant)}`);
  errs.forEach((e) => console.log('   !! ' + e));
  missing.forEach((m) => console.log(`   !! expected text not found: "${m}"`));
  await mp.close();
}
await checkModel('model-confident', 'PtXaTreH.01G021800',
  { expect: ['233 residues', 'very high', 'drawn as a helix or a strand arrow'] });
await checkModel('model-strands', 'PtXaTreH.01G241900', { expect: ['287 residues'] });
await checkModel('model-lsg', 'PtXaTreH.01G001500', { expect: ['112 residues', 'the model is guessing'] });
await checkModel('model-confident-dark', 'PtXaTreH.01G021800', { theme: 'dark' });

// --- v0.6: the review's items, each asserted where a reader would look --------------------
// Browse is the page the review calls the key thing, so the deep link and the chips that make
// a filtered view legible get their own cases.
await check('browse-deeplink-chips', '#/browse?ps=18',
  { expect: ['Phylostratum =', 'Clear all', 'MS is indirect'], wait: 1400 });
await check('browse-expressed-in', '#/browse?xin=xylem',
  { expect: ['Expressed in (>1 TPM)', 'Clear all'], wait: 1400 });
await check('browse-proxy-statement', '#/browse',
  { expect: ['MS is indirect', 'only 12% match exactly one 717 gene',
             'no reciprocal-best ortholog was found'], wait: 1400 });
// A stratum bar and a synteny class must be doors into Browse, not dead ends.
await check('phylostrat-drillthrough', '#/module/phylostrat',
  { expect: ['Click a stratum to browse its genes'] });
await check('synteny-drillthrough', '#/module/synteny',
  { expect: ['click a class to browse it'] });
// Peptide provenance: the point is that a reader can tell shared evidence from specific.
await check('gene-peptide-provenance', '#/gene/PtXaAlbH.17G050300',
  { expect: ['How that was assigned', 'Gene-unique', '717-only',
             'also in P. trichocarpa'], wait: 1400 });
await check('module-expression-studies', '#/module/expression',
  { expect: ['click a row to open it', 'Samples', 'Paper'], wait: 1400 });
// The map's overlays each have a different denominator, which the page must say out loud.
await check('map-overlay-notes', '#/map',
  { expect: ['Colour by:', 'Genes per 100 kb bin'], wait: 1400 });
// TE wording: "0 bp" read as missing data.
await check('gene-te-overlap', '#/gene/PtXaTreH.01G000100',
  { expect: ['Duplication class'], wait: 1000 });

// Promoter motif positions (TODO 44). Two cases, and the second is the one that keeps the
// card honest: a gene whose positions were withheld must SAY so, not silently show an empty
// track that reads as "no motifs here".
await check('gene-promoter-positions', '#/gene/PtXaTreH.01G000900',
  { expect: ['Where those matches sit', 'transcription start', 'the lane says which family'],
    wait: 1200 });
await check('gene-promoter-positions-withheld', '#/gene/PtXaTreH.01G040100',
  { expect: ['Motif positions are withheld for this gene',
             'contradict the bars'], wait: 1200 });

// RNA-seq gene-model evidence. Five cases, and three of them exist to stop the card
// overclaiming: a shallow gene must say so rather than read as a broken model, an untestable
// gene must say so rather than look clean, and a readthrough locus must not read as a split.
await check('genemodel-supported', '#/gene/PtXaAlbH.17G050000',
  { expect: ['Gene model, from RNA-seq', '13 of 13',
             'Every annotated intron is supported'], wait: 1200 });
await check('genemodel-too-shallow', '#/gene/PtXaAlbH.09G000200',
  { expect: ['Too shallow to conclude anything', 'fewer than 27%',
             'not evidence against the gene model'], wait: 1200 });
await check('genemodel-split-clean', '#/gene/PtXaAlbH.17G059000',
  { expect: ['Possible split model', 'Reads inside the intergenic gap',
             'nearly empty of reads', 'not a lineage-specific problem'], wait: 1200 });
await check('genemodel-split-readthrough', '#/gene/PtXaAlbH.17G082500',
  { expect: ['Possible split model', 'readthrough transcription',
             'No threshold is applied'], wait: 1200 });
await check('genemodel-not-testable', '#/gene/PtXaAlbH.17G050200',
  { expect: ['Not testable for this gene', 'not evidence',
             '9,079 genes are in this position'], wait: 1200 });

// --- 34g: the 3D model at PHONE viewport ---------------------------------------------------
// The viewer went public on 2026-09-12 having only ever been rendered at 1180x900. A desktop
// viewport cannot see the three ways a WebGL canvas fails on a phone: the page gains horizontal
// scroll, the canvas is laid out wider than its container, or the control that opens it is
// below the 44px touch floor. Pixels are still counted the same way as the desktop cases,
// because a canvas existing is not a model being drawn -- that mistake already passed three
// blank canvases once.
{
  const pp = await browser.newPage({ viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const perrs = [];
  pp.on('console', (m) => { if (m.type() === 'error') perrs.push('console: ' + m.text()); });
  pp.on('pageerror', (e) => perrs.push('pageerror: ' + e.message));
  await pp.goto(base + '/#/gene/PtXaTreH.01G021800', { waitUntil: 'networkidle' });
  await pp.waitForTimeout(1000);
  const btn = await pp.$('button.struct-open');
  let btnMin = 0;
  if (!btn) perrs.push('no "Show 3D model" button at phone viewport');
  else {
    const bb = await btn.boundingBox();
    btnMin = bb ? Math.min(bb.width, bb.height) : 0;
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
  }
  await pp.waitForSelector('.struct-stage canvas', { timeout: 20000 })
    .catch(() => perrs.push('no canvas at phone viewport'));
  await pp.waitForTimeout(1200);
  const pr = await pp.evaluate(async () => {
    const stage = document.querySelector('.struct-stage');
    const cv = stage && stage.querySelector('canvas');
    const v = stage && stage.__viewer;
    let painted = 0;
    if (v) {
      const img = new Image();
      img.src = v.pngURI();
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, c.width, c.height).data;
      let on = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) on++;
      painted = on / (d.length / 4);
    }
    const sb = stage ? stage.getBoundingClientRect() : null;
    const cb = cv ? cv.getBoundingClientRect() : null;
    return {
      painted,
      overflow: cb && sb ? +(cb.width - sb.width).toFixed(1) : null,
      hscroll: document.documentElement.scrollWidth
        > document.documentElement.clientWidth + 1,
      stageW: sb ? Math.round(sb.width) : 0,
    };
  });
  const ok = !perrs.length && pr.painted > 0.002 && !pr.hscroll
    && pr.overflow !== null && pr.overflow <= 1 && btnMin >= 44;
  if (!ok) failures++;
  console.log(`\n### model-phone  ${ok ? 'OK' : 'FAIL'}  painted=${(pr.painted * 100).toFixed(2)}%`
    + ` stage=${pr.stageW}px canvasOverflow=${pr.overflow}px hscroll=${pr.hscroll}`
    + ` openBtn=${btnMin}px`);
  perrs.slice(0, 4).forEach((e) => console.log('   !! ' + e));
  await pp.screenshot({ path: `${outdir}/model-phone.png`, fullPage: false });
  await pp.close();
}

await check('module-about', '#/module/about',
  { expect: ['About & provenance', 'Known limitations', 'HAP2 domain annotation is thin',
             'Tissue specificity is the dissertation’s', 'derived here, not imported', 'Sources'] });
await check('home-dark', '#/', { expect: ['63,960', 'Start here'], theme: 'dark' });

// --- v0.11: duplication layers + the copies-over-all-samples heatmap ---------------------
// A gene whose only duplicates are its own tandem array: this produces ONE track, which an
// earlier guard treated as "nothing to draw" and silently hid the commonest case on the site.
await check('gene-duplayers-tandem', '#/gene/PtXaTreH.08G070600',
  // 'three layers, kept apart' is the layers VIEW's own tag. The old expectation was the
  // heading 'Duplication layers', which the merge replaced with the group heading
  // 'Duplication' -- the view is now named by its tab and its tag, not by an <h2>.
  { expect: ['three layers, kept apart', 'tandem duplication', 'ds 0.', 'array’s median ds',
             'this gene + 3 array members'], wait: 1800 });
// A gene with partners on OTHER chromosomes plus a HAP2 allele: the multi-track case, and the
// one where the allele must be labelled as not a duplication.
await check('gene-duplayers-wgd', '#/gene/PtXaTreH.17G070400',
  // The allele no longer gets a ROW of its own (a full track and a link crossing the figure,
  // to say a 1-to-1 thing). It is named in words beside the compare button instead.
  { expect: ['three layers, kept apart', 'ancient whole-genome triplication (aWGT)',
             'the same gene on the other haplotype is',
             'not a duplication'], wait: 2200 });
// The per-PAIR tandem dS is a NEW column and is not td.ks. Assert both the column and the
// sentence that keeps them apart -- a future patch that piped the array median into this
// column would still render plausibly.
await check('gene-tandem-pairds', '#/gene/PtXaTreH.08G070600',
  { expect: ['pair ds', 'its class', 'max tpm', 'peak tissue',
             'it is not the array median above'], wait: 1800  });

// Second-order duplication history: an array MEMBER retains a WGD partner where the focal
// gene retains none. The whole risk of this feature is that it reads as the gene's own event,
// so assert BOTH the array-level statement and the unchanged gene-level "not called" -- a
// regression that promoted the array's event to the gene would still render plausibly.
// PtXaTreH.04G044000: 3-member array, no WGD of its own, members carry one salicoid and one
// gamma partner between them.
await check('gene-array-history', '#/gene/PtXaTreH.04G044000',
  { expect: ['this array\u2019s history', 'this gene retains', 'no', 'partner',
             'other array member', 'property of this gene alone',
             'of an array member',                      // the layers card's row label
             'second order',                            // the layers card's caption
             'not called'],                             // gene-level S/A call, unchanged
    wait: 2400  });

// Dragging links and dS labels out of the way. The property that MUST hold is not that
// something moved -- it is that a dragged link still joins the same two genes. An arc whose
// endpoints could be dragged off its genes would be a drawing that lies about what is
// duplicated, and it would still look fine in a screenshot. So: exactly one curve changes,
// every endpoint of every curve is unchanged, and the keyboard route (SC 2.5.7's required
// alternative to dragging) moves and resets a label.
{
  const dp = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  const derrs = [];
  dp.on('pageerror', (e) => derrs.push(e.message));
  dp.on('console', (m) => { if (m.type() === 'error') derrs.push('console: ' + m.text()); });
  await dp.goto(base + '/#/gene/PtXaTreH.04G044000', { waitUntil: 'networkidle' });
  await dp.waitForTimeout(2400);
  // Scoped to the layers view panel. Locating by the <h2> broke when the layers figure and
  // the duplication tables merged into one card -- the panel, not the heading, is what this
  // view IS, and it keeps its identity through presentational changes.
  const card = dp.locator('.viewpanel[data-view="layers"]').first();
  const arcs = card.locator('path[role=button]');
  const pill = card.locator('g[role=button]').first();
  await pill.scrollIntoViewIfNeeded();
  await dp.waitForTimeout(250);

  const allD = () => arcs.evaluateAll((ns) => ns.map((n) => n.getAttribute('d')));
  const dsBefore = await allD();

  // drag a label
  const bb = await pill.boundingBox();
  await dp.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await dp.mouse.down();
  await dp.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 - 30, { steps: 8 });
  await dp.mouse.up();
  const pillMoved = await pill.evaluate((n) => n.getAttribute('transform'));

  // drag a link, grabbed at quarter length so its own dS pill does not take the press
  const mid = await arcs.first().evaluate((n) => {
    const q = n.getPointAtLength(n.getTotalLength() * 0.25);
    const svg = n.ownerSVGElement; const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
    return { x: r.left + q.x * (r.width / vb.width), y: r.top + q.y * (r.height / vb.height) };
  });
  await dp.mouse.move(mid.x, mid.y);
  await dp.mouse.down();
  await dp.mouse.move(mid.x + 50, mid.y - 40, { steps: 8 });
  await dp.mouse.up();
  const dsAfter = await allD();
  const ends = (d) => {
    const m = d.match(/M ([\d.-]+) ([\d.-]+).*?([\d.-]+) ([\d.-]+)$/);
    return m ? `${(+m[1]).toFixed(1)},${(+m[2]).toFixed(1)}->${(+m[3]).toFixed(1)},${(+m[4]).toFixed(1)}` : d;
  };
  const nChanged = dsBefore.filter((d, i) => d !== dsAfter[i]).length;
  const endsHeld = dsBefore.every((d, i) => ends(d) === ends(dsAfter[i]));

  // keyboard alternative, then the reset control
  await pill.focus();
  await dp.keyboard.press('ArrowRight');
  const kbMoved = await pill.evaluate((n) => n.getAttribute('transform'));
  await dp.keyboard.press('Escape');
  const kbReset = await pill.evaluate((n) => n.getAttribute('transform'));
  await card.locator('button', { hasText: 'Reset the layout' }).click();
  await dp.waitForTimeout(200);
  const dsReset = await allD();
  const pillReset = await pill.evaluate((n) => n.getAttribute('transform'));

  const ok = !derrs.length
    && pillMoved === 'translate(60 -30)'                  // label follows the pointer exactly
    && nChanged === 1                                     // only the grabbed link bends
    && endsHeld                                           // and no link leaves its genes
    && kbMoved && kbMoved !== 'translate(0 0)'            // keyboard alternative works
    && kbReset === 'translate(0 0)'                       // Escape restores
    && dsReset.every((d, i) => d === dsBefore[i])         // reset restores every curve
    && (pillReset === null || pillReset === 'translate(0 0)');
  if (!ok) failures++;
  console.log(`\n### duplayers:drag  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   label drag=${pillMoved}  arcs=${dsBefore.length} bent=${nChanged} `
    + `endpoints-held=${endsHeld}  kb=${kbMoved}->${kbReset}`);
  derrs.forEach((e) => console.log('   !! ' + e));
  await dp.close();
}

// ONE whole-genome duplication call. Until 0.18.0 an exploratory "topology re-check" was drawn
// beside the adopted call and 1,355 genes were advertised as disputed, although the adopted call
// already combines Ks and topology. PtXaTreH.09G077400 was the showcase "disagreeing" gene: it
// must now state one call, and name no second one.
await check('gene-one-wgd-call', '#/gene/PtXaTreH.09G077400',
  { expect: ['The call combines anchor-pair Ks with the position of the two segments', 'retained duplicate'],
    forbid: ['topology re-check', 'proposed, not adopted', 'the two calls disagree', 'call and the anchor table differ'],
    wait: 1800 });
// The four genes the audit of 2026-10-13 opened: each showed an anchor partner labelled with the
// other event than its own class, and the "call and the anchor table differ" box.
for (const gid of ['PtXaAlbH.02G097300', 'PtXaTreH.12G041900']) {
  await check('gene-anchor-events-agree:' + gid, '#/gene/' + gid,
    { expect: ['aWGT'], forbid: ['call and the anchor table differ', 'topology re-check'], wait: 1500 });
}

// Browse must return the SAME numbers as the duplication class figures. It did not: the
// tandem facet was built from syn.flags.ar (GENESPACE placement, 6,804 genes) while the Venn,
// the Duplication card and validate_data.py all use the curated union set (13,048), so
// "tandem + both WGDs" returned 103 against a canonical 385. Every check passed, because
// nothing compared Browse's ANSWER to the canonical intersection. These are those numbers.
// They also exercise deep-linked filters, which used to throw before `inputs` existed.
{
  const bp = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  const berrs = [];
  bp.on('pageerror', (e) => berrs.push(e.message));
  bp.on('console', (m) => { if (m.type() === 'error') berrs.push('console: ' + m.text()); });
  const want = [
    ['tandem=yes', 13048, 'curated union tandem set'],
    // the primary call (wgd9, the default WGD filter since 2026-10-03): letter-code totals of
    // the dissertation's table, e.g. tandem + both WGDs = the ADST code, 379
    ['hap=hap1&tandem=yes&wgd9=both', 188, 'HAP1 tandem + both WGDs, primary call'],
    ['tandem=yes&wgd9=both', 379, 'tandem + both WGDs (= letter code ADST), primary call'],
    ['tandem=yes&wgd9=salicoid', 1581, 'tandem AND sWGD, primary call'],
    ['tandem=yes&wgd9=gamma', 1015, 'tandem AND aWGT, primary call'],
    ['wgd9=neither&tandem=no', 20959, 'neither WGD nor curated tandem, primary call'],
    // a link saved before 0.18.0 with ?wgd= (then an exploratory re-check) resolves to the adopted call
    ['hap=hap1&tandem=yes&wgd=both', 188, 'HAP1 tandem + both WGDs, old ?wgd= link'],
    // the dissertation's Table 2.1, as Browse queries: quality-filtered genes, per haplotype
    ['hap=hap1&qc=no', 31819, 'HAP1 quality-filtered genes'],
    ['hap=hap1&qc=no&wgd9=salicoid', 14136, 'HAP1 sWGD'],
    ['hap=hap2&qc=no&wgd9=gamma', 5430, 'HAP2 aWGT'],
    ['hap=hap2&qc=no&dup=D', 6529, 'HAP2 dispersed only'],
    ['hap=hap1&qc=no&dup=C', 3665, 'HAP1 singleton'],
    // tissue-specific genes and the final LSG set, as the dissertation counts them
    ['hap=hap1&qc=no&tok=yes&tau_min=0.85', 1372, 'HAP1 tissue-specific'],
    ['hap=hap2&qc=no&tok=yes&tau_min=0.85', 1305, 'HAP2 tissue-specific'],
    ['hap=hap1&lsg=final_set', 583, 'HAP1 final LSG set'],
    ['hap=hap2&lsg=final_set', 621, 'HAP2 final LSG set'],
  ];
  const got = [];
  for (const [q, n] of want) {
    await bp.goto(base + '/#/browse?' + q, { waitUntil: 'networkidle' });
    await bp.waitForTimeout(1800);
    const txt = await viewText(bp);
    const m = txt.match(/([\d,]+)\s*\n?\s*of [\d,]+ genes match/i);
    got.push(m ? parseInt(m[1].replace(/,/g, ''), 10) : null);
  }
  const ok = !berrs.length && want.every(([, n], i) => got[i] === n);
  if (!ok) failures++;
  console.log(`\n### browse:counts-match-the-class-figures  ${ok ? 'OK' : 'FAIL'}`);
  want.forEach(([q, n, label], i) => console.log(
    `   ${got[i] === n ? 'ok ' : 'BAD'} ${String(got[i]).padStart(6)} (want ${String(n).padStart(6)})  ${label}`));
  berrs.forEach((e) => console.log('   !! ' + e));
  await bp.close();
}

// Cache safety. GitHub Pages sends max-age=600 on every file and cannot be told otherwise, so
// for ten minutes after a deploy a reader can hold a stale facets.json while fetching fresh
// JavaScript. Every column this code reads by NAME still resolves in that state -- just to the
// wrong thing -- so the page renders a confident number instead of failing. A reader on data
// 0.11.2 saw 191 from a link that serves 229 for exactly this reason. Two defences, both
// asserted: data URLs carry the manifest's version, and a mismatched build says so out loud.
{
  const cp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const cerrs = [];
  const dataUrls = [];
  cp.on('pageerror', (e) => cerrs.push(e.message));
  cp.on('console', (m) => { if (m.type() === 'error') cerrs.push('console: ' + m.text()); });
  cp.on('request', (r) => { if (r.url().includes('/data/')) dataUrls.push(r.url()); });
  await cp.goto(base + '/#/browse?tandem=yes&wgd=both', { waitUntil: 'networkidle' });
  await cp.waitForTimeout(1800);
  const txt = await cp.evaluate(() => document.body.innerText);
  const others = dataUrls.filter((u) => !u.includes('manifest.json'));
  const unstamped = others.filter((u) => !u.includes('?v='));
  const okMatch = !cerrs.length && others.length > 0 && unstamped.length === 0
    && !txt.includes('cached build');
  if (!okMatch) failures++;
  console.log(`\n### cache:data-urls-carry-the-version  ${okMatch ? 'OK' : 'FAIL'}`);
  console.log(`   ${others.length} non-manifest data fetches, ${unstamped.length} unstamped, `
    + `banner shown: ${txt.includes('cached build')}`);
  unstamped.slice(0, 3).forEach((u) => console.log('   !! unstamped: ' + u));
  cerrs.forEach((e) => console.log('   !! ' + e));
  await cp.close();

  // A stale build must announce itself. Rewrite the meta before boot to simulate a reader
  // holding yesterday's HTML and script against today's data.
  const sp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await sp.route('**/index.html', async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace(/atlas-build-version" content="[^"]+"/,
      'atlas-build-version" content="0.0.1"');
    await route.fulfill({ response: r, body });
  });
  await sp.goto(base + '/index.html#/', { waitUntil: 'networkidle' });
  await sp.waitForTimeout(1800);
  const stxt = await sp.evaluate(() => document.body.innerText);
  const okStale = stxt.includes('cached build') && stxt.includes('0.0.1');
  if (!okStale) failures++;
  console.log(`### cache:stale-build-warns  ${okStale ? 'OK' : 'FAIL'}`);
  await sp.close();
}

// The third side of the triangle. Gamma predates salicoid, so a gene's salicoid sister and its
// gamma copy are themselves a gamma pair -- drawing only the focal gene's links showed a star
// and hid the history. PtXaTreH.08G070200 is the Fuzzy MYB locus from Chen's talk: salicoid to
// 10G136900, gamma to 17G070400, and the 10g-17g edge that must now also appear. The count is
// asserted so an inference bug (completing the triangle by construction rather than from the
// anchor table) shows up as too MANY links rather than passing silently.
{
  const tp = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  const terrs = [];
  tp.on('pageerror', (e) => terrs.push(e.message));
  tp.on('console', (m) => { if (m.type() === 'error') terrs.push('console: ' + m.text()); });
  await tp.goto(base + '/#/gene/PtXaTreH.08G070200', { waitUntil: 'networkidle' });
  await tp.waitForTimeout(2400);
  const card = tp.locator('.viewpanel[data-view="layers"]').first();
  const txt = (await card.innerText()).toLowerCase();
  // every dS drawn on the card, in order
  const ds = (await card.innerText()).match(/dS \d+\.\d+/g) || [];
  const has = (v) => ds.includes(v);
  const ok = !terrs.length
    && has('dS 0.093')      // 08g -> 10g salicoid
    && has('dS 1.21')       // 08g -> 17g gamma
    && has('dS 1.03')       // 10g -> 17g gamma: the third edge
    && txt.includes('two partners')   // 'joins' when there is one, 'join' when several
    && txt.includes('never inferred from the other two');
  if (!ok) failures++;
  console.log(`\n### duplayers:third-edge-of-the-triangle  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   dS labels drawn: ${ds.join(', ')}`);
  terrs.forEach((e) => console.log('   !! ' + e));
  await tp.close();
}

// The home page's question links. Each count is computed in the browser from the facet index
// with Browse's OWN predicates, so the number on the home page and the number on the page it
// links to cannot drift. Asserted BOTH ways here: the home page shows a count, and following
// the link produces the same count. The disputed-WGD one is the interesting case -- a first
// draft expressed it as {wgd:'salicoid', wgd9:'gamma'} and reported 7,574, because a gene
// carrying both events under both calls matches that while agreeing about everything. The
// real answer is 904 and it needed its own facet column.
{
  const qp = await browser.newPage({ viewport: { width: 1180, height: 1400 } });
  const qerrs = [];
  qp.on('pageerror', (e) => qerrs.push(e.message));
  qp.on('console', (m) => { if (m.type() === 'error') qerrs.push('console: ' + m.text()); });
  await qp.goto(base + '/#/', { waitUntil: 'networkidle' });
  await qp.waitForTimeout(3200);
  const card = qp.locator('.card').filter({ has: qp.locator('h2', { hasText: 'Start from a question' }) }).first();
  const found = await card.count();
  const txt = found ? await card.innerText() : '';
  const counts = (txt.match(/\u00b7 [\d,]+ (?:HAP1 \/ [\d,]+ HAP2 )?genes/g) || []);
  const links = found ? await card.locator('a').evaluateAll((ns) => ns.map((n) => n.getAttribute('href'))) : [];

  // follow three of them and check the destination agrees
  const checks = [
    ['#/browse?tandem=yes&top=xylem&tau_min=0.85&tok=yes&qc=no', 214],
    ['#/browse?lsg=final_set', 1204],
    ['#/browse?rel=hemizygous_strict_PAV', 1133],
  ];
  const got = [];
  for (const [href, want] of checks) {
    await qp.goto(base + '/' + href, { waitUntil: 'networkidle' });
    await qp.waitForTimeout(1500);
    const t = await viewText(qp);
    const m = t.match(/([\d,]+)\s*\n?\s*of [\d,]+ genes match/i);
    got.push(m ? parseInt(m[1].replace(/,/g, ''), 10) : null);
  }

  const ok = !qerrs.length && found > 0
    && counts.length === 8                                   // every question got a live count
    && links.length === 8
    && txt.includes('528 HAP1 / 605 HAP2')                   // per haplotype, never summed
    && txt.includes('583 HAP1 / 621 HAP2')                   // the final LSG set
    && !/disagree|disputed/i.test(txt)                       // no second WGD call is advertised
    && checks.every(([, want], i) => got[i] === want);        // home count == destination count
  if (!ok) failures++;
  console.log(`\n### home:questions-round-trip  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${counts.length}/8 live counts; destinations ${got.join(', ')} `
    + `(want ${checks.map(([, w]) => w).join(', ')})`);
  qerrs.forEach((e) => console.log('   !! ' + e));
  await qp.close();
}

// #/pair/<id> -- the allele pair as one page. Three properties matter and all three are
// asserted: entering from EITHER haplotype gives the same page (two readers arriving from
// opposite alleles must not see mirror images of each other); rows that differ by
// construction (id, coordinates) are NOT marked, because flagging those dilutes the rows
// where a difference means something; and a gene with no allele gets its own view rather
// than a broken one -- that state covers 12,098 genes and is a finding, not an error.
{
  const pp = await browser.newPage({ viewport: { width: 1180, height: 1400 } });
  const perrs = [];
  pp.on('pageerror', (e) => perrs.push(e.message));
  pp.on('console', (m) => { if (m.type() === 'error') perrs.push('console: ' + m.text()); });

  const read = async (id) => {
    await pp.goto(base + '/#/pair/' + id, { waitUntil: 'networkidle' });
    await pp.waitForTimeout(2600);
    return viewText(pp);
  };

  const fromHap1 = await read('PtXaTreH.01G176300');
  const fromHap2 = await read('PtXaAlbH.01G179300');
  const solo = await read('PtXaTreH.01G175200');

  const marks = (t) => (t.match(/differs/g) || []).length;
  const corr = (t) => (t.match(/Pearson ([\d.]+)/) || [])[1];
  const ok = !perrs.length
    // same pair from either side: same marked rows and the same correlation
    && marks(fromHap1) === marks(fromHap2)
    && corr(fromHap1) && corr(fromHap1) === corr(fromHap2)
    // both ids present on both renderings -- the pair, not the gene you came from
    && fromHap1.includes('PtXaTreH.01G176300') && fromHap1.includes('PtXaAlbH.01G179300')
    && fromHap2.includes('PtXaTreH.01G176300') && fromHap2.includes('PtXaAlbH.01G179300')
    // the honesty lines that stop this being read as allele-specific expression
    && fromHap1.includes('NOT allele-specific expression')
    && fromHap1.toLowerCase().includes('not measured') === fromHap1.toLowerCase().includes('not measured')
    // a gene with no allele gets the real explanation, not an empty table
    && solo.includes('No allele pair') && solo.includes('not by itself a presence/absence call')
    && !solo.includes('Side by side');
  if (!ok) failures++;
  console.log(`\n### pair:same-from-either-haplotype  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   marked rows ${marks(fromHap1)} vs ${marks(fromHap2)}; Pearson `
    + `${corr(fromHap1)} vs ${corr(fromHap2)}; no-allele view ${solo.includes('No allele pair')}`);
  perrs.forEach((e) => console.log('   !! ' + e));
  await pp.close();
}

// #/karyotype -- the ancestral genome as a navigable surface, reduced in the browser from the
// `aek` facet column. The property that matters is the round trip: a cell claims a count and
// its link must land on exactly that count, because the grid and Browse are two different code
// paths over the same column and this repo has already shipped two numbers that disagreed for
// exactly that reason (0.11.2 and 0.11.3). Also asserted: the counts partition the corpus
// (placed + not placed == 63,960), and the "not subgenomes" caveat is present, since copy
// RANKS read as subgenome labels to anyone who has seen a polyploid paper.
{
  const kp = await browser.newPage({ viewport: { width: 1180, height: 1300 } });
  const kerrs = [];
  kp.on('pageerror', (e) => kerrs.push(e.message));
  kp.on('console', (m) => { if (m.type() === 'error') kerrs.push('console: ' + m.text()); });
  await kp.goto(base + '/#/karyotype', { waitUntil: 'networkidle' });
  await kp.waitForTimeout(3600);
  const txt = await viewText(kp);
  const cells = await kp.locator('#view a[href*="AEK"]').count();

  // take three cells, read the count each claims, follow it, compare
  const picked = await kp.locator('#view a[href*="salicoid_copy"]').evaluateAll(
    (ns) => ns.filter((_, i) => i % 13 === 0).slice(0, 3).map((n) => ({
      href: n.getAttribute('href'),
      claim: parseInt((n.innerText.split('\n')[0] || '').replace(/,/g, ''), 10),
    })));
  const landed = [];
  for (const c of picked) {
    await kp.goto(base + '/' + c.href, { waitUntil: 'networkidle' });
    await kp.waitForTimeout(1500);
    const t = await viewText(kp);
    const m = t.match(/([\d,]+)\s*\n?\s*of [\d,]+ genes match/i);
    landed.push(m ? parseInt(m[1].replace(/,/g, ''), 10) : null);
  }

  const num = (re) => { const m = txt.match(re); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null; };
  const placed = num(/([\d,]+)\s*\n\s*genes placed on the ancestral genome/);
  const unplaced = num(/([\d,]+)\s*\n\s*not placed/);

  const ok = !kerrs.length
    && cells >= 40
    && picked.length === 3
    && picked.every((c, i) => Number.isFinite(c.claim) && landed[i] === c.claim)
    && placed + unplaced === 63960                    // the counts partition the corpus
    && txt.includes('not subgenomes')                 // the caveat that stops the misreading
    && txt.includes('absence of evidence');           // an empty cell is not a proven loss
  if (!ok) failures++;
  console.log(`\n### karyotype:cells-round-trip  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${cells} clickable cells; claims ${picked.map((c) => c.claim).join(', ')} `
    + `-> landed ${landed.join(', ')}; ${placed} placed + ${unplaced} not placed`);
  kerrs.forEach((e) => console.log('   !! ' + e));
  await kp.close();
}

// #/karyotype painted chromosomes: every legend count must equal the count re-derived here, from
// facets.json directly (hap column x aek hundreds digit), with a positive control that a one-gene
// perturbation is caught. Then a driven click: a painted row -> detail -> Browse, and a legend
// link -> Browse, each landing on the number it claimed. Then the page fits a 390 px phone.
{
  const kp = await browser.newPage({ viewport: { width: 1180, height: 1300 } });
  const kerrs = [];
  kp.on('pageerror', (e) => kerrs.push(e.message));
  await kp.goto(base + '/#/karyotype', { waitUntil: 'networkidle' });
  await kp.waitForSelector('[data-kp-fig]', { timeout: 60000 });
  const fac = await kp.evaluate(async () => (await fetch('data/index/facets.json')).json());
  const ih = fac.cols.indexOf('hap'); const ia = fac.cols.indexOf('aek');
  const want = {};
  for (const r of fac.rows) {
    if (r[ia] == null || r[ia] < 100) continue;
    const k = `${r[ih] === 0 ? 'hap1' : 'hap2'}|AEK${Math.floor(r[ia] / 100)}`;
    want[k] = (want[k] || 0) + 1;
  }
  const shown = await kp.locator('[data-kp-legend]').evaluateAll((ns) => ns.map((n) => [n.dataset.kpLegend, +n.dataset.n,
    parseInt(n.querySelector('.kp-n').textContent.replace(/,/g, ''), 10)]));
  const agree = (w) => shown.length === 14 && shown.every(([k, n, t]) => w[k] === n && n === t);
  const perturbed = { ...want, 'hap2|AEK4': want['hap2|AEK4'] + 1 };
  const legendOk = agree(want) && !agree(perturbed);   // positive control: a one-gene drift is caught

  const leg = kp.locator('[data-kp-legend="hap2|AEK3"]').first();
  const legN = +(await leg.getAttribute('data-n'));
  await leg.click();
  await kp.waitForTimeout(1500);
  const lm = (await viewText(kp)).match(/([\d,]+)\s*\n?\s*of [\d,]+ genes match/i);
  const legLanded = lm ? parseInt(lm[1].replace(/,/g, ''), 10) : null;

  await kp.goto(base + '/#/karyotype', { waitUntil: 'networkidle' });
  await kp.waitForSelector('[data-kp-fig]', { timeout: 60000 });
  await kp.locator('[data-kp-hit="hap1|Chr06"]').click();
  const bl = kp.locator('[data-kp-browse]');
  const segN = +(await bl.getAttribute('data-n'));
  await bl.click();
  await kp.waitForTimeout(1500);
  const sm = (await viewText(kp)).match(/([\d,]+)\s*\n?\s*of [\d,]+ genes match/i);
  const segLanded = sm ? parseInt(sm[1].replace(/,/g, ''), 10) : null;
  await kp.close();

  const pp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pp.goto(base + '/#/karyotype', { waitUntil: 'networkidle' });
  await pp.waitForSelector('[data-kp-fig]', { timeout: 60000 });
  const fit = await pp.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth,
    Math.min(...[...document.querySelectorAll('[data-kp-mode],[data-kp-focus],[data-kp-legend]')]
      .map((n) => n.getBoundingClientRect().height))]);
  await pp.close();

  const ok = !kerrs.length && legendOk && legLanded === legN && segN > 0 && segLanded === segN
    && fit[0] <= fit[1] && fit[2] >= 44;
  if (!ok) failures++;
  console.log(`\n### karyotype:painted-legend-and-clicks  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   legend ${shown.length} counts agree with facets ${agree(want)}, perturbed caught ${!agree(perturbed)}; `
    + `legend ${legN} -> ${legLanded}; segment ${segN} -> ${segLanded}; phone ${fit[0]}/${fit[1]}, min target ${fit[2]}px`);
  kerrs.forEach((e) => console.log('   !! ' + e));
}

// The provenance records are no longer rendered as page text (Chen, 2026-10-03: internal
// version and folder names stay in build files). They remain published beside the data.

// #/family/<gene> -- the descent group, walked to exhaustion. Built only after measuring that
// components are drawable (largest 85, median 3); had the edges chained the genome together
// this would show 20,000 rows. Asserted: the member count matches the rows actually rendered,
// the focal gene is at distance 0 and its direct partners at 1, recentring on another member
// gives the SAME family, and a gene with no homology edge gets the real explanation rather
// than a family of one.
{
  const fp = await browser.newPage({ viewport: { width: 1180, height: 1400 } });
  const ferrs = [];
  fp.on('pageerror', (e) => ferrs.push(e.message));
  fp.on('console', (m) => { if (m.type() === 'error') ferrs.push('console: ' + m.text()); });

  const read = async (id) => {
    await fp.goto(base + '/#/family/' + id, { waitUntil: 'networkidle' });
    await fp.waitForTimeout(3400);
    const txt = await viewText(fp);
    const rows = await fp.locator('#view tbody tr').count();
    const ids = await fp.locator('#view tbody tr td:first-child').allInnerTexts();
    return { txt, rows, ids: ids.map((s) => s.trim()).sort() };
  };

  const a = await read('PtXaTreH.08G070200');           // Fuzzy MYB: tandem + both WGDs
  const b2 = await read('PtXaAlbH.08G074000');          // furthest member of the same family
  const solo = await read('PtXaTreH.01G175200');        // no homology edge at all

  const claimed = parseInt(((a.txt.match(/(\d+)\s*\n\s*genes in the family/) || [])[1] || '0'), 10);
  const sameFamily = a.ids.length === b2.ids.length
    && a.ids.every((x, i) => x === b2.ids[i]);

  const ok = !ferrs.length
    && claimed === a.rows                                  // the stat and the table agree
    && a.rows >= 8
    && /focal/.test(a.txt)                                 // the focal gene is marked, not given a distance
    && a.txt.includes('tandem') && a.txt.includes('sWGD') && a.txt.includes('aWGT')
    && sameFamily                                          // recentring gives the same membership
    && solo.txt.includes('No descent group') && solo.txt.includes('3,348')
    && solo.rows === 0;
  if (!ok) failures++;
  console.log(`\n### family:walk-and-recentre  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${a.rows} members (claimed ${claimed}); recentring gives the same set: `
    + `${sameFamily}; no-family view: ${solo.txt.includes('No descent group')}`);
  ferrs.forEach((e) => console.log('   !! ' + e));
  await fp.close();
}

// #/status -- the gates this build passed, rendered as a boot log. The site told readers its
// data was validated and published none of the verdicts; they lived in a terminal on the
// cluster. Asserted: every recorded gate reaches the page (not a truncated sample), the counts
// in the header agree with the lines below them, and the page states the caveat that makes the
// whole record honest -- a gate passing over zero rows proves nothing, which this project has
// actually shipped.
{
  const sp = await browser.newPage({ viewport: { width: 1180, height: 1600 } });
  const serrs = [];
  sp.on('pageerror', (e) => serrs.push(e.message));
  sp.on('console', (m) => { if (m.type() === 'error') serrs.push('console: ' + m.text()); });
  await sp.goto(base + '/#/status', { waitUntil: 'networkidle' });
  await sp.waitForTimeout(2400);
  const txt = await viewText(sp);
  const okLines = (txt.match(/\[ OK \]/g) || []).length;
  const failLines = (txt.match(/\[ FAIL \]/g) || []).length;
  const claimed = parseInt(((txt.match(/(\d+)\s*\n\s*gates run/) || [])[1] || '0'), 10);
  const claimedFail = parseInt(((txt.match(/(\d+)\s*\n\s*failed/) || [])[1] || '-1'), 10);

  // fetch the record directly and compare -- the page must not drop or invent a line
  const rec = await sp.evaluate(async () => {
    const r = await fetch('data/meta/gates.json');
    return r.ok ? r.json() : null;
  });

  const ok = !serrs.length
    && rec && rec.n_checks > 40
    && okLines + failLines === rec.n_checks     // every gate reaches the page
    && claimed === rec.n_checks                 // the header agrees with the lines
    && failLines === rec.n_failed && claimedFail === rec.n_failed
    && /passes over zero rows/.test(txt)        // the caveat that makes the record honest
    && /check\.mjs/.test(txt);                  // rendered-page checks named as separate
  if (!ok) failures++;
  console.log(`\n### status:gates-published-in-full  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   record has ${rec ? rec.n_checks : '?'} gates (${rec ? rec.n_failed : '?'} failed); `
    + `page renders ${okLines} OK + ${failLines} FAIL, header claims ${claimed}`);
  serrs.forEach((e) => console.log('   !! ' + e));
  await sp.close();
}

// The gene page carries nineteen cards. Two things keep it navigable, and both can regress
// silently: the running order (bands are ordered by WHAT THE EVIDENCE IS -- measured on this
// assembly first, predicted/transferred last) and the section nav. Asserted here: the bands
// appear in the declared order with `predicted` last, every nav link has a heading and every
// heading has a nav link (a band that renders nothing must not leave a dead chip), the glance
// strip names duplication/synteny/expression, and the scroll-spy marks the band you are in --
// including after scrolling back to the top, which the first implementation got wrong because
// it compared IntersectionObserver rects captured when each entry last fired.
{
  const np = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const nerrs = [];
  np.on('pageerror', (e) => nerrs.push(e.message));
  np.on('console', (m) => { if (m.type() === 'error') nerrs.push('console: ' + m.text()); });
  await np.goto(base + '/#/gene/PtXaTreH.19G110500', { waitUntil: 'networkidle' });
  await np.waitForTimeout(2200);

  const EXPECTED = ['identity', 'duplication', 'synteny', 'expression', 'predicted'];
  const shape = await np.evaluate(() => ({
    heads: [...document.querySelectorAll('#view h2.sect')].map((h) => h.id.replace(/^sec-/, '')),
    navs: [...document.querySelectorAll('.secnav-link')].map((a) => a.dataset.sec),
    glance: [...document.querySelectorAll('.card.glance .kv dt')].map((d) => d.textContent),
    // the ordering claim: every card of a band sits between its heading and the next one
    firstPredictedCardAfterLastMeasured: (() => {
      const nodes = [...document.querySelectorAll('#view h2.sect, #view .cards > .card')];
      const iPred = nodes.findIndex((n) => n.id === 'sec-predicted');
      const iExpr = nodes.findIndex((n) => n.id === 'sec-expression');
      return iPred > iExpr && iPred > -1;
    })(),
  }));

  const orderOk = EXPECTED.every((id, i) => shape.heads[i] === id);
  const pairedOk = shape.heads.length === shape.navs.length
    && shape.heads.every((h, i) => shape.navs[i] === h);
  const glanceOk = ['Duplication', 'Synteny', 'Expression'].every((k) => shape.glance.includes(k));

  // scroll-spy, including the return to the top
  const marksAt = async (secId) => {
    if (secId) await np.evaluate((i) => document.getElementById('sec-' + i).scrollIntoView(), secId);
    else await np.evaluate(() => window.scrollTo(0, 0));
    await np.waitForTimeout(420);
    return np.evaluate(() => {
      const on = document.querySelector('.secnav-link.on');
      return on ? on.dataset.sec : null;
    });
  };
  const spy = [];
  for (const id of EXPECTED) spy.push([id, await marksAt(id)]);
  const backTop = await marksAt(null);
  const spyOk = spy.every(([want, got]) => want === got) && backTop === 'identity';

  // the nav must clear the site header, which wraps to several rows on a phone -- so the
  // offset is measured at runtime rather than hard-coded
  await np.evaluate((i) => document.getElementById('sec-' + i).scrollIntoView(), 'synteny');
  await np.waitForTimeout(300);
  const clear = await np.evaluate(() => {
    const n = document.querySelector('.secnav'), h = document.querySelector('header.top');
    return n && h ? n.getBoundingClientRect().top >= h.getBoundingClientRect().bottom - 1 : false;
  });

  const ok = !nerrs.length && orderOk && pairedOk && glanceOk && spyOk && clear
    && shape.firstPredictedCardAfterLastMeasured;
  if (!ok) failures++;
  console.log(`\n### genepage:bands-order-and-section-nav  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   bands ${shape.heads.join(' > ')}  (predicted last: ${shape.firstPredictedCardAfterLastMeasured})`);
  console.log(`   nav paired with headings: ${pairedOk}; glance rows ${shape.glance.join('/')}`);
  console.log(`   spy ${spy.map(([w, g]) => `${w}->${g}`).join(' ')}  back-to-top->${backTop}; nav clears header: ${clear}`);
  nerrs.forEach((e) => console.log('   !! ' + e));
  await np.close();
}

// A phone wraps header.top to three rows, so the section nav's sticky offset is measured
// rather than assumed, and the nav itself becomes ONE swipeable row instead of wrapping --
// wrapping put a third of the viewport under sticky chrome. The active chip must stay
// visible inside that row, or the reader loses their place exactly when navigation matters.
{
  const mp = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const merrs = [];
  mp.on('pageerror', (e) => merrs.push(e.message));
  await mp.goto(base + '/#/gene/PtXaTreH.19G110500', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(2000);

  const rows = [];
  for (const id of ['identity', 'expression', 'predicted']) {
    await mp.evaluate((i) => document.getElementById('sec-' + i).scrollIntoView(), id);
    await mp.waitForTimeout(420);
    rows.push(await mp.evaluate(() => {
      const nav = document.querySelector('.secnav');
      const on = nav && nav.querySelector('.secnav-link.on');
      if (!on) return { sec: null, visible: false, oneRow: false };
      const nr = nav.getBoundingClientRect(), or = on.getBoundingClientRect();
      return {
        sec: on.dataset.sec,
        visible: or.left >= nr.left - 1 && or.right <= nr.right + 1,
        oneRow: nr.height < 56,                       // two rows of chips would exceed this
        clearsHeader: nr.top >= document.querySelector('header.top').getBoundingClientRect().bottom - 1,
      };
    }));
  }
  const noHScroll = await mp.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 2);

  const ok = !merrs.length && noHScroll
    && rows.every((r) => r.visible && r.oneRow && r.clearsHeader)
    && rows[2].sec === 'predicted';
  if (!ok) failures++;
  console.log(`\n### genepage:section-nav-on-a-phone  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${rows.map((r) => `${r.sec}:vis=${r.visible},1row=${r.oneRow}`).join('  ')}`);
  console.log(`   no horizontal page scroll: ${noHScroll}`);
  merrs.forEach((e) => console.log('   !! ' + e));
  await mp.close();
}

// The header carried ten flat tabs in MODULES import order and wrapped to three rows on a
// phone. It is now four ways-in, one grouped "Layers" tab, and About last. The thing that
// must not regress is REACHABILITY: grouping is only acceptable if every destination is still
// one click away and the group shows when the page you are on lives inside it.
{
  const hp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const herrs = [];
  hp.on('pageerror', (e) => herrs.push(e.message));
  hp.on('console', (m) => { if (m.type() === 'error') herrs.push('console: ' + m.text()); });
  await hp.goto(base + '/#/', { waitUntil: 'networkidle' });
  await hp.waitForTimeout(1300);

  const h = await hp.evaluate(() => {
    const nav = document.querySelector('header.top nav');
    return {
      visible: [...nav.children].map((c) => c.tagName === 'DETAILS'
        ? c.querySelector('summary').textContent : c.textContent),
      hrefs: [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      inMenu: [...document.querySelectorAll('.navmenu-panel a')].map((a) => a.textContent),
      closedAtLoad: document.querySelector('.navmenu')?.open === false,
    };
  });

  // every module that publishes an overview must be reachable from the header, grouped or not
  const wantHrefs = ['#/', '#/browse', '#/map', '#/karyotype', '#/module/duplication',
    '#/module/synteny', '#/module/expression', '#/module/protein', '#/module/phylostrat',
    '#/module/about', '#/glossary', '#/downloads'];
  const reachable = wantHrefs.every((w) => h.hrefs.includes(w));

  // the group must mark itself when the current page is one of its children
  await hp.click('.navmenu > summary');
  await hp.waitForTimeout(220);
  await hp.click('.navmenu-panel a[href="#/module/expression"]');
  await hp.waitForTimeout(1200);
  const after = await hp.evaluate(() => ({
    hash: location.hash,
    groupOn: document.querySelector('.navmenu')?.classList.contains('on'),
    closed: document.querySelector('.navmenu')?.open === false,
  }));

  const ok = !herrs.length && reachable && h.closedAtLoad
    && h.visible.length === 8 && h.visible[0] === 'Home'
    && h.visible.includes('Glossary') && h.visible.includes('Downloads')
    && h.visible[h.visible.length - 1] === 'About'
    && h.inMenu.length === 5 && h.inMenu[0] === 'Duplication'
    && after.hash === '#/module/expression' && after.groupOn && after.closed;
  if (!ok) failures++;
  console.log(`\n### header:grouped-tabs-stay-reachable  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${h.visible.length} visible: ${h.visible.join(' | ')}`);
  console.log(`   Layers holds: ${h.inMenu.join(', ')}; all ${wantHrefs.length} destinations reachable: ${reachable}`);
  console.log(`   choosing one -> ${after.hash}, group marked: ${after.groupOn}, menu closed: ${after.closed}`);
  herrs.forEach((e) => console.log('   !! ' + e));
  await hp.close();
}

// GO names must arrive even when the card renders before terms.json (a race once printed
// "term name unavailable" on every id). PtXaTreH.08G070200 carries GO:0003677 (DNA binding).
{
  const gp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await gp.goto(base + '/#/gene/PtXaTreH.08G070200', { waitUntil: 'networkidle' });
  await gp.waitForTimeout(1500);
  const r = await gp.evaluate(() => [...document.querySelectorAll('[data-go-name]')].map((n) => n.textContent));
  const named = r.filter((t) => t && t !== '…' && !/not in the release/.test(t)).length;
  const ok = r.length > 0 && named === r.length && r.some((t) => /DNA binding/.test(t));
  if (!ok) failures++;
  console.log(`\n### annotation:go-names  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${named}/${r.length} named: ${r.slice(0, 3).join(' | ')}`);
  await gp.close();
}

// Relationship categories and array status, as the dissertation names them (2026-10-03).
// One gene per category must render its reader name on the gene page, the raw code must never
// render, and every array status must render its reader name on its array page. Never
// "HAP1 only" / "HAP2 only" for an array: one-sided arrays are expansions.
{
  const genes = {
    '1:1': ['PtXaTreH.01G000200', '1:1'], 'N:N_TD': ['PtXaTreH.01G000300', 'TD-associated N:N'],
    'N:N_nonTD': ['PtXaTreH.01G017400', 'Non-TD N:N'], 'CNV_TD': ['PtXaTreH.01G002200', 'TD-associated CNV'],
    'CNV_nonTD': ['PtXaTreH.01G319400', 'Non-TD CNV'], 'hemizygous_strict_PAV': ['PtXaTreH.01G006100', 'Strict PAV'],
    'hemizygous_TD_array': ['PtXaTreH.03G012100', 'Hemizygous TD arrays'],
    'hemizygous_nonPAV': ['PtXaTreH.01G000100', 'Non-PAV hemizygous'], none: ['PtXaTreH.01G006600', 'not classified'],
  };
  const arrays = {
    HAP1_U00000: 'N:N (same copy number)', HAP1_U00001: 'CNV, arrays in both haplotypes',
    HAP1_U00021: 'CNV, HAP1-specific expansion', HAP2_U02223: 'CNV, HAP2-specific expansion',
    HAP1_U00361: 'Hemizygous (no syntelog)',
  };
  const rp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const rerrs = [];
  rp.on('pageerror', (e) => rerrs.push(e.message));
  const bad = [];
  for (const [code, [gid, name]] of Object.entries(genes)) {
    await rp.goto(`${base}/#/gene/${gid}`, { waitUntil: 'networkidle' });
    await rp.waitForTimeout(900);
    const t = await rp.evaluate(() => {
      const c = document.querySelector('[data-card="relationship"]');
      return c ? c.innerText : '';
    });
    if (!t.includes(name)) bad.push(`${gid}: no "${name}"`);
    if (code !== 'none' && code !== '1:1' && t.includes(code)) bad.push(`${gid}: raw code ${code} rendered`);
  }
  for (const [aid, name] of Object.entries(arrays)) {
    await rp.goto(`${base}/#/array/${aid}`, { waitUntil: 'networkidle' });
    await rp.waitForSelector('[data-arr-rel]', { timeout: 15000 }).catch(() => {});
    const t = await rp.evaluate(() => document.getElementById('view').innerText);
    if (!t.includes(name)) bad.push(`${aid}: no "${name}"`);
    if (/HAP[12] only/.test(t)) bad.push(`${aid}: says "HAP1/2 only"`);
  }
  await rp.goto(`${base}/#/arrays`, { waitUntil: 'networkidle' });
  await rp.waitForTimeout(1200);
  const tab = await rp.evaluate(() => [...document.querySelectorAll('[data-arrays-rel-row]')]
    .map((r) => [r.dataset.arraysRelRow, ...[...r.querySelectorAll('td')].slice(1).map((c) => c.textContent)]));
  const want = { same_copy_number: ['1,229', '1,228'], HAP1_specific_expansion: ['285', '0'],
    HAP2_specific_expansion: ['0', '259'], TD_associated_PAV: ['48', '47'], diff_copy_number_arrays_both: ['557', '550'] };
  for (const [k, [h1, h2]] of Object.entries(want)) {
    const row = tab.find((r) => r[0] === k);
    if (!row || !row[1].startsWith(h1) || !row[2].startsWith(h2)) bad.push(`arrays table ${k}: ${row ? row.slice(1).join(' / ') : 'missing'}`);
  }
  const ok = !bad.length && !rerrs.length;
  if (!ok) failures++;
  console.log(`\n### relationship:reader-names  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${Object.keys(genes).length} genes, ${Object.keys(arrays).length} arrays, status table ${tab.length} rows`);
  [...bad, ...rerrs].forEach((e) => console.log('   !! ' + e));
  await rp.close();
}

// Sample design map. (1) On the allele pair page, whose bars are medians over wild-type
// controls, focusing a tissue row selects those samples, and the readout's n and both alleles'
// medians (computed from the 652-sample vectors) must equal the row's n and bar values (the
// shards' x.n / x.t). Positive control: a row read against ANOTHER row's readout must disagree.
// (2) On the gene page, pinning a grid cell lights exactly that cell's samples in the profile.
{
  const dp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const derrs = [];
  dp.on('pageerror', (e) => derrs.push(e.message));
  const bad = [];
  let nrows = 0, controlDisagrees = false, profileOk = false;
  for (const gid of ['PtXaTreH.05G194600', 'PtXaTreH.05G120200']) {
    await dp.goto(`${base}/#/pair/${gid}`, { waitUntil: 'networkidle' });
    await dp.waitForSelector('[data-dmap]', { timeout: 15000 });
    await dp.mouse.move(0, 0);
    const got = await dp.evaluate(() => [...document.querySelectorAll('g.pr-trow[data-ids]')].map((g) => {
      g.dispatchEvent(new FocusEvent('focus'));
      const row = { t: g.dataset.tissue, n: g.querySelectorAll('.pr-tn')[0].textContent,
        bars: [...g.querySelectorAll('.pr-tv')].map((x) => +x.textContent),
        read: document.querySelector('.dmap-readout').textContent };
      g.dispatchEvent(new FocusEvent('blur'));
      return row;
    }));
    const parse = (read) => {
      const n = +(/: (\d+) wild-type control sample/.exec(read) || [])[1];
      const meds = [...read.matchAll(/: (?:median ([\d,.]+) TPM|values? ([\d,.]+(?:, [\d,.]+)*) TPM)/g)].map((m) => {
        if (m[1]) return +m[1].replace(/,/g, '');
        const v = m[2].split(', ').map((x) => +x.replace(/,/g, '')).sort((a, b) => a - b);
        return v[Math.floor(v.length / 2)];
      });
      return { n, meds };
    };
    const agree = (r, o) => o.n === +r.n.replace('n ', '') && r.bars.length === 2 && o.meds.length === 2
      && r.bars.every((b, j) => Math.abs(o.meds[j] - b) <= Math.max(0.06, b * 0.006));
    got.forEach((r, i) => {
      nrows++;
      if (!agree(r, parse(r.read))) bad.push(`${gid} ${r.t}: n ${r.n}, bars ${r.bars.join(' / ')}, readout "${r.read.slice(0, 160)}"`);
      if (!agree(r, parse(got[(i + 1) % got.length].read))) controlDisagrees = true;
    });
  }
  // (3) The gene page's tissue table (the dissertation's 222-sample reference panel, `ref222`):
  // each row's n and mean must equal the readout over the samples it lights. Control: a row
  // read against the NEXT row's readout must disagree.
  let refRows = 0, refControl = false;
  for (const gid of ['PtXaTreH.05G120200', 'PtXaAlbH.05G196300']) {
    await dp.goto(`${base}/#/gene/${gid}`, { waitUntil: 'networkidle' });
    await dp.waitForSelector('[data-dmap]', { timeout: 15000 });
    await dp.mouse.move(0, 0);
    const rows = await dp.evaluate(() => [...document.querySelectorAll('[data-paper-expr] tbody tr[data-ids]')].map((tr) => {
      tr.dispatchEvent(new FocusEvent('focus'));
      const o = { t: tr.dataset.tissue, mean: +tr.cells[1].textContent.replace(/,/g, ''), n: tr.cells[2].textContent.trim(),
        read: document.querySelector('[data-dmap] .dmap-readout').textContent };
      tr.dispatchEvent(new FocusEvent('blur'));
      return o;
    }));
    const agree = (r, read) => { const m = /: (\d+) samples.*mean ([\d,.]+) TPM/.exec(read);
      return !!m && `n=${m[1]}` === r.n && Math.abs(+m[2].replace(/,/g, '') - r.mean) <= Math.max(0.011, 0.002 * r.mean); };
    rows.forEach((r, i) => {
      refRows++;
      if (!agree(r, r.read)) bad.push(`${gid} reference row ${r.t}: ${r.n}, mean ${r.mean}; readout "${r.read.slice(0, 120)}"`);
      if (!agree(r, rows[(i + 1) % rows.length].read)) refControl = true;
    });
    if (rows.length !== 9) bad.push(`${gid}: ${rows.length} linked reference rows, expected 9`);
  }
  if (!refControl) bad.push('reference rows: positive control did not disagree');
  await dp.goto(`${base}/#/gene/PtXaTreH.05G120200`, { waitUntil: 'networkidle' });
  await dp.waitForSelector('[data-dmap]', { timeout: 15000 });
  await dp.click('[data-card=expression] button:has-text("Show all 652 samples")');
  await dp.waitForSelector('#expr-profile tbody tr[data-ids]');
  await dp.click('#expr-profile button:has-text("By sample")');
  const lit = await dp.evaluate(() => {
    const c = [...document.querySelectorAll('[data-card=expression] .dmap-cell')].find((x) => +x.textContent > 3);
    c.click();
    return { want: +c.textContent, ticks: document.querySelectorAll('#expr-profile .dmap-tick[data-hot="all"]').length };
  });
  profileOk = lit.want > 0 && lit.ticks === lit.want;
  if (!profileOk) bad.push(`gene page: a ${lit.want}-sample cell lit ${lit.ticks} profile samples`);
  const ok = !bad.length && controlDisagrees && profileOk && !derrs.length;
  if (!ok) failures++;
  console.log(`\n### expression:design-map-agrees  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${nrows} pair-page tissue rows and ${refRows} reference-panel rows matched against the grid readout; positive control disagrees: ${controlDisagrees}; `
    + `gene-page cell lights its samples in the profile: ${profileOk}`);
  [...bad, ...derrs].forEach((e) => console.log('   !! ' + e));
  await dp.close();
}

// Study design drawings. (1) Every study draws each of its samples exactly once; a planted
// duplicate dot must be caught. (2) Every comparison lights exactly its own groups, whole.
// (3) With a gene, each group's values agree with the gene page's own per-condition table.
{
  const sp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const serrs = [];
  sp.on('pageerror', (e) => serrs.push(e.message));
  const bad = [];
  await sp.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  const studies = await sp.evaluate(async () => Object.keys(await (await fetch('data/expr/studies.json')).json()));
  const drawnOnce = () => {
    const ids = [...document.querySelectorAll('[data-card=study-design] [data-study-design] [data-i]')].map((n) => +n.dataset.i);
    const n = +((document.querySelector('[data-card=study-design] .sd-lede') || {}).textContent || '').match(/^([\d,]+) samples/)[1].replace(/,/g, '');
    const rows = document.querySelectorAll('tbody tr[data-i]').length;
    return { ok: ids.length === n && new Set(ids).size === n && rows === n, ids: ids.length, n, rows };
  };
  let nContrasts = 0;
  for (const sid of studies) {
    await sp.goto(`${base}/#/study/${sid}`, { waitUntil: 'networkidle' });
    await sp.waitForSelector('[data-study-design]', { timeout: 15000 });
    const r = await sp.evaluate(drawnOnce);
    if (!r.ok) bad.push(`study ${sid}: ${r.ids} dots, ${r.rows} sample rows, ${r.n} samples`);
    const cbad = await sp.evaluate(() => {
      const out = [];
      document.querySelectorAll('.sd-contrasts tbody tr').forEach((tr, j) => {
        tr.focus();
        const want = new Set(tr.dataset.ids.split(',').map(Number));
        const got = [...document.querySelectorAll('[data-card=study-design] .sd-cell[data-hot="all"]')].flatMap((c) => c.dataset.ids.split(',').map(Number));
        const part = document.querySelectorAll('[data-card=study-design] .sd-cell[data-hot="part"]').length;
        const ctrl = document.querySelectorAll('[data-card=study-design] .sd-cell[data-role="ctrl"]').length;
        if (part || got.length !== want.size || !got.every((i) => want.has(i)) || !ctrl) out.push(`row ${j + 1}`);
        tr.blur();
      });
      return { out, n: document.querySelectorAll('.sd-contrasts tbody tr').length };
    });
    nContrasts += cbad.n;
    if (cbad.out.length) bad.push(`study ${sid} comparisons not drawn as two whole groups: ${cbad.out.join(', ')}`);
  }
  // Positive control for (1): duplicate one dot and the same test must fail.
  const control = await sp.evaluate((fn) => {
    const dot = document.querySelector('[data-card=study-design] [data-study-design] [data-i]');
    dot.parentNode.append(dot.cloneNode());
    return (0, eval)(`(${fn})`)().ok;
  }, drawnOnce.toString());
  // (3) gene values: study 12 against the gene page's By condition rows for study 12.
  const gid = 'PtXaTreH.05G194600';
  await sp.goto(`${base}/#/study/12?gene=${gid}`, { waitUntil: 'networkidle' });
  await sp.waitForSelector('.sd-gene');
  const onStudy = await sp.evaluate(() => [...document.querySelectorAll('[data-card=study-design] .sd-cell')].map((c) => {
    const v = [...c.querySelectorAll('circle[data-v]')].map((t) => +t.dataset.v);
    return `${v.length}:${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}`;
  }).sort());
  await sp.goto(`${base}/#/gene/${gid}`, { waitUntil: 'networkidle' });
  await sp.click('[data-card=expression] button:has-text("Show all 652 samples")');
  await sp.waitForSelector('#expr-profile tbody tr');
  const onGene = await sp.evaluate(() => [...document.querySelectorAll('#expr-profile tbody tr')]
    .filter((tr) => tr.cells[0].textContent.trim() === '12')
    .map((tr) => `${tr.cells[4].textContent.trim()}:${tr.cells[5].textContent.trim()}`).sort());
  const valuesAgree = onStudy.length > 0 && JSON.stringify(onStudy) === JSON.stringify(onGene);
  if (!valuesAgree) bad.push(`study 12 with ${gid}: study page ${onStudy.join(' ')} | gene page ${onGene.join(' ')}`);
  const ok = !bad.length && control === false && !serrs.length;
  if (!ok) failures++;
  console.log(`\n### study:design-drawings  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${studies.length} studies drawn, ${nContrasts} comparisons checked; planted duplicate caught: ${control === false}; `
    + `gene values agree with the gene page: ${valuesAgree} (${onStudy.length} groups)`);
  [...bad, ...serrs].forEach((e) => console.log('   !! ' + e));
  await sp.close();
}

// Study design layout and highlight hygiene.
// (1) No label in a design drawing overlaps another, sits outside its drawing, or widens the
//     page, at six widths, with web fonts and once without (fonts change text width). A planted
//     overlapping label must be caught.
// (2) Nothing stays lit after the mouse leaves a group or a dot, and a dot names its own sample.
{
  const scan = () => {
    const out = [];
    for (const panel of document.querySelectorAll('[data-card=study-design] .sd-panel')) {
      const els = [...panel.querySelectorAll('.sd-col, .sd-row, .sd-tlab, .sd-bandlabels b, .sd-ptitle')]
        .filter((n) => n.textContent.trim() && n.getClientRects().length);
      const r = els.map((n) => n.getBoundingClientRect());
      for (let a = 0; a < r.length; a++) {
        for (let b = a + 1; b < r.length; b++) {
          const ov = Math.min(r[a].right, r[b].right) - Math.max(r[a].left, r[b].left);
          const oh = Math.min(r[a].bottom, r[b].bottom) - Math.max(r[a].top, r[b].top);
          if (ov > 1 && oh > 1) out.push(`"${els[a].textContent.trim()}" overlaps "${els[b].textContent.trim()}"`);
        }
      }
      for (const n of panel.querySelectorAll('.sd-n, .sd-tlab, .sd-col')) {
        if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== 'visible') out.push(`"${n.textContent.trim()}" is clipped`);
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide at ${innerWidth}px`);
    return out;
  };
  const lerrs = [];
  const fresh = async (w) => {   // a new tab per width: one tab through 56 loads can run out of memory
    const t = await browser.newPage({ viewport: { width: w, height: 900 } });
    t.on('pageerror', (e) => lerrs.push(e.message));
    return t;
  };
  let lp = null;
  const bad = [];
  let pages = 0;
  const routes = ['/study/1', '/study/12', '/study/16', '/study/17', '/study/27', '/study/31',
    '/study/12?gene=PtXaTreH.05G194600', '/study/17?gene=PtXaTreH.05G194600'];
  for (const [w, fonts] of [[320, true], [390, true], [768, true], [1024, true], [1280, true], [1600, true], [390, false]]) {
    if (lp) await lp.close();
    lp = await fresh(w);
    if (!fonts) await lp.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    for (const r of routes) {
      await lp.goto(`${base}/#${r}`, { waitUntil: 'networkidle' });
      await lp.waitForSelector('[data-card=study-design] .sd-panel', { timeout: 15000 });
      pages++;
      (await lp.evaluate(scan)).forEach((m) => bad.push(`${r} at ${w}px${fonts ? '' : ' without web fonts'}: ${m}`));
    }
    if (!fonts) await lp.unroute(/fonts\.(googleapis|gstatic)\.com/);
  }
  const sees = (await lp.evaluate((fn) => {
    const a = document.querySelector('[data-card=study-design] .sd-row');
    const b = a.cloneNode(true);
    b.style.position = 'absolute'; b.style.left = a.offsetLeft + 'px'; b.style.top = a.offsetTop + 'px';
    a.parentNode.append(b);
    return (0, eval)(`(${fn})`)().length;
  }, scan.toString())) > 0;
  // (2) highlight hygiene, with a real mouse.
  await lp.close();
  lp = await fresh(1280);
  await lp.goto(`${base}/#/study/12?gene=PtXaTreH.05G194600`, { waitUntil: 'networkidle' });
  await lp.waitForSelector('[data-card=study-design] .sd-dot');
  const lit = () => lp.evaluate(() => ({
    hot: document.querySelectorAll('[data-card=study-design] [data-hot="all"], [data-card=study-design] [data-hot="part"], tr[data-hot="all"]').length,
    read: document.querySelector('[data-card=study-design] .dmap-readout').textContent }));
  const cell = await lp.$('[data-card=study-design] .sd-cell');
  const cb = await cell.boundingBox();
  await lp.mouse.move(cb.x + 4, cb.y + 4);
  const onCell = await lit();
  const dot = await lp.$('[data-card=study-design] .sd-dot');
  const db = await dot.boundingBox();
  await lp.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  const onDot = await lit();
  await lp.mouse.move(2, 2);
  const after = await lit();
  const dotNames = /^\S+.*: .*(TPM)\.$/.test(onDot.read) && onDot.read !== onCell.read;
  const clears = after.hot === 0 && /^Each dot is one sample/.test(after.read);
  if (!(onCell.hot > 0)) bad.push('hovering a group lit nothing');
  if (!dotNames) bad.push(`hovering a dot did not name its sample: "${onDot.read.slice(0, 120)}"`);
  if (!clears) bad.push(`after the mouse left, ${after.hot} marks stayed lit; readout "${after.read.slice(0, 80)}"`);
  const ok = !bad.length && sees && !lerrs.length;
  if (!ok) failures++;
  console.log(`\n### study:design-layout  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${pages} page renders at 6 widths (one pass without web fonts); planted overlap caught: ${sees}; `
    + `dot names its sample: ${dotNames}; nothing lit after leaving: ${clears}`);
  [...bad.slice(0, 20), ...lerrs].forEach((e) => console.log('   !! ' + e));
  await lp.close();
}

// Gene-age cross-checks (ps.xc). One gene per outcome, a HAP2 gene, an excluded candidate and a
// non-candidate; then Browse's counts per outcome against the manifest, with a planted flip of
// one facet row that the same comparison must catch.
await check('gene-xc-agree', '#/gene/PtXaTreH.01G001500',
  { expect: ['Other gene-age methods agree', 'none of the 6 independent checks', 'do not change its call'], forbid: ['disagree'] });
await check('gene-xc-sensitive', '#/gene/PtXaTreH.01G018800',
  { expect: ['search-sensitive', 'MMseqs2', 'upper bound'], forbid: ['Other methods disagree'] });
await check('gene-xc-disagree', '#/gene/PtXaTreH.10G204200',
  { expect: ['Other methods disagree', 'Pfam', 'Foldseek', 'do not change its call', 'yes, in the final set'] });
await check('gene-xc-hap2', '#/gene/PtXaAlbH.01G053900',
  { expect: ['search-sensitive', 'run on HAP1 only'] });
await check('gene-xc-excluded', '#/gene/PtXaTreH.05G032500',
  { expect: ['candidate, excluded from the final set', 'Other methods disagree'] });
await check('gene-xc-absent', '#/gene/PtXaTreH.01G000300',
  { forbid: ['gene-age methods', 'Other methods'] });
{
  const xp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const xerrs = [];
  xp.on('pageerror', (e) => xerrs.push(e.message));
  await xp.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  const man = await xp.evaluate(async () => (await (await fetch('data/meta/manifest.json')).json()).gene_age_crosscheck);
  const bad = [];
  const counts = {};
  for (const h of ['hap1', 'hap2']) {
    for (const o of ['agree', 'search_sensitive', 'disagree']) {
      await xp.goto(`${base}/#/browse?hap=${h}&lsg=final_set&xage=${o}`, { waitUntil: 'networkidle' });
      await xp.waitForSelector('.bz-count', { timeout: 15000 });
      await xp.waitForTimeout(400);
      const n = +(await xp.$eval('.bz-count', (e) => e.textContent)).match(/^([\d,]+)/)[1].replace(/,/g, '');
      counts[`${h}/${o}`] = n;
      const want = man.per_set.final[h.toUpperCase()][o];
      if (n !== want) bad.push(`${h} ${o}: Browse ${n}, manifest ${want}`);
    }
    const sum = ['agree', 'search_sensitive', 'disagree'].reduce((a, o) => a + counts[`${h}/${o}`], 0);
    if (sum !== { hap1: 583, hap2: 621 }[h]) bad.push(`${h}: outcomes sum to ${sum}`);
  }
  // planted control: serve the page a facet index with one final-set HAP1 row flipped from agree
  // to disagree; the same Browse-versus-manifest comparison must now fail.
  const cp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await cp.route('**/data/index/facets.json*', async (route) => {
    const res = await route.fetch();
    const f = await res.json();
    const c = Object.fromEntries(f.cols.map((n, i) => [n, i]));
    const k = f.rows.findIndex((r) => r[c.lsg] === 1 && r[c.hap] === 0 && r[c.xa] === 0);
    f.rows[k][c.xa] = 2;
    await route.fulfill({ response: res, body: JSON.stringify(f) });
  });
  await cp.goto(`${base}/#/browse?hap=hap1&lsg=final_set&xage=disagree`, { waitUntil: 'networkidle' });
  await cp.waitForSelector('.bz-count', { timeout: 15000 });
  await cp.waitForTimeout(400);
  const planted = +(await cp.$eval('.bz-count', (e) => e.textContent)).match(/^([\d,]+)/)[1].replace(/,/g, '');
  const sees = planted !== man.per_set.final.HAP1.disagree;
  await cp.close();
  const ok = !bad.length && sees && !xerrs.length;
  if (!ok) failures++;
  console.log(`\n### browse:xage-counts  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${JSON.stringify(counts)}; a planted flipped row is caught: ${sees}`);
  [...bad, ...xerrs].forEach((e) => console.log('   !! ' + e));
  await xp.close();
}

// Tandem cross-checks (dup.xt): one gene per outcome on the Duplication card, and Browse's counts
// against the manifest with a planted flipped facet row the comparison must catch.
for (const [name, gid, want] of [
  ['all-three', 'PtXaTreH.01G000400', 'All three published tandem-duplication tools also call it tandem'],
  ['some', 'PtXaTreH.01G000300', 'Two of three published tools call it tandem'],
  ['nearby', 'PtXaTreH.01G004300', 'a nearby copy (proximal'],
  ['none', 'PtXaTreH.01G005600', 'None of three published tandem tools'],
  ['tools-only', 'PtXaTreH.01G017400', 'the dissertation’s curated tandem set does not include it']]) {
  const tp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await tp.goto(`${base}/#/gene/${gid}`, { waitUntil: 'networkidle' });
  await tp.waitForTimeout(800);
  const t = await tp.evaluate(() => { const dt = [...document.querySelectorAll('[data-card=duplication] dt')].find((d) => d.textContent === 'Published tools');
    return dt ? dt.nextElementSibling.textContent : ''; });
  const ok = t.includes(want) && t.includes('not part of the dissertation’s call');
  if (!ok) failures++;
  console.log(`\n### gene-xt-${name}  ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) console.log(`   !! ${gid}: "${t.slice(0, 160)}"`);
  await tp.close();
}
{
  const xp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await xp.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  const man = await xp.evaluate(async () => (await (await fetch('data/meta/manifest.json')).json()).dup_crosscheck);
  const OUT = ['all_three', 'some', 'nearby_copy_only', 'none', 'tools_only'];
  const bad = [], counts = {};
  const countOf = async (page, h, o) => {
    await page.goto(`${base}/#/browse?hap=${h}&xtandem=${o}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.bz-count', { timeout: 15000 });
    await page.waitForTimeout(400);
    return +(await page.$eval('.bz-count', (e) => e.textContent)).match(/^([\d,]+)/)[1].replace(/,/g, '');
  };
  for (const h of ['hap1', 'hap2']) {
    for (const o of OUT) {
      const n = await countOf(xp, h, o);
      counts[`${h}/${o}`] = n;
      if (n !== man.per_haplotype[o][h.toUpperCase()]) bad.push(`${h} ${o}: Browse ${n}, manifest ${man.per_haplotype[o][h.toUpperCase()]}`);
    }
  }
  const cp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await cp.route('**/data/index/facets.json*', async (route) => {
    const res = await route.fetch();
    const f = await res.json();
    const c = Object.fromEntries(f.cols.map((n, i) => [n, i]));
    const k = f.rows.findIndex((r) => r[c.hap] === 0 && r[c.xt] === 0);
    f.rows[k][c.xt] = 4;
    await route.fulfill({ response: res, body: JSON.stringify(f) });
  });
  const sees = (await countOf(cp, 'hap1', 'tools_only')) !== man.per_haplotype.tools_only.HAP1;
  await cp.close();
  const ok = !bad.length && sees;
  if (!ok) failures++;
  console.log(`\n### browse:xtandem-counts  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${JSON.stringify(counts)}; a planted flipped row is caught: ${sees}`);
  bad.forEach((e) => console.log('   !! ' + e));
  await xp.close();
}

// A null handed to the browser's own append() is printed as the word "null". These two genes
// reach their allele through a tandem array, the path that did it. Planted control as below.
{
  const np = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  // No leading \b ("3 morenull"); "is undefined" is prose ("ω is undefined when Ks is 0"), so 05G120200 carries
  // that sentence and must pass.
  const LEAK = /null\b|(?<!is )undefined\b|\bNaN\b|\[object Object\]/;
  const hits = [];
  for (const gid of ['PtXaTreH.01G009600', 'PtXaTreH.10G046700', 'PtXaTreH.08G070200', 'PtXaTreH.05G120200']) {
    await np.goto(`${base}/#/gene/${gid}`, { waitUntil: 'networkidle' });
    await np.waitForTimeout(1500);
    const t = await np.evaluate(() => document.querySelector('#view').innerText);
    const m = LEAK.exec(t);
    if (m) hits.push(`${gid}: "${t.slice(Math.max(0, m.index - 50), m.index + 20).replace(/\n/g, ' ')}"`);
  }
  const sees = LEAK.test(await np.evaluate(() => { const s = document.createElement('span'); s.append('3 more', null); return s.textContent; }));
  const ok = !hits.length && sees;
  if (!ok) failures++;
  console.log(`\n### genepage:no-leaked-null  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   4 gene pages scanned; positive control detected: ${sees}`);
  hits.forEach((h) => console.log('   !! ' + h));
  await np.close();
}

// No internal version or project names in page text (Chen, 2026-10-03): provenance belongs in
// the changelog, the citation file and build metadata. A planted positive control proves the
// scan can see a hit before its silence is trusted. Also retired labels: a tandem array with no
// syntelog for any member is hemizygous, never PAV (Chen, 2026-10-05).
{
  const INTERNAL = /(?:^|[^A-Za-z0-9])v(?:[5-9]|1[0-2])(?![0-9.])|\bmaster v?\d|\bmaster (?:duplication )?table\b|\bCJ\b|\bcj_[a-z]|\b\d{2,3}_[a-z][a-z0-9]*_[a-z0-9_]+|ms1-dup|ms2-lsg|\bMS[12]\b|\broute C\b|FACTS_|Sapelo|\bChen\b|TODO \d|\/scratch\/|TD-associated PAV|PAV \(whole array\)|Chapters? [23]\b|dissertation chapter/i;
  const routes = ['/', '/browse', '/arrays', '/array/HAP1_U00120', '/pair/PtXaTreH.05G120200', '/map/hap1/Chr01',
    '/karyotype', '/status', '/module/about', '/module/duplication', '/module/phylostrat', '/glossary', '/downloads', '/changes',
    '/gene/PtXaTreH.08G070200', '/gene/PtXaAlbH.18G016900', '/gene/PtXaTreH.19G087400',
    '/gene/PtXaAlbH.05G122300', '/gene/PtXaTreH.10G046700', '/gene/PtXaTreH.01G006100', '/family/PtXaTreH.08G070200',
    // (study pages are not scanned: their sample tables print the studies' own sample labels,
    // such as 17_apical_bud_spring_a_rep1, which match the folder-name pattern by shape)
    '/gene/PtXaTreH.10G204200', '/gene/PtXaAlbH.01G053900', '/gene/PtXaTreH.01G018800'];
  const ip = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const hits = [];
  for (const r of routes) {
    await ip.goto(`${base}/#${r}`, { waitUntil: 'networkidle' });
    await ip.waitForTimeout(1500);
    const t = await ip.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => { d.open = true; });
      document.querySelectorAll('[hidden]').forEach((d) => d.removeAttribute('hidden'));
      return document.body.innerText;
    });
    // The contact address is published on purpose (About, 2026-10-13); nothing else may name a person.
    // Likewise the names of the downloadable tables (717_genes.csv ...), which begin with the clone's
    // number and would otherwise read as an analysis-folder name.
    const m = INTERNAL.exec(t.replace(/Chen\.Hsieh@uga\.edu/g, '<contact>').replace(/\b717_[A-Za-z_]+\.csv\b/g, '<table>'));
    if (m) hits.push(`${r}: "${t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, ' ')}"`);
  }
  const control = await ip.evaluate(() => { const p = document.createElement('p'); p.textContent = 'held on master v9'; document.body.append(p); return document.body.innerText; });
  const sees = INTERNAL.test(control);
  const ok = !hits.length && sees;
  if (!ok) failures++;
  console.log(`\n### wording:no-internal-names  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${routes.length} pages scanned; positive control detected: ${sees}`);
  hits.forEach((h) => console.log('   !! ' + h));
  await ip.close();
}

// One locus browser everywhere (core/locusbrowser.js): the gene, array and pair pages embed the
// genome map's own two-haplotype view. What must hold on each: it paints, it highlights the
// page's genes, and the links it draws are classified -- the focus genes' own alleles are
// counted separately from the alignment anchors and from every other allele pair in view.
// HAP1_U00120: all 3 members have an allele, 2 of them in HAP2_U02345, which must be named as
// the matching array. HAP1_U00361 (hemizygous, no syntelog): no member has an allele, so every emphasised link is an
// anchor and the page must say nothing on HAP2 is this array's allele.
{
  const cases = [
    ['gene', '#/gene/PtXaTreH.05G120200', '[data-card="mirror"]', (d) => +d.linksFocus === 1],
    ['pair', '#/pair/PtXaTreH.05G120200', '[data-pair-locus]', (d) => +d.linksFocus === 1],
    ['array-linked', '#/array/HAP1_U00120', '[data-arr-locus]', (d) => +d.linksFocus === 3],
    ['array-anchored', '#/array/HAP1_U00361', '[data-arr-locus]', (d) => +d.linksFocus === 0 && +d.linksAnchor > 0 && +d.linksAnchor <= 4],
  ];
  for (const [label, route, host, linksOk] of cases) {
    const lp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
    const lerrs = [];
    lp.on('pageerror', (e) => lerrs.push(e.message));
    lp.on('console', (m) => { if (m.type() === 'error') lerrs.push('console: ' + m.text()); });
    await lp.goto(base + '/' + route, { waitUntil: 'networkidle' });
    await lp.waitForSelector(`${host} [data-locus-browser="embed"][data-tiles="ready"]`, { timeout: 15000 })
      .catch(() => lerrs.push('no browser'));
    await lp.waitForTimeout(500);
    const r = await lp.evaluate((h) => {
      const st = document.querySelector(`${h} [data-locus-browser="embed"]`);
      if (!st) return { missing: true };
      const cv = st.querySelector('canvas');
      const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const seen = new Set();
      for (let i = 0; i < px.length; i += 4 * 97) seen.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
      const linked = document.querySelector('[data-arr-linked]');
      return { d: { ...st.dataset }, colours: seen.size,
        matching: [...document.querySelectorAll('[data-arr-linked-array]')].map((n) => n.dataset.arrLinkedArray),
        linkedText: linked ? linked.innerText : '' };
    }, host);
    let extra = true;
    if (label === 'array-linked') extra = r.matching && r.matching[0] === 'HAP2_U02345';
    if (label === 'array-anchored') extra = /Hemizygous \(no syntelog\)/.test(r.linkedText || '') && /No member has its own allele/.test(r.linkedText || '');
    const ok = !r.missing && r.colours > 5 && linksOk(r.d || {}) && extra && !lerrs.length;
    if (!ok) failures++;
    console.log(`\n### locus-browser:${label}  ${ok ? 'OK' : 'FAIL'}`);
    console.log(`   colours=${r.colours} links focus/anchor/other=${r.d?.linksFocus}/${r.d?.linksAnchor}/${r.d?.linksOther} `
      + `matching=${(r.matching || []).join(',')}`);
    lerrs.forEach((e) => console.log('   !! ' + e));
    await lp.screenshot({ path: `${outdir}/locus-browser-${label}.png` });
    await lp.close();
  }
}

// The Duplication card and the Duplication layers figure named EXACTLY the same partners --
// every gene the card listed, the figure drew, in position -- so the page ran a 645px picture
// and a 1422px table of the same thing. They are now one card with a view switch.
//
// The failure this guards is specific: the layers figure sizes an SVG from its container, and
// a panel that is display:none has zero width. So the layers view must be the one rendered
// visible, and -- the nastier case -- the figure must still come back at full width after the
// WINDOW IS RESIZED WHILE IT IS HIDDEN, which is when a measure-once implementation collapses.
{
  const vp = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  const verrs = [];
  vp.on('pageerror', (e) => verrs.push(e.message));
  vp.on('console', (m) => { if (m.type() === 'error') verrs.push('console: ' + m.text()); });
  await vp.goto(base + '/#/gene/PtXaTreH.19G110500', { waitUntil: 'networkidle' });
  await vp.waitForTimeout(2600);

  const read = () => vp.evaluate(() => {
    const host = document.querySelector('.card.viewgroup');
    if (!host) return { missing: true };
    const svg = host.querySelector('.viewpanel[data-view="layers"] svg');
    return {
      title: (host.querySelector('h2')?.childNodes[0]?.textContent || '').trim(),
      tag: host.querySelector('h2 .tag')?.textContent || '',
      tabs: [...host.querySelectorAll('.viewtab')].map((t) => t.textContent),
      onTab: [...host.querySelectorAll('.viewtab')].findIndex((t) => t.classList.contains('on')),
      aria: [...host.querySelectorAll('.viewtab')].map((t) => t.getAttribute('aria-selected')).join(','),
      shown: [...host.querySelectorAll('.viewpanel')]
        .filter((v) => !v.hasAttribute('hidden')).map((v) => v.dataset.view),
      // the collapsed panel must be findable, not display:none -- this is the whole point
      collapsedAttr: [...host.querySelectorAll('.viewpanel')]
        .filter((v) => v.hasAttribute('hidden')).map((v) => v.getAttribute('hidden')),
      svgW: svg ? Math.round(svg.getBoundingClientRect().width) : null,
      ds: (host.textContent.match(/dS\s*[\d.]+/g) || []).length,
      headings: host.querySelectorAll('h2').length,
    };
  });

  const first = await read();
  // switch away, resize while hidden, switch back -- the collapse case
  await vp.click('.viewtab:nth-child(2)');
  await vp.waitForTimeout(500);
  const second = await read();
  await vp.setViewportSize({ width: 760, height: 1000 });
  await vp.waitForTimeout(700);
  await vp.click('.viewtab:nth-child(1)');
  await vp.waitForTimeout(1200);
  const back = await read();

  const ok = !verrs.length && !first.missing
    && first.title === 'Duplication' && first.headings === 1
    && first.tabs.length === 2 && first.onTab === 0
    && first.aria === 'true,false'
    && first.shown.length === 1 && first.shown[0] === 'layers'
    && first.svgW > 600 && first.ds > 0
    // the tag must follow the view, so the card never credits the wrong source
    && second.tag !== first.tag && second.shown[0] === 'details'
    && first.collapsedAttr.every((a) => a === 'until-found')
    // and the figure must survive being resized while hidden
    && back.shown[0] === 'layers' && back.svgW > 400 && back.svgW < 760 && back.ds === first.ds;
  if (!ok) failures++;
  console.log(`\n### genepage:duplication-views-merged  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   "${first.title}" with tabs [${first.tabs.join(' | ')}], one heading: ${first.headings === 1}`);
  console.log(`   layers shown first at ${first.svgW}px with ${first.ds} dS labels; tag "${first.tag}"`);
  console.log(`   tab 2 -> shows ${second.shown[0]}, tag becomes "${second.tag}"`);
  console.log(`   collapsed panel is hidden="${first.collapsedAttr.join(',')}" (findable, not display:none)`);
  console.log(`   resized to 760 while hidden, back to layers -> svg ${back.svgW}px, ${back.ds} dS labels`);
  verrs.forEach((e) => console.log('   !! ' + e));
  await vp.close();
}

// Response by contrast: the distribution behind the Expression card's single `resp.v` number.
// Computed in the browser from the gene's own 652-sample vector and the control/perturbation
// sample indices already shipped in contrasts.json -- nothing new is built for it.
//
// The expected values here were computed INDEPENDENTLY in python straight off the blob and the
// shipped curated contrasts (2026-10-15, after the switch from the v4 191 panel to the
// dissertation's 165), so this is a cross-implementation check, not the panel agreeing with itself. PtXaTreH.19G110500 is a WNK-family kinase and the
// two largest responses in the whole panel are both drought, off a real expression base --
// annotation and measurement agreeing is the reason this gene was chosen for the check.
//
// The n columns are the substance, not decoration: the median contrast here is 3 samples per
// side and 5 of the 165 have a single sample on one side. Those bars must be drawn (hiding
// them would misrepresent the panel), dimmed, and counted in the caveat.
{
  const xp = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  const xerrs = [];
  xp.on('pageerror', (e) => xerrs.push(e.message));
  xp.on('console', (m) => { if (m.type() === 'error') xerrs.push('console: ' + m.text()); });
  await xp.goto(base + '/#/gene/PtXaTreH.19G110500', { waitUntil: 'networkidle' });
  await xp.waitForTimeout(3000);

  await xp.evaluate(() => {
    const pn = document.querySelector('.viewpanel[data-view="contrasts"]');
    const host = pn && pn.closest('.card.viewgroup');
    const i = host ? [...host.querySelectorAll('.viewpanel')].indexOf(pn) : -1;
    if (i >= 0) host.querySelectorAll('.viewtab')[i].click();
  });
  await xp.waitForTimeout(1200);

  const c = await xp.evaluate(() => {
    const pn = document.querySelector('.viewpanel[data-view="contrasts"]');
    if (!pn) return { missing: true };
    const vals = [...pn.querySelectorAll('.lfc-val')].map((v) => v.textContent);
    const ns = [...pn.querySelectorAll('.lfc-n')].map((v) => v.textContent);
    const weak = [...pn.querySelectorAll('.lfc-fill')].map((v) => v.classList.contains('weak'));
    const host = pn.closest('.card.viewgroup');
    return {
      total: (pn.textContent.match(/All (\d+) shipped contrasts/) || [])[1],
      median: pn.querySelector('.kv dd')?.textContent,
      top: vals[0], topN: ns[0], topLabel: pn.querySelector('.lfc-lab')?.textContent,
      second: vals[1],
      nWeak: weak.filter(Boolean).length,
      weakAllLowN: weak.every((w, i) => w === /^1v|v1$/.test(ns[i])),
      caveat: (pn.textContent.match(/(\d+) of these \d+ contrasts have a single sample/) || [])[1],
      resp: pn.querySelector('[data-resp]')?.dataset.resp,
      states: /not a differential-expression test/.test(pn.textContent)
        && /no multiple-testing correction/.test(pn.textContent),
      reverseNotClaimed: !/which genes respond/i.test(pn.textContent),
      tabs: [...host.querySelectorAll('.viewtab')].map((t) => t.textContent),
      heading: host.querySelector('h2')?.childNodes[0]?.textContent.trim(),
    };
  });

  const ok = !xerrs.length && !c.missing
    && c.total === '165' && c.median === '0.629'
    && c.top === '+6.13' && c.topN === '3v3' && /chronic drought/.test(c.topLabel || '')
    && c.second === '+5.86'
    && c.caveat === '5' && c.nWeak === 0 && c.weakAllLowN && c.resp === '0.674'
    && c.states && c.reverseNotClaimed
    && c.heading === 'Expression' && c.tabs.length === 2;
  if (!ok) failures++;
  console.log(`\n### expression:response-by-contrast  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   "${c.heading}" tabs [${(c.tabs || []).join(' | ')}]; scored ${c.total}, median ${c.median}, responsiveness ${c.resp}`);
  console.log(`   top ${c.top} (n=${c.topN}) ${c.topLabel}; second ${c.second}`);
  console.log(`   ${c.caveat} single-sample contrasts; ${c.nWeak} of the drawn bars dimmed, all of them low-n: ${c.weakAllLowN}`);
  console.log(`   states it is not a DE test: ${c.states}; does not claim the reverse question: ${c.reverseNotClaimed}`);
  xerrs.forEach((e) => console.log('   !! ' + e));
  await xp.close();
}

// The 652-sample duplicate heatmap is opt-in and its low-expression filter is OFF by default.
// Driven: the toggle must REMOVE rows and must never remove the focal gene, and the default
// view must show the quiet copies -- the whole point of defaulting it off.
{
  const hp = await browser.newPage({ viewport: { width: 1180, height: 1400 } });
  const herrs = [];
  hp.on('pageerror', (e) => herrs.push(e.message));
  hp.on('console', (m) => { if (m.type() === 'error') herrs.push('console: ' + m.text()); });
  // 11-member array, 6 copies under 1 TPM, plus a salicoid partner and a HAP2 allele.
  await hp.goto(base + '/#/gene/PtXaTreH.03G157300', { waitUntil: 'networkidle' });
  await hp.waitForTimeout(1200);
  await hp.click('button:has-text("Load the heatmap")');
  await hp.waitForTimeout(3500);
  // Every gene card carries data-card = the module that drew it (stamped in app.js). Prefer
  // that to a heading, which moves when cards merge, and to a position, which moves when the
  // running order changes -- both happened this week.
  const card = hp.locator('[data-card="dupheatmap"]').first();
  const hBefore = await card.locator('canvas').evaluate((c) => c.getBoundingClientRect().height);
  const textBefore = (await card.innerText()).toLowerCase();
  const boxChecked = await card.locator('input[type=checkbox]').isChecked();
  await card.locator('input[type=checkbox]').check();
  await hp.waitForTimeout(900);
  const hAfter = await card.locator('canvas').evaluate((c) => c.getBoundingClientRect().height);
  const textAfter = (await card.innerText()).toLowerCase();
  // Row labels and the correlation numbers are PAINTED ON THE CANVAS, so innerText cannot see
  // them -- an earlier version of this check asserted on 'self' and on the gene id and failed
  // for that reason, not because the card was wrong. What the canvas CAN be asked is its
  // height, which is rows x ROW_H + the tissue strip, so the row count is recoverable exactly.
  const ROW_H = 22, CHROME = 4 + 14;   // must track js/modules/dupheatmap.js
  const rowsOf = (h) => Math.round((h - CHROME) / ROW_H);
  const nBefore = rowsOf(hBefore), nAfter = rowsOf(hAfter);
  const ok = !herrs.length
    && boxChecked === false                                   // unfiltered by default
    && nBefore === 13                                         // 11 array members + allele + focal
    && nAfter === nBefore - 6                                 // exactly the 6 quiet rows go,
                                                              // so the focal row (not quiet) stays
    && textBefore.includes('a silent copy is a result, not noise')
    && textBefore.includes('hide copies that never reach 1 tpm')
    && textBefore.includes('log2(tpm + 1)')
    && textAfter.includes('6 of 13 copies never reach');
  if (!ok) failures++;
  console.log(`\n### dupheatmap:filter  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   default unchecked=${boxChecked === false}  rows ${nBefore} -> ${nAfter}`
    + `  (canvas ${hBefore}px -> ${hAfter}px)`);
  herrs.forEach((e) => console.log('   !! ' + e));
  await hp.close();
}

// Search is the one interaction that has no index file behind it -- prove it resolves.
const p = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const serrs = [];
p.on('pageerror', (e) => serrs.push(e.message));
await p.goto(base + '/#/', { waitUntil: 'networkidle' });
await p.fill('#q', 'PtXaTreH.05G1202');
await p.waitForTimeout(900);
const hits = await p.$$eval('#hits a', (as) => as.map((a) => a.textContent.trim()).slice(0, 3));
await p.screenshot({ path: `${outdir}/search.png` });
let searchOk = hits.some((h) => h.includes('PtXaTreH.05G120200')) && !serrs.length;
console.log(`\n### search:id  ${searchOk ? 'OK' : 'FAIL'}\n   hits: ${JSON.stringify(hits)}`);
if (!searchOk) failures++;

for (const [label, q, want] of [['keyword', 'dehydrin', null], ['at-locus', 'AT1G55570', null]]) {
  await p.fill('#q', '');
  await p.fill('#q', q);
  await p.waitForTimeout(1100);
  const h = await p.$$eval('#hits a', (as) => as.map((a) => a.textContent.trim()).slice(0, 3));
  const ok = h.length > 0 && !h[0].startsWith('Nothing matches') && !serrs.length;
  if (!ok) failures++;
  console.log(`### search:${label} "${q}"  ${ok ? 'OK' : 'FAIL'}\n   hits: ${JSON.stringify(h)}`);
}
await p.screenshot({ path: `${outdir}/search-text.png` });

// Promoter card: text-based, so a plain content assertion is enough. Uses the known
// tata_core=True gene so the "canonical TATA box" sentence is exercised, not just the
// "no TATA" branch -- a wrong-branch bug (found once already: an inverted tata_pos
// distance) would otherwise hide behind whichever branch happened to render.
await check('gene-promoter-tata-true', '#/gene/PtXaTreH.01G000900',
  { expect: ['Promoter', 'TATA-box motif', 'core-promoter window', 'bZIP', 'not comparable'] });
await check('gene-promoter-tata-false', '#/gene/PtXaTreH.05G120200',
  { expect: ['Promoter', 'No canonical core-promoter TATA box'] });

// Search results page: a broad query ("kinase") must produce more matches than the
// dropdown shows, land on the results page with the true total, and carry comparison
// columns a dropdown row cannot -- that is the entire point of the page.
{
  const sp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const serrs = [];
  sp.on('pageerror', (e) => serrs.push(e.message));
  sp.on('console', (m) => { if (m.type() === 'error') serrs.push(m.text()); });
  await sp.goto(base + '/', { waitUntil: 'networkidle' });
  await sp.fill('#q', 'kinase');
  await sp.waitForTimeout(1200);
  const seeAll = await sp.$('#hits a:last-child');
  const seeAllText = seeAll ? await seeAll.textContent() : '';
  await sp.goto(base + '/#/search/kinase', { waitUntil: 'networkidle' });
  await sp.waitForTimeout(1000);
  const stext = await viewText(sp);
  const rows = await sp.$$eval('table.compare tbody tr', (trs) => trs.length);
  const ok = /compared side by side/.test(seeAllText) && stext.includes('matches')
    && rows > 20 && stext.includes('page 1 of') && !serrs.length;
  if (!ok) failures++;
  console.log(`
### search-results-refinement  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   dropdown link: "${seeAllText}"  rows shown: ${rows}`);
  serrs.slice(0, 2).forEach((e) => console.log('   ERR ' + e.slice(0, 110)));
  await sp.screenshot({ path: `${outdir}/search-results.png` });
  await sp.close();
}

// The gene page's locus is a canvas, so a text assertion cannot see it. Check that the
// canvas is actually PAINTED (more than one colour sampled), that the DPR backing
// buffer matches, and that a phone viewport neither scrolls horizontally nor
// shrinks a control below the 44px comfort target. Scoped to the mirror card's own browser.
for (const [label, vw, vh, dpr] of [['locus-desktop', 1180, 900, 1], ['locus-phone', 375, 667, 2]]) {
  const lp = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
  const lerrs = [];
  lp.on('pageerror', (e) => lerrs.push(e.message));
  lp.on('console', (m) => { if (m.type() === 'error') lerrs.push(m.text()); });
  await lp.goto(base + '/#/gene/PtXaTreH.05G120200', { waitUntil: 'networkidle' });
  await lp.waitForSelector('[data-card="mirror"] [data-locus-browser][data-tiles="ready"]', { timeout: 15000 }).catch(() => {});
  await lp.waitForTimeout(400);
  const r = await lp.evaluate(() => {
    const host = document.querySelector('[data-card="mirror"]');
    const cv = host && host.querySelector('[data-locus-browser] canvas');
    if (!cv) return { missing: true };
    const box = cv.getBoundingClientRect();
    const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const seen = new Set();
    for (let i = 0; i < px.length; i += 4 * 97) seen.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
    const btns = [...host.querySelectorAll('.map-btn')]
      .map((b) => b.getBoundingClientRect()).map((q) => Math.min(q.width, q.height));
    return {
      colours: seen.size, ratio: +(cv.width / box.width).toFixed(2),
      minBtn: btns.length ? Math.min(...btns) : 0, nBtn: btns.length,
      hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  const ok = !r.missing && r.colours > 3 && r.minBtn >= 44 && r.nBtn === 5
    && !r.hscroll && r.ratio === Math.min(dpr, 2) && !lerrs.length;
  if (!ok) failures++;
  console.log(`\n### ${label}  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   colours=${r.colours} dprRatio=${r.ratio} minBtn=${r.minBtn}px `
    + `buttons=${r.nBtn} h-scroll=${r.hscroll}`);
  lerrs.slice(0, 2).forEach((e) => console.log('   ERR ' + e.slice(0, 110)));
  await lp.screenshot({ path: `${outdir}/${label}.png` });
  await lp.close();
}

// The condition view is the expression module's analytical payoff -- drive it.
{
  const cp = await browser.newPage({ viewport: { width: 1180, height: 1200 } });
  const cerrs = [];
  cp.on('pageerror', (e) => cerrs.push(e.message));
  cp.on('console', (m) => { if (m.type() === 'error') cerrs.push('console: ' + m.text()); });
  await cp.goto(base + '/#/gene/PtXaTreH.05G120200', { waitUntil: 'networkidle' });
  await cp.click('button:has-text("Show all 652 samples")');
  await cp.waitForTimeout(1500);
  const rows = await cp.$$eval('#view tbody tr', (ns) => ns.length);
  const txt = await viewText(cp).then((t) => t.toLowerCase());
  await cp.click('button:has-text("By sample")');
  await cp.waitForTimeout(700);
  const sampleView = await viewText(cp).then((t) => t.toLowerCase());
  const ok = rows > 150 && txt.includes('conditions across') && txt.includes('mean tpm')
    && sampleView.includes('every sample') && !cerrs.length;
  if (!ok) failures++;
  console.log(`\n### expression:conditions  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   condition rows=${rows}  sample-view toggle=${sampleView.includes('every sample')}`);
  cerrs.forEach((e) => console.log('   !! ' + e));
  await cp.close();
}

// ComBat-seq (TODO 18) is opt-in per gene: the toggle must appear on an eligible gene and
// switch the rendered numbers, and must be ABSENT on an ineligible one -- offering it with
// nothing behind it would be worse than not offering it at all.
{
  const gp = await browser.newPage({ viewport: { width: 1180, height: 1200 } });
  const gerrs = [];
  gp.on('pageerror', (e) => gerrs.push(e.message));
  gp.on('console', (m) => { if (m.type() === 'error') gerrs.push('console: ' + m.text()); });
  await gp.goto(base + '/#/gene/PtXaTreH.05G120200', { waitUntil: 'networkidle' }); // has x.cb
  await gp.click('button:has-text("Show all 652 samples")');
  await gp.waitForTimeout(1200);
  const rawFirstRow = await gp.$eval('#expr-profile tbody tr', (n) => n.innerText);
  await gp.click('button:has-text("ComBat-corrected")');
  await gp.waitForTimeout(900);
  const cbFirstRow = await gp.$eval('#expr-profile tbody tr', (n) => n.innerText);
  const cbText = await viewText(gp).then((t) => t.toLowerCase());
  const eligibleOk = cbText.includes('cross-study') && rawFirstRow !== cbFirstRow && !gerrs.length;
  if (!eligibleOk) failures++;
  console.log(`
### combat:eligible  ${eligibleOk ? 'OK' : 'FAIL'}`);
  console.log(`   raw row="${rawFirstRow.replace(/\n/g, ' ')}"`);
  console.log(`   combat row="${cbFirstRow.replace(/\n/g, ' ')}"`);
  gerrs.forEach((e) => console.log('   !! ' + e));
  await gp.close();

  const ip = await browser.newPage({ viewport: { width: 1180, height: 1200 } });
  await ip.goto(base + '/#/gene/PtXaTreH.T000100', { waitUntil: 'networkidle' }); // no x.cb
  await ip.click('button:has-text("Show all 652 samples")');
  await ip.waitForTimeout(900);
  const hasToggle = (await ip.$('button:has-text("ComBat-corrected")')) !== null;
  const ineligibleOk = !hasToggle;
  if (!ineligibleOk) failures++;
  console.log(`### combat:ineligible  ${ineligibleOk ? 'OK' : 'FAIL'}  (toggle present: ${hasToggle})`);
  await ip.close();
}

// The cross-module query is the whole point of browse -- drive it, don't just render it.
{
  const bp = await browser.newPage({ viewport: { width: 1180, height: 1200 } });
  const berrs = [];
  bp.on('pageerror', (e) => berrs.push(e.message));
  bp.on('console', (m) => { if (m.type() === 'error') berrs.push('console: ' + m.text()); });
  await bp.goto(base + '/#/browse', { waitUntil: 'networkidle' });
  await bp.waitForTimeout(1500);
  const readCount = () => bp.$eval('.stat .n', (n) => n.textContent.trim());
  const all = await readCount();
  await bp.selectOption('label[data-filter="cls"] select', 'private_no_ortholog');   // synteny class, found by name not position
  await bp.waitForTimeout(400);
  const priv = await readCount();
  await bp.fill('label[data-filter="ps_min"] input', '18');   // phylostratum >= 18
  await bp.waitForTimeout(500);
  const privLsg = await readCount();
  await bp.screenshot({ path: `${outdir}/browse-query.png`, fullPage: true });
  const n = (s) => parseInt(s.replace(/,/g, ''), 10);
  const ok = n(all) === 63960 && n(priv) > 0 && n(priv) < n(all)
    && n(privLsg) > 0 && n(privLsg) < n(priv) && !berrs.length;
  if (!ok) failures++;
  console.log(`\n### browse:query  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   all=${all}  private=${priv}  private+PS>=18=${privLsg}`);
  berrs.forEach((e) => console.log('   !! ' + e));
  await bp.close();
}
serrs.forEach((e) => console.log('   !! ' + e));
await p.close();

// Genome map (section 2.4): the overview renders and is clickable through to a
// chromosome, and the chromosome view is clickable through to a real gene page --
// driven end to end, not just rendered, since the whole point is the click-through.
await check('map-overview', '#/map',
  { expect: ['Genome map', 'Colour by', 'Click a chromosome to zoom in'], wait: 900 });
await check('map-hap2', '#/map/hap2',
  { expect: ['Genome map', 'HAP2 (AlbH)'], wait: 900 });
{
  const mp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const merrs = [];
  mp.on('pageerror', (e) => merrs.push(e.message));
  mp.on('console', (m) => { if (m.type() === 'error') merrs.push(m.text()); });
  await mp.goto(base + '/#/map/hap1/Chr19', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(900);
  const chrText = await viewText(mp);
  // "genes" and "Mb" are drawn INSIDE the canvas (like the locus card's own captions),
  // invisible to innerText -- only assert on real DOM text here.
  const hasChr = chrText.includes('Chr19') && chrText.includes('HAP1 (TreH)')
    && chrText.includes('← genome');
  // Click the gene the view itself reports at data-probe-x/y (changed 2026-09-29 from a fixed
  // position: the chromosome view became a multi-track browser and its layout moved).
  const probe = await mp.$eval('[data-map-view="chromosome"] .map-stage',
    (s) => ({ x: +s.dataset.probeX, y: +s.dataset.probeY }));
  await mp.click('[data-map-view="chromosome"] .map-canvas', { position: probe });
  await mp.waitForTimeout(900);
  const afterClick = mp.url();
  const navigated = /#\/(gene\/PtXaTreH\.19|map\/hap1$)/.test(afterClick);
  const ok = hasChr && navigated && !merrs.length;
  if (!ok) failures++;
  console.log(`\n### map:chromosome-drilldown  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   chromosome view rendered: ${hasChr}   url after click: ${afterClick}`);
  merrs.forEach((e) => console.log('   !! ' + e));
  await mp.close();
}

// Genome map track browser (2026-09-29): renders both haplotypes with a legend that
// states n; a driven zoom narrows the window (positive control: the whole-chromosome gene
// count must be LARGER than the zoomed count, and the URL must carry start/end); at gene
// level the probed gene opens its page; a shared ?start=&end= URL restores that window;
// and at 390 px the page does not scroll sideways and every map button is >= 44 px.
{
  const mp = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  mp.on('pageerror', (e) => errs.push(e.message));
  mp.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  // Chr08 has a gene-free stretch near its middle, so zoom from a window that starts gene-rich.
  await mp.goto(base + '/#/map/hap1/Chr08', { waitUntil: 'networkidle' });
  await mp.waitForSelector('[data-map-view="chromosome"] .map-stage[data-tiles="ready"]', { timeout: 15000 });
  await mp.waitForTimeout(300);
  const t0 = await viewText(mp);
  const rendered = ['HAP1 (TreH)', 'HAP2 (AlbH)', 'Duplication', 'Synteny', 'LSG pool', 'allele links drawn']
    .every((x) => t0.includes(x));
  const nWhole = await mp.$eval('.map-stage', (s) => +s.dataset.genesInView);
  const linksWhole = +(t0.match(/(\d+) allele links drawn/) || [0, 0])[1];
  for (let i = 0; i < 3; i++) { await mp.click('[data-map-zoom="in"]'); await mp.waitForTimeout(60); }
  for (let i = 0; i < 3; i++) { await mp.click('[data-map-pan="left"]'); await mp.waitForTimeout(60); }
  for (let i = 0; i < 4; i++) { await mp.click('[data-map-zoom="in"]'); await mp.waitForTimeout(60); }
  await mp.waitForTimeout(300);
  const nZoom = await mp.$eval('.map-stage', (s) => +s.dataset.genesInView);
  const url = mp.url();
  const urlOk = /\?start=\d+&end=\d+/.test(url);
  // brush: drag across part of the tracks with the mouse, the window must shrink again
  const box = await (await mp.$('.map-canvas')).boundingBox();
  await mp.mouse.move(box.x + 300, box.y + 120);
  await mp.mouse.down();
  await mp.mouse.move(box.x + 500, box.y + 120, { steps: 5 });
  await mp.mouse.up();
  await mp.waitForTimeout(300);
  const nBrush = await mp.$eval('.map-stage', (s) => +s.dataset.genesInView);
  // shared URL restores the window
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await p2.goto(url, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(800);
  const nShared = await p2.$eval('.map-stage', (s) => +s.dataset.genesInView);
  await p2.close();
  const probe = await mp.$eval('.map-stage', (s) => ({ x: +s.dataset.probeX, y: +s.dataset.probeY, g: s.dataset.probeGene }));
  await mp.click('.map-canvas', { position: { x: probe.x, y: probe.y } });
  await mp.waitForTimeout(800);
  const opened = mp.url().endsWith('#/gene/' + probe.g);
  const ok = rendered && nWhole > nZoom && nZoom > 0 && nBrush <= nZoom && nBrush > 0 && urlOk
    && nShared === nZoom && linksWhole > 0 && opened && !errs.length;
  if (!ok) failures++;
  console.log(`\n### map:track-browser  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   rendered=${rendered} genes whole=${nWhole} zoomed=${nZoom} brushed=${nBrush} shared=${nShared}`
    + ` links=${linksWhole} urlOk=${urlOk} opened ${probe.g}=${opened}`);
  errs.forEach((e) => console.log('   !! ' + e));
  await mp.close();
}
for (const hash of ['#/map', '#/map/hap2/Chr19?start=1000000&end=1200000']) {
  const pp = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await pp.goto(base + '/' + hash, { waitUntil: 'networkidle' });
  await pp.waitForTimeout(1200);
  const m = await pp.evaluate(() => {
    const btns = [...document.querySelectorAll('.map-btn, .map-metric')];
    const small = btns.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length;
    const cv = document.querySelector('.map-canvas');
    return { fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      nBtns: btns.length, small, canvasW: cv ? cv.getBoundingClientRect().width : 0,
      touch: cv ? getComputedStyle(cv).touchAction : '' };
  });
  const ok = m.fits && m.nBtns > 0 && m.small === 0 && m.canvasW > 200 && m.canvasW <= 390 && m.touch === 'pan-y';
  if (!ok) failures++;
  console.log(`\n### map:phone ${hash}  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${JSON.stringify(m)}`);
  await pp.close();
}

// Phytozome links (fixed 2026-09-08): the previous constant had no genome segment at
// all and 404'd for every gene. Verify actual href values, not just that a link with
// some text exists -- a wrong destination renders identically to a right one.
{
  const lp = await browser.newPage();
  await lp.goto(base + '/#/gene/PtXaTreH.01G000600', { waitUntil: 'networkidle' });
  await lp.waitForTimeout(900);
  const hrefs = await lp.$$eval('a', (as) => as.map((a) => a.href));
  const hap1Report = hrefs.includes('https://phytozome-next.jgi.doe.gov/report/gene/PtremulaxPopulusalbaHAP1_v5_1/PtXaTreH.01G000600');
  const ptriReport = hrefs.some((h) => h.startsWith('https://phytozome-next.jgi.doe.gov/report/gene/Ptrichocarpa_v4_1/Potri.'));
  const browserLink = hrefs.some((h) => h.startsWith('https://phytozome-next.jgi.doe.gov/jbrowse/index.html?')
    && h.includes('data=genomes%2FPtremulaxPopulusalbaHAP1_v5_1') && h.includes('loc=Chr01%3A'));
  await lp.close();

  const lp2 = await browser.newPage();
  await lp2.goto(base + '/#/gene/PtXaAlbH.05G122300', { waitUntil: 'networkidle' });
  await lp2.waitForTimeout(900);
  const hrefs2 = await lp2.$$eval('a', (as) => as.map((a) => a.href));
  const hap2Report = hrefs2.includes('https://phytozome-next.jgi.doe.gov/report/gene/PtremulaxPopulusalbaHAP2_v5_1/PtXaAlbH.05G122300');
  await lp2.close();

  const ok = hap1Report && ptriReport && browserLink && hap2Report;
  if (!ok) failures++;
  console.log(`\n### phytozome-links  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   hap1 report=${hap1Report}  ptri report=${ptriReport}  jbrowse=${browserLink}  hap2 report=${hap2Report}`);
}

// Mirror (plan section 2.2): renders on a gene with a real allele partner, shows both a
// fully-resolved neighbourhood and one with genuine hemizygous gaps (no ribbon), and a
// click on the OTHER haplotype's strip actually navigates there -- driven, not just
// rendered, since the whole point is comparing two independently-coordinated genomes.
await check('mirror-full', '#/gene/PtXaTreH.05G120200',
  { expect: ['This locus on HAP2 too', 'both haplotypes', 'HAP1 (TreH) above',
             'HAP2 (AlbH) below', 'joined by the solid line'], wait: 2500 });
// This gene's neighbourhood runs into a real HAP1-only stretch (verified against pav.confirmed
// directly): the card must say so in its own count, not just render silently.
await check('mirror-hemizygous-gap', '#/gene/PtXaTreH.12G001200',
  { expect: ['This locus on HAP2 too', 'with none'], wait: 2500 });
{
  const mp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const merrs = [];
  mp.on('pageerror', (e) => merrs.push(e.message));
  mp.on('console', (m) => { if (m.type() === 'error') merrs.push(m.text()); });
  await mp.goto(base + '/#/gene/PtXaTreH.05G120200', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(1200);
  const h = await mp.$('h2:has-text("This locus on")');
  await h.scrollIntoViewIfNeeded();
  await mp.waitForTimeout(500);
  // Scoped by the module stamp. This used to index canvases[1] out of a page-wide
  // '.locus-canvas' list, which broke the moment the gene page's running order changed --
  // '.locus-canvas' is a shared style class, not this card's identity -- and then by heading
  // text, which is one merge away from moving too.
  await mp.waitForSelector('[data-card="mirror"] [data-locus-browser][data-tiles="ready"][data-probe-other-x]', { timeout: 15000 }).catch(() => {});
  await mp.waitForTimeout(300);
  const st = await mp.$('[data-card="mirror"] [data-locus-browser]');
  const pr = await st.evaluate((n) => ({ x: +n.dataset.probeOtherX, y: +n.dataset.probeOtherY }));
  const cv = await mp.$('[data-card="mirror"] [data-locus-browser] canvas');
  await cv.scrollIntoViewIfNeeded();
  const cb = await cv.boundingBox();
  if (cb && pr.x > 0) await mp.mouse.click(cb.x + pr.x, cb.y + pr.y);
  else merrs.push(`no lower-haplotype probe (${JSON.stringify(pr)})`);
  await mp.waitForTimeout(700);
  const navigated = /#\/gene\/PtXaAlbH\./.test(mp.url());
  const ok = navigated && !merrs.length;
  if (!ok) failures++;
  console.log(`\n### mirror:cross-haplotype-click  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   url after click: ${mp.url()}`);
  merrs.forEach((e) => console.log('   !! ' + e));
  await mp.close();
}

// Expression scrubber (plan section 2.3): renders, defaults to the focal gene's own top
// tissue, and switching to contrast mode paints and captions correctly even with NO
// manual selection -- a real bug caught during development, where the <select> showed a
// value the browser auto-picks with no 'change' event to hook, while the caption and
// canvas still showed stale tissue-mode content. Checked here so it cannot silently
// return.
await check('scrubber-tissue-default', '#/gene/PtXaTreH.05G120200',
  { expect: ['Expression across the neighborhood', 'By tissue', 'By contrast', 'Median TPM in catkin'], wait: 1200 });
{
  const sp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const serrs2 = [];
  sp.on('pageerror', (e) => serrs2.push(e.message));
  sp.on('console', (m) => { if (m.type() === 'error') serrs2.push(m.text()); });
  await sp.goto(base + '/#/gene/PtXaTreH.05G120200', { waitUntil: 'networkidle' });
  await sp.waitForTimeout(1200);
  const h = await sp.$('h2:has-text("Expression across the neighborhood")');
  await h.scrollIntoViewIfNeeded();
  await sp.waitForTimeout(500);
  // Switch mode WITHOUT ever touching the <select> -- the exact scenario that failed.
  // Scoped to the scrubber's own card. A page-wide substring selector for "By contrast" also
  // matched the Expression card's contrast view tab once that existed.
  await sp.locator('[data-card="scrubber"] button:has-text("By contrast")').first().click();
  await sp.waitForTimeout(700);
  const text = await viewText(sp);
  const ok = text.includes('log2((mean perturbation') && text.includes('Orange = higher') && !serrs2.length;
  if (!ok) failures++;
  console.log(`\n### scrubber:contrast-mode-no-manual-select  ${ok ? 'OK' : 'FAIL'}`);
  serrs2.forEach((e) => console.log('   !! ' + e));
  // Click-through still works from this card too.
  // '.locus-canvas' is a shared style class (locus, mirror, genome map, scrubber), so "the
  // last one on the page" is a position, not an identity. Scope by the module stamp.
  //
  // Clicked ELEMENT-RELATIVE, not by viewport coordinates. viewText() above reveals every
  // collapsed view panel, which makes the page taller and moves this canvas; a click at
  // coordinates measured before that lands somewhere else entirely, and the check failed
  // while the canvas worked. locator.click scrolls the target into view and resolves the
  // position against the element itself, so it cannot drift.
  const cv = sp.locator('[data-card="scrubber"] .locus-canvas').first();
  const cbox = await cv.boundingBox();
  await cv.click({ position: { x: cbox.width * 0.05, y: cbox.height * 0.5 } });
  await sp.waitForTimeout(600);
  const navigated = sp.url() !== base + '/#/gene/PtXaTreH.05G120200';
  if (!navigated) failures++;
  console.log(`### scrubber:click-through  ${navigated ? 'OK' : 'FAIL'}  url: ${sp.url()}`);
  await sp.close();
}

// The scrubber's own tissue chips and mode buttons are real tap targets (10 chips, easy
// to reach for on a phone) -- they must meet the same 44px floor as every other button
// on the site, not a smaller one because there happen to be more of them. Caught once
// already in development (an inline min-width:0 silently opted them out); asserted here
// so it cannot regress silently a second time.
{
  const tp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await tp.goto(base + '/#/gene/PtXaTreH.05G120200', { waitUntil: 'networkidle' });
  await tp.waitForTimeout(1200);
  const h = await tp.$('h2:has-text("Expression across the neighborhood")');
  await h.scrollIntoViewIfNeeded();
  const r = await tp.evaluate(() => {
    const card = [...document.querySelectorAll('.card')]
      .find((c) => c.querySelector('h2')?.textContent.includes('Expression across the neighborhood'));
    const btns = [...card.querySelectorAll('.locus-btn')]
      .map((b) => b.getBoundingClientRect()).map((q) => Math.min(q.width, q.height));
    return { n: btns.length, min: btns.length ? Math.min(...btns) : 0 };
  });
  const ok = r.n === 12 && r.min >= 44;  // 2 mode buttons + 10 tissue chips
  if (!ok) failures++;
  console.log(`\n### scrubber:touch-targets  ${ok ? 'OK' : 'FAIL'}  n=${r.n} min=${r.min}px`);
  await tp.close();
}

// Duplicate-partner co-expression (this session): the paralog table's Expr r column and the
// tandem array's Other-members table. This gene has both a comparable pair (r=0.2854, -> 0.29)
// and a saturated pair with no r at all -- the two must render as distinct states, not as a
// correlation of 0 vs 0.29.
await check('gene-duplicate-coexpr', '#/gene/PtXaTreH.01G330600',
  { expect: ['Expr r', '0.29', 'n/c', 'Other members', 'not a divergence model'], wait: 1000 });

// Ancestral karyotype (route C, exploratory). One case per branch, because a wrong-branch bug
// hides behind whichever branch renders: a direct anchor with its slot table, the same ancestral
// gene seen from HAP2, a conflict gene that must NOT show a copy, an unplaced chromosome gene, and
// an unplaced-scaffold gene that was never assessed. The slot wording is asserted in full, since
// "lost or not detected" must never read as a proven loss.
await check('gene-karyotype-anchor', '#/gene/PtXaTreH.01G144500',
  { expect: ['Ancestral karyotype', 'exploratory', 'AEK1', 'aWGT copy', 'sWGD copy',
             'Label support', '100%', 'eud1g01445', 'Its HAP1 descendants', 'PtXaTreH.03G046700',
             'lost or not detected', 'not evidence that the gene was lost', 'not subgenomes',
             'doi:10.1186/s12915-022-01420-1'], wait: 1000 });
await check('gene-karyotype-hap2', '#/gene/PtXaAlbH.01G147000',
  { expect: ['Ancestral karyotype', 'AEK1', 'eud1g01445', 'Its HAP2 descendants',
             'PtXaAlbH.03G042800'], wait: 1000 });
await check('gene-karyotype-conflict', '#/gene/PtXaTreH.01G040500',
  { expect: ['Ancestral karyotype', 'AEK5', 'not assigned', 'different ancestral chromosomes'], wait: 1000 });
await check('gene-karyotype-unplaced', '#/gene/PtXaTreH.02G000100',
  { expect: ['Ancestral karyotype', 'not placed', 'No collinear block links this gene'], wait: 1000 });
await check('gene-karyotype-scaffold', '#/gene/PtXaTreH.T006000',
  { expect: ['Ancestral karyotype', 'not assessed', 'unplaced scaffold'], wait: 1000 });
// HAP1 and HAP2 are never pooled: the HAP2 page's slot table must name no HAP1 gene, even though
// the same ancestral gene has HAP1 descendants and the page links the HAP1 allele elsewhere.
{
  const kp = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const kerrs = [];
  kp.on('pageerror', (e) => kerrs.push(e.message));
  kp.on('console', (m) => { if (m.type() === 'error') kerrs.push('console: ' + m.text()); });
  await kp.goto(base + '/#/gene/PtXaAlbH.01G147000', { waitUntil: 'networkidle' });
  await kp.waitForTimeout(1000);
  // This section sits in the duplication card's collapsed view, and innerText cannot see a
  // collapsed panel -- the read returned '' and the check failed while the page was correct.
  await revealViewPanels(kp);
  const sec = await kp.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((n) => n.textContent.startsWith('Ancestral karyotype'));
    return h ? h.parentElement.innerText : '';
  });
  const ok = !kerrs.length && sec.includes('PtXaAlbH.03G042800') && !/PtXaTreH\./.test(sec);
  if (!ok) failures++;
  console.log(`\n### karyotype:haplotypes-not-pooled  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   section ${sec.length} chars; names the HAP2 syntelog: ${sec.includes('PtXaAlbH.03G042800')}; `
    + `mentions a HAP1 gene: ${/PtXaTreH\./.test(sec)}`);
  kerrs.forEach((e) => console.log('   !! ' + e));
  await kp.close();
}
// The Browse filter, deep-linked, both haplotypes and then one: 2,167 = 1,097 HAP1 + 1,070 HAP2.
await check('browse-karyotype', '#/browse?aek=AEK1_gamma_copy_1',
  { expect: ['Ancestral chromosome (exploratory)', 'AEK1 aWGT copy 1', '2,167', 'Clear all'], wait: 1400 });
await check('browse-karyotype-hap2', '#/browse?aek=AEK1_gamma_copy_1&hap=hap2',
  { expect: ['AEK1 aWGT copy 1', '1,070', 'Clear all 2'], wait: 1400 });

// The chromatin card's "Show the signal profile" button must actually fetch and draw the
// four-mark panel, not just sit there -- chipRow and metricNote were both built and wired but
// never mounted earlier in this project, so only a real click-through catches a dead button.
{
  const cp = await browser.newPage({ viewport: { width: 1180, height: 1200 } });
  const cerrs = [];
  cp.on('pageerror', (e) => cerrs.push(e.message));
  cp.on('console', (m) => { if (m.type() === 'error') cerrs.push('console: ' + m.text()); });
  await cp.goto(base + '/#/gene/PtXaTreH.01G000700', { waitUntil: 'networkidle' });
  await cp.waitForTimeout(1000);
  await cp.click('button:has-text("Show the signal profile")');
  await cp.waitForTimeout(900);
  const text = (await viewText(cp)).toLowerCase();
  const gone = (await cp.$('button:has-text("Show the signal profile")')) === null;
  const ok = !cerrs.length && gone
    && text.includes('active promoter')
    && text.includes('oriented by strand when they were extracted');
  if (!ok) failures++;
  console.log(`\n### gene-chromatin-profile-click  ${ok ? 'OK' : 'FAIL'}  button-replaced=${gone}`);
  cerrs.forEach((e) => console.log('   !! ' + e));
  await cp.close();
}

// Every visible link must clear its WCAG contrast floor, in BOTH colour schemes, measured on
// the background it actually sits on. Added 2026-09-20 after the live site was measured with
// 53 of 69 links failing in light mode and 51 in dark: --accent (#2a78d6) was 4.30:1 on
// --surface and 4.04 on --panel-2, and the dark #3987e5 fell to 3.90 on --panel-2. Links are
// 11.5-14px, so the 4.5:1 floor applies. They now use --accent-ink.
//
// POSITIVE CONTROL first: one link is injected in the OLD colour and must be flagged. Without
// it a measurement that silently found no links, or read every background as white, would
// report "0 failing" and pass -- the shape of every vacuous gate found in this project.
for (const scheme of ['light', 'dark']) {
  const lp = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: scheme });
  const lerrs = [];
  lp.on('pageerror', (e) => lerrs.push(e.message));
  await lp.goto(base + '/#/gene/PtXaTreH.08G070200', { waitUntil: 'networkidle' });
  await lp.waitForSelector('.card', { timeout: 20000 });
  await lp.waitForTimeout(800);
  const r = await lp.evaluate((sch) => {
    const card = document.querySelector('#view .card');
    const probe = document.createElement('a');
    probe.href = '#'; probe.id = '__contrast_probe'; probe.textContent = 'probe';
    // A colour that must FAIL on this scheme's panels. Dark: the light theme's moss link colour
    // leaking into dark mode (the old #3987e5 passes on the darker herbarium panels, so it
    // stopped being a control). Light: the pre-2026-09-20 link blue, still 4.3:1 on paper.
    probe.style.color = sch === 'dark' ? '#3f5a2a' : '#2a78d6';
    probe.style.fontSize = '12px';
    card.appendChild(probe);
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = ([rr, g, b]) => 0.2126 * lin(rr) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const bgOf = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const c = rgb(getComputedStyle(e).backgroundColor);
        if (c.length >= 3 && (c[3] === undefined || c[3] > 0.99)) return c;
      }
      return [255, 255, 255];
    };
    let n = 0, fails = 0, min = Infinity, probeFlagged = false;
    for (const a of document.querySelectorAll('#view a, header a')) {
      const box = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      if (!box.width || !box.height || cs.visibility === 'hidden') continue;
      const l1 = L(rgb(cs.color)), l2 = L(bgOf(a));
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
      const need = (size >= 24 || (bold && size >= 18.66)) ? 3 : 4.5;
      if (a.id === '__contrast_probe') { probeFlagged = ratio < need; continue; }
      n++;
      if (ratio < need) fails++;
      min = Math.min(min, ratio);
    }
    return { n, fails, min, probeFlagged };
  }, scheme);
  const ok = !lerrs.length && r.probeFlagged && r.n >= 20 && r.fails === 0;
  if (!ok) failures++;
  console.log(`\n### links:contrast-${scheme}  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${r.n} visible links, ${r.fails} below their WCAG floor, min ${r.min.toFixed(2)}:1`);
  console.log(`   positive control (old colour injected) flagged: ${r.probeFlagged}`);
  lerrs.forEach((e) => console.log('   !! ' + e));
  await lp.close();
}

// ---- copies on both haplotypes (js/modules/copies.js) ----------------------------------------
// The panel exists because no HAP1 NRX1 page led to HAP2. What must hold: it is on every gene
// page it draws and on no other; it draws EXACTLY the rows the data file holds (compared as
// sets, not probed for a few expected names); the focal row is the page's own gene; a number
// it shares with another card is the same number; and no two labels collide, at desktop AND
// phone width, where the layout folds differently. The collision test has a positive control
// -- a label deliberately stacked on another must be flagged -- or "0 overlaps" could simply
// mean the measurement found no text.
async function copiesPanel(p) {
  await p.waitForSelector('[data-card="copies"] svg.cp-svg, .card .cp-holder svg.cp-svg', { timeout: 20000 });
  return p.evaluate(async () => {
    const card = document.querySelector('[data-card="copies"]') || document.querySelector('.cp-holder').closest('.card');
    const L = await (await fetch('data/copies/nrx1.json')).json();
    const svg = card.querySelector('svg.cp-svg');
    const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim());
    const overlaps = (list) => {
      const boxes = list.map((t) => t.getBoundingClientRect());
      let n = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++;
        }
      }
      return n;
    };
    const n = overlaps(texts);
    // positive control: a second label stacked exactly on the first. Cloned from the SAME
    // element, anchor included -- the first version cloned a right-anchored label onto a
    // left-anchored one, which lands beside it rather than on it, so the control never fired.
    const probe = texts[0].cloneNode(true);
    probe.textContent = 'overlap probe';
    svg.appendChild(probe);
    const nWithProbe = overlaps([...texts, probe]);
    probe.remove();
    const clipped = texts.filter((t) => {
      const r = t.getBoundingClientRect(), s = svg.getBoundingClientRect();
      return r.left < s.left - 1 || r.right > s.right + 1;
    }).map((t) => t.textContent);
    const drawnIds = [...svg.querySelectorAll('.cp-id')].map((t) => t.textContent).sort();
    const fileIds = L.rows.filter((r) => r.gene).map((r) => r.gene).sort();
    return {
      drawnIds, fileIds,
      unannText: svg.querySelectorAll('.cp-unann').length,
      unannFile: L.rows.filter((r) => !r.gene).length,
      dashed: svg.querySelectorAll('.cp-dashed').length,
      focal: (svg.querySelector('.cp-focal') || {}).textContent || null,
      pieces: [...svg.querySelectorAll('.cp-piece')].map((t) => t.textContent),
      links: [...svg.querySelectorAll('a.cp-link')].map((a) => a.getAttribute('href')),
      overlaps: n, controlFlagged: nWithProbe > n, clipped,
      chip: (card.querySelector('.ev-chip') || {}).textContent || null,
      lede: (card.querySelector('.cp-lede') || {}).innerText || '',
      glance: (document.querySelector('.card.glance') || {}).innerText || '',
      allele: (document.querySelector('[data-card="allele"]') || {}).innerText || '',
      // the element's own text only: its <title> tooltip is a child, and textContent would
      // append "median TPM in stem, ..." to the number
      tpmOf: Object.fromEntries([...svg.querySelectorAll('[data-tpm-for]')]
        .map((t) => [t.getAttribute('data-tpm-for'), [...t.childNodes].filter((c) => c.nodeType === 3)
          .map((c) => c.nodeValue).join('').split('·').pop().trim()])),
      pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });
}
for (const [label, hash, focal, width] of [
  ['hap1-desktop', '#/gene/PtXaTreH.10G047000', 'PtXaTreH.10G047000', 1180],
  ['hap1-phone', '#/gene/PtXaTreH.10G047000', 'PtXaTreH.10G047000', 375],
  ['hap2-desktop', '#/gene/PtXaAlbH.10G043900', 'PtXaAlbH.10G043900', 1180],
  ['route', '#/copies/nrx1', null, 1180],
]) {
  const p = await browser.newPage({ viewport: { width, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(base + '/' + hash, { waitUntil: 'networkidle' });
  const r = await copiesPanel(p);
  await p.screenshot({ path: `${outdir}/copies-${label}.png`, fullPage: true });
  const sameRows = JSON.stringify(r.drawnIds) === JSON.stringify(r.fileIds);
  const hap2Link = focal === 'PtXaAlbH.10G043900' || r.links.includes('#/gene/PtXaAlbH.10G043900');
  // The focal gene's peak TPM must be the number the summary strip prints for it. The strip
  // rounds to a whole number and the panel keeps a decimal, so compare at the strip's precision.
  const glanceTpm = (r.glance.match(/Expression\s+\S+\s+([\d,.]+) TPM/) || [])[1];
  const panelTpm = focal ? r.tpmOf[focal] : null;
  const tpmAgrees = !focal || (glanceTpm != null && panelTpm != null
    && Math.round(parseFloat(panelTpm.replace(/,/g, ''))) === parseInt(glanceTpm.replace(/,/g, ''), 10));
  const checks = {
    'rows drawn == rows in data/copies/nrx1.json': sameRows,
    'each unannotated row says so in words and is outlined': r.unannText === r.unannFile && r.dashed === r.unannFile,
    'focal row is this page': r.focal === focal,
    'a link leads to the HAP2 gene model': hap2Link,
    'the joined gene model shows pieces A and B': r.pieces.join('') === 'AB',
    'no two labels overlap': r.overlaps === 0,
    'overlap control (stacked label) is flagged': r.controlFlagged,
    'no label runs outside the panel': !r.clipped.length,
    'the page fits its width': r.pageFits,
    'chip says where the evidence comes from': !focal || r.chip === 'from the genome',
    'lede states HAP2 in pieces': r.lede.includes('HAP2: 3 pieces'),
    'glance row leads here': !focal || r.glance.includes('Both haplotypes'),
    // where a reader looking for the other haplotype stops: an Allele card with no allele
    'the allele card points to the panel': !focal || r.allele.includes('NRX1 panel'),
    'focal peak TPM equals the summary strip': tpmAgrees,
  };
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const ok = !errs.length && !bad.length;
  if (!ok) failures++;
  console.log(`\n### copies:${label}  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${r.drawnIds.length} annotated + ${r.unannText} unannotated rows; focal ${r.focal}; `
    + `pieces ${r.pieces.join('') || '-'}; overlaps ${r.overlaps} (control flagged: ${r.controlFlagged}); `
    + `peak TPM strip ${glanceTpm ?? '-'} / panel ${panelTpm ?? '-'}`);
  bad.forEach((b) => console.log('   !! ' + b));
  errs.forEach((e) => console.log('   !! ' + e));
  await p.close();
}
// ...and on no other gene page: a panel must not appear where no search was run.
await check('copies-absent-elsewhere', '#/gene/PtXaTreH.08G070200',
  // "Both haplotypes" alone is now the locus browser card's section label on every gene page,
  // so the copies panel is identified by its own heading and nav label instead.
  { expect: ['Location'], forbid: ['on both haplotypes', 'Copies on both haplotypes'], wait: 2500 });
await check('copies-unknown-locus', '#/copies/nope', { expect: ['No such copy search', 'nrx1'] });

// ---- evidence tiers (registry.js CARD_EVIDENCE) --------------------------------------------
// Every top-level card carries exactly one chip whose words and tier are the ones the table
// declares for its data-card; the tier's rule STYLE is what the CSS says it is (so the channel
// that survives greyscale exists); chip text clears 4.5:1 on its own background in both schemes.
// Three genes between them draw every tier: NRX1 (copies, predicted band), a chromatin gene,
// and a presence-variation candidate with chromatin. The contrast measurement has its own
// positive control.
for (const scheme of ['light', 'dark']) {
  for (const gid of ['PtXaTreH.10G047000', 'PtXaTreH.01G000700', 'PtXaTreH.01G000100']) {
    const p = await browser.newPage({ viewport: { width: 1180, height: 1000 }, colorScheme: scheme });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.goto(`${base}/#/gene/${gid}`, { waitUntil: 'networkidle' });
    await p.waitForSelector('.ev-chip', { timeout: 20000 });
    const r = await p.evaluate(async () => {
      const { CARD_EVIDENCE } = await import('./js/core/registry.js');
      const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const ratio = (el) => {
        const a = L(rgb(getComputedStyle(el).color)), b = L(rgb(getComputedStyle(el).backgroundColor));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const STYLE = { 1: 'solid', 2: 'dashed', 3: 'dotted' };
      const wrong = [], seen = {};
      let minRatio = Infinity;
      for (const top of document.querySelectorAll('.cards > .card, .cards > details.card-fold')) {
        const key = top.dataset.card || (top.querySelector(':scope > .card') || {}).dataset?.card;
        const chips = top.querySelectorAll(':scope > h2 > .ev-chip, :scope > summary > .ev-chip');
        const want = CARD_EVIDENCE[key];
        const tier = Number(top.dataset.evidence);
        seen[key] = tier;
        if (!want) { wrong.push(`${key}: not in CARD_EVIDENCE`); continue; }
        if (chips.length !== 1) { wrong.push(`${key}: ${chips.length} chips`); continue; }
        if (tier !== want[0] || chips[0].textContent !== want[1]) wrong.push(`${key}: shows ${tier}/${chips[0].textContent}`);
        if (getComputedStyle(top).borderLeftStyle !== STYLE[tier]) wrong.push(`${key}: rule ${getComputedStyle(top).borderLeftStyle}`);
        minRatio = Math.min(minRatio, ratio(chips[0]));
      }
      // positive control: a chip in --line-2 must measure under 4.5 in BOTH schemes. (--ink-3 was
      // the first choice and fails only in light: it is 5.28:1 on the dark surface, so in dark
      // mode the control could never fire.)
      const probe = document.createElement('span');
      probe.className = 'ev-chip';
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--line-2');
      document.querySelector('.ev-key').append(probe);
      probe.textContent = 'probe';
      const probeRatio = ratio(probe);
      probe.remove();
      return { wrong, seen, minRatio, probeRatio, key: document.querySelectorAll('.ev-key .ev-key-item').length };
    });
    const tiers = new Set(Object.values(r.seen));
    const ok = !errs.length && !r.wrong.length && r.minRatio >= 4.5 && r.probeRatio < 4.5 && r.key === 3;
    if (!ok) failures++;
    console.log(`\n### evidence:${gid}-${scheme}  ${ok ? 'OK' : 'FAIL'}`);
    console.log(`   ${Object.keys(r.seen).length} cards, tiers ${[...tiers].sort().join('/')}, chip contrast min `
      + `${r.minRatio.toFixed(2)}:1 (control ${r.probeRatio.toFixed(2)}:1 must be < 4.5)`);
    r.wrong.forEach((w) => console.log('   !! ' + w));
    errs.forEach((e) => console.log('   !! ' + e));
    await p.close();
  }
}

// #/array/<id>, #/arrays and the deeper #/pair: member count re-derived from arrays.json here
// (not a snapshot), a driven click from a gene's Duplication card, pair pages with and without
// an allele, and a phone fit. Elements are found by data- attributes only.
{
  const ap = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  const aerrs = [];
  ap.on('pageerror', (e) => aerrs.push(e.message));
  ap.on('console', (m) => { if (m.type() === 'error') aerrs.push('console: ' + m.text()); });
  const arrays = await (await fetch(`${base}/data/index/arrays.json`)).json();
  // the tandem gene used by gene-tandem-array above; find its array by membership
  const gid = 'PtXaTreH.01G330700';
  const aid = Object.keys(arrays).find((k) => arrays[k].includes(gid));
  const want = aid ? arrays[aid].length : -1;
  await ap.goto(base + '/#/gene/' + gid, { waitUntil: 'networkidle' });
  await ap.waitForTimeout(1400);
  await revealViewPanels(ap);
  const link = ap.locator(`[data-card="duplication"] [data-array-link="${aid}"]`).first();
  const hasLink = await link.count() > 0;
  if (hasLink) { await link.scrollIntoViewIfNeeded(); await link.click(); }
  await ap.waitForSelector('[data-arr-page]', { timeout: 15000 }).catch(() => aerrs.push('array page did not render'));
  await ap.waitForSelector('[data-arr-locus] [data-locus-browser][data-tiles="ready"][data-genes-in-view]', { timeout: 15000 }).catch(() => aerrs.push('no locus browser'));
  const got = await ap.evaluate(() => ({
    hash: location.hash,
    n: document.querySelectorAll('[data-arr-member]').length,
    attr: Number((document.querySelector('[data-arr-page]') || {}).dataset?.arrN),
    heat: document.querySelectorAll('[data-arr-heat-row]').length,
    marked: Number((document.querySelector('[data-arr-locus] [data-locus-browser]') || {}).dataset?.genesInView || 0),
    text: document.getElementById('view').innerText,
  }));
  await ap.screenshot({ path: `${outdir}/array-page.png`, fullPage: true });
  await ap.goto(base + '/#/arrays', { waitUntil: 'networkidle' });
  await ap.waitForTimeout(800);
  const idx = await ap.evaluate(() => ({
    rows: document.querySelectorAll('[data-arrays-row]').length,
    count: (document.querySelector('[data-arrays-count]') || {}).textContent || '' }));
  await ap.locator('[data-arrays-sort="n"]').click();          // toggles to ascending
  const firstAsc = await ap.evaluate(() => document.querySelector('[data-arrays-row] td:nth-child(4)').textContent);
  const nArrays = Object.keys(arrays).length;
  const ok = !aerrs.length && hasLink && want > 1 && got.hash === `#/array/${aid}`
    && got.n === want && got.attr === want && got.heat === want && got.marked >= want
    && /no ks estimate|have none/i.test(got.text) && /n \d+/.test(got.text)
    && idx.rows > 0 && idx.count.includes(`of ${nArrays} arrays`) && firstAsc === '2';
  if (!ok) failures++;
  console.log(`\n### array:page-from-duplication-card  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`   ${aid}: ${got.n} member rows, heat rows ${got.heat}, want ${want} (from arrays.json); `
    + `link ${hasLink}; index ${idx.rows} rows, "${idx.count.slice(0, 40)}"; smallest-first ${firstAsc}`);
  aerrs.forEach((e) => console.log('   !! ' + e));
  await ap.close();

  // pair pages: with an allele (models + expression figure), without one (neighbourhood)
  const pp = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  const perr = [];
  pp.on('pageerror', (e) => perr.push(e.message));
  pp.on('console', (m) => { if (m.type() === 'error') perr.push('console: ' + m.text()); });
  await pp.goto(base + '/#/pair/PtXaTreH.05G120200', { waitUntil: 'networkidle' });
  await pp.waitForSelector('[data-pair-models]', { timeout: 15000 }).catch(() => perr.push('no gene models'));
  const withA = await pp.evaluate(() => ({
    pair: (document.querySelector('[data-pair]') || {}).dataset?.pair,
    bars: document.querySelectorAll('[data-pair-expr] .pr-bar').length,
    ns: document.querySelectorAll('[data-pair-expr] .pr-tn').length,
    desc: !!document.querySelector('[data-pair-row="Description"]') }));
  await pp.goto(base + '/#/pair/PtXaTreH.01G175200', { waitUntil: 'networkidle' });
  await pp.waitForSelector('[data-pair-neighborhood] [data-locus-browser][data-tiles="ready"]', { timeout: 15000 }).catch(() => perr.push('no neighborhood'));
  const solo = await pp.evaluate(() => ({
    id: (document.querySelector('[data-pair-solo]') || {}).dataset?.pairSolo,
    tracks: document.querySelectorAll('[data-pair-neighborhood] [data-locus-browser] canvas').length }));
  const pok = !perr.length && withA.pair === 'PtXaTreH.05G120200|PtXaAlbH.05G122300' && withA.bars >= 2
    && withA.ns > 0 && withA.desc && solo.id === 'PtXaTreH.01G175200' && solo.tracks >= 1;
  if (!pok) failures++;
  console.log(`\n### pair:models-expression-neighborhood  ${pok ? 'OK' : 'FAIL'}`);
  console.log(`   pair ${withA.pair}, ${withA.bars} bars; solo tracks ${solo.tracks}`);
  perr.forEach((e) => console.log('   !! ' + e));
  await pp.close();

  // phone fit: no horizontal PAGE scroll on the new pages
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const fits = [];
  for (const h of [`#/array/${aid}`, '#/arrays', '#/pair/PtXaTreH.05G120200', '#/pair/PtXaTreH.01G175200']) {
    await mp.goto(base + '/' + h, { waitUntil: 'networkidle' });
    await mp.waitForTimeout(1500);
    fits.push([h, await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)]);
  }
  const fok = fits.every(([, f]) => f);
  if (!fok) failures++;
  console.log(`\n### array-pair:fits-a-phone  ${fok ? 'OK' : 'FAIL'}  ${fits.map(([h, f]) => `${h}=${f}`).join(' ')}`);
  await mp.close();
}

// The home page overflowed a 375px phone by 74px (the question list). Held at phone width now.
{
  const p = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await p.goto(base + '/#/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  const ok = w[0] <= w[1];
  if (!ok) failures++;
  console.log(`\n### home:fits-a-phone  ${ok ? 'OK' : 'FAIL'}  scrollWidth ${w[0]} vs ${w[1]}`);
  await p.close();
}

// Every module the site loads is preloaded from the head (scripts/sync_preload.py), so the
// browser fetches the import graph in one round trip instead of one per import level. A module
// requested without a preload link means the generated list went stale.
{
  const p = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const js = new Set();
  p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('.js') && !u.pathname.includes('/vendor/')) js.add(u.pathname.replace(/^.*?\/js\//, 'js/')); });
  await p.goto(base + '/#/gene/PtXaTreH.08G070200', { waitUntil: 'networkidle' });
  const pre = await p.evaluate(() => [...document.querySelectorAll('link[rel=modulepreload]')].map((l) => l.getAttribute('href')));
  const missing = [...js].filter((f) => f !== 'js/app.js' && !pre.includes(f));
  const ok = js.size > 10 && pre.length > 10 && missing.length === 0;
  if (!ok) failures++;
  console.log(`\n### perf:modules-preloaded  ${ok ? 'OK' : 'FAIL'}  ${js.size} modules loaded, ${pre.length} preloaded`);
  missing.forEach((m) => console.log('   !! not preloaded: ' + m));
  await p.close();
}

// arrays.json lists every DETECTED array; the manuscript counts arrays with a member that passed
// the pseudogene screen: 2,119 HAP1 / 2,085 HAP2 (ms1-dup master v11 README, has_T_gene).
// HAP1_U00357 lost every member to the screen and must say it is not counted.
{
  const p = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/#/arrays', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-arrays-counted]');
  const note = await p.$eval('[data-arrays-counted]', (n) => n.innerText);
  await p.selectOption('[data-arrays-status]', 'removed');
  const removedCount = await p.$eval('[data-arrays-count]', (n) => n.innerText);
  await p.goto(base + '/#/array/HAP1_U00357', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const st = await p.evaluate(() => document.querySelector('[data-arr-status]')?.getAttribute('data-arr-status'));
  await p.goto(base + '/#/array/HAP1_U00193', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const stOk = await p.evaluate(() => document.querySelector('[data-arr-status]') === null);
  const ok = !errs.length && note.includes('2,119') && note.includes('2,085')
    && /of 167 arrays/.test(removedCount) && st === 'removed' && stOk;
  if (!ok) failures++;
  console.log(`\n### arrays:counted-vs-detected  ${ok ? 'OK' : 'FAIL'}  status(U00357)=${st} fullyCountedHasNoBanner=${stOk}`);
  console.log(`   ${note}\n   removed filter: ${removedCount}`);
  errs.forEach((e) => console.log('   !! ' + e));
  await p.close();
}

// Protein FASTA from the gene header: the downloaded sequence must have the residue count the
// gene record states (prot.ss.n, from the ESMFold model of the same protein), and since 0.21 a
// gene with no 3D model downloads its annotated protein too, at the length its button states.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/#/gene/PtXaTreH.05G120200', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-protein-fasta]');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('[data-protein-fasta]')]);
  const text = await (await import('fs')).promises.readFile(await dl.path(), 'utf8');
  const seq = text.split('\n').slice(1).join('').trim();
  const want = await p.evaluate(async () => {
    const r = await fetch('data/genes/hap1/Chr05/4.json').then((x) => x.json());
    return r['PtXaTreH.05G120200'].prot.ss.n;
  });
  await p.goto(base + '/#/gene/PtXaTreH.01G000200', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-protein-fasta]');
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('[data-protein-fasta]')]);
  const seq2 = (await (await import('fs')).promises.readFile(await dl2.path(), 'utf8')).split('\n').slice(1).join('').trim();
  // the button states the length once it has read the sequence
  const none = await p.$eval('[data-protein-fasta]', (b) => b.textContent);
  const stated = Number((none.match(/\((\d+) aa\)/) || [])[1]);
  const ok = !errs.length && text.startsWith('>PtXaTreH.05G120200 ') && /^[A-Z*]+$/.test(seq)
    && seq.length === want && /^[A-Z*]+$/.test(seq2) && seq2.length === stated && stated > 0;
  if (!ok) failures++;
  console.log(`\n### gene:protein-fasta  ${ok ? 'OK' : 'FAIL'}  ${seq.length} aa vs record ${want}; no-model button: "${none}"`);
  errs.forEach((e) => console.log('   !! ' + e));
  await ctx.close();
}

// Browse protein FASTA: refuses a whole-genome selection, and for a pasted list writes one
// record per gene (every gene has an annotated protein since 0.21).
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/#/browse', { waitUntil: 'networkidle' });
  await p.waitForSelector('#view .stat .n');
  await p.click('[data-browse-fasta]');
  const refused = await p.$eval('[data-browse-action-status]', (n) => n.textContent);
  await p.evaluate(() => { document.querySelector('[data-group="ids"]').open = true; });
  await p.fill('label[data-filter="ids"] textarea', 'PtXaTreH.05G120200 PtXaTreH.01G000200 PtXaAlbH.05G122300');
  await p.click('[data-group="ids"] button:has-text("Apply list")');
  await p.waitForTimeout(300);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('[data-browse-fasta]')]);
  const text = await (await import('fs')).promises.readFile(await dl.path(), 'utf8');
  const heads = text.split('\n').filter((l) => l.startsWith('>')).map((l) => l.split(' ')[0].slice(1));
  const ok = !errs.length && /limited to 2,000/.test(refused) && heads.length === 3
    && ['PtXaTreH.05G120200', 'PtXaTreH.01G000200', 'PtXaAlbH.05G122300'].every((g) => heads.includes(g));
  if (!ok) failures++;
  console.log(`\n### browse:protein-fasta  ${ok ? 'OK' : 'FAIL'}  records=${heads.join(',')}  refused="${refused.slice(0, 60)}"`);
  errs.forEach((e) => console.log('   !! ' + e));
  await ctx.close();
}

// A tandem gene with no syntelog of its own reaches the other haplotype through its array
// (CJ's tandem rule, ms1-dup master v11 `td_array_associated`). Expected pairs are copied from
// master_per_gene_v11.csv `syntelog_partner_gene_id` -- an INDEPENDENT source, not the atlas's
// own shards -- for the members of HAP1_U00025. HAP1_U00361 is the negative case: every member counted tandem, no member
// of that array has a partner in v11 OR in the atlas map, so the page must say so rather than
// name anything. (HAP1_U00186 was tried first and is NOT a negative: the atlas map gives
// 01G316900 an allele v11 does not -- the two partner sets differ, see TODO.)
{
  const p = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const read = async (id) => {
    await p.goto(`${base}/#/gene/${id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    return p.evaluate(() => ({
      card: document.querySelector('[data-allele-via-array]')?.innerText || '',
      glance: document.querySelector('[data-glance-array-allele]')?.innerText || '',
    }));
  };
  const pos = await read('PtXaTreH.01G020200');
  const neg = await read('PtXaTreH.03G012100');
  const want = [['PtXaTreH.01G020300', 'PtXaAlbH.01G020800'], ['PtXaTreH.01G020400', 'PtXaAlbH.01G021000']];
  const okPos = want.every(([m, a]) => pos.card.includes(m) && pos.card.includes(a))
    && pos.card.includes('HAP1_U00025') && pos.card.includes('may have no counterpart')
    && pos.glance.includes('PtXaAlbH.01G020800');
  const okNeg = neg.card.includes('HAP1_U00361') && neg.card.includes('array-level case')
    && !/PtXaAlbH\./.test(neg.card);
  const ok = !errs.length && okPos && okNeg;
  if (!ok) failures++;
  console.log(`\n### allele:through-the-array  ${ok ? 'OK' : 'FAIL'}  positive=${okPos} negative=${okNeg}`);
  if (!okPos) console.log('   card: ' + pos.card.slice(0, 300) + '\n   glance: ' + pos.glance);
  if (!okNeg) console.log('   neg card: ' + neg.card.slice(0, 300));
  errs.forEach((e) => console.log('   !! ' + e));
  await p.close();
}

// Browse bulk lookup: a pasted list narrows the table to exactly the IDs that exist, and an ID
// that is not in the release is NAMED, not silently dropped. Combined with a filter, so the
// list is shown to AND with the sidebar rather than replace it.
{
  const p = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/#/browse', { waitUntil: 'networkidle' });
  await p.waitForSelector('#view .stat .n');
  await p.evaluate(() => { document.querySelector('[data-group="ids"]').open = true; });
  await p.fill('label[data-filter="ids"] textarea',
    'PtXaTreH.05G120200, PtXaAlbH.05G122300\nNOT_A_GENE.1');
  await p.click('[data-group="ids"] button:has-text("Apply list")');
  await p.waitForTimeout(400);
  const listed = await p.$eval('#view .stat .n', (n) => n.textContent.trim());
  const note = await p.$eval('label[data-filter="ids"] .bz-hint', (n) => n.textContent);
  await p.selectOption('label[data-filter="hap"] select', 'hap2');
  await p.waitForTimeout(400);
  const withHap = await p.$eval('#view .stat .n', (n) => n.textContent.trim());
  const ok = !errs.length && listed === '2' && withHap === '1'
    && note.includes('2 of 3') && note.includes('NOT_A_GENE.1');
  if (!ok) failures++;
  console.log(`\n### browse:gene-list  ${ok ? 'OK' : 'FAIL'}  listed=${listed} +hap2=${withHap}  note="${note}"`);
  errs.forEach((e) => console.log('   !! ' + e));
  await p.close();
}

// Saved sets: saving says so beside the button, the set survives a reload, a wrong file is
// refused in words, and removing it works -- all without a console error.
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(base + '/#/browse', { waitUntil: 'networkidle' });
  await p.waitForSelector('#view .stat .n');
  await p.selectOption('label[data-filter="hap"] select', 'hap2');
  await p.waitForTimeout(300);
  await p.click('button:has-text("Save as set")');
  const said = await p.$eval('[data-browse-action-status]', (x) => x.textContent);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('#view .stat .n');
  await p.evaluate(() => { document.querySelector('.bz-sets').open = true; });
  const kept = await p.$eval('.bz-sets', (x) => x.innerText.includes('hap=hap2'));
  await p.setInputFiles('#saved-sets-import', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
  await p.waitForTimeout(300);
  const refused = await p.$eval('.bz-sets .card > p', (x) => x.textContent);
  await p.click('.bz-sets button:has-text("Remove")');
  await p.waitForTimeout(300);
  const gone = await p.$eval('.bz-sets', (x) => ![...x.querySelectorAll('tbody tr')].some((r) => r.innerText.includes('hap=hap2')));
  const ok = !errs.length && /^Saved “hap=hap2” \(31,823 genes\)/.test(said) && kept && gone
    && /not a saved-sets export/.test(refused);
  if (!ok) failures++;
  console.log(`\n### browse:saved-sets  ${ok ? 'OK' : 'FAIL'}  said="${said}" kept=${kept} refused="${refused}" gone=${gone}`);
  errs.forEach((e) => console.log('   !! ' + e));
  await ctx.close();
}

// Keyboard and screen reader basics (0.21): each page names itself in the tab title, following
// a link moves focus to the new page's heading, the skip link is the first Tab stop and lands in
// the page, and a section link on a gene page moves focus to the section. #/changes renders.
{
  const p = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/#/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const homeTitle = await p.title();
  const firstFocus = await p.evaluate(() => document.activeElement === document.body);
  await p.keyboard.press('Tab');
  const firstTab = await p.evaluate(() => document.activeElement.className);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  const afterSkip = await p.evaluate(() => !!document.activeElement.closest('#view'));
  await p.click('header nav a[href="#/glossary"]');
  await p.waitForSelector('#view h1');
  await p.waitForTimeout(300);
  const g = await p.evaluate(() => ({ t: document.title, f: document.activeElement.tagName + ':' + document.activeElement.textContent }));
  await p.goto(base + '/#/gene/PtXaTreH.05G120200', { waitUntil: 'networkidle' });
  await p.waitForSelector('.secnav a');
  await p.waitForTimeout(500);
  const geneTitle = await p.title();
  await p.click('.secnav a >> nth=1');
  await p.waitForTimeout(300);
  const secFocus = await p.evaluate(() => document.activeElement.id || document.activeElement.tagName);
  await p.goto(base + '/#/changes', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-changes] .change');
  const ch = await p.evaluate(() => ({ t: document.title, n: document.querySelectorAll('.change').length,
    first: document.querySelector('.change .mono').textContent }));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(200);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await p.screenshot({ path: `${outdir}/changes-phone.png` });
  const parts = {
    homeTitle: homeTitle === '717 gene atlas' || / · 717 gene atlas$/.test(homeTitle),
    noFocusStealOnLoad: firstFocus, skipFirst: /\bskip\b/.test(firstTab), skipLands: afterSkip,
    glossaryTitle: g.t === 'Glossary · 717 gene atlas', glossaryFocus: g.f === 'H1:Glossary',
    geneTitle: geneTitle.startsWith('PtXaTreH.05G120200'), sectionFocus: /^sec-/.test(secFocus),
    changes: ch.t === 'What changed · 717 gene atlas' && ch.n >= 8 && /^0\.\d+/.test(ch.first), phoneFits: !overflow,
  };
  const ok = !errs.length && Object.values(parts).every(Boolean);
  if (!ok) failures++;
  console.log(`\n### a11y:titles-focus-skip  ${ok ? 'OK' : 'FAIL'}  ${Object.entries(parts).filter(([, v]) => !v).map(([k]) => k).join(' ') || 'all parts'}`);
  if (!ok) console.log(`   home="${homeTitle}" tab="${firstTab}" glossary=${JSON.stringify(g)} gene="${geneTitle}" sec=${secFocus} changes=${JSON.stringify(ch)}`);
  errs.forEach((e) => console.log('   !! ' + e));
  await p.close();
}

// Studies 2 and 3 sample developing and mature xylem; the tissue fields say only "xylem", so the
// design once drew two sites as one group (n=8). ArrayExpress (E-MTAB-7288, E-MTAB-7587): 8 and 6
// groups of 4. The drawing must show exactly those groups and label each sample's site, and since
// the switch to the dissertation's curated contrasts every comparison stays within one site (or
// compares the two sites), 4 against 4.
{
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const got = {};
  for (const [id, groups] of [[2, 8], [3, 6]]) {
    await p.goto(`${base}/#/study/${id}`, { waitUntil: 'networkidle' });
    await p.waitForSelector('.sd-cell');
    got[id] = await p.evaluate(() => {
      const keys = new Map();
      document.querySelectorAll('.sd-cell').forEach((c) => keys.set(c.dataset.ids, c.dataset.ids.split(',').length));
      return { groups: keys.size, sizes: [...new Set(keys.values())],
        pooled: [...document.querySelectorAll('.sd-contrasts tbody tr')].every((t) =>
          /^(developing xylem|mature xylem|developing xylem to mature xylem)$/.test(t.children[2].textContent.trim())
          && /4 vs 4/.test(t.innerText)),
        sites: [...new Set([...document.querySelectorAll('tr[data-i] td:nth-child(2)')].map((t) => t.textContent))].sort().join('|') };
    });
    got[id].ok = got[id].groups === groups && got[id].sizes.join() === '4' && got[id].pooled
      && got[id].sites === 'developing xylem|mature xylem';
  }
  const ok = !errs.length && got[2].ok && got[3].ok;
  if (!ok) failures++;
  console.log(`\n### study:xylem-sites  ${ok ? 'OK' : 'FAIL'}  ${JSON.stringify(got)}`);
  errs.forEach((e) => console.log('   !! ' + e));
  await p.close();
}

// The shipped contrasts are the dissertation's curated set: no arm mixes developing and mature
// xylem (the v4 panel's six pooled study 2/3 contrasts are gone), and studies 2 and 3 carry their
// 17 site-split contrasts, 4 against 4.
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  const r = await p.evaluate(async () => {
    const { loadContrasts, loadExprSamples } = await import('./js/core/data.js');
    const [cs, ss] = await Promise.all([loadContrasts(), loadExprSamples()]);
    const site = (i) => ss[i].label.split('_')[1];
    const x = cs.filter((c) => [...c.ctrl, ...c.pert].some((i) => ss[i].study === 2 || ss[i].study === 3));
    return { n: cs.length, resp: cs.filter((c) => c.resp).length, xylem: x.length,
      mixed: x.filter((c) => new Set(c.ctrl.map(site)).size > 1 || new Set(c.pert.map(site)).size > 1).length,
      fours: x.every((c) => c.ctrl.length === 4 && c.pert.length === 4) };
  });
  const ok = !errs.length && r.n === 165 && r.resp === 149 && r.xylem === 17 && r.mixed === 0 && r.fours;
  if (!ok) failures++;
  console.log(`\n### contrasts:curated-set  ${ok ? 'OK' : 'FAIL'}  ${JSON.stringify(r)}`);
  errs.forEach((e) => console.log('   !! ' + e));
  await p.close();
}

// Contrast view controls: each filter keeps only matching rows, each sort orders them, and the two
// responsiveness switches together reproduce the gene's own responsiveness (112 contrasts, 0.674 for
// PtXaTreH.19G110500, computed independently in python), which ties the filters to the record.
{
  const p = await browser.newPage({ viewport: { width: 1180, height: 1100 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/#/gene/PtXaTreH.19G110500', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    const pn = document.querySelector('.viewpanel[data-view="contrasts"]');
    const host = pn && pn.closest('.card.viewgroup');
    const i = host ? [...host.querySelectorAll('.viewpanel')].indexOf(pn) : -1;
    if (i >= 0) host.querySelectorAll('.viewtab')[i].click();
  });
  await p.waitForSelector('[data-cv-switch="resp"]');
  const read = () => p.evaluate(() => {
    const pn = document.querySelector('.viewpanel[data-view="contrasts"]');
    return {
      summary: pn.querySelector('.cv-summary').textContent,
      median: pn.querySelector('[data-cv-median]')?.dataset.cvMedian || null,
      kinds: [...pn.querySelectorAll('[data-cv-row]')].map((x) => x.dataset.kind),
      labs: [...pn.querySelectorAll('.lfc-lab')].map((x) => x.textContent),
      vals: [...pn.querySelectorAll('.lfc-val')].map((x) => parseFloat(x.textContent.replace('−', '-'))),
      weak: pn.querySelectorAll('.lfc-n.warn-n').length,
      chips: Object.fromEntries([...pn.querySelectorAll('[data-cv-kind]')].map((b) => [b.dataset.cvKind || 'All', +b.querySelector('.cv-n').textContent])),
    };
  });
  const r0 = await read();
  const mixed = new Set(r0.kinds).size > 1;                        // positive control: kinds differ before filtering
  await p.click('[data-cv-switch="resp"]');
  await p.click('[data-cv-switch="expressed"]');
  const r1 = await read();
  const respOk = /^112 of 165 contrasts match/.test(r1.summary) && r1.median === '0.674';
  await p.click('[data-cv-switch="resp"]'); await p.click('[data-cv-switch="expressed"]');
  await p.click('[data-cv-kind="Phytohormone"]');
  const r2 = await read();
  const kindOk = r2.kinds.length > 0 && r2.kinds.every((k) => k === 'Phytohormone')
    && new RegExp(`^${r0.chips.Phytohormone} of 165`).test(r2.summary);
  await p.click('[data-cv-kind=""]');
  await p.selectOption('[data-cv-sort]', 'down');
  const r3 = await read();
  const sortOk = r3.vals.every((v, i) => i === 0 || v >= r3.vals[i - 1]) && r3.vals[0] < 0;
  await p.selectOption('[data-cv-sort]', 'abs');
  await p.selectOption('[data-cv-tissue]', 'xylem');
  const r4 = await read();
  const tissueOk = r4.labs.length > 0 && r4.labs.every((t) => / · xylem( · |$)/.test(t));
  await p.selectOption('[data-cv-tissue]', '');
  await p.click('[data-cv-switch="replicated"]');
  await p.click('.cv-more');
  const r5 = await read();
  const n5 = +(r5.summary.match(/^(\d+) of/) || [])[1];
  const repOk = r5.weak === 0 && r5.vals.length === n5 && n5 === 160;
  const parts = { mixed, respOk, kindOk, sortOk, tissueOk, repOk };
  const ok = !errs.length && Object.values(parts).every(Boolean);
  if (!ok) failures++;
  console.log(`\n### expression:contrast-view-controls  ${ok ? 'OK' : 'FAIL'}  ${Object.entries(parts).filter(([, v]) => !v).map(([k]) => k).join(' ') || 'all parts'}`);
  if (!ok) console.log('   ' + JSON.stringify({ r1: r1.summary, m: r1.median, r2: r2.summary, r3: r3.vals.slice(0, 4), r4: r4.labs.slice(0, 2), r5: r5.summary, w: r5.weak }));
  errs.forEach((e) => console.log('   !! ' + e));
  await p.screenshot({ path: `${outdir}/contrast-view.png` });
  await p.close();
}

// Search engine (0.21): each kind of query lands on the gene a reader means, the dropdown is a
// working combobox from the keyboard, and no query reads a gene file. The positive control drops
// the "cesa8" token from its shard; the same assertion must then fail, or it proves nothing.
{
  async function ask(p, q) {
    await p.fill('#q', '');
    await p.fill('#q', q);
    await p.waitForSelector(`#hits[data-query="${q}"]`, { timeout: 20000 }).catch(() => {});
    return p.evaluate(() => ({
      opts: [...document.querySelectorAll('#hits [role=option]')].map((a) => a.textContent.trim()),
      notes: [...document.querySelectorAll('#hits .hits-note')].map((n) => n.textContent).join(' / '),
      status: document.getElementById('hits-status').textContent }));
  }
  const cesa = (r) => r.opts.length > 0 && /CESA8: Arabidopsis gene name/.test(r.opts[0]);
  const p = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  let geneFiles = 0;
  p.on('request', (r) => { if (/\/data\/genes\//.test(r.url())) geneFiles++; });
  await p.goto(base + '/#/', { waitUntil: 'networkidle' });
  const res = {};
  for (const q of ['CESA8', 'irx1', 'AT1G20440', 'Potri.001G000400', 'cellulose synthase', 'dehydrogenaze', 'qwertyzz'])
    res[q] = await ask(p, q);
  const filesAfterQueries = geneFiles;
  const okCesa = cesa(res.CESA8);
  const okIrx = /IRX1: /.test(res.irx1.opts[0] || '');
  const okAt = res.AT1G20440.opts.some((o) => o.startsWith('PtXaTreH.')) && res.AT1G20440.opts.some((o) => o.startsWith('PtXaAlbH.'));
  const okPotri = res['Potri.001G000400'].opts.some((o) => /P\. trichocarpa ortholog: potri\.001g000400/i.test(o));
  const okWords = res['cellulose synthase'].opts.length >= 10 && !res['cellulose synthase'].notes;
  const okTypo = /dehydrogenaze → dehydrogenase/.test(res.dehydrogenaze.notes) && res.dehydrogenaze.opts.length > 0;
  const okNone = res.qwertyzz.opts.length === 0 && /Nothing matches/.test(res.qwertyzz.notes) && res.qwertyzz.status === 'no results';
  // keyboard: ArrowDown marks the first option active, Enter opens it
  await ask(p, 'CESA8');
  await p.press('#q', 'ArrowDown');
  const kb = await p.evaluate(() => ({ exp: document.getElementById('q').getAttribute('aria-expanded'),
    act: document.getElementById('q').getAttribute('aria-activedescendant'),
    sel: document.querySelector('#hits [aria-selected=true]')?.id || null }));
  await p.press('#q', 'Enter');
  await p.waitForTimeout(500);
  const okKb = kb.exp === 'true' && kb.act === 'hit-0' && kb.sel === 'hit-0' && /^#\/gene\/PtXa/.test(await p.evaluate(() => location.hash));
  await p.close();
  // positive control
  const pc = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await pc.route('**/data/index/search/c.json*', async (route) => {
    const r = await route.fetch(); const j = await r.json(); delete j.cesa8;
    await route.fulfill({ response: r, body: JSON.stringify(j) });
  });
  await pc.goto(base + '/#/', { waitUntil: 'networkidle' });
  const ctrl = cesa(await ask(pc, 'CESA8'));
  await pc.close();
  const parts = { okCesa, okIrx, okAt, okPotri, okWords, okTypo, okNone, okKb, noGeneFiles: filesAfterQueries === 0, controlFails: !ctrl };
  const ok = !errs.length && Object.values(parts).every(Boolean);
  if (!ok) failures++;
  console.log(`\n### search:engine  ${ok ? 'OK' : 'FAIL'}  ${Object.entries(parts).filter(([, v]) => !v).map(([k]) => k).join(' ') || 'all parts'}`);
  if (!ok) for (const [q, r] of Object.entries(res)) console.log(`   ${q}: ${r.status} | ${r.notes} | ${r.opts.slice(0, 2).join(' || ').slice(0, 220)}`);
  errs.forEach((e) => console.log('   !! ' + e));
}

await browser.close();
console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}`);
process.exit(failures ? 1 : 0);
