// Route: #/status -- the integrity gates this build actually passed, as a boot log.
//
// The About page tells a reader the data is validated. The evidence for that lived only in a
// terminal on the cluster: 76 gates ran, and the site published none of their verdicts. This
// is that record, written by `check()` as each gate executes, not summarised afterwards.
//
// ON THE AESTHETIC. The control-room look is borrowed deliberately and only where it is
// earned: a boot sequence with a right-aligned verdict column IS what this data is. What is
// NOT borrowed from that visual language is its decorative half -- no invented telemetry, no
// random callsign columns, no letter-scatter standing in for a point cloud. On a page whose
// entire argument is that its numbers are real, texture that imitates data would undo the
// argument it is dressing up.
//
// The one liberty taken is the dot leader, which is a genuine alignment device: it ties a long
// label to a right-aligned verdict across a wide screen, which is exactly the job it did on a
// teletype.
import { el, fmt } from '../core/dom.js';
import { loadManifest } from '../core/data.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** LABEL ........... VALUE, with the leader filling the actual gap. */
function leaderRow(label, value, ok) {
  return el('div', {
    style: `display:flex;align-items:baseline;gap:0;font-family:${MONO};font-size:12px;`
      + 'line-height:1.75;white-space:nowrap',
  },
    el('span', { style: 'overflow:hidden;text-overflow:ellipsis' }, label),
    el('span', {
      style: 'flex:1;min-width:14px;overflow:hidden;color:var(--line-2);'
        + 'margin:0 6px;letter-spacing:2px',
      'aria-hidden': 'true',
    }, '.'.repeat(200)),
    el('span', { style: `flex:none;color:${ok === false ? 'var(--c-disp)' : 'var(--ink-2)'}` },
      value));
}

/** The bracket-corner frame. Purely a frame -- it carries no value and pretends to none. */
function framed(...kids) {
  const corner = (pos) => el('span', {
    'aria-hidden': 'true',
    style: `position:absolute;${pos};width:14px;height:14px;border:1px solid var(--line-2);`
      + (pos.includes('top') ? 'border-bottom:none;' : 'border-top:none;')
      + (pos.includes('left') ? 'border-right:none;' : 'border-left:none;'),
  });
  return el('div', { style: 'position:relative;padding:14px 16px' },
    corner('top:0;left:0'), corner('top:0;right:0'),
    corner('bottom:0;left:0'), corner('bottom:0;right:0'),
    ...kids);
}

export async function statusView() {
  const man = await loadManifest();
  let gates = null;
  try {
    const r = await fetch(`data/meta/gates.json?v=${encodeURIComponent(man.data_version || '')}`);
    if (r.ok) gates = await r.json();
  } catch { /* handled below */ }

  if (!gates) {
    return el('div', {},
      el('h1', {}, 'Data checks'),
      el('div', { class: 'card' }, el('p', { style: 'margin:0' },
        'No check record is published for this release. Treat that as unknown, not as '
        + 'passed.')));
  }

  const stale = gates.data_version && man.data_version && gates.data_version !== man.data_version;
  const passed = gates.n_checks - gates.n_failed;

  return el('div', {},
    el('h1', {}, 'Data checks'),
    el('p', { class: 'sub' },
      'Every internal consistency check run over the published data, with its result, '
      + 'recorded as each check ran.'),

    stale ? el('div', { class: 'warn' },
      el('strong', {}, 'This record is from an earlier data release. '),
      `The checks were recorded against data v${gates.data_version}; the site is serving `
      + `v${man.data_version}. The results below describe the earlier release.`) : null,

    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(gates.n_checks)), el('div', { class: 'l' }, 'gates run')),
      el('div', { class: 'stat' }, el('div', { class: 'n' }, fmt(passed)), el('div', { class: 'l' }, 'passed')),
      el('div', { class: 'stat' },
        el('div', { class: 'n', style: gates.n_failed ? 'color:var(--c-disp)' : null }, fmt(gates.n_failed)),
        el('div', { class: 'l' }, 'failed')),
      el('div', { class: 'stat' }, el('div', { class: 'n mono', style: 'font-size:18px' }, `v${gates.data_version || '?'}`),
        el('div', { class: 'l' }, 'data version')),
    ),

    el('div', { class: 'card', style: 'padding:0;overflow:hidden' },
      framed(
        el('div', { style: `font-family:${MONO};font-size:11.5px;color:var(--ink-3);margin-bottom:10px` },
          `VALIDATE // ${gates.n_checks} GATES // DATA v${gates.data_version || '?'} // `
          + `STATUS: ${gates.n_failed ? 'FAILED' : 'NOMINAL'}`),
        ...gates.checks.map((c) => el('div', {},
          leaderRow(c.name, c.ok ? '[ OK ]' : '[ FAIL ]', c.ok),
          c.detail ? el('div', {
            style: `font-family:${MONO};font-size:11px;color:var(--ink-3);`
              + 'margin:-2px 0 4px 14px;white-space:normal',
          }, c.detail) : null)))),

    el('div', { class: 'card' },
      el('h2', {}, 'What these do and do not prove'),
      el('p', { style: 'margin:0;font-size:13.5px;color:var(--ink-2)' },
        'Each check tests the published data against itself: that a gene ID resolves to its '
        + 'record, that a link is not dangling, that a count matches the set it claims. None of '
        + 'them can tell you an upstream measurement or inference was correct, only that the '
        + '717 Gene Hub did not corrupt or contradict it.'),
      el('p', { class: 'muted', style: 'font-size:12.5px;margin:10px 0 0' },
        'A check that passes over zero rows proves nothing, and this project has shipped exactly '
        + 'that once: "every pointer resolves" passed while iterating over an empty set. Where a '
        + 'check asserts a count, the count is in its detail line above; that is the part worth '
        + 'reading.'),
      el('p', { class: 'muted', style: 'font-size:12.5px;margin:10px 0 0' },
        'The rendered-page checks are separate and run in a browser: ',
        el('span', { class: 'mono' }, 'scripts/check.mjs'),
        ', asserting what a reader actually sees.')));
}

export default { id: 'status', label: 'Status' };
