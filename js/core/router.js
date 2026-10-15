// Hash router. Hash (not history API) so it works on GitHub Pages under a project subpath
// with no server rewrite rules.
import { disposeTree } from './lifecycle.js';

const routes = [];
export function route(pattern, handler) { routes.push({ pattern, handler }); }

// A route can outlive the URL that started it: a slow gene shard may finish after a reader
// follows another link. Each render therefore gets an identity. Handlers receive a context
// whose `isCurrent()` answers whether their eventual result may still update the page.
let renderGeneration = 0;
let activeScope = null;

// Each page names itself in the tab title, and after a navigation keyboard focus moves to the
// page heading, so a screen reader announces the new page instead of staying silent. Pages
// build their heading after data arrives, so the heading is picked up when it appears.
const SITE = '717 gene atlas';
let headingWanted = null;     // { generation, focus } until this render's heading shows up
let firstRender = true;

function settleHeading() {
  if (!headingWanted || headingWanted.generation !== renderGeneration) return;
  const view = document.getElementById('view');
  const h = view && view.querySelector('h1, .empty > h2');
  if (!h) return;
  const text = h.textContent.replace(/\s+/g, ' ').trim();
  document.title = !text || text.includes(SITE) ? SITE : `${text} · ${SITE}`;
  if (headingWanted.focus) {
    const a = document.activeElement;
    // Leave focus alone if the reader is already working inside the new page.
    if (!a || a === document.body || !a.isConnected || a.closest('header')) {
      if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  }
  headingWanted = null;
}

// Route handlers can build DOM before an awaited fetch settles. Keep those detached roots in
// the route scope so an error or a newer navigation releases their observers as well.
function makeScope(generation) {
  const roots = new Set();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    [...roots].reverse().forEach((root) => disposeTree(root));
    roots.clear();
  };
  return {
    track(root) {
      if (!root) return root;
      if (disposed || generation !== renderGeneration) disposeTree(root);
      else roots.add(root);
      return root;
    },
    dispose,
  };
}

function replaceView(node) {
  const view = document.getElementById('view');
  if (!view) return;
  disposeTree(view, { includeRoot: false });
  view.replaceChildren(node);
  window.scrollTo(0, 0);
}

function notFound(path) {
  const root = document.createElement('div');
  root.className = 'empty';
  const title = document.createElement('h2');
  title.textContent = 'Not found';
  const detail = document.createElement('p');
  detail.className = 'mono';
  detail.textContent = path;
  root.append(title, detail);
  replaceView(root);
}

function routeError(path, error, retry) {
  const root = document.createElement('div');
  root.className = 'empty';
  const title = document.createElement('h2');
  title.textContent = 'Could not load this page';
  const explanation = document.createElement('p');
  explanation.textContent = 'The atlas data could not be loaded. Check your connection and try again.';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Try again';
  button.addEventListener('click', retry);
  const detail = document.createElement('p');
  detail.className = 'muted mono';
  detail.style.fontSize = '12px';
  detail.textContent = `${path}: ${error && error.message ? error.message : String(error)}`;
  root.append(title, explanation, button, detail);
  replaceView(root);
}

export function navigate(path) {
  if (location.hash.slice(1) === path) render();
  else location.hash = path;
}

/** The `?a=b&c=d` part of the current hash, as a plain object. Empty when there is none.
 *  Routes match against the path only (see render), so a view that wants query state asks
 *  for it here rather than parsing its own arguments. */
export function query() {
  const raw = location.hash.slice(1);
  const i = raw.indexOf('?');
  if (i < 0) return {};
  const out = {};
  for (const [k, v] of new URLSearchParams(raw.slice(i + 1))) out[k] = v;
  return out;
}

/** Rewrite the query part WITHOUT navigating. Setting location.hash would fire hashchange,
 *  re-run the route and rebuild the view from scratch, throwing away the very state we are
 *  trying to record. replaceState leaves the URL shareable and the view untouched. */
export function setQuery(params) {
  const raw = location.hash.slice(1);
  const path = raw.split('?')[0] || '/';
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  history.replaceState(null, '', '#' + path + (qs ? '?' + qs : ''));
}

export function render() {
  const generation = ++renderGeneration;
  headingWanted = { generation, focus: !firstRender };
  firstRender = false;
  activeScope?.dispose();
  const scope = makeScope(generation);
  activeScope = scope;
  const path = (location.hash.slice(1) || '/').split('?')[0];
  for (const { pattern, handler } of routes) {
    const m = pattern.exec(path);
    if (!m) continue;
    const context = Object.freeze({
      isCurrent: () => generation === renderGeneration,
      retry: () => {
        if (generation === renderGeneration) render();
      },
      track: (root) => scope.track(root),
    });
    try {
      const result = handler(...m.slice(1), context);
      // Route failures used to leave the route's loading message in place indefinitely.
      // Catch them here, once, and only paint the error if this is still the active route.
      Promise.resolve(result).catch((error) => {
        scope.dispose();
        if (context.isCurrent()) routeError(path, error, context.retry);
      });
      return result;
    } catch (error) {
      scope.dispose();
      if (context.isCurrent()) routeError(path, error, context.retry);
      return undefined;
    }
  }
  notFound(path);
}

export function start() {
  addEventListener('hashchange', render);
  const view = document.getElementById('view');
  if (view && typeof MutationObserver === 'function') {
    new MutationObserver(settleHeading).observe(view, { childList: true, subtree: true });
  }
  render();
  settleHeading();
}
