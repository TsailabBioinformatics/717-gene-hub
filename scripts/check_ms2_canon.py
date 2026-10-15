#!/usr/bin/env python3
"""Check the atlas against ms2-lsg's canonical tables, gene by gene. The second check that
looks outward (check_facts.py is the first, for ms1-dup).

WHY. The LSG layers the atlas publishes -- the pool, both panels' ranks, the QC flags, the
peptide evidence -- are copies of ms2-lsg tables. Every other check here compares the atlas
with itself, and all of them passed while the site served a withdrawn pool for four days
(2026-09-06 to 09-10). A per-gene comparison against the owner's tables is stronger than any
count: a count can agree while the membership differs.

PINNED, NOT VENDORED. sources/ms2_canon.pin.json names an ms2-lsg commit and each table's git
blob ID and carries no values, because this repo's root is public. The tables are read through
`git show <commit>:<path>`, so whatever branch the local ms2-lsg clone has checked out does not
matter -- that clone is routinely on another session's branch.

UPSTREAM MOVED? (section 0, added 2026-09-26). A pin proves the atlas agrees with the tables it
pinned, not that the owner still stands by them. From 2026-09-21 to 09-26 every pinned table was
byte-identical upstream while the owner's RULING on them was reversed (CORRECTIONS C4 -> C5), and
this check passed throughout. So it now also compares each pinned blob, and the corrections log,
with the clone's origin/main. It does not fetch (a check should not touch the network); it says
how old the last fetch is instead.

REFUSES RATHER THAN SKIPS. No clone, a missing commit, or a blob ID that does not match the pin
all exit 1 with the reason. "Could not run" is not "passed".

Needs a clone of ChenHsieh/ms2-lsg (private), so it runs on a maintainer's machine, not in CI.
"""
import roots
import collections
import glob
import gzip
import hashlib
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PIN = os.path.join(ROOT, "sources", "ms2_canon.pin.json")

MS2_CANDIDATES = [roots.root("ms2_lsg")]

fails = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  -- {detail}" if detail else ""))
    if not ok:
        fails.append(name)


def refuse(msg):
    print(f"\nREFUSED: {msg}")
    sys.exit(1)


def load_tables():
    if not os.path.exists(PIN):
        refuse(f"{os.path.relpath(PIN, ROOT)} is missing")
    pin = json.load(open(PIN))
    commit = pin["ms2_lsg_commit"]
    roots = [r for r in MS2_CANDIDATES if r and os.path.exists(os.path.join(r, ".git"))]  # worktree: .git is a file
    if not roots:
        refuse("no ms2-lsg clone found (set MS2_LSG_ROOT). This check does not skip.")
    for root in roots:
        ok = subprocess.run(["git", "-C", root, "cat-file", "-e", f"{commit}^{{commit}}"],
                            capture_output=True).returncode == 0
        if not ok:
            continue
        out = {}
        for path, blob in pin["tables"].items():
            got = subprocess.run(["git", "-C", root, "rev-parse", f"{commit}:{path}"],
                                 capture_output=True, text=True).stdout.strip()
            if got != blob:
                refuse(f"{path} at {commit[:9]} is blob {got or 'ABSENT'}, the pin says "
                       f"{blob}. The table moved or the pin is wrong: read it, then refresh.")
            raw = subprocess.run(["git", "-C", root, "cat-file", "blob", blob],
                                 capture_output=True, check=True).stdout
            if path.endswith(".gz"):
                raw = gzip.decompress(raw)
            lines = raw.decode().splitlines()
            head = lines[0].split("\t")
            out[path] = [dict(zip(head, ln.split("\t"))) for ln in lines[1:] if ln]
        print(f"ms2-lsg tables read from {root} @ {commit[:9]}, every blob ID matches the pin")
        return out, root, pin
    refuse(f"commit {commit[:9]} is not in any ms2-lsg clone found ({', '.join(roots)}). "
           "Fetch it (safe: this reads a commit, not HEAD).")


def ruling_section(text, heading_prefix):
    """The corrections-log entry the atlas follows: its heading line through the line before the
    next `---` rule or `## ` heading. None if the heading is gone."""
    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.startswith(heading_prefix)), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines))
                if lines[i].strip() == "---" or lines[i].startswith("## ")), len(lines))
    return "\n".join(lines[start:end]).strip() + "\n"


def section_sha(text, heading_prefix):
    sec = ruling_section(text, heading_prefix)
    return None if sec is None else hashlib.sha256(sec.encode()).hexdigest()


def upstream_moved(root, pin):
    """Section 0: has ms2-lsg main moved past the pin in a way that touches the atlas?

    Two separate questions, so a failure says which: did the RULING the atlas follows change
    (the pinned section's own hash), and did the log merely GROW (the file's blob). Both fail;
    the second prints the headings added since the pin, so a re-pin is a short read."""
    print("[0] the pin against ms2-lsg origin/main (the owner's current state)")
    head = subprocess.run(["git", "-C", root, "rev-parse", "--verify", "-q", "origin/main"],
                          capture_output=True, text=True).stdout.strip()
    if not head:
        check("origin/main exists in the ms2-lsg clone", False, "fetch it: git fetch origin main")
        return
    fh = os.path.join(root, ".git", "FETCH_HEAD")
    age = (f"last fetch {(time.time() - os.path.getmtime(fh)) / 3600:.1f} h ago"
           if os.path.exists(fh) else "never fetched")
    print(f"      origin/main = {head[:9]} ({age}); pin = {pin['ms2_lsg_commit'][:9]}")
    blob_text = lambda ref: subprocess.run(["git", "-C", root, "cat-file", "-p", ref],
                                           capture_output=True, text=True).stdout
    rs = pin.get("ruling_section")
    if rs:
        log_path = next(iter(pin["corrections_log"]))
        now_sha = section_sha(blob_text(f"{head}:{log_path}"), rs["heading_prefix"])
        check(f"the ruling the atlas follows is unchanged on origin/main ({rs['heading_prefix'][3:]})",
              now_sha == rs["sha256"],
              "" if now_sha == rs["sha256"] else
              ("its heading is gone from the log" if now_sha is None
               else "its text changed: read it before anything else"))
    for path, blob in (pin.get("corrections_log") or {}).items():
        old = {ln for ln in blob_text(blob).splitlines() if ln.startswith("## ")}
        new = [ln for ln in blob_text(f"{head}:{path}").splitlines()
               if ln.startswith("## ") and ln not in old]
        for ln in new:
            print(f"      new in {path}: {ln[3:]}")
    watched = dict(pin["tables"])
    watched.update(pin.get("corrections_log") or {})
    for path, blob in watched.items():
        now = subprocess.run(["git", "-C", root, "rev-parse", f"{head}:{path}"],
                             capture_output=True, text=True).stdout.strip()
        what = ("a new correction upstream: read it, then refresh the pin"
                if path in (pin.get("corrections_log") or {}) else "the table changed upstream")
        check(f"{path} unchanged on origin/main", now == blob,
              "" if now == blob else f"{what} ({blob[:9]} -> {now[:9] or 'ABSENT'})")


def rank_of(v):
    return None if v in ("", "nan", "NA", None) else int(float(v))


def yes(v):
    return str(v).strip() == "True"


def load_shards():
    genes = {}
    for hap in ("hap1", "hap2"):
        paths = (sorted(glob.glob(os.path.join(DATA, "genes", hap, "*", "*.json")))
                 + sorted(glob.glob(os.path.join(DATA, "genes", hap, "*.json"))))
        for p in paths:
            for gid, rec in json.load(open(p)).items():
                genes[gid] = (hap.upper(), rec)
    return genes


def gene_class(r):
    """The owning analysis's age classes (make_proteomics_v2_source.py copies them)."""
    if r is None:
        return "unassigned"
    if r <= 2:
        return "PS1_2_ancient"
    if r <= 12:
        return "PS3_12_conserved"
    if r <= 15:
        return "PS13_15_rosids"
    if r <= 17:
        return "PS16_17_salicaceae"
    return "LSG_PS18_populus" if r == 18 else "LSG_PS19_hybrid"


def main():
    T, root, pin = load_tables()
    genes = load_shards()
    man = json.load(open(os.path.join(DATA, "meta", "manifest.json")))
    print(f"atlas shards: {len(genes):,} genes\n")

    upstream_moved(root, pin)

    # ---- 1. phylostratigraphy: the rerun is the pool, the frozen call kept beside it -------
    # C5 (Chen, 2026-09-21 evening, reconfirmed 2026-09-26): the pool is the genEra rerun that
    # added Idesia, 776/835. So ps.* must be lsg_pool_idesia.tsv.gz, and ps.frz the frozen call
    # (lsg_pool.tsv) wherever its rank differs, as provenance.
    print("\n[1] ps.* against lsg_pool_idesia.tsv.gz (the pool) and lsg_pool.tsv (frozen call)")
    frozen = {}
    for r in T["pipeline/out/lsg_pool.tsv"]:
        frozen[r["gene_id"]] = r          # one gene sits on two label rows; identical otherwise
    pool = {r["gene_id"]: r for r in T["pipeline/out/lsg_pool_idesia.tsv.gz"]}
    check("same 63,960 genes in both tables and the atlas",
          set(pool) == set(genes) == set(frozen) and len(pool) == 63960,
          f"canon-only {len(set(pool) - set(genes))}, atlas-only {len(set(genes) - set(pool))}")
    bad = collections.defaultdict(list)
    for gid, r in pool.items():
        f = frozen[gid]
        ps = (genes.get(gid, (None, {}))[1].get("ps")) or {}
        rank, fz_rank = rank_of(r["rank"]), rank_of(f["rank"])
        if ps.get("rank") != rank:
            bad["rank"].append(gid)
        if bool(ps.get("lsg")) != yes(r["is_lsg"]):
            bad["pool membership"].append(gid)
        if r["phylostratum"] not in ("", "nan") and ps.get("name") != r["phylostratum"]:
            bad["stratum name"].append(gid)
        if rank is not None and r["tax_rep"] not in ("", "nan") and \
                (ps.get("tr") is None or abs(float(r["tax_rep"]) - ps["tr"]) > 0.051):
            bad["tax_rep"].append(gid)
        if fz_rank != rank_of(r["frozen_rank"]):
            bad["the two tables' frozen ranks"].append(gid)
        fz = ps.get("frz")
        if fz_rank != rank:
            if not fz or fz.get("rank") != fz_rank or bool(fz.get("lsg")) != yes(f["is_lsg"]):
                bad["frozen call"].append(gid)
        elif fz:
            bad["frozen call where the two agree"].append(gid)
        if "rr" in ps:
            bad["leftover ps.rr"].append(gid)
    for k in ("rank", "pool membership", "stratum name", "tax_rep", "the two tables' frozen ranks",
              "frozen call", "frozen call where the two agree", "leftover ps.rr"):
        check(f"per-gene {k}", not bad[k], f"{len(bad[k])}, e.g. {bad[k][:3]}" if bad[k] else "")

    want = collections.Counter()
    for gid, r in pool.items():
        h = r["hap"]
        if yes(r["is_lsg"]):
            want[(h, "pool", rank_of(r["rank"]))] += 1
        if yes(frozen[gid]["is_lsg"]):
            want[(h, "frozen", 0)] += 1
            if not yes(r["is_lsg"]):
                want[(h, "left", 0)] += 1
    lp = man.get("lsg_pool") or {}
    for h in ("HAP1", "HAP2"):
        p18, p19 = want[(h, "pool", 18)], want[(h, "pool", 19)]
        print(f"      {h}: pool {p18 + p19:,} ({p18} PS18 + {p19} PS19); frozen call "
              f"{want[(h, 'frozen', 0)]}; left the pool {want[(h, 'left', 0)]}")
        check(f"manifest lsg_pool.pool {h}", (lp.get("pool") or {}).get(h.lower()) == p18 + p19)
        check(f"manifest lsg_pool.pool PS18/PS19 {h}",
              ((lp.get("pool") or {}).get("ps18_ps19", {}).get(f"{h}_PS18"),
               (lp.get("pool") or {}).get("ps18_ps19", {}).get(f"{h}_PS19")) == (p18, p19))
        fz_m = (lp.get("frozen") or {})
        check(f"manifest lsg_pool.frozen counts {h}",
              ((fz_m.get("at_rank_18_or_above") or {}).get(h.lower()),
               (fz_m.get("left_the_pool") or {}).get(h.lower()))
              == (want[(h, "frozen", 0)], want[(h, "left", 0)]))

    # ---- 2. QC flags: the two C5 checks on every pool gene ----------------------------------
    print("\n[2] qc.* against lsg_pool_flags_newpool.tsv (C5 flags) + lsg_pool_synteny.tsv")
    flags = {r["gene_id"]: r for r in T["pipeline/out/lsg_pool_flags_newpool.tsv"]}
    syn = {r["gene_id"]: r for r in T["pipeline/out/lsg_pool_synteny.tsv"]}
    pool_genes = {g for g, r in pool.items() if yes(r["is_lsg"])}
    has_qc = {g for g, (_, rec) in genes.items() if rec.get("qc")}
    check("canon: the flag table covers exactly the pool", set(flags) == pool_genes,
          f"{len(set(flags) ^ pool_genes)} genes differ")
    check("a qc record on every pool gene, and on nothing else", has_qc == pool_genes,
          f"missing {len(pool_genes - has_qc)}, extra {len(has_qc - pool_genes)}")
    check("canon: the flag table's rank is the pool's rank",
          all(rank_of(flags[g]["rank"]) == rank_of(pool[g]["rank"]) for g in set(flags) & set(pool)))
    fields = {"ret": ("tblastn_retract", yes), "abs": ("hdf_reject", yes),
              "post": ("unflagged", yes), "hdf": ("HDF_flag", str), "verdict": ("verdict", str)}
    sfields = {"syn_any": "contested_any", "syn_og": "og_contested", "syn_twin": "twin_contested"}
    qbad = collections.defaultdict(list)
    for g in pool_genes & has_qc & set(flags):
        q = genes[g][1]["qc"]
        for k, (col, cast) in fields.items():
            w = cast(flags[g][col])
            a = q.get(k) if cast is str else bool(q.get(k))
            if w != a:
                qbad[k].append(g)
        for k, col in sfields.items():
            if (syn[g][col] == "1") != bool(q.get(k)):
                qbad[k].append(g)
        if (syn[g]["sens_stable"] == "True") != (q.get("stable") is not False):
            qbad["stable (sens_stable)"].append(g)
        if "rr" in q or "wgd" in q:
            qbad["no C4 flag (rr, wgd)"].append(g)
    for k in list(fields) + list(sfields) + ["stable (sens_stable)", "no C4 flag (rr, wgd)"]:
        check(f"per-gene qc {k}", not qbad[k], f"{len(qbad[k])}, e.g. {qbad[k][:3]}" if qbad[k] else "")
    tally = collections.Counter()
    for r in flags.values():
        for col in ("hdf_reject", "tblastn_retract", "unflagged"):
            tally[(col, r["hap"])] += yes(r[col])
    got = {c: (tally[(c, "HAP1")], tally[(c, "HAP2")]) for c in ("hdf_reject", "tblastn_retract", "unflagged")}
    check(f"flag counts per haplotype = {got} (the chapter's Results 3.1: 84/106, 96/104, 602/635)",
          got == {"hdf_reject": (84, 106), "tblastn_retract": (96, 104), "unflagged": (602, 635)})

    # ---- 3. peptide evidence, per dataset x haplotype x age class ---------------------------
    print("\n[3] prot.ms against aspen_detection_by_class.tsv")
    n, det = collections.Counter(), collections.Counter()
    for gid, (hap, rec) in genes.items():
        ps = rec.get("ps") or {}
        c = gene_class(ps.get("rank"))   # the owner reports the rerun's strata, which ps.rank is
        ds = ((rec.get("prot") or {}).get("ms") or {}).get("ds") or []
        n[(hap, c)] += 1
        for d in ds:
            det[(d, hap, c)] += 1
        if ds:   # the owner's table also carries a union row set: detected in ANY dataset
            det[("UNION_all_datasets", hap, c)] += 1
    cells = T["analyses/proteomics_translation_evidence/results/aspen_detection_by_class.tsv"]
    cbad = [f"{r['dataset']} {r['hap']} {r['gene_class']}" for r in cells
            if (n[(r["hap"], r["gene_class"])], det[(r["dataset"], r["hap"], r["gene_class"])])
            != (int(r["n_genes"]), int(r["n_detected"]))]
    check(f"all {len(cells)} dataset x haplotype x class cells", not cbad,
          f"{len(cbad)} differ, e.g. {cbad[:3]}" if cbad else "")

    # ---- 4. founder families: the same run as the pool --------------------------------------
    FND = "data/founder_families_rerun_20260926/founder_family_per_gene.tsv.gz"
    if FND in T:
        print("\n[4] ps.fnd against founder_family_per_gene.tsv.gz (the pool's genEra run)")
        fam = {r["gene_id"]: r for r in T[FND]}
        fbad = collections.defaultdict(list)
        for gid, (_, rec) in genes.items():
            ps = rec.get("ps") or {}
            r, f = fam.get(gid), ps.get("fnd")
            if r is None or rank_of(r["gene_rank"]) is None:
                if f is not None:
                    fbad["a family where the run has none"].append(gid)
                continue
            if rank_of(r["gene_rank"]) != ps.get("rank"):
                fbad["gene rank (a different run)"].append(gid)
            if not f or f.get("rank") != rank_of(r["family_rank"]) or f.get("fam") != int(r["family_size"]):
                fbad["family rank and size"].append(gid)
        for k in ("gene rank (a different run)", "family rank and size", "a family where the run has none"):
            check(f"per-gene fnd: {k}", not fbad[k], f"{len(fbad[k])}, e.g. {fbad[k][:3]}" if fbad[k] else "")

    print(f"\n{len(fails)} FAIL" + (f": {fails}" if fails else ""))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
