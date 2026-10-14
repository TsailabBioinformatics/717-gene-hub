// #/downloads -- the files behind the dissertation, served from this site with their checksums.
// The list is downloads/index.json, written by scripts/make_downloads.py from the release
// bundle; nothing on this page is typed by hand.
import { el, fmt } from '../core/dom.js';
import { SITE_URL, CONTACT, CITE_NOTE } from '../core/paper.js';

const size = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);

export async function downloadsView(man) {
  let idx = null;
  try {
    const r = await fetch('downloads/index.json', { cache: 'no-cache' });
    if (r.ok) idx = await r.json();
  } catch { /* shown below */ }
  const head = [el('h1', {}, 'Downloads'),
    el('p', { class: 'sub' },
      'Gene duplication and cross-haplotype tables, lineage-specific gene tables and the dissertation\u2019s supplementary tables, as versioned files with checksums. '
      + `Site data version ${man.data_version}.`)];
  if (!idx || !(idx.files || []).length) {
    return el('div', { 'data-downloads': 'empty' }, ...head,
      el('div', { class: 'card' },
        el('p', { style: 'margin:0' },
          'The release files are not posted yet. Until they are, the per-gene data of this site can be '
          + 'exported from ', el('a', { href: '#/browse' }, 'Browse'), ' (Export TSV), and requests can be sent to ',
          el('a', { href: `mailto:${CONTACT}` }, CONTACT), '.')));
  }
  const groups = [...new Set(idx.files.map((f) => f.group))];
  return el('div', { 'data-downloads': idx.files.length }, ...head,
    el('div', { class: 'card' },
      el('p', { style: 'margin:0 0 6px;font-size:13.5px' },
        `Release ${idx.release}. ${idx.files.length} files, ${size(idx.files.reduce((a, f) => a + f.bytes, 0))} in total. `
        + 'Check a download with ', el('span', { class: 'mono' }, 'md5sum <file>'), ' (', el('span', { class: 'mono' }, 'md5 <file>'),
        ' on macOS), or all of them against ', el('a', { href: 'downloads/MD5SUMS.txt' }, 'MD5SUMS.txt'), '.'),
      el('p', { style: 'margin:0 0 6px;font-size:13px', 'data-cite-note': '' }, CITE_NOTE),
      el('p', { class: 'muted', style: 'margin:0;font-size:12.5px' },
        'Data are provided for research use; please cite the atlas (see ', el('a', { href: '#/module/about' }, 'About'),
        ') and the underlying study for any expression data. The raw expression matrix is not distributed here; '
        + 'each study’s reads are public under the accessions in the RNA-seq library table.')),
    ...groups.map((g) => el('div', { class: 'card' },
      el('h2', {}, g),
      el('div', { class: 'scroll-x' }, el('table', { class: 'data', 'data-download-table': '' },
        el('thead', {}, el('tr', {}, el('th', {}, 'File'), el('th', { class: 'num' }, 'Size'),
          el('th', {}, 'Version'), el('th', {}, 'What it is'), el('th', {}, 'md5'))),
        el('tbody', {}, ...idx.files.filter((f) => f.group === g).map((f) => el('tr', {},
          el('td', {}, el('a', { href: f.href, download: '', class: 'mono' }, f.name)),
          el('td', { class: 'num' }, size(f.bytes)),
          el('td', {}, f.version || '–'),
          el('td', { style: 'font-size:12.5px' }, f.description || ''),
          el('td', { class: 'mono', style: 'font-size:11px' }, f.md5)))))))),
    el('p', { class: 'muted', style: 'font-size:12px' }, `Permanent address of this page: ${SITE_URL}#/downloads`));
}
