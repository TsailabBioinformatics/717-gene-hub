// Tiny DOM helper. Deliberately not a framework -- the site has no build step.
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
export const fmt = (n) => (n == null ? '–' : n.toLocaleString('en-US'));
export const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '–');
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/** Smooth scrolling, unless the reader asked the system for reduced motion. */
export const scrollBehavior = () =>
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/** Jump to a section inside the page: scroll it to the top and move keyboard focus there, so
 *  Tab continues from the section and a screen reader reads it. Anchors cannot do this here,
 *  because the hash belongs to the router. */
export function jumpTo(node) {
  if (!node) return;
  node.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
  node.focus({ preventScroll: true });
}
