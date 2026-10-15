#!/usr/bin/env python3
"""Sequences for every gene: protein, CDS, transcript and genomic gene span.

Reads the Phytozome v5.1 release on /work (primary transcript files, one per gene: 32,137 HAP1 +
31,823 HAP2 = every atlas gene) and the v5.0 genome assembly they are annotated on. Writes, per
haplotype, data/seq/seq_<hap>.gzb: one gzip member per gene, concatenated, each a JSON object
    {"p": protein, "c": CDS, "t": transcript (with UTRs), "g": genomic span}
and stamps each gene record with `sq = [offset, length]`, so a gene page fetches only its own
sequences with one HTTP range request (the same scheme as the expression vectors).

  protein     the release's protein, without the terminal stop
  CDS         start codon to stop codon, as released
  transcript  the primary transcript, 5' UTR to 3' UTR, as released
  genomic     the gene's span on the assembly (record start..end), exons and introns, on the
              gene's own strand (reverse-complemented for minus-strand genes), upper case

Gates, all refusing to write: every atlas gene has exactly one record in each file (matched by
the header's own locus= field); every CDS translates to its protein; every CDS is a substring of
its transcript; every transcript is rebuilt EXACTLY from its exons in the release's
gene_exons.gff3 on the assembly, and those exons lie inside the gene's span; every span lies
inside its chromosome. Positive controls: a planted one-base change in a CDS must fail the
translation gate, and a strand flip must fail the exon rebuild.
"""
import gzip
import hashlib
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roots  # noqa: E402

DATA = roots.path("atlas", "data")
ANN = "717Official/annotation"
REL = {"hap1": ("PtremulaxPopulusalbaHAP1_717_v5.1", "717Official/PtremulaxPopulusalbaHAP1_717_v5.0.fa"),
       "hap2": ("PtremulaxPopulusalbaHAP2_716_v5.1", "717Official/PtremulaxPopulusalbaHAP2_716_v5.0.fa")}
B, A = "TCAG", "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
CODON = {a + b + c: A[16 * i + 4 * j + k] for i, a in enumerate(B) for j, b in enumerate(B) for k, c in enumerate(B)}
COMP = str.maketrans("ACGTNacgtn", "TGCANtgcan")


def translate(c):
    return "".join(CODON.get(c[i:i + 3].upper(), "X") for i in range(0, len(c) - 2, 3))


def read_exons(path):
    """{transcript name: [(chrom, start, end, strand), ...]} from a gene_exons.gff3."""
    ex = {}
    with open(path) as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split("\t")
            if len(f) < 9 or f[2] != "exon":
                continue
            attrs = dict(x.split("=", 1) for x in f[8].split(";") if "=" in x)
            parent = attrs["Parent"].removesuffix(".v5.1")
            ex.setdefault(parent, []).append((f[0], int(f[3]), int(f[4]), f[6]))
    return ex


def rebuild(exons, genome):
    """The spliced transcript, 5' to 3', from its exons."""
    exons = sorted(exons, key=lambda e: e[1])
    s = "".join(genome[c][a - 1:b] for c, a, b, _ in exons).upper()
    return s.translate(COMP)[::-1] if exons[0][3] == "-" else s


def read_fasta(path, by_locus=True, names=None):
    """{locus or name: sequence}; refuses a locus seen twice. `names` collects locus -> record name."""
    out, key, buf = {}, None, []
    def flush():
        if key is not None:
            if key in out:
                sys.exit(f"REFUSING: {key} appears twice in {path}")
            out[key] = "".join(buf)
    with open(path) as fh:
        for line in fh:
            if line.startswith(">"):
                flush()
                f = dict(x.split("=", 1) for x in line[1:].split()[1:] if "=" in x)
                key, buf = (f["locus"] if by_locus else line[1:].split()[0]), []
                if names is not None:
                    names[key] = line[1:].split()[0]
            else:
                buf.append(line.strip())
    flush()
    return out


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def gates(rec, rebuilt):
    """Problems with one gene's sequences, as strings."""
    bad = []
    if translate(rec["c"]).rstrip("*") != rec["p"]:
        bad.append("CDS does not translate to the protein")
    if rec["c"].upper() not in rec["t"].upper():
        bad.append("CDS is not inside the transcript")
    if rebuilt != rec["t"].upper():
        bad.append("transcript is not rebuilt exactly from its exons")
    return bad


def main():
    sources, manifest_seq = {}, {"haplotypes": {}}
    shard_index = {}
    for hap, (code, genome_rel) in REL.items():
        files = {k: roots.path("work", f"{ANN}/{code}.{k}_primaryTranscriptOnly.fa") for k in ("protein", "cds", "transcript")}
        prot = {g: s.rstrip("*") for g, s in read_fasta(files["protein"]).items()}
        txname = {}
        cds, tx = read_fasta(files["cds"]), read_fasta(files["transcript"], names=txname)
        genome = read_fasta(roots.path("work", genome_rel), by_locus=False)
        exons = read_exons(roots.path("work", f"{ANN}/{code}.gene_exons.gff3"))
        recs = {}
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in fs:
                if fn.endswith(".json"):
                    for gid, r in json.load(open(os.path.join(dp, fn))).items():
                        recs[gid] = (r["chr"], r["start"], r["end"], r["strand"])
        missing = [g for g in recs if not (g in prot and g in cds and g in tx)]
        extra = sorted((set(prot) | set(cds) | set(tx)) - set(recs))
        if missing or extra:
            sys.exit(f"REFUSING {hap}: {len(missing)} genes lack a record ({missing[:3]}), {len(extra)} records are not genes ({extra[:3]})")
        blob, index, problems = io.BytesIO(), {}, []
        for gid in sorted(recs):
            chrom, start, end, strand = recs[gid]
            seq = genome.get(chrom)
            if seq is None or end > len(seq) or start < 1:
                sys.exit(f"REFUSING: {gid} span {chrom}:{start}-{end} lies outside the assembly")
            g = seq[start - 1:end].upper()
            if strand == "-":
                g = g.translate(COMP)[::-1]
            rec = {"p": prot[gid], "c": cds[gid], "t": tx[gid], "g": g}
            ex = exons.get(txname[gid])
            if not ex:
                problems.append(f"{gid}: no exons for {txname[gid]}")
                continue
            if any(e[0] != chrom or e[1] < start or e[2] > end for e in ex):
                problems.append(f"{gid}: an exon lies outside the gene span")
                continue
            bad = gates(rec, rebuild(ex, genome))
            if bad:
                problems.append(f"{gid}: {', '.join(bad)}")
                continue
            raw = json.dumps(rec, separators=(",", ":")).encode()
            member = io.BytesIO()
            with gzip.GzipFile(fileobj=member, mode="wb", mtime=0, compresslevel=9) as z:
                z.write(raw)
            m = member.getvalue()
            index[gid] = [blob.tell(), len(m)]
            blob.write(m)
        if problems:
            sys.exit(f"REFUSING {hap}: {len(problems)} genes fail a gate, e.g. {problems[:5]}")
        # positive controls, on the first gene: a planted one-base CDS change and a strand flip
        g0 = sorted(recs)[0]
        r0 = json.loads(gzip.decompress(blob.getvalue()[index[g0][0]:sum(index[g0])]))
        ex0 = exons[txname[g0]]
        mut = dict(r0, c=r0["c"][:3] + ("A" if r0["c"][3] != "A" else "C") + r0["c"][4:])
        flipped = [(c, a, b, "+" if st == "-" else "-") for c, a, b, st in ex0]
        if not (gates(mut, rebuild(ex0, genome)) and gates(r0, rebuild(flipped, genome))):
            sys.exit("REFUSING: a planted change was not caught by the gates")
        os.makedirs(os.path.join(DATA, "seq"), exist_ok=True)
        out = os.path.join(DATA, "seq", f"seq_{hap}.gzb")
        with open(out, "wb") as fh:
            fh.write(blob.getvalue())
        shard_index[hap] = index
        for k, p in files.items():
            sources[f"{hap}_{k}"] = {"file": os.path.basename(p), "sha256": sha256(p)}
        sources[f"{hap}_genome"] = {"file": os.path.basename(genome_rel), "sha256": sha256(roots.path("work", genome_rel))}
        manifest_seq["haplotypes"][hap] = {"genes": len(index), "bytes": blob.tell()}
        print(f"{hap}: {len(index)} genes, {blob.tell() / 1e6:.1f} MB; every gate passed; planted changes caught")

    for hap, index in shard_index.items():
        for dp, _, fs in os.walk(os.path.join(DATA, "genes", hap)):
            for fn in fs:
                if not fn.endswith(".json"):
                    continue
                p = os.path.join(dp, fn)
                shard = json.load(open(p))
                for gid, rec in shard.items():
                    rec["sq"] = index[gid]
                with open(p, "w") as fh:
                    json.dump(shard, fh, separators=(",", ":"), sort_keys=True)
    man_path = os.path.join(DATA, "meta", "manifest.json")
    man = json.load(open(man_path))
    manifest_seq.update({
        "what": "protein, CDS, transcript and genomic gene span for every gene, from the Phytozome v5.1 primary transcripts on the v5.0 assembly",
        "fields": {"p": "protein (no terminal stop)", "c": "CDS", "t": "transcript with UTRs", "g": "genomic span on the gene's strand"},
        "sources": sources})
    man["sequences"] = manifest_seq
    with open(man_path, "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
