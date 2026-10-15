// FASTA helpers shared by the Sequences card, the gene header and Browse.
import { el } from './dom.js';
import { hapLabel, dataVersion } from './data.js';

export const KINDS = [
  ['p', 'Protein', 'aa', 'faa', 'protein (no terminal stop)'],
  ['c', 'CDS', 'nt', 'fna', 'coding sequence, start codon to stop codon'],
  ['t', 'Transcript', 'nt', 'fna', 'primary transcript, 5′ UTR to 3′ UTR'],
  ['g', 'Genomic', 'nt', 'fna', 'gene span on the assembly, exons and introns, on the gene’s strand'],
];

/** One FASTA record, wrapped at 60, with a header that says what and where it came from. */
export function fastaRecord(g, kind, seq) {
  const k = KINDS.find((x) => x[0] === kind);
  const where = `${g.chr}:${g.start}-${g.end}(${g.strand || '?'})`;
  return `>${g.id} ${k[1].toLowerCase()} len=${seq.length} ${hapLabel(g.hap)} ${where} `
    + `Phytozome v5.1, 717 atlas v${dataVersion()}\n${seq.replace(/(.{60})/g, '$1\n').replace(/\n$/, '')}\n`;
}

export function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

