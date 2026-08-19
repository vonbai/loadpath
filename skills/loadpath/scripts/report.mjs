#!/usr/bin/env node
// Loadpath — rendering. Nothing here measures; nothing that measures prints.
//
// L0 orients, L1 gives structure, L2 gives detail. The L0 algorithm is the same
// everywhere: state the distribution, then rank by deviation from it. `136f`
// means nothing until `median 7` is on the page, and then it means 19x the
// median — a fact about the distribution, exact and checkable.

import { dirname, basename } from "node:path";
import { median, pct, day, num } from "./scan.mjs";

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
    out.push(`history     ${num(hist.commits.length)} commits over ${days} days, since ${since}`);
    out.push(`activity    ${active} of ${live.length} directories touched in the last 90 days, ${dormant} not`);
    if (dormant) out.push(`            a directory with no recent commits is unmeasured here, not known to be safe`);
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
  out.push(deps.line);

  // Deviation ranking. Every row is a ratio against a figure printed above it.
  const med = median(fileCounts) || 1;
  const ranked = [...dirs.values()].sort((a, b) => b.files / med - a.files / med).slice(0, 5);
  out.push("");
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

export function renderL1({ dirs, hist, budget }) {
  const rows = [...dirs.values()].map((d) => {
    const h = hist.available ? hist.dirs.get(d.path) : null;
    return {
      path: d.path || ".",
      mass: d.lines,
      cells: [
        `${d.files}f`,
        `${num(d.lines)}L`,
        d.tests ? `${d.tests}t` : "",
        h ? `${h.commits}c` : "",
        h ? `${Math.round(h.topShare * 100)}%/${h.majorAuthors}a` : "",
        h ? day(h.last) : "",
      ],
    };
  }).sort((a, b) => b.mass - a.mass);

  const draw = (n) => {
    const keep = rows.slice(0, n);
    const w = [0, 0, 0, 0, 0, 0];
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
    if (s.length / 3.6 <= budget) { best = s; lo = mid + 1; } else hi = mid - 1;
  }
  const head = "  files lines tests commits share/authors last-touched  directory";
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
  out.push(`  share  profile across windows      pair`);
  for (const p of hist.pairs.slice(0, top)) {
    const prof = p.profile.map((x) => x.toFixed(1).padStart(4)).join(" ");
    const lo = Math.min(...p.profile), hi = Math.max(...p.profile);
    const conc = p.profile.filter((x) => x > 0).length === 1 ? "  one window only" : "";
    out.push(`  ${(p.share * 100).toFixed(0).padStart(4)}%  [${prof} ]  min ${lo.toFixed(1)} max ${hi.toFixed(1)}  ${p.a} + ${p.b}${conc}`);
  }
  out.push("");
  out.push(`  Directories changing together is the Common Closure criterion, a design`);
  out.push(`  argument. No study reviewed for this tool tested whether it predicts`);
  out.push(`  anything, so read it as a question about placement, not as risk.`);
  return out.join("\n");
}

// ── Relocations ──────────────────────────────────────────────────────────────

export function renderRelocations(hist) {
  if (!hist.available || !hist.relocations.length) return null;
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
