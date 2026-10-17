// Read an APA-style citation string into its parts, for labelling a study by its paper rather
// than by its serial number. Every field is null when the string does not have that shape;
// callers fall back to "Study N", never to a guess.
//   "Georgii, E., Kugler, K., ... (2019). The systems architecture ... . The Plant Cell, 31(2), ..."
/** The citation as published, without the curation notes some entries carry after it
 *  ("Set the title in italics...", "If the lab prefers personal attribution..."). Those notes
 *  were written for whoever formats the reference list and follow the first URL, so the
 *  reference ends there. Entries without a URL are returned whole. */
export function cleanCitation(citation) {
  if (!citation) return citation;
  const m = citation.match(/^[\s\S]*?https?:\/\/\S+?(?=[\s)]|$)/);
  return m ? m[0].replace(/[.,;]$/, '') : citation;
}

export function studyMeta(citation) {
  citation = cleanCitation(citation);
  const out = { title: null, firstAuthor: null, year: null, journal: null, dataset: false, url: null };
  if (!citation) return out;
  const y = citation.match(/\((\d{4})[a-z]?\)/);
  if (!y) return out;
  out.year = y[1];
  const url = citation.match(/https?:\/\/\S+$/);
  out.url = url ? url[0] : null;
  // Authors: "Surname, I. I." groups before the year. Two authors are named ("Kins & Janz"), three
  // or more are "First et al." (APA), and an institution with no initials is given as written.
  const authors = citation.slice(0, y.index).trim();
  const names = [...authors.matchAll(/(?:^|,\s*(?:&\s*)?|&\s*)([^,&]+?),\s+[A-Z]\.(?:[-\s]?[A-Z]\.)*/g)]
    .map((m) => m[1].trim());
  if (names.length >= 3 || /et al\.?|\.\.\./.test(authors)) out.firstAuthor = `${names[0] || authors.split(',')[0]} et al.`;
  else if (names.length === 2) out.firstAuthor = `${names[0]} & ${names[1]}`;
  else if (names.length === 1) out.firstAuthor = names[0];
  else if (authors && authors.length < 60) out.firstAuthor = authors.replace(/\.$/, '');
  const after = citation.slice(y.index + y[0].length).replace(/^\.\s*/, '');
  out.dataset = /\[Data set\]/i.test(after);
  if (out.dataset) {
    // "Title (accession) [Data set]. Repository. URL": the repository stands where a journal would
    const d = after.match(/^(.+?)\s*\[Data set\]\.\s*([^.]+)\./i);
    if (d) {
      out.title = d[1].replace(/\s*\((?:BioProject No\.|Accession No\.)?\s*[A-Z][\w-]*\d\)\s*$/, '').trim();
      out.journal = d[2].trim();
    }
    return out;
  }
  // "Title. Journal, vol(issue), pages. URL" or "Title. Journal. URL". The title may itself hold
  // periods ("Populus tremula x P. alba"), so the journal is the LAST period-free segment before
  // the volume or the link, and the title is everything before it.
  const a = after.match(/^(.*)\.\s+([^.]+?),\s*\d+(?:\(\d+\))?,\s*[^.]*\.\s*https?:/)
    || after.match(/^(.*)\.\s+([^.]+?)\.\s*https?:/);
  if (a) {
    out.title = a[1].trim();
    out.journal = a[2].trim();
  }
  return out;
}
