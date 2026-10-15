// Module: sequences. Protein, CDS, transcript and genomic gene span for every gene, from the
// Phytozome v5.1 primary transcripts on the v5.0 assembly (data/seq, build_sequences.py). One
// range request per gene page; nothing is fetched until the card is built.
import { el, fmt } from '../core/dom.js';
import { loadSequences } from '../core/data.js';
import { KINDS, fastaRecord, downloadText } from '../core/fasta.js';

function geneCard(g) {
  if (!g.sq) return null;
  const body = el('div', {}, el('p', { class: 'muted', style: 'margin:0' }, 'Fetching the sequences…'));
  const card = el('div', { class: 'card', 'data-card': 'sequence' },
    el('h2', {}, 'Sequences', el('span', { class: 'tag' }, 'Phytozome v5.1')), body);
  loadSequences(g).then((s) => {
    body.replaceChildren(
      el('table', { class: 'data seq-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Sequence'), el('th', { class: 'num' }, 'Length'), el('th', {}, ''))),
        el('tbody', {}, ...KINDS.map(([k, name, unit, ext, what]) => {
          const copy = el('button', { type: 'button', class: 'btn', 'data-seq-copy': k }, 'Copy');
          copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(s[k]); copy.textContent = 'Copied'; }
            catch { copy.textContent = 'Copy failed'; }
            setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
          });
          const dl = el('button', { type: 'button', class: 'btn', 'data-seq-download': k }, 'FASTA');
          dl.addEventListener('click', () => downloadText(`${g.id}.${k === 'p' ? 'protein' : name.toLowerCase()}.${ext}`, fastaRecord(g, k, s[k])));
          return el('tr', {}, el('td', {}, el('strong', {}, name), el('span', { class: 'muted seq-what' }, what)),
            el('td', { class: 'num mono' }, `${fmt(s[k].length)} ${unit}`), el('td', { class: 'seq-actions' }, copy, dl));
        }))),
      el('details', { class: 'seq-peek' }, el('summary', {}, 'Show the protein'),
        el('pre', { class: 'mono seq-pre' }, s.p.replace(/(.{60})/g, '$1\n'))),
      el('p', { class: 'muted', style: 'font-size:12px;margin:8px 0 0' },
        'The primary transcript of the annotation release. The genomic span is the gene record’s '
        + 'start to end on the assembly, so it includes the UTRs and introns but no flanking sequence; '
        + 'for promoter or flanking sequence, take the coordinates above to a genome browser.'));
  }).catch((e) => { body.replaceChildren(el('p', { class: 'muted' }, `Could not fetch the sequences: ${e.message}`)); });
  return card;
}

export default { id: 'sequence', label: 'Sequences', geneCard };
