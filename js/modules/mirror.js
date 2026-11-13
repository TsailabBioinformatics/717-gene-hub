// Module: mirror. The gene's locus on both phased haplotypes, drawn with the shared locus
// browser (core/locusbrowser.js) -- the same draggable view as the genome map, the array page
// and the pair page. The gene is highlighted on its own haplotype and its allele on the other,
// joined by a solid line; when it has no allele, the nearest neighbors' alleles line the two
// haplotypes up and are drawn dashed, so they are not mistaken for this gene's allele.
//
// This replaced a fixed canvas (no zoom, no exon structure) and the folded single-haplotype
// Locus strip below it: one view at several resolutions instead of three figures.
import { el } from '../core/dom.js';
import { getGene } from '../core/data.js';
import { genesIn, matchingRegion } from '../core/locusfig.js';
import { chromosomeBrowser, HAP_LABEL } from '../core/locusbrowser.js';
import { categoryName } from '../core/relationship.js';

function geneCard(g) {
  if (!g.chr || !/^Chr\d+$/.test(g.chr)) return null;
  const other = g.hap === 'hap1' ? 'hap2' : 'hap1';
  const otherShort = HAP_LABEL[other].split(' ')[0];
  const holder = el('div', {}, el('p', { class: 'muted' }, 'Loading the locus on both haplotypes…'));
  const caption = el('p', { class: 'arr-note', style: 'margin:0 0 8px' });
  const card = el('div', { class: 'card' },
    el('h2', {}, `This locus on ${otherShort} too`, el('span', { class: 'tag' }, 'both haplotypes, drag to move')),
    caption, holder);

  (async () => {
    const pad = Math.max(60000, (g.end - g.start) * 3);
    let partner = null;
    if (g.allele && g.allele.id) partner = await getGene(g.allele.id).catch(() => null);
    let anchors = new Set();
    let otherChr = partner ? partner.chr : g.chr;
    if (partner) {
      caption.textContent = `${HAP_LABEL[g.hap]} above, ${HAP_LABEL[other]} below. This gene and its allele `
        + `${partner.id} are highlighted and joined by the solid line; grey lines are the other allele pairs in view.`;
    } else {
      const wide = await genesIn(g.hap, g.chr, g.start - 3e5, g.end + 3e5);
      const region = await matchingRegion(g.hap, wide, [g.id], 6, 2);
      if (region) { anchors = new Set(region.anchors.map(([x]) => x)); otherChr = region.chr; }
      const cat = categoryName(g.rel && g.rel.c);
      caption.textContent = `${HAP_LABEL[g.hap]} above, ${HAP_LABEL[other]} below. This gene has no syntelog `
        + `partner on ${otherShort}, so none is drawn for it${cat ? ` (relationship category: ${cat})` : ''}. `
        + (region ? `The lower haplotype is lined up by ${anchors.size} neighboring genes' alleles (dashed).`
          : 'No nearby gene has an allele either, so the lower haplotype is not lined up.');
    }
    holder.replaceChildren(await chromosomeBrowser({
      hap: g.hap, chr: g.chr, otherChr, start: Math.max(0, g.start - pad), end: g.end + pad, embed: true,
      focus: new Set([g.id]), linked: new Set(partner ? [partner.id] : []), anchors,
      focusLabel: partner ? 'this gene and its allele' : 'this gene' }));
  })().catch((e) => { holder.replaceChildren(el('p', { class: 'muted' }, `Locus unavailable: ${e.message}`)); });
  return card;
}

export default { id: 'mirror', label: 'Both haplotypes', geneCard };
