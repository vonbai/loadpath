#!/usr/bin/env node
// Loadpath — rendering. Nothing here measures; nothing that measures prints.
//
// L0 orients, L1 gives structure, L2 gives detail. The L0 algorithm is the same
// everywhere: state the distribution, then rank by deviation from it. `136f`
// means nothing until `median 7` is on the page, and then it means 19x the
// median — a fact about the distribution, exact and checkable.

import { dirname, basename } from "node:path";
import { median, pct, day, num, tokens } from "./scan.mjs";

// ── L0: orient ───────────────────────────────────────────────────────────────

export function renderL0({ files, dirs, conv, hist, mans, filtered = [], spans, root, since, windows }) {
  const out = [];
  const fileCounts = [...dirs.values()].map((d) => d.files);
  const lineCounts = files.map((f) => f.lines);
  const totalLines = files.reduce((s, f) => s + f.lines, 0);
  const tests = files.filter((f) => conv.isTest(f.path)).length;
  const depth = Math.max(0, ...[...dirs.keys()].map((d) => (d ? d.split("/").length : 0)));

  const ext = new Map();
  for (const f of files) {
    const e = f.path.slice(f.path.lastIndexOf("."));
    ext.set(e, (ext.get(e) || 0) + 1);
  }
  const langs = [...ext.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([e, n]) => `${e}×${n}`).join(", ");

  out.push(`${num(files.length)} source files, ${num(totalLines)} lines, ${dirs.size} directories, ${depth} deep`);
  out.push(`languages   ${langs}`);
  out.push(conv.winners.length
    ? `tests       ${num(tests)} files by ${conv.winners.slice(0, 2).map((w) => w.name).join(" and ")}`
    : `tests       no test-path convention detected`);
  out.push("");
  out.push(`files per directory   median ${median(fileCounts)}   p90 ${pct(fileCounts, 0.9)}   max ${Math.max(...fileCounts)}`);
  out.push(`lines per file        median ${median(lineCounts)}   p90 ${pct(lineCounts, 0.9)}   max ${Math.max(...lineCounts)}`);

  out.push("");
  if (hist.available) {
    const days = Math.round((hist.hi - hist.lo) / 86400);
    // A rewritten spelling is shown as the rewrite it was, never as if the
    // reader had typed the thing that actually ran.
    const asked = hist.rewrittenFrom ? `--since ${hist.rewrittenFrom} → ${hist.since}` : `--since ${since}`;
    // What the count counts. A commit touching only documentation is not in
    // it, and a bare "N commits" invites the reader to reconcile it with a
    // number git would give them.
    out.push(`history     ${num(hist.commits.length)} commits touching source since ${hist.cutoffDay} (${asked}), spanning ${days} days`);
    // The split, the horizon and the join against the tree are all measured in
    // scan.mjs; this line spends them.
    out.push(`activity    ${hist.active} touched in the last ${hist.horizonDays} days, ${hist.dormant} not, ` +
             `${hist.unseen} with no commit in this window at all — of ${dirs.size} directories`);
    if (hist.dormant || hist.unseen) out.push(`            a directory with no recent commit is unmeasured here, not known to be safe`);
  } else {
    out.push(`history     not measured — ${hist.reason}`);
  }

  out.push("");
  if (mans.length) {
    out.push(`declared modules`);
    // A merged ecosystem name can be wider than the column; padEnd alone then
    // runs the two fields together — `Node/TypeScriptpackages/create-vite` is
    // what vite printed. One space is the floor, the column is the target.
    for (const m of mans.slice(0, 8)) out.push(`  ${(m.eco + " ").padEnd(11)}${m.path || "."}`);
    if (mans.length > 8) out.push(`  +${mans.length - 8} more`);
  } else {
    out.push(`declared modules   none found`);
  }
  // A drop this large decides how the section reads, so it is disclosed with
  // its reason rather than left as a shorter list.
  if (filtered.length) {
    const names = [...new Set(filtered.map((f) => f.name))];
    const which = names.length === 1
      ? `one name (${names[0]})`
      : `${names.length} names (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""})`;
    out.push(`  +${filtered.length} filtered: ${filtered.length} manifests share ${which}`);
  }

  out.push("");
  out.push(renderDeps(spans));

  // A size ranking, and it says so. Ranking by files/median is ranking by
  // files: dividing every row by one constant cannot reorder them, so calling
  // the result the directories furthest from the repository's norms claimed a
  // deviation the arithmetic never computed. The ratio stays, because it is
  // what makes 136f mean something — it is a ratio against a figure printed
  // above it, which is a different job from choosing the order.
  const med = median(fileCounts) || 1;
  const ranked = [...dirs.values()].sort((a, b) => b.files - a.files).slice(0, 5);
  out.push("");
  // With a flat distribution every ratio is 1 and the sort is a no-op, so the
  // rows would be insertion order presented as outliers.
  if (!ranked.length || ranked[0].files <= med) {
    out.push(`no directory departs from those norms; the distribution is flat`);
    return out.join("\n");
  }
  out.push(`largest directories, against the median`);
  for (const d of ranked) {
    const h = hist.available ? hist.dirs.get(d.path) : null;
    const share = h ? `  top author ${Math.round(h.topShare * 100)}% of ${h.commits}c` : "";
    out.push(`  ${String(d.files).padStart(4)}f  ${(d.files / med).toFixed(0)}× median   ${num(d.lines).padStart(8)}L   ${d.path || "."}${share}`);
  }
  return out.join("\n");
}

// ── L1: structure ────────────────────────────────────────────────────────────
//
// A flat directory table does not scale — measured at ~14,000 tokens on a
// 3,154-directory repository. Budget is met by binary search over how many
// rows survive, after Aider's repo map, rather than a hardcoded top-N.

export function renderL1({ dirs, hist, spans, budget }) {
  // The spans' node sets are disjoint — each ecosystem's analyzer sees its own
  // directories — so one layer column carries all of them, with the group
  // numbers taken from the page rather than from any one span.
  const groups = entangledGroups(spans);
  const layerOf = new Map();
  for (const s of spans) if (s.measured) for (const [n, l] of s.layerOf) layerOf.set(n, l);
  const rows = [...dirs.values()].map((d) => {
    const h = hist.available ? hist.dirs.get(d.path) : null;
    const grp = layerOf.has(d.path)
      ? { layer: layerOf.get(d.path), group: groups.get(d.path) } : null;
    return {
      path: d.path || ".",
      mass: d.lines,
      cells: [
        `${d.files}f`,
        `${num(d.lines)}L`,
        d.tests ? `${d.tests}t` : "-",
        // A blank cell under a "commits" header reads as zero. Where history
        // is unavailable the column says so once, in the header, and every
        // cell carries the same mark rather than an absence.
        hist.available ? (h ? `${h.commits}c` : "0c") : "?",
        hist.available ? (h ? `${Math.round(h.topShare * 100)}%/${h.majorAuthors}a` : "-") : "?",
        hist.available ? (h ? day(h.last) : "-") : "?",
        grp ? `L${grp.layer}${grp.group ? " g" + grp.group : ""}` : "",
      ],
    };
  }).sort((a, b) => b.mass - a.mass);

  const draw = (n) => {
    const keep = rows.slice(0, n);
    const w = [0, 0, 0, 0, 0, 0, 0];
    for (const r of keep) r.cells.forEach((c, i) => (w[i] = Math.max(w[i], c.length)));
    const lines = keep.map((r) =>
      "  " + r.cells.map((c, i) => c.padStart(w[i])).join(" ") + "  " + r.path);
    const rest = rows.length - keep.length;
    if (rest > 0) {
      const rf = rows.slice(n).reduce((s, r) => s + Number(r.cells[0].replace("f", "")), 0);
      lines.push(`  +${rest} directories not shown (${rf} files)`);
    }
    return lines.join("\n");
  };

  // Binary search to the budget, within about 15%. The seed is the smallest
  // table there is: seeded at twenty rows it survives untouched when no size
  // fits, and the table then answers a budget of five with 265 tokens. The
  // CLI clamps --budget at 200 and so cannot reach that, which hid it.
  let lo = 1, hi = rows.length, best = draw(1);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = draw(mid);
    if (tokens(s) <= budget) { best = s; lo = mid + 1; } else hi = mid - 1;
  }
  const head = hist.available
    ? "  files lines tests commits share/authors last-touched layer  directory"
    : "  files lines tests   (? = history not measured)                  directory";
  return [head, best].join("\n");
}

// ── Co-change ────────────────────────────────────────────────────────────────
//
// An average alone is not reportable: a figure can look excellent while its
// worst case is total, because opposing regions cancel in the mean. Each row
// carries its per-window profile, and the window count is stated as the
// parameter it is.

export function renderCoChange(hist, top) {
  if (!hist.available) return `co-change   not measured — ${hist.reason}`;
  const out = [];
  const breadths = hist.commits.map((c) => new Set(c.paths.map((p) => dirname(p))).size).sort((a, b) => a - b);
  out.push(`co-change   ${hist.commits.length} commits, median ${median(breadths)} directories each, ${hist.windows} equal time windows`);
  if (hist.capped) out.push(`            ${hist.capped} commits touched more than the breadth cap and were excluded as sweeps`);
  if (hist.dropped) out.push(`            ${hist.dropped} pairs named a directory the tree no longer has and were dropped`);
  if (!hist.pairs.length) { out.push("            no pair above the reporting floor"); return out.join("\n"); }
  out.push("");
  out.push(`  Each commit casts one vote, split across the pairs it implies. "share" is`);
  out.push(`  that vote-sum over the commits of whichever directory moved less often.`);
  out.push("");
  out.push(`  share  vote per window          pair`);
  for (const p of hist.pairs.slice(0, top)) {
    const prof = p.profile.map((x) => x.toFixed(1).padStart(4)).join(" ");
    const lo = Math.min(...p.profile), hi = Math.max(...p.profile);
    const conc = p.profile.filter((x) => x > 0).length === 1 ? "  in one window" : "";
    // The repository root has no name of its own, and it is spelled "." on
    // every other row of the page. One population, one spelling — a bare
    // leading space is not a directory a reader can open.
    out.push(`  ${(p.share * 100).toFixed(0).padStart(4)}%  [${prof} ]  of ${p.base}c  ${p.a || "."} + ${p.b || "."}${conc}`);
  }
  out.push("");
  out.push(`  Directories changing together is the Common Closure criterion, a design`);
  out.push(`  argument. No study reviewed for this tool tested whether it predicts`);
  out.push(`  anything, so read it as a question about placement, not as risk.`);
  return out.join("\n");
}

// ── Relocations ──────────────────────────────────────────────────────────────
//
// The one section that is a record rather than a lead. It names what moved,
// and the side it moved away from is supposed to be gone — so it takes neither
// the population rule nor the join against the tree. It therefore counts every
// file a rename touched rather than only the source files the rest of the page
// is about, and it says so: a count that means something different from every
// other count here has to read as different.

export function renderRelocations(hist) {
  if (!hist.available) return `relocations  not measured — ${hist.reason}`;
  if (!hist.relocations.length) return `relocations  none — no directory has moved 3 or more files, of any type, in this window`;
  const out = [`relocations  what this repository has already moved — every file type, not only source`];
  for (const r of hist.relocations.slice(0, 8)) {
    out.push(`  ${day(r.at)}  ${r.n.toString().padStart(4)} files   ${r.from} → ${r.to}`);
  }
  return out.join("\n");
}

// ── L2: one subtree in detail ────────────────────────────────────────────────

export function renderL2({ files, conv, hist, prefix }) {
  const inSub = files.filter((f) => f.path.startsWith(prefix + "/") || f.dir === prefix);
  if (!inSub.length) return `no source files under ${prefix}`;
  const lineCounts = inSub.map((f) => f.lines);
  const out = [];
  out.push(`${prefix}   ${inSub.length} files, ${num(lineCounts.reduce((a, b) => a + b, 0))} lines`);
  out.push(`lines per file   median ${median(lineCounts)}   p90 ${pct(lineCounts, 0.9)}   max ${Math.max(...lineCounts)}`);
  out.push("");
  const sorted = [...inSub].sort((a, b) => b.lines - a.lines);
  const w = Math.max(...sorted.map((f) => String(f.lines).length));
  for (const f of sorted) {
    const t = conv.isTest(f.path) ? " test" : "     ";
    out.push(`  ${String(f.lines).padStart(w)}L${t}  ${f.path}`);
  }
  return out.join("\n");
}

// ── Dependencies: one line per span ──────────────────────────────────────────
//
// The quarantine measures; this renders it. Nothing computes and prints in
// the same place, which is why v0.1.0's truncation could go undisclosed.
//
// A repository declaring two ecosystems gets two labelled lines, side by side
// and never added together, because a Go package and a TypeScript file
// directory are not the same unit. One span keeps the unlabelled line it has
// always had: a label that never varies is a column of noise.

const labelOf = (spans, s) => (spans.length > 1 ? ` (${s.eco})` : "");

export function renderDeps(spans) {
  return spans.map((s) => renderSpan(s, labelOf(spans, s))).join("\n");
}

function renderSpan(d, label) {
  const head = `dependencies${label}`;
  if (!d.measured) return `${head}  not measured — ${d.why}`;
  const pad = " ".repeat(head.length + 2);
  const out = [];
  // A partial resolution is stated on the same line as the number it qualifies.
  // A reader who sees only the count will otherwise read a partial graph as the
  // whole one, which is the failure this tool exists to avoid.
  out.push(`${head}  ${d.edges} edges over ${d.nodes.size} ${d.nodes.size===1?d.unit:d.unitPlural}, via ${d.provenance}${d.note ? ` — ${d.note}` : ""}`);
  out.push(`${pad}load path is ${d.depth} layers deep; ${d.tangles.length} mutually entangled group(s)`);
  // What was measured is the whole module; what is shown is the scope. The
  // edges between the two are the load this subtree carries, and dropping them
  // silently would make a subtree look self-contained when it is not.
  if (d.crossings) out.push(pad + renderCrossings(d.crossings));
  return out.join("\n");
}

function renderCrossings(c) {
  const eg = (dirs) => (dirs.length ? ` (top: ${dirs.join(", ")})` : "");
  if (!c.inbound && !c.outbound) return `crossings   no edge crosses into or out of ${c.at}`;
  return `crossings   ${c.inbound} inbound from outside ${c.at}${eg(c.inboundTop)} · ` +
         `${c.outbound} outbound${eg(c.outboundTop)}`;
}

// Group numbers belong to the page, not to a span: two spans each numbering
// their own tangles from one would print two g1 rows in a table where a reader
// cannot tell them apart.
export function entangledGroups(spans) {
  const all = spans.filter((s) => s.measured).flatMap((s) => s.tangles);
  all.sort((a, b) => b.length - a.length);
  const of = new Map();
  all.forEach((t, i) => t.forEach((n) => of.set(n, i + 1)));
  return of;
}

export function renderDepsDetail(spans) {
  const groups = entangledGroups(spans);
  const out = [];
  for (const d of spans) {
    if (!d.measured) continue;
    const label = labelOf(spans, d);
    const pad = " ".repeat(`dependencies${label}`.length + 2);
    // Each span's detail is announced when there is more than one, so the
    // blocks below cannot be read as one graph's.
    if (label) { out.push(""); out.push(`dependencies${label}`); }
    d.tangles.slice(0, 3).forEach((t, i) => {
      const internal = t.reduce((s, n) => s + [...(d.out.get(n) || [])].filter((x) => t.includes(x)).length, 0);
      const g = label ? ` g${groups.get(t[0])}` : "";
      // The span's own header already opened the block; a second blank line
      // under it buys nothing, and output is the budget this tool spends.
      if (!(label && i === 0)) out.push("");
      out.push(`  entangled${g}: ${t.length} ${d.unitPlural}, ${internal} internal edges`);
      const rank = t.map((n) => ({ n, deg: [...(d.out.get(n) || [])].filter((x) => t.includes(x)).length + t.filter((m) => (d.out.get(m) || new Set()).has(n)).length }))
        .sort((a, b) => b.deg - a.deg);
      for (const r of rank.slice(0, 5)) out.push(`    ${String(r.deg).padStart(3)} of the group's edges   ${r.n}`);
      if (rank.length > 5) out.push(`    +${rank.length - 5} more`);
      out.push(`    Inside a group nothing can be built, tested, or replaced alone.`);
    });
    if (!d.tangles.length) {
      // Unlabelled, this line hangs under the header it qualifies; labelled,
      // it sits with the other blocks of its own span.
      out.push(`${label ? "  " : pad}no group found in the ${d.nodes.size} ${d.unitPlural} ${d.provenance} resolved`);
    }

    const top = [...d.fanOut.entries()].map(([n, o]) => ({ n, o, i: d.fanIn.get(n) || 0 }))
      .filter((x) => x.o >= 3 && x.i <= 1).sort((a, b) => b.o - a.o).slice(0, 3);
    if (top.length) {
      out.push("");
      out.push(`  fan-out 3 or more with fan-in 1 or less`);
      for (const t of top) out.push(`    fan-out ${String(t.o).padStart(3)}  fan-in ${t.i}   ${t.n}`);
    }
  }
  return out.join("\n").trim();
}
