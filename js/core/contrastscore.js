// One gene's fold change in every shipped contrast, from its 652-sample vector and the control
// and perturbation sample indices in data/expr/contrasts.json. Shared by the Expression card's
// Contrasts view and the study pages, so the two cannot compute it differently.
//
// +1 TPM before the ratio: without it a control at 0 gives an infinite fold change, and the
// largest "responses" in the panel would all be genes that were simply off.
export function contrastRows(vec, contrasts) {
  const rows = [];
  for (const c of contrasts) {
    const ctrl = (c.ctrl || []).filter((i) => i < vec.length).map((i) => vec[i]);
    const pert = (c.pert || []).filter((i) => i < vec.length).map((i) => vec[i]);
    if (!ctrl.length || !pert.length) continue;
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const mc = mean(ctrl), mp = mean(pert);
    rows.push({
      id: c.id,
      lfc: Math.log2((mp + 1) / (mc + 1)),
      nc: ctrl.length, np: pert.length,
      base: Math.max(mc, mp),
      tissue: c.tissue, kind: c.kind, within: c.within || '', sub: c.sub || '', tier: c.tier || '',
      study: +((/^s(\d+)\./.exec(c.id) || [])[1] || 0),
      label: `${c.pert_label} vs ${c.control_label}`,
      resp: !!c.resp,   // one of the 149 perturbation contrasts behind the responsiveness value
    });
  }
  return rows;
}
