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

export function renderL0({ files, dirs, conv, hist, mans, deps, root, since, windows }) {
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
    const cutoff = hist.hi - 90 * 86400;
    // History knows directories that no longer exist. Intersect with the tree
    // or the count exceeds the number of directories there are.
    const live = [...hist.dirs.entries()].filter(([p]) => dirs.has(p));
    const active = live.filter(([, d]) => d.last >= cutoff).length;
    const dormant = live.length - active;
    const unseen = dirs.size - live.length;
    // A rewritten spelling is shown as the rewrite it was, never as if the
    // reader had typed the thing that actually ran.
    const asked = hist.rewrittenFrom ? `--since ${hist.rewrittenFrom} → ${hist.since}` : `--since ${since}`;
    out.push(`history     ${num(hist.commits.length)} commits since ${hist.cutoffDay} (${asked}), spanning ${days} days`);
    out.push(`activity    ${active} touched in the last 90 days, ${dormant} not, ` +
             `${unseen} with no commit in this window at all — of ${dirs.size} directories`);
    if (dormant || unseen) out.push(`            a directory with no recent commit is unmeasured here, not known to be safe`);
  } else {
    out.push(`history     not measured — ${hist.reason}`);
  }

  out.push("");
  if (mans.length) {
    out.push(`declared modules`);
    for (const m of mans.slice(0, 8)) out.push(`  ${m.eco.padEnd(11)}${m.path || "."}`);
    if (mans.length > 8) out.push(`  +${mans.length - 8} more`);
  } else {
    out.push(`declared modules   none found`);
  }

  out.push("");
  out.push(renderDeps(deps, { level: 0 }));

  // Deviation ranking. Every row is a ratio against a figure printed above it.
  const med = median(fileCounts) || 1;
  const ranked = [...dirs.values()].sort((a, b) => b.files / med - a.files / med).slice(0, 5);
  out.push("");
  // With a flat distribution every ratio is 1 and the sort is a no-op, so the
  // rows would be insertion order presented as outliers.
  if (!ranked.length || ranked[0].files <= med) {
    out.push(`no directory departs from those norms; the distribution is flat`);
    return out.join("\n");
  }
  out.push(`furthest from this repository's own norms`);
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

export function renderL1({ dirs, hist, deps, budget }) {
  const rows = [...dirs.values()].map((d) => {
    const h = hist.available ? hist.dirs.get(d.path) : null;
    const grp = deps && deps.measured && deps.layerOf.has(d.path)
      ? { layer: deps.layerOf.get(d.path), group: deps.groupOf.get(d.path) } : null;
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

  // Binary search to the budget, within about 15%.
  let lo = 1, hi = rows.length, best = draw(Math.min(rows.length, 20));
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
    out.push(`  ${(p.share * 100).toFixed(0).padStart(4)}%  [${prof} ]  of ${p.base}c  ${p.a} + ${p.b}${conc}`);
  }
  out.push("");
  out.push(`  Directories changing together is the Common Closure criterion, a design`);
  out.push(`  argument. No study reviewed for this tool tested whether it predicts`);
  out.push(`  anything, so read it as a question about placement, not as risk.`);
  return out.join("\n");
}

// ── Relocations ──────────────────────────────────────────────────────────────

export function renderRelocations(hist) {
  if (!hist.available) return `relocations  not measured — ${hist.reason}`;
  if (!hist.relocations.length) return `relocations  none — no directory has moved 3 or more files in this window`;
  const out = [`relocations  what this repository has already moved`];
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

// The quarantine measures; this renders it. Nothing computes and prints in
// the same place, which is why v0.1.0's truncation could go undisclosed.
export function renderDeps(d, { level = 0 } = {}) {
  if (!d.measured) return `dependencies  not measured — ${d.why}`;
  const out = [];
  // A partial resolution is stated on the same line as the number it qualifies.
  // A reader who sees only the count will otherwise read a partial graph as the
  // whole one, which is the failure this tool exists to avoid.
  out.push(`dependencies  ${d.edges} edges over ${d.nodes.size} ${d.nodes.size===1?d.unit:d.unitPlural}, via ${d.provenance}${d.note ? ` — ${d.note}` : ""}`);
  out.push(`              load path is ${d.depth} layers deep; ${d.tangles.length} mutually entangled group(s)`);
  if (level === 0) return out.join("\n");

  for (const t of d.tangles.slice(0, 3)) {
    const internal = t.reduce((s, n) => s + [...(d.out.get(n) || [])].filter((x) => t.includes(x)).length, 0);
    out.push("");
    out.push(`  entangled: ${t.length} ${d.unitPlural}, ${internal} internal edges`);
    const rank = t.map((n) => ({ n, deg: [...(d.out.get(n) || [])].filter((x) => t.includes(x)).length + t.filter((m) => (d.out.get(m) || new Set()).has(n)).length }))
      .sort((a, b) => b.deg - a.deg);
    for (const r of rank.slice(0, 5)) out.push(`    ${String(r.deg).padStart(3)} of the group's edges   ${r.n}`);
    if (rank.length > 5) out.push(`    +${rank.length - 5} more`);
    out.push(`    Inside a group nothing can be built, tested, or replaced alone.`);
  }
  if (!d.tangles.length) {
    out.push(`              no group found in the ${d.nodes.size} ${d.unitPlural} ${d.provenance} resolved`);
  }

  const top = [...d.fanOut.entries()].map(([n, o]) => ({ n, o, i: d.fanIn.get(n) || 0 }))
    .filter((x) => x.o >= 3 && x.i <= 1).sort((a, b) => b.o - a.o).slice(0, 3);
  if (top.length) {
    out.push("");
    out.push(`  fan-out 3 or more with fan-in 1 or less`);
    for (const t of top) out.push(`    fan-out ${String(t.o).padStart(3)}  fan-in ${t.i}   ${t.n}`);
  }
  return out.join("\n");
}
