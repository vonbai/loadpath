#!/usr/bin/env node
// Loadpath — exact facts about how a codebase carries its weight.
//
// Everything in this file is measured from the filesystem or from git history.
// Nothing here infers. Inference lives in deps.mjs, alone, so that a reader can
// tell a number's trustworthiness from which file produced it.
//
// Entry point is loadpath.mjs; this file is a module, not a command.
//
// The tool emits leads. A finding exists after someone reads the code a lead
// points at. See DESIGN.md.

import { readdirSync, openSync, readSync, closeSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname, basename, extname, sep, resolve } from "node:path";
import { execFileSync } from "node:child_process";

// ── Vocabulary ───────────────────────────────────────────────────────────────

const SOURCE_EXT = new Set([
  ".go", ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".java",
  ".kt", ".kts", ".rb", ".php", ".cs", ".swift", ".c", ".h", ".cc", ".cpp",
  ".hpp", ".m", ".mm", ".scala", ".ex", ".exs", ".clj", ".cljs", ".hs", ".ml",
  ".sol", ".zig", ".dart", ".lua", ".pl", ".r", ".jl", ".vue", ".svelte",
]);

// Directories never walked. Vendored and build output, not first-party code.
const SKIP_DIR = new Set([
  ".git", "node_modules", "vendor", "target", "dist", "build", "out",
  ".venv", "venv", "__pycache__", ".next", ".nuxt", ".svelte-kit", "coverage",
  ".tox", "third_party", "Pods", "Carthage", ".gradle", ".idea", ".vscode",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", "bower_components", ".terraform",
]);

// Generated-file markers, after github-linguist's generated.rb. Path patterns
// first because they need no content read; a filter, not a report line.
const GENERATED_PATH = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|go\.sum|flake\.lock|Podfile\.lock)$/,
  /\.min\.(js|css)$/, /\.pb\.(go|cc|h|py)$/, /_pb2\.py$/, /\.generated\./,
  /(^|\/)(gen|generated)\//, /\.designer\.cs$/i, /\.g\.dart$/, /_generated\.\w+$/,
];
const GENERATED_HEAD = /^\/\/ Code generated .* DO NOT EDIT\.|@generated|DO NOT EDIT/;

// Test-path conventions, voted on rather than assumed. Applied to the full
// repo-relative path, never a bare filename — a filename cannot contain a
// separator, so a path rule tested against one can never fire.
const TEST_RULES = [
  { name: "*_test.*", re: /_test\.[^./]+$/ },
  { name: "test_*", re: /(^|\/)test_[^/]+$/ },
  { name: "*.test.*", re: /\.test\.[^./]+$/ },
  { name: "*.spec.*", re: /\.spec\.[^./]+$/ },
  { name: "*_spec.*", re: /_spec\.[^./]+$/ },
  { name: "__tests__/", re: /(^|\/)__tests__\// },
  { name: "tests/", re: /(^|\/)tests?\// },
  { name: "spec/", re: /(^|\/)specs?\// },
  { name: "*Test.*", re: /(^|\/)[A-Z]\w*Tests?\.[^./]+$/ },
  { name: "conftest.py", re: /(^|\/)conftest\.py$/ },
];

const MANIFESTS = [
  { file: "go.mod", eco: "Go" },
  { file: "package.json", eco: "Node" },
  { file: "pyproject.toml", eco: "Python" },
  { file: "setup.py", eco: "Python" },
  { file: "Cargo.toml", eco: "Rust" },
  { file: "pom.xml", eco: "Java" },
  { file: "build.gradle", eco: "Java" },
  { file: "build.gradle.kts", eco: "Java" },
  { file: "Gemfile", eco: "Ruby" },
  { file: "composer.json", eco: "PHP" },
  { file: "pnpm-workspace.yaml", eco: "Node" },
  { file: "tsconfig.json", eco: "TypeScript" },
  { suffix: ".sln", eco: "C#" },
  { suffix: ".csproj", eco: "C#" },
];

// The directories an application keeps its own source in. A private
// package.json beside one of these is a module the repository builds, not a
// workspace glob's fixture.
const APP_DIR = new Set(["src", "lib", "app", "web"]);

// ── One population, two writers ──────────────────────────────────────────────
//
// The filesystem walk and the git log must admit the same paths. They did not:
// history admitted anything with a source extension, so it voted for vendored,
// generated and dot-directory files the walk had already refused, and it kept
// directories that have since been deleted. On a pinned corpus the top two
// co-change rows named four directories, none of them on disk. A lead the
// reader cannot open is not a lead. The rule therefore lives here, once, and
// both writers ask it rather than each restating a version of it.
//
// The checks that need the file itself — the generated-marker read, the
// unreadable file, the symlink — stay with the walk. Git cannot answer them.

// A directory neither writer enters. `.github` is the one dot-directory that
// holds first-party code.
const closed = (seg) => SKIP_DIR.has(seg) || (seg.startsWith(".") && seg !== ".github");

function admits(submodules = new Set()) {
  const subs = [...submodules];
  return (rel) => {
    if (!SOURCE_EXT.has(extname(rel))) return false;
    if (rel.split("/").some(closed)) return false;
    if (GENERATED_PATH.some((re) => re.test(rel))) return false;
    return !subs.some((sm) => rel === sm || rel.startsWith(sm + "/"));
  };
}

// ── Small helpers ────────────────────────────────────────────────────────────

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(Math.floor(s.length * p), s.length - 1)];
};
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const num = (n) => n.toLocaleString("en-US");
// Token estimate. A proxy, stated as one wherever it is printed.
// Upper bounds, not estimates — a budget that can be exceeded is not a budget.
// Measured with tiktoken (o200k_base and cl100k_base agree to within 1%) over
// this repository's own bytes. Two, because prose and a table of paths and
// numbers do not tokenize alike, and one ratio applied to both must be wrong
// somewhere: 4.55 chars/token for SKILL.md, 3.8 for the prose-heavy orient
// view, 2.9 for a structure page, 2.66 for the structure table body alone.
// Each divisor sits just under the densest shape it covers, so neither figure
// is ever optimistic. A general "about 3.6" was 36% optimistic on exactly the
// output --budget trims, which is the half that matters.
const CHARS_PER_TOKEN = 2.6;        // tool output: tables of paths and numbers
const CHARS_PER_TOKEN_PROSE = 4.4;  // markdown prose: SKILL.md and references
const tokens = (s) => Math.round(s.length / CHARS_PER_TOKEN);
const proseTokens = (s) => Math.round(s.length / CHARS_PER_TOKEN_PROSE);

function git(root, args, { buffer = false } = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: buffer ? "buffer" : "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryGit(root, args, opts) {
  try { return { ok: true, out: git(root, args, opts) }; }
  catch (e) { return { ok: false, err: String(e.stderr || e.message).trim().split("\n")[0] }; }
}

// ── Inventory — exact, from the filesystem ───────────────────────────────────

// Paths git tracks as submodules. Their code belongs to another repository, and
// counting it makes the filesystem half describe one project while the git half
// describes another.
function submodulePaths(root) {
  const out = new Set();
  const f = join(root, ".gitmodules");
  if (!existsSync(f)) return out;
  try {
    for (const m of readAll(f).matchAll(/^\s*path\s*=\s*(.+)$/gm)) out.add(m[1].trim());
  } catch { /* unreadable: skip nothing */ }
  return out;
}

function inventory(root, prefix = "", submodules = new Set()) {
  const admit = admits(submodules);
  const files = [];
  const unreadable = [];
  const walk = (abs) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const p = join(abs, e.name);
      if (e.isSymbolicLink()) continue;             // never follow; loops and duplicates
      // Pruning, not filtering: `admit` refuses every path under a closed
      // directory anyway. Not descending is what keeps node_modules from
      // costing a walk.
      if (e.isDirectory()) { if (!closed(e.name)) walk(p); continue; }
      if (!e.isFile()) continue;
      const rel = relative(root, p).split(sep).join("/");
      if (prefix && !rel.startsWith(prefix + "/") && rel !== prefix) continue;
      if (!admit(rel)) continue;
      const m = measure(p);
      if (m.unreadable) { unreadable.push(rel); continue; }
      if (m.generated) continue;
      files.push({ path: rel, dir: dirname(rel) === "." ? "" : dirname(rel), ...m });
    }
  };
  walk(root);
  files.unreadable = unreadable;
  return files;
}

// One read per file: line count, byte count, generated-marker check, binary check.
const BUF = Buffer.allocUnsafe(1 << 16);
function measure(abs) {
  let fd;
  // A file that cannot be read is not a file of zero lines. It leaves the
  // inventory rather than entering every total, median and percentile as 0.
  try { fd = openSync(abs, "r"); } catch { return { unreadable: true }; }
  let lines = 0, bytes = 0, first = "", partial = false, n;
  try {
    while ((n = readSync(fd, BUF, 0, BUF.length, null)) > 0) {
      if (bytes === 0) first = BUF.subarray(0, Math.min(n, 400)).toString("utf8");
      for (let i = 0; i < n; i++) if (BUF[i] === 10) lines++;
      bytes += n;
    }
  } catch { partial = true; }
  finally { closeSync(fd); }
  if (partial) return { unreadable: true };   // a partial count is not an exact one
  return { lines, bytes, generated: GENERATED_HEAD.test(first) };
}

// Which test convention does this repository use? Voted, not assumed.
function testConvention(files) {
  const votes = TEST_RULES.map((r) => ({ ...r, n: files.filter((f) => r.re.test(f.path)).length }))
    .filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  const winners = votes.filter((v) => v.n >= Math.max(3, votes[0]?.n * 0.2));
  const isTest = (p) => winners.some((w) => w.re.test(p));
  return { winners, isTest };
}

function byDirectory(files, isTest) {
  const dirs = new Map();
  for (const f of files) {
    let d = dirs.get(f.dir);
    if (!d) dirs.set(f.dir, (d = { path: f.dir, files: 0, lines: 0, tests: 0 }));
    d.files++; d.lines += f.lines;
    if (isTest(f.path)) d.tests++;
  }
  return dirs;
}

// ── History — exact, from git ────────────────────────────────────────────────
//
// One pass with --name-status -M -z yields file lists, add/delete/rename
// status, author and timestamp together. The timestamp is the *committer*
// date, because that is what --since filters on: bucketing by author date
// put 99.7% of a rebased repository's commits in the final window and
// annotated every pair "one window only" as though it were a fact about time.
//
// NUL separation is not optional: git C-quotes any path holding a non-ASCII
// byte, a quote, a tab or a newline, and such a path parses its own extension
// wrongly and vanishes.

// Git reads `1y` as a date, not a duration. It resolves to nineteen days ago,
// `6mo` to fourteen, and `30d` to ten days in the *future* — a day-of-month, so
// the window holds nothing. All three exit 0, so the answer is silently wrong
// rather than refused, which is the one failure shape this tool exists to stop.
// The compact spellings are rewritten to the dotted form git reads as a
// duration, and the rewrite is disclosed beside the window it produced.
const SINCE_UNITS = {
  y: "years", yr: "years", yrs: "years", year: "years", years: "years",
  mo: "months", mos: "months", mon: "months", month: "months", months: "months",
  w: "weeks", wk: "weeks", wks: "weeks", week: "weeks", weeks: "weeks",
  d: "days", day: "days", days: "days",
  h: "hours", hr: "hours", hrs: "hours", hour: "hours", hours: "hours",
};
function normalizeSince(input) {
  const t = String(input).trim();
  const m = /^(\d+)\s*([A-Za-z]+)$/.exec(t);
  if (!m) return { since: t };
  const unit = SINCE_UNITS[m[2].toLowerCase()];
  // `m` is minutes to some readers and months to others, and git agrees with
  // neither. Naming both spellings is more use than picking one.
  if (!unit) return { since: t, ambiguous: `${m[1]}${m[2]}` };
  const canonical = `${m[1]}.${unit}`;
  return canonical === t ? { since: t } : { since: canonical, rewritten: t };
}

// `live` is the set of directories the inventory found on disk, and it is not
// optional: the two writers report one page, and a history figure that has not
// been joined against the tree can name a directory the reader cannot open.
function history(root, { since: requested, windows, breadthCap, prefix = "", submodules = new Set(), live }) {
  const norm = normalizeSince(requested);
  if (norm.ambiguous) {
    return { available: false, reason: `--since ${norm.ambiguous} is ambiguous — git reads it as a day of the month, not a duration. Write it as ${/^\d+m$/i.test(norm.ambiguous) ? `${parseInt(norm.ambiguous, 10)}.months or ${parseInt(norm.ambiguous, 10)}.minutes` : "N.days, N.weeks, N.months or N.years"}.` };
  }
  const since = norm.since;
  const shallow = tryGit(root, ["rev-parse", "--is-shallow-repository"]);
  if (shallow.ok && shallow.out.trim() === "true") {
    return { available: false, reason: "shallow clone — every file reads as added, so history figures would be fabricated. Re-clone without --depth." };
  }
  const probe = tryGit(root, ["log", "-1", `--since=${since}`, "--format=%H"]);
  if (!probe.ok) {
    return { available: false, reason: `not a git repository, or no history (${probe.err})` };
  }
  // Git resolves an unparseable date to *now* and exits 0, so a typo silently
  // empties the window. A resolved cutoff within a few seconds of now is that
  // failure, not a request for the last few seconds. Ask git to parse it first.
  const dateCheck = tryGit(root, ["rev-parse", `--since=${since}`]);
  const cutoff = Number((dateCheck.out || "").match(/--max-age=(\d+)/)?.[1] ?? 0);
  if (!dateCheck.ok || !cutoff || Math.abs(cutoff - Date.now() / 1000) < 5) {
    return { available: false, reason: `--since ${since} is not a date git understands; git resolves it to "now", which would silently report no history` };
  }
  // A cutoff in the future is a day-of-month reading that normalisation missed.
  if (cutoff > Date.now() / 1000) {
    return { available: false, reason: `--since ${requested} resolves to a date in the future, so the window holds nothing. Write it as N.days, N.weeks, N.months or N.years.` };
  }
  // The resolved cutoff is printed, always, so any remaining disagreement
  // between the word typed and the window measured is visible rather than silent.
  const cutoffDay = new Date(cutoff * 1000).toISOString().slice(0, 10);

  const res = tryGit(root, [
    "-c", "core.quotePath=false", "log", `--since=${since}`, "--no-merges",
    "-M", "--name-status", "-z", "--format=%x01%H%x1f%ct%x1f%aN",
  ], { buffer: true });
  if (!res.ok) return { available: false, reason: res.err };

  const text = res.out.toString("utf8");
  const admit = admits(submodules);
  const commits = [];
  const relocations = new Map();
  let cur = null;

  for (const chunk of text.split("\x01")) {
    if (!chunk) continue;
    const nl = chunk.indexOf("\n");
    const head = nl < 0 ? chunk : chunk.slice(0, nl);
    const [oid, at, author] = head.split("\x1f");
    if (!/^[0-9a-f]{40,64}$/.test(oid || "")) continue;   // sha1 and sha256 both
    cur = { at: Number(at), author: author || "?", paths: [], adds: 0, edits: 0 };
    commits.push(cur);
    const body = nl < 0 ? "" : chunk.slice(nl + 1);
    const fields = body.split("\0").filter(Boolean);
    const inScope = (p) => !prefix || p === prefix || p.startsWith(prefix + "/");
    for (let i = 0; i < fields.length; i++) {
      const st = fields[i];
      if (!/^[A-Z]\d*$/.test(st)) continue;
      if (st[0] === "R" || st[0] === "C") {
        const from = fields[++i], to = fields[++i];
        if (!from || !to) continue;
        // The vote is a lead and takes the population rule with everything else
        // that points somewhere.
        if (admit(to) && inScope(to)) { cur.paths.push(to); cur.edits++; }
        // The relocation is a record, and takes no filter at all. What a
        // repository moved is what it moved: a 482-file specs -> archive is the
        // migration it has already done, which is the best evidence of the one
        // it is mid-way through, and neither side of it has to be code this
        // tool counts. The section says it counts every file type, because
        // "482 files" there means something the rest of the page does not.
        const move = inScope(from) || inScope(to) ? commonMove(from, to) : null;
        if (move) {
          const k = `${move[0]}\0${move[1]}`;
          const r = relocations.get(k) || { from: move[0], to: move[1], n: 0, at: cur.at };
          r.n++; r.at = Math.max(r.at, cur.at); relocations.set(k, r);
        }
      } else {
        const p = fields[++i];
        if (!p) continue;
        if (!admit(p) || !inScope(p)) continue;
        cur.paths.push(p);
        // An edit is what separates maintenance from creation, so it is counted
        // over the same paths the votes are. Counted over every path in the
        // commit, one README edit lifted a bulk add of fifty files out of the
        // creation damping below.
        if (st[0] === "A") cur.adds++; else cur.edits++;
      }
    }
  }

  const withSource = commits.filter((c) => c.paths.length);
  if (!withSource.length) return { available: false, reason: "no commits touching source in this window" };

  return {
    available: true,
    cutoff, cutoffDay, since, rewrittenFrom: norm.rewritten || "",
    commits: withSource,
    relocations: [...relocations.values()].filter((r) => r.n >= 3).sort((a, b) => b.n - a.n),
    ...perDirectory(withSource, windows, live),
    ...coChange(withSource, windows, breadthCap, live),
  };
}

// A rename's highest differing path prefix. `a/b/x.go -> a/c/x.go` relocates
// `a/b` to `a/c`; a rename inside one directory relocates nothing.
function commonMove(from, to) {
  const a = dirname(from).split("/"), b = dirname(to).split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i >= a.length && i >= b.length) return null;
  const fa = a.slice(0, i + 1).join("/"), fb = b.slice(0, i + 1).join("/");
  return fa === fb ? null : [fa, fb];
}

// The window the commits actually occupy, which is not the window that was
// asked for: --since sets a floor, and the oldest commit inside it sets the
// start of everything measured against time.
function windowSpan(commits) {
  const times = commits.map((c) => c.at).sort((a, b) => a - b);
  const lo = times[0], hi = times[times.length - 1];
  return { lo, hi, span: Math.max(hi - lo, 1) };
}

function perDirectory(commits, windows, live) {
  const { lo, hi, span } = windowSpan(commits);
  const dirs = new Map();
  for (const c of commits) {
    const seen = new Set();
    for (const p of c.paths) {
      const d = dirname(p) === "." ? "" : dirname(p);
      if (seen.has(d)) continue;
      seen.add(d);
      let e = dirs.get(d);
      if (!e) dirs.set(d, (e = { commits: 0, first: c.at, last: c.at, authors: new Map() }));
      e.commits++;
      e.first = Math.min(e.first, c.at);
      e.last = Math.max(e.last, c.at);
      e.authors.set(c.author, (e.authors.get(c.author) || 0) + 1);
    }
  }
  // History knows directories the tree no longer has. The join happens here,
  // in the measurement and exactly once, so that every renderer is handed the
  // same population and no count can exceed the number of directories there
  // are.
  for (const d of [...dirs.keys()]) if (!live.has(d)) dirs.delete(d);
  // Commit-share concentration: the top author's share, and how many authors
  // clear a stated 5% share. The ratio ranked first in a defect model where the
  // raw count did not — but it is undefined where activity is absent, so it is
  // emitted beside the count and never instead of it.
  for (const e of dirs.values()) {
    const shares = [...e.authors.values()].sort((a, b) => b - a);
    e.topShare = shares[0] / e.commits;
    e.majorAuthors = shares.filter((n) => n / e.commits >= 0.05).length;
    e.authorCount = shares.length;
  }
  // How far back "recently" reaches. Ninety days is the convention, but a
  // window shorter than that cannot be asked a ninety-day question, and the
  // sentence would then claim more than was measured — `--since 30.days` said
  // "the last 90 days" for as long as the horizon was a constant in the
  // renderer. Whole days, because that is the unit the line prints, and the
  // cutoff is taken from the same number so the two cannot disagree. It is
  // anchored at the newest commit in the window rather than at now: the
  // measurement knows the window, not the calendar.
  const horizonDays = Math.max(1, Math.min(90, Math.floor(span / 86400)));
  const recent = hi - horizonDays * 86400;
  const active = [...dirs.values()].filter((e) => e.last >= recent).length;
  const unseen = live.size - dirs.size;
  return { dirs, lo, hi, span, windows, horizonDays, active, dormant: dirs.size - active, unseen };
}

function coChange(commits, windows, cap, live) {
  const { lo, span } = windowSpan(commits);
  const pair = new Map();
  const own = new Map();
  let capped = 0;
  for (const c of commits) {
    const ds = [...new Set(c.paths.map((p) => (dirname(p) === "." ? "" : dirname(p))))].sort();
    const w = Math.min(Math.floor(((c.at - lo) * windows) / span), windows - 1);
    for (const d of ds) own.set(d, (own.get(d) || 0) + 1);
    if (ds.length < 2) continue;
    // A commit touching many directories is a sweep, not evidence of pairwise
    // coupling: at breadth 100 a pair's share of one vote is 2e-4, so 2,475
    // such commits would be needed to reach the reporting floor. Capping loses
    // nothing measurable and is disclosed.
    if (ds.length > cap) { capped++; continue; }
    const vote = (2 / (ds.length * (ds.length - 1))) * (c.edits === 0 ? 0.15 : 1);
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const k = ds[i] + "\0" + ds[j];
        let v = pair.get(k);
        if (!v) pair.set(k, (v = new Array(windows).fill(0)));
        v[w] += vote;
      }
    }
  }
  const pairs = [];
  let dropped = 0;
  for (const [k, v] of pair) {
    const [a, b] = k.split("\0");
    const total = v.reduce((x, y) => x + y, 0);
    const base = Math.min(own.get(a) || 0, own.get(b) || 0);
    if (total < 0.5 || base < 3) continue;
    // A pair naming a directory the tree no longer has cannot be followed, and
    // it outranked everything that could: the two strongest rows on a pinned
    // corpus named four deleted directories. Dropped after the floor, so the
    // count means pairs that would otherwise have been reported, and counted,
    // because a silently shorter list is the same failure one step quieter.
    if (!live.has(a) || !live.has(b)) { dropped++; continue; }
    pairs.push({ a, b, total, base, share: total / base, profile: v });
  }
  pairs.sort((x, y) => y.share - x.share);
  return { pairs, capped, dropped, own };
}

// ── Manifests — exact, declared rather than inferred ─────────────────────────

function manifests(root) {
  const hits = [];
  const walk = (abs, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name) || e.name.startsWith(".")) continue;
        walk(join(abs, e.name), depth + 1);
      } else {
        const hit = MANIFESTS.find((m) => m.file === e.name || (m.suffix && e.name.endsWith(m.suffix)));
        if (hit) {
          const rel = relative(root, join(abs, e.name)).split(sep).join("/");
          // A workspace glob is not a module boundary: on one real repository
          // it matched 297 of 299 package.json files where the modules number
          // three. Named-and-public separates them — but it also erased every
          // application, because `private: true` is npm's own flag for "do not
          // publish this", which is exactly what an application says. Three
          // shapes are declarations: a published package, a workspace root,
          // and a private package that keeps its own source directory.
          let keep = true, name = "";
          if (e.name === "package.json") {
            try {
              const j = JSON.parse(readAll(join(abs, e.name)));
              name = typeof j.name === "string" ? j.name : "";
              keep = (Boolean(j.name) && !j.private)
                || (Boolean(j.private) && Boolean(j.workspaces))
                || (Boolean(j.private) && entries.some((x) => x.isDirectory() && APP_DIR.has(x.name)));
            } catch { keep = false; }
          }
          // `template-vanilla` is the spelling scaffolds actually use: vite
          // keeps sixteen of them, each privately named and each with its own
          // src/, and every rule that reads the file alone admits them. A
          // `templates?/` segment was already excluded, so the hyphenated form
          // adds the measured spelling rather than a new class — `templating`
          // still declares a module, because the separator is required. A
          // scaffold spelling enters this list when a real repository shows it,
          // never in anticipation; docs/research/findings.md carries the count.
          if (/(^|\/)(__tests__|fixtures?|playground|examples?|testdata|templates?|template[-_.][^/]*)\//.test(rel)) keep = false;
          if (keep) hits.push({ path: dirname(rel) === "." ? "" : dirname(rel), eco: hit.eco, file: e.name, name });
        }
      }
    }
  };
  walk(root, 0);

  // Two packages cannot carry one name — no registry would accept the
  // collision — so a name on more than one manifest is a copy of a scaffold
  // rather than a module, and every copy goes, including the first. This runs
  // after the rules above rather than inside them: whether a package.json
  // declares a module is a property of that file, and whether it is a copy is
  // a property of the set. The count and the name it shares are returned so
  // the reader learns what left, and why.
  const seen = new Map();
  for (const h of hits) if (h.name) seen.set(h.name, (seen.get(h.name) || 0) + 1);
  const shared = new Set([...seen].filter(([, n]) => n > 1).map(([n]) => n));
  const copies = (h) => Boolean(h.name) && shared.has(h.name);

  const modules = [];
  for (const h of hits) {
    if (copies(h)) continue;
    const prior = modules.find((x) => x.path === h.path);
    if (prior) prior.eco = [...new Set([...prior.eco.split("/"), h.eco])].join("/");
    else modules.push({ path: h.path, eco: h.eco, file: h.file });
  }
  return { modules, filtered: hits.filter(copies).map((h) => ({ path: h.path, name: h.name })) };
}

function readAll(abs) {
  const fd = openSync(abs, "r");
  try {
    let s = "", n;
    while ((n = readSync(fd, BUF, 0, BUF.length, null)) > 0) s += BUF.subarray(0, n).toString("utf8");
    return s;
  } finally { closeSync(fd); }
}

export { inventory, history, normalizeSince, CHARS_PER_TOKEN, CHARS_PER_TOKEN_PROSE, proseTokens, manifests, submodulePaths, byDirectory, testConvention, median, pct, day, num, tokens, git, tryGit, SOURCE_EXT, SKIP_DIR };
