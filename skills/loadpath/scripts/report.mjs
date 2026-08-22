#!/usr/bin/env node
// Loadpath — rendering. Nothing here acquires source facts; nothing that
// acquires them prints.
//
// L0 orients, L1 gives structure, L2 gives detail. The L0 algorithm is the same
// everywhere: state the distribution, then rank by size against it. `136f`
// means nothing until `median 7` is on the page, and then it means 19x the
// median — a fact about the distribution, exact and checkable.

import { dirname } from "node:path";
import { median, pct, day, num, count, maxOf, tokens, CO_FLOOR, CO_SUPPORT } from "./scan.mjs";

// Every truncation states what it dropped. A list that ends without a "+N more"
// is claiming to be the whole list, and that claim is checked the same way any
// other one here is. One spelling of it, so no section can quietly stop
// disclosing while the others go on doing it.
const more = (n, what = "more") => (n > 0 ? `, +${n} ${what}` : "");

// How many of each capped list survives. Named, because a slice with a literal
// in it is a threshold the reader cannot see and the writer forgets.
const LANGS = 5, CONVS = 2, LARGEST = 5, RELOCS = 8, TANGLES = 3, FANOUT = 3;

// One author holding every source-containing directory's commits. The share
// column then prints the same two figures on every row — measured at 54 rows
// of it on this repository — which is a column of noise wide enough to cost
// real output. It is a fact about the repository, so it is stated once and the
// column goes.
const singleAuthor = (hist) =>
  Boolean(hist.available && hist.dirs?.size) &&
  [...hist.dirs.values()].every((e) => e.topShare === 1 && e.majorAuthors === 1);

// ── L0: orient ───────────────────────────────────────────────────────────────

export function renderL0({ files, dirs, conv, hist, mans, filtered = [], noise = [], spans, scattered = [], since }) {
  const out = [];
  const fileCounts = [...dirs.values()].map((d) => d.files);
  const lineCounts = files.map((f) => f.lines);
  const totalLines = files.reduce((s, f) => s + f.lines, 0);
  const tests = files.filter((f) => conv.isTest(f.path)).length;
  const depth = maxOf([...dirs.keys()].map((d) => (d ? d.split("/").length : 0)));

  const ext = new Map();
  for (const f of files) {
    const e = f.path.slice(f.path.lastIndexOf("."));
    ext.set(e, (ext.get(e) || 0) + 1);
  }
  const byCount = [...ext.entries()].sort((a, b) => b[1] - a[1]);
  const langs = byCount.slice(0, LANGS).map(([e, n]) => `${e}×${n}`).join(", ")
    + more(byCount.length - LANGS);

  out.push(`${count(files.length, "source file")}, ${count(totalLines, "line")}, ` +
           `${count(dirs.size, "source-containing directory", "source-containing directories")}, max source-path depth ${depth}`);
  out.push(`languages   ${langs}`);
  out.push(conv.winners.length
    ? `tests       ${count(tests, "file")} by ${conv.winners.slice(0, CONVS).map((w) => w.name).join(" and ")}${more(conv.winners.length - CONVS)}`
    : `tests       no test-path convention detected`);
  out.push("");
  out.push(`files per source-containing directory   median ${median(fileCounts)}   p90 ${pct(fileCounts, 0.9)}   max ${maxOf(fileCounts)}`);
  out.push(`lines per file                         median ${median(lineCounts)}   p90 ${pct(lineCounts, 0.9)}   max ${maxOf(lineCounts)}`);
  // Files that exist, carry a source extension, and are in none of the figures
  // above. What a measurement refused is part of the measurement: a binary file
  // used to enter the total, the median and the p90 carrying a count of its
  // newline bytes, which is a number about its encoding and not about its code.
  const withheld = (files.unreadable?.length ?? 0) + (files.binary?.length ?? 0);
  if (withheld) {
    const why = [files.unreadable?.length ? `${files.unreadable.length} unreadable` : "",
                 files.binary?.length ? `${files.binary.length} binary` : ""].filter(Boolean).join(", ");
    out.push(`not counted           ${count(withheld, "file")} with a source extension and no line count (${why})`);
  }
  // Named the same way the distribution lines are: the unit once, then the
  // rows. An absence is stated rather than left as a missing line, because a
  // section that vanishes when it finds nothing cannot be told from one that
  // was never computed.
  out.push(scattered.length
    ? `scattered names       ${scattered.map((s) => `${s.token} ×${s.files} across ${s.dirs} source-containing directories`).join(" · ")}`
    : `scattered names       none recur across 3 or more source-containing directories`);

  out.push("");
  if (hist.available) {
    const days = Math.round((hist.hi - hist.lo) / 86400);
    // A rewritten spelling is shown as the rewrite it was, never as if the
    // reader had typed the thing that actually ran.
    const asked = hist.rewrittenFrom ? `--since ${hist.rewrittenFrom} → ${hist.since}` : `--since ${since}`;
    // What the count counts. A commit touching only documentation is not in
    // it, and a bare "N commits" invites the reader to reconcile it with a
    // number git would give them.
    out.push(`history     ${count(hist.commits.length, "commit")} touching source since ${hist.cutoffDay} (${asked}), spanning ${count(days, "day")}`);
    // The split, the horizon and the join against the tree are all measured in
    // scan.mjs; this line spends them.
    out.push(`activity    ${hist.active} touched in the last ${count(hist.horizonDays, "day")}, ${hist.dormant} not, ` +
             `${hist.unseen} with no commit in this window at all — of ${count(dirs.size, "source-containing directory", "source-containing directories")}`);
    if (hist.dormant || hist.unseen) out.push(`            a source-containing directory with no recent commit is unmeasured here, not known to be safe`);
    // A record git holds that this parser could not read. Counting them is what
    // separates a repository with nothing there from a parser that lost it.
    if (hist.skipped) out.push(`            ${count(hist.skipped, "history record")} did not parse and ${hist.skipped === 1 ? "was" : "were"} skipped`);
    if (singleAuthor(hist)) out.push(`            one author holds every source-containing directory's commits, so the share is dropped from the rows below`);
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
    out.push(`  +${filtered.length} filtered: ${count(filtered.length, "manifest")} share ${which}`);
  }
  // The other two drops. A repository whose only package.json is a workspace
  // glob printed "none found" and read as one that declares nothing at all —
  // the same silence the name-collision line was added to break.
  if (noise.length) {
    const shapeless = noise.filter((m) => m.why === "shape").length;
    const scaffold = noise.length - shapeless;
    const why = [shapeless ? `${shapeless} declaring no module of its own` : "",
                 scaffold ? `${scaffold} on a scaffold or fixture path` : ""].filter(Boolean).join(", ");
    out.push(`  +${noise.length} filtered: ${why}`);
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
  const ranked = [...dirs.values()].sort((a, b) => b.files - a.files).slice(0, LARGEST);
  out.push("");
  // With a flat distribution every ratio is 1 and the sort is a no-op, so the
  // rows would be insertion order presented as outliers.
  if (!ranked.length || ranked[0].files <= med) {
    out.push(`no source-containing directory departs from those norms; the distribution is flat`);
    return out.join("\n");
  }
  out.push(`largest source-containing directories, against the median`);
  // Where one author holds everything, "top author 100%" is the same phrase on
  // every row and the count beside it is the only figure that varies.
  const one = singleAuthor(hist);
  for (const d of ranked) {
    const h = hist.available ? hist.dirs.get(d.path) : null;
    const share = h ? (one ? `  ${h.commits}c` : `  top author ${Math.round(h.topShare * 100)}% of ${h.commits}c`) : "";
    out.push(`  ${String(d.files).padStart(4)}f  ${(d.files / med).toFixed(0)}× median   ${num(d.lines).padStart(8)}L   ${d.path || "."}${share}`);
  }
  if (dirs.size > ranked.length) out.push(`  +${dirs.size - ranked.length} more source-containing directories, all smaller`);
  return out.join("\n");
}

// ── L1: structure ────────────────────────────────────────────────────────────
//
// A flat source-containing-directory table does not scale — measured at
// ~14,000 tokens on a 3,154-row repository. Budget is met by binary search
// over how many rows survive, after Aider's repo map, rather than a hardcoded
// top-N.

export function renderL1({ dirs, hist, spans, budget }) {
  const groups = entangledGroups(spans);
  const measured = spans.filter((s) => s.measured);
  const layersOf = new Map();
  for (const s of measured) {
    for (const [n, layer] of s.layerOf) {
      if (!layersOf.has(n)) layersOf.set(n, []);
      layersOf.get(n).push({ eco: s.eco, layer, group: groups.get(s)?.get(n) });
    }
  }
  // Two columns exist only when they can carry a figure: the share where more
  // than one author holds the commits, the layer where some analyzer answered.
  // A column of one repeated value, or of nothing at all, is width every row
  // pays for and no row uses.
  const share = !singleAuthor(hist);
  const layered = layersOf.size > 0;

  const names = ["files", "lines", "tests", hist.available ? "commits" : "?"];
  if (share) names.push(hist.available ? "share/a" : "?");
  names.push(hist.available ? "touched" : "?");
  if (layered) names.push("layer");

  const rows = [...dirs.values()].map((d) => {
    const h = hist.available ? hist.dirs.get(d.path) : null;
    const layers = layersOf.get(d.path) ?? [];
    const cells = [
      `${d.files}f`,
      `${num(d.lines)}L`,
      d.tests ? `${d.tests}t` : "-",
      // A blank cell under a "commits" header reads as zero. Where history
      // is unavailable the column says so once, in the header, and every
      // cell carries the same mark rather than an absence.
      hist.available ? (h ? `${h.commits}c` : "0c") : "?",
    ];
    if (share) cells.push(hist.available ? (h ? `${Math.round(h.topShare * 100)}%/${h.majorAuthors}a` : "-") : "?");
    cells.push(hist.available ? (h ? day(h.last) : "-") : "?");
    if (layered) cells.push(layers.length
      ? layers.map((one) => `${measured.length > 1 ? one.eco + ":" : ""}L${one.layer}${one.group ? " g" + one.group : ""}`).join(" · ")
      : "-");
    return { path: d.path || ".", mass: d.lines, cells };
  }).sort((a, b) => b.mass - a.mass);

  const draw = (n) => {
    const keep = rows.slice(0, n);
    // The header is laid out from the widths its own cells produced. A fixed
    // header string sat over whatever the padding happened to make, and named
    // one column while standing above another on every table this has printed.
    const w = names.map((h) => h.length);
    for (const r of keep) r.cells.forEach((c, i) => (w[i] = Math.max(w[i], c.length)));
    const lines = keep.map((r) =>
      "  " + r.cells.map((c, i) => c.padStart(w[i])).join(" ") + "  " + r.path);
    const rest = rows.length - keep.length;
    if (rest > 0) {
      const rf = rows.slice(n).reduce((s, r) => s + Number(r.cells[0].replace("f", "")), 0);
      lines.push(`  +${count(rest, "source-containing directory", "source-containing directories")} not shown (${count(rf, "file")})`);
    }
    const head = "  " + names.map((h, i) => h.padStart(w[i])).join(" ") + "  source-containing directory"
      + (hist.available ? "" : "   (? = history not measured)");
    return [head, ...lines].join("\n");
  };

  // Binary search to the budget, within about 15%. The seed is the smallest
  // table there is: seeded at twenty rows it survives untouched when no size
  // fits, and the table then answers a budget of five with 265 tokens. The
  // CLI clamps --budget at 200 and so cannot reach that, which hid it.
  let lo = 1, hi = rows.length, best = draw(1), kept = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = draw(mid);
    if (tokens(s) <= budget) { best = s; kept = mid; lo = mid + 1; } else hi = mid - 1;
  }
  // "every source-containing directory" stops being true the moment the
  // budget trims one, and the promise was printed above a table that had
  // already dropped a third of its population. The section names what it
  // actually shows.
  return [kept < rows.length
    ? "structure   every source-containing directory the budget admits, largest first"
    : "structure   every source-containing directory, largest first", best].join("\n");
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
  const floor = `${CO_FLOOR} votes over ${count(CO_SUPPORT, "commit")}`;
  out.push(`co-change   ${count(hist.commits.length, "commit")}, median ${count(median(breadths), "source-containing directory", "source-containing directories")} each, ${count(hist.windows, "equal time window")}`);
  if (hist.capped) out.push(`            ${count(hist.capped, "commit")} touched more than the breadth cap and ${hist.capped === 1 ? "was" : "were"} excluded as sweeps`);
  // The floor travels with the sentence about it, in both directions: a reader
  // who sees nothing needs to know what nothing means here, and a reader who
  // sees rows needs to know what the rows had to clear. It was a literal in
  // scan.mjs and appeared nowhere in the output at all.
  if (!hist.pairs.length) { out.push(`            no pair reached the floor of ${floor}`); return out.join("\n"); }
  out.push("");
  out.push(`  Each commit casts one vote, split across the pairs it implies. "share" is`);
  out.push(`  that vote-sum over the commits of whichever source-containing directory`);
  out.push(`  moved less often, and a pair is printed once it clears ${floor}.`);
  out.push("");
  out.push(`  share  vote per window          pair`);
  for (const p of hist.pairs.slice(0, top)) {
    const prof = p.profile.map((x) => x.toFixed(1).padStart(4)).join(" ");
    const conc = p.profile.filter((x) => x > 0).length === 1 ? "  in one window" : "";
    // The repository root has no name of its own, and it is spelled "." on
    // every other row of the page. One population, one spelling — a bare
    // leading space is not a directory a reader can open.
    out.push(`  ${(p.share * 100).toFixed(0).padStart(4)}%  [${prof} ]  of ${p.base}c  ${p.a || "."} + ${p.b || "."}${conc}`);
  }
  // How many cleared the floor and did not fit --top. Without it the list ends
  // at a number the reader chose and reads as the end of the evidence.
  const rest = hist.pairs.length - Math.min(top, hist.pairs.length);
  if (rest > 0) out.push(`  +${count(rest, "pair")} above that floor, not shown (--top ${top})`);
  out.push("");
  out.push(`  Source-containing directories changing together is the Common Closure`);
  out.push(`  criterion, a design argument. No study reviewed for this tool tested`);
  out.push(`  whether it predicts anything, so read it as a placement question, not risk.`);
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
  for (const r of hist.relocations.slice(0, RELOCS)) {
    out.push(`  ${day(r.at)}  ${r.n.toString().padStart(4)} files   ${r.from} → ${r.to}`);
  }
  if (hist.relocations.length > RELOCS) out.push(`  +${count(hist.relocations.length - RELOCS, "move")} not shown`);
  return out.join("\n");
}

// ── L2: one subtree in detail ────────────────────────────────────────────────

export function renderL2({ files, conv, hist, spans = [], prefix }) {
  const inSub = files.filter((f) => f.path.startsWith(prefix + "/") || f.dir === prefix);
  if (!inSub.length) return `no source files under ${prefix}`;
  const lineCounts = inSub.map((f) => f.lines);
  const out = [];
  out.push(`${prefix}   ${count(inSub.length, "file")}, ${count(lineCounts.reduce((a, b) => a + b, 0), "line")}`);
  out.push(`lines per file   median ${median(lineCounts)}   p90 ${pct(lineCounts, 0.9)}   max ${maxOf(lineCounts)}`);
  // A subtree is read to decide whether it can come out, and that question is
  // not answered by its own files: what holds it in place is who loads on it
  // and what it loads on.
  out.push("");
  out.push(renderLoad(spans));
  out.push("");
  const sorted = [...inSub].sort((a, b) => b.lines - a.lines);
  const w = maxOf(sorted.map((f) => String(f.lines).length));
  // A blank cell under a date reads as an old file. A file with no commit in
  // the window is unmeasured, and where history itself is unavailable every
  // cell says so — the same two marks the structure table uses.
  const stamp = (f) => (!hist.available ? "?" : hist.fileLast.has(f.path) ? day(hist.fileLast.get(f.path)) : "-");
  const sw = maxOf(sorted.map((f) => stamp(f).length));
  // The gutter is measured from the row it heads, so the column name sits over
  // its own column however wide the line counts run.
  const gutter = " ".repeat(Math.max(1, w + 8 - "lines".length));
  out.push(`  lines${gutter}${(hist.available ? "last-touched" : "(? = history not measured)").padEnd(sw)}  file`);
  for (const f of sorted) {
    const t = conv.isTest(f.path) ? " test" : "     ";
    out.push(`  ${String(f.lines).padStart(w)}L${t}  ${stamp(f).padEnd(sw)}  ${f.path}`);
  }
  return out.join("\n");
}

// The load one subtree carries, per span, from the same confinement the scoped
// span line is rendered from. Both directions always, because "nothing depends
// on this" and "this depends on nothing" are different facts and a reader
// planning an extraction needs both.
function renderLoad(spans) {
  const out = [];
  for (const s of spans) {
    const head = `load on this subtree${labelOf(spans, s)}`;
    const pad = " ".repeat(head.length + 3);
    if (!s.measured) { out.push(`${head}   not measured — ${s.why}`); continue; }
    const c = s.load;
    // Measured, and none of it is here. That is a different sentence from a
    // subtree nothing crosses into, and rendering them alike would let a
    // reader take an unanalysed subtree for a self-contained one.
    if (!c.held) { out.push(`${head}   the ${s.eco} graph holds no ${s.unitPlural} under ${c.at}`); continue; }
    if (!c.inbound && !c.outbound) {
      out.push(`${head}   fan-in 0, fan-out 0 — no edge crosses into or out of ${c.at}`);
    } else {
      out.push(`${head}   fan-in ${c.inbound} from outside${counterparts(c.inboundTop, true)}`);
      out.push(`${pad}fan-out ${c.outbound} to outside${counterparts(c.outboundTop, true)}`);
    }
    out.push(`${pad}${c.internal} ${c.internal === 1 ? "edge stays" : "edges stay"} inside ${c.at}`);
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

function renderDeps(spans) {
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
  out.push(`${head}  ${count(d.edges, "edge")} over ${count(d.nodes.size, d.unit, d.unitPlural)}, via ${d.provenance}${d.note ? ` — ${d.note}` : ""}`);
  // Where the analyzer's own search stopped, on its own line, because it
  // qualifies the count above it. The note beside that count says a module was
  // found and did not resolve; this says a directory was never opened, so
  // nothing inside it was ever a candidate — a different fact, and the quieter
  // of the two.
  if (d.unsearched) {
    const [were, them] = d.unsearched === 1 ? ["was", "it"] : ["were", "them"];
    out.push(`${pad}${count(d.unsearched, "directory", "directories")} sat deeper than the ${d.searchDepth} levels this walk descends and ${were} not searched for ${d.searchFor}, nor anything under ${them}`);
  }
  // Once, here. The detail below used to repeat it in other words two lines
  // later — "0 mutually entangled group(s)" and then "no group found" — and a
  // fact stated twice invites the reader to look for the difference.
  out.push(`${pad}load path is ${count(d.depth, "layer")} deep; ${d.tangles.length ? count(d.tangles.length, "mutually entangled group") : "no mutually entangled group"}`);
  // What was measured is the whole module; what is shown is the scope. The
  // edges between the two are the load this subtree carries, and dropping them
  // silently would make a subtree look self-contained when it is not.
  if (d.crossings) out.push(pad + renderCrossings(d.crossings));
  return out.join("\n");
}

// The counterparts a reader would follow first, and what the handful left out.
// One renderer for both places the confinement is shown, so the truncation is
// disclosed the same way in each: a list that simply stops is a fact the
// reader cannot see is missing. The one-line form under a span carries names;
// the subtree section carries the edge count with them, because that is the
// number an extraction turns on.
const counterparts = (t, withCount) =>
  t.top.length
    ? ` (top: ${t.top.map((x) => (withCount ? `${x.at} ${x.edges}` : x.at)).join(", ")}${t.more ? `, +${t.more} more` : ""})`
    : "";

function renderCrossings(c) {
  if (!c.inbound && !c.outbound) return `crossings   no edge crosses into or out of ${c.at}`;
  return `crossings   ${c.inbound} inbound from outside ${c.at}${counterparts(c.inboundTop)} · ` +
         `${c.outbound} outbound${counterparts(c.outboundTop)}`;
}

// Group numbers belong to the page, not to a span: two spans each numbering
// their own tangles from one would print two g1 rows in a table where a reader
// cannot tell them apart.
function entangledGroups(spans) {
  const all = spans.filter((s) => s.measured).flatMap((span) => span.tangles.map((group) => ({ span, group })));
  all.sort((a, b) => b.group.length - a.group.length);
  const of = new Map();
  all.forEach(({ span, group }, i) => {
    if (!of.has(span)) of.set(span, new Map());
    for (const n of group) of.get(span).set(n, i + 1);
  });
  return of;
}

export function renderDepsDetail(spans) {
  const groups = entangledGroups(spans);
  const out = [];
  for (const d of spans) {
    if (!d.measured) continue;
    const label = labelOf(spans, d);
    // Each span's detail is announced when there is more than one, so the
    // blocks below cannot be read as one graph's.
    if (label) { out.push(""); out.push(`dependencies${label}`); }
    d.tangles.slice(0, TANGLES).forEach((t, i) => {
      const internal = t.reduce((s, n) => s + [...(d.out.get(n) || [])].filter((x) => t.includes(x)).length, 0);
      const g = label ? ` g${groups.get(d)?.get(t[0])}` : "";
      // The span's own header already opened the block; a second blank line
      // under it buys nothing, and output is the budget this tool spends.
      if (!(label && i === 0)) out.push("");
      out.push(`  entangled${g}: ${count(t.length, d.unit, d.unitPlural)}, ${count(internal, "internal edge")}`);
      const rank = t.map((n) => ({ n, deg: [...(d.out.get(n) || [])].filter((x) => t.includes(x)).length + t.filter((m) => (d.out.get(m) || new Set()).has(n)).length }))
        .sort((a, b) => b.deg - a.deg);
      for (const r of rank.slice(0, 5)) out.push(`    ${String(r.deg).padStart(3)} of the group's edges   ${r.n}`);
      if (rank.length > 5) out.push(`    +${rank.length - 5} more`);
      out.push(`    Inside a group nothing can be built, tested, or replaced alone.`);
    });
    if (d.tangles.length > TANGLES) out.push(`  +${count(d.tangles.length - TANGLES, "more group")}`);

    const gate = [...d.fanOut.entries()].map(([n, o]) => ({ n, o, i: d.fanIn.get(n) || 0 }))
      .filter((x) => x.o >= 3 && x.i <= 1).sort((a, b) => b.o - a.o || (a.n < b.n ? -1 : 1));
    const top = gate.slice(0, FANOUT);
    if (top.length) {
      out.push("");
      out.push(`  fan-out 3 or more with fan-in 1 or less`);
      for (const t of top) {
        // What a change here arrives at, counted for the reader rather than
        // left as a traversal of an edge list the page does not print. It
        // prices the split: everything reached is everything a change reaches.
        const r = d.reach.get(t.n);
        const reach = r === undefined ? "" : `  reaches ${r} of ${d.nodes.size}`;
        out.push(`    fan-out ${String(t.o).padStart(3)}  fan-in ${t.i}${reach}   ${t.n}`);
      }
      if (d.reachWhy) out.push(`    reach not measured — ${d.reachWhy}`);
      if (gate.length > FANOUT) out.push(`    +${gate.length - FANOUT} more past that gate`);
    }
  }
  // Blank lines off both ends, and nothing else: a plain trim also ate the
  // indent of whichever block happened to come first, so a section moved one
  // column left depending on what the repository had in it.
  return out.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
}

// ── Compare: this scan against a recorded one ────────────────────────────────
//
// The delta and nothing else. A reader running this has already read the
// normal view once — that is where the snapshot came from — and reprinting it
// would bury the few lines they came back for.
//
// Facts, not verdicts, which here also means no exit code: a dissolved group
// and a formed one are the same kind of fact, and the tool does not know which
// of them the reader was aiming at.

// Every list here is capped, and every cap says what it left out.
const CAP = 5;
const capped = (xs) => xs.slice(0, CAP).join(", ") + (xs.length > CAP ? `, +${xs.length - CAP} more` : "");

// History is append-only: a directory that moved yesterday keeps the co-change
// and the activity of the place it came from until the window fills. Printed
// on every comparison, because the reader who needs it is the one who did not
// think to ask.
const LAG = [
  `co-change and activity are history-derived and lag by design: history is`,
  `append-only, so a move enters it only as the window fills. Compare those`,
  `across windows, not across a refactor.`,
];

export function renderCompare(before, now) {
  const out = [];
  out.push(`snapshot    loadpath ${before.version}, schema ${before.schema}`);
  out.push(`now         loadpath ${now.version}, schema ${now.schema}`);
  out.push(`            ${num(before.files)} → ${count(now.files, "source file")}, ` +
           `${num(Object.keys(before.dirs).length)} → ${count(Object.keys(now.dirs).length, "source-containing directory", "source-containing directories")}`);
  const moved = [];

  // ── Spans, matched by ecosystem ──
  const ecos = [...new Set([...before.spans, ...now.spans].map((s) => s.eco))];
  for (const eco of ecos) {
    const b = before.spans.find((s) => s.eco === eco);
    const n = now.spans.find((s) => s.eco === eco);
    const head = `dependencies${ecos.length > 1 ? ` (${eco})` : ""}`;
    const pad = " ".repeat(head.length + 2);
    const body = [];
    // A span measured on one side only is not a change in the repository; it
    // is a change in what could be measured, and saying so is the difference
    // between an installed toolchain and a restructuring.
    if (!b) body.push(`measured now and not in the snapshot; there is nothing to compare it against`);
    else if (!n) body.push(`in the snapshot and not measured now; there is nothing to compare it against`);
    else {
      const changed = [];
      if (b.edges !== n.edges) changed.push(`${num(b.edges)} → ${count(n.edges, "edge")}`);
      if (b.nodes !== n.nodes) changed.push(`${num(b.nodes)} → ${count(n.nodes, n.unit)}`);
      if (b.layers !== n.layers) changed.push(`${b.layers} → ${count(n.layers, "layer")} deep`);
      if (changed.length) body.push(changed.join(", "));
      // By member set, never by count: one group dissolving while another of
      // the same size forms is the restructuring, and a count comparison calls
      // that pair of events nothing at all.
      const key = (g) => [...g].sort().join("\0");
      const was = new Map(b.groups.map((g) => [key(g), g]));
      const is = new Map(n.groups.map((g) => [key(g), g]));
      for (const [k, g] of was) if (!is.has(k)) body.push(`group dissolved   ${capped(g)}`);
      for (const [k, g] of is) if (!was.has(k)) body.push(`group formed      ${capped(g)}`);
    }
    if (!body.length) continue;
    // A span missing from one side is a gap in the comparison, not a move, so
    // it does not suppress the sentence below saying nothing moved. The reader
    // gets both: what did not change, and what could not be checked.
    if (b && n) moved.push(eco);
    out.push("");
    out.push(`${head}  ${body[0]}`);
    for (const l of body.slice(1)) out.push(pad + l);
  }

  // ── Layout ──
  const appeared = Object.keys(now.dirs).filter((d) => !(d in before.dirs)).sort();
  const gone = Object.keys(before.dirs).filter((d) => !(d in now.dirs)).sort();
  if (appeared.length || gone.length) {
    moved.push("source-containing directories");
    out.push("");
    const rows = [];
    if (appeared.length) rows.push(`${appeared.length} appeared   ${capped(appeared)}`);
    if (gone.length) rows.push(`${gone.length} gone       ${capped(gone)}`);
    out.push(`source-containing directories   ${rows[0]}`);
    for (const r of rows.slice(1)) out.push(" ".repeat(32) + r);
  }

  // A source-containing directory that kept its name can still have had its
  // contents moved out from under it, which is the half of a restructuring
  // the name list misses.
  const mass = [];
  for (const [d, was] of Object.entries(before.dirs)) {
    const is = now.dirs[d];
    if (!is || !was.lines) continue;
    const delta = (is.lines - was.lines) / was.lines;
    if (Math.abs(delta) > 0.2) mass.push({ d, was, is, delta });
  }
  if (mass.length) {
    moved.push("mass");
    mass.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    out.push("");
    out.push(`source-containing directory mass moved by more than a fifth`);
    for (const m of mass.slice(0, CAP)) {
      out.push(`  ${num(m.was.lines)}L → ${num(m.is.lines)}L   ${m.delta > 0 ? "+" : ""}${Math.round(m.delta * 100)}%   ${m.d}`);
    }
    if (mass.length > CAP) out.push(`  +${mass.length - CAP} more beyond a fifth`);
  }

  if (!moved.length) {
    out.push("");
    out.push(`no structural change against the snapshot`);
  }
  out.push("");
  for (const l of LAG) out.push(l);
  return out.join("\n");
}
