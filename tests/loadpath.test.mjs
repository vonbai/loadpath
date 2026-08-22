// Acceptance tests. Each one builds the exact shape a behaviour is supposed to
// handle and asserts on the number that behaviour produces — never on text that
// also occurs in a header, which is how v0.1.0's suite let 14 of 20 one-line
// feature deletions pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Everything below goes through the command, because that is what a reader
// runs. These imports are for the cases the command cannot reach: the clamps
// put one out of range (see "no width of table fits the budget"), and one needs
// an array wider than any repository this suite is willing to build.
import { renderL1 } from "../skills/loadpath/scripts/report.mjs";
import { inventory, byDirectory, testConvention, maxOf } from "../skills/loadpath/scripts/scan.mjs";
import { MADGE } from "../skills/loadpath/scripts/deps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "skills", "loadpath", "scripts", "loadpath.mjs");

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@e.com",
  GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@e.com",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
};

function repo() {
  const d = mkdtempSync(join(tmpdir(), "lp-"));
  return {
    dir: d,
    file(p, body = "x\n") { const f = join(d, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); return f; },
    git(...a) { return execFileSync("git", ["-C", d, ...a], { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] }); },
    init(fmt) { this.git("init", "-q", "-b", "main", ...(fmt ? ["--object-format", fmt] : [])); return this; },
    commit(when, author) {
      this.git("add", "-A");
      execFileSync("git", ["-C", d, "-c", "commit.gpgsign=false", "commit", "-qm", "c"], {
        env: { ...ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when, ...(author ? { GIT_AUTHOR_NAME: author, GIT_COMMITTER_NAME: author } : {}) },
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
    run(...args) {
      return execFileSync("node", [CLI, d, ...args], { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    },
    clean() { rmSync(d, { recursive: true, force: true }); },
  };
}

const line = (out, needle) => out.split("\n").find((l) => l.includes(needle));
const hasGo = () => {
  try { execFileSync("go", ["version"], { stdio: "ignore" }); return true; } catch { return false; }
};
// madge arrives through npx, so its presence is a property of this machine's
// cache. A span it cannot measure is still a span; only the assertion changes.
let madgeSeen = null;
const hasMadge = () => {
  if (madgeSeen === null) {
    try { execFileSync("npx", ["--yes", "--offline", MADGE, "--version"], { stdio: "ignore", timeout: 120000 }); madgeSeen = true; }
    catch { madgeSeen = false; }
  }
  return madgeSeen;
};
const nums = (s) => (s || "").match(/-?\d[\d,]*/g)?.map((x) => Number(x.replace(/,/g, ""))) ?? [];
// `nums` counts the 90 inside "p90" and the 90 inside "90 days". Where a field
// has a label, read it by label.
const field = (s, label) => {
  const m = (s || "").match(new RegExp(`${label}\\s+(-?[\\d,]+)`));
  return m ? Number(m[1].replace(/,/g, "")) : NaN;
};

// Node's public seam is the CLI, but its analyzer normally arrives through an
// npx cache that a release runner intentionally starts without. Put a tiny,
// deterministic npx at the same process boundary so analyzer semantics are
// exercised on every machine instead of silently skipped with the cache.
function withMadge(script, run) {
  const bin = mkdtempSync(join(tmpdir(), "lp-madge-"));
  const npx = join(bin, "npx");
  try {
    writeFileSync(npx, `#!/usr/bin/env node\n${script}\n`);
    chmodSync(npx, 0o755);
    return run({ ...ENV, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` });
  } finally { rmSync(bin, { recursive: true, force: true }); }
}

// ── Inventory ────────────────────────────────────────────────────────────────

test("counts files and lines, and states the distribution", () => {
  const r = repo();
  try {
    for (let i = 0; i < 5; i++) r.file(`pkg/f${i}.go`, "x\n".repeat(10));
    r.file("pkg/big.go", "x\n".repeat(100));
    const out = r.run();
    assert.match(out, /^6 source files, 150 lines, 1 source-containing directory, max source-path depth 1$/m);
    assert.equal(field(line(out, "lines per file"), "median"), 10, "median must be the median, not the mean");
  } finally { r.clean(); }
});

test("directory totals name the source population and physical depth exactly", () => {
  const r = repo();
  try {
    r.file("src/ledger/posting.go", "x\n");
    r.file("docs/guide.md", "not in the source population\n");
    r.file("ops/release.sh", "not in the source population\n");
    const out = r.run("--structure");
    assert.match(out, /^1 source file, 1 line, 1 source-containing directory, max source-path depth 2$/m, out);
    assert.match(out, /structure {3}every source-containing directory, largest first/, out);
    assert.match(out, /source-containing directory/, out);
    assert.doesNotMatch(out, /^\s+.*(?:docs|ops)(?:\/|$)/m,
      `container-only and unsupported-file directories are outside this table's population:\n${out}`);
  } finally { r.clean(); }
});

test("generated and vendored files are excluded before anything else", () => {
  const r = repo();
  try {
    r.file("src/real.go", "x\n");
    r.file("src/api.pb.go", "x\n".repeat(500));
    r.file("src/marked.go", "// Code generated by tool. DO NOT EDIT.\nx\n");
    r.file("node_modules/dep/index.js", "x\n".repeat(999));
    r.file("vendor/lib/v.go", "x\n".repeat(999));
    const out = r.run();
    assert.match(out, /^1 source file,/m);
  } finally { r.clean(); }
});

test("a symlink is not counted as a second file", () => {
  const r = repo();
  try {
    r.file("a/one.go", "x\n".repeat(7));
    execFileSync("ln", ["-s", join(r.dir, "a", "one.go"), join(r.dir, "a", "alias.go")]);
    execFileSync("ln", ["-s", join(r.dir, "a"), join(r.dir, "b")]);
    const out = r.run();
    assert.match(out, /^1 source file, 7 lines/m, "neither the aliased file nor the aliased directory is a second file");
  } finally { r.clean(); }
});

test("the test convention is inferred by vote, not assumed", () => {
  const r = repo();
  try {
    for (let i = 0; i < 4; i++) { r.file(`p/a${i}.go`); r.file(`p/a${i}_test.go`); }
    assert.match(r.run(), /tests\s+4 files by \*_test\.\*/);
  } finally { r.clean(); }
});

test("Java- and C#-style test names are recognised, not counted as implementation", () => {
  const r = repo();
  try {
    for (const n of ["FooTest", "BarTest", "BazTests"]) r.file(`p/${n}.java`);
    r.file("p/Real.java");
    assert.match(r.run(), /tests\s+3 files/);
  } finally { r.clean(); }
});

// ── Size ranking ─────────────────────────────────────────────────────────────

test("ranks the largest source-containing directories first, and prints each against the median", () => {
  const r = repo();
  try {
    for (let d = 0; d < 5; d++) for (let i = 0; i < 2; i++) r.file(`small${d}/f${i}.go`);
    for (let i = 0; i < 20; i++) r.file(`wide/f${i}.go`);
    const out = r.run();
    const first = out.split("largest source-containing directories")[1].split("\n")[1];
    assert.ok(first.includes("wide"), `the largest must rank first, got: ${first}`);
    assert.ok(/10×\s*median/.test(first), `must print the ratio against the median, got: ${first}`);
  } finally { r.clean(); }
});

test("the ranking claims size, because size is what it sorts by", () => {
  const r = repo();
  try {
    for (let d = 0; d < 5; d++) for (let i = 0; i < 2; i++) r.file(`small${d}/f${i}.go`);
    for (let i = 0; i < 20; i++) r.file(`wide/f${i}.go`);
    const out = r.run();
    assert.ok(line(out, "largest source-containing directories"), `the section must name what it computes:\n${out}`);
    // files/median is monotone in files: dividing every row by one constant
    // cannot reorder them, so a heading promising the directories furthest
    // from this repository's norms promised a deviation nothing computed.
    assert.ok(!/furthest|deviation/i.test(out), `no line may claim a deviation ranking:\n${out}`);
    assert.ok(/10×\s*median/.test(line(out, "wide")), "and the ratio against the median stays");
  } finally { r.clean(); }
});

// ── History ──────────────────────────────────────────────────────────────────

test("a path git must quote-escape is still counted", () => {
  const r = repo(); r.init();
  try {
    r.file("ascii/plain.go"); r.file("unicode/结算.go");
    r.commit("2024-01-01T00:00:00");
    for (let i = 0; i < 5; i++) {
      r.file("ascii/plain.go", `v${i}\n`); r.file("unicode/结算.go", `v${i}\n`);
      r.commit(`2024-0${i + 2}-01T00:00:00`);
    }
    const out = r.run("--since", "20.years");
    assert.ok(!/co-change\s+not measured/.test(out), "history must be available");
    assert.equal(nums(line(out, "co-change   "))[1], 2, "median breadth must be 2, not 1");
    assert.ok(/unicode/.test(out), "the non-ASCII directory must appear");
  } finally { r.clean(); }
});

test("a SHA-256 repository is read, not reported as empty", () => {
  const r = repo();
  try {
    try { r.init("sha256"); } catch { return; }          // old git: nothing to test
    r.file("a/x.go"); r.file("b/y.go"); r.commit("2024-01-01T00:00:00");
    for (let i = 0; i < 4; i++) { r.file("a/x.go", `${i}\n`); r.file("b/y.go", `${i}\n`); r.commit(`2024-0${i + 2}-01T00:00:00`); }
    assert.ok(!/history\s+not measured/.test(r.run("--since", "20.years")), "64-char object ids must parse");
  } finally { r.clean(); }
});

test("a shallow clone refuses to report history rather than fabricating it", () => {
  const src = repo(); src.init();
  const dst = mkdtempSync(join(tmpdir(), "lp-shallow-"));
  try {
    for (let i = 0; i < 6; i++) { src.file(`d${i % 3}/f.go`, `${i}\n`); src.commit(`2024-0${i + 1}-01T00:00:00`); }
    execFileSync("git", ["clone", "-q", "--depth", "1", "file://" + src.dir, dst], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    const out = execFileSync("node", [CLI, dst, "--since", "20.years"], { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    assert.match(out, /history\s+not measured — shallow clone/);
  } finally { src.clean(); rmSync(dst, { recursive: true, force: true }); }
});

test("an unparseable --since is refused instead of silently emptying the window", () => {
  const r = repo(); r.init();
  try {
    r.file("a/x.go"); r.commit("2024-01-01T00:00:00");
    assert.match(r.run("--since", "banana"), /not a date git understands/);
  } finally { r.clean(); }
});

test("history counts directories that still exist, never more", () => {
  const r = repo(); r.init();
  try {
    r.file("gone/x.go"); r.file("stays/y.go"); r.commit("2024-01-01T00:00:00");
    rmSync(join(r.dir, "gone"), { recursive: true });
    r.file("stays/y.go", "2\n"); r.commit("2024-02-01T00:00:00");
    const l = line(r.run("--since", "20.years"), "activity");
    const total = Number(l.match(/of (\d+) source-containing director/)[1]);
    assert.equal(total, 1, "a deleted directory must not inflate the count");
  } finally { r.clean(); }
});

// ── Commit share ─────────────────────────────────────────────────────────────

test("commit share is the top author's fraction, beside the count", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 30; i++) r.file(`p/f${i}.go`);
    r.commit("2024-01-01T00:00:00", "Ann");
    for (let i = 0; i < 3; i++) { r.file("p/f0.go", `${i}\n`); r.commit(`2024-0${i + 2}-01T00:00:00`, "Ann"); }
    r.file("p/f0.go", "z\n"); r.commit("2024-06-01T00:00:00", "Bob");
    // One directory has no deviation from a median it defines, so the share
    // is read from the structure table rather than the outlier section.
    const row = r.run("--since", "20.years", "--structure").split("\n").find((l) => /%\/\d+a/.test(l));
    assert.ok(row, "the structure table must carry the share");
    const share = Number(row.match(/(\d+)%\//)[1]);
    assert.ok(share >= 75 && share < 85, `4 of 5 commits by one author is 80%, got ${share}%`);
    assert.ok(/\b5c\b/.test(row), "the raw count must stay beside the ratio");
  } finally { r.clean(); }
});

// ── Co-change ────────────────────────────────────────────────────────────────

test("one commit is one vote, split across the pairs it implies", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 8; i++) r.file(`w${i}/f.go`);
    r.commit("2020-01-01T00:00:00");
    for (let i = 0; i < 8; i++) { r.file(`w${i}/f.go`, "edit\n"); }
    r.commit("2020-02-01T00:00:00");
    for (let i = 0; i < 6; i++) { r.file("a/f.go", `${i}\n`); r.file("b/f.go", `${i}\n`); r.commit(`2021-0${i + 1}-01T00:00:00`); }
    const out = r.run("--since", "20.years");
    const rows = out.split("\n").filter((l) => / \+ /.test(l) && /%/.test(l));
    assert.ok(rows.length, "pairs must be reported");
    assert.ok(/\ba \+ b\b/.test(rows[0]), `the repeated narrow pair must outrank a wide sweep, got: ${rows[0]}`);
  } finally { r.clean(); }
});

test("commits wider than the cap are excluded and the count is disclosed", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 12; i++) r.file(`d${i}/f.go`);
    r.commit("2020-01-01T00:00:00");
    for (let i = 0; i < 12; i++) r.file(`d${i}/f.go`, "e\n");
    r.commit("2020-02-01T00:00:00");
    const out = r.run("--since", "20.years", "--cap", "4");
    assert.match(out, /2 commits touched more than the breadth cap/);
  } finally { r.clean(); }
});

test("each pair carries its per-window profile and its min and max", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 6; i++) { r.file("a/f.go", `${i}\n`); r.file("b/f.go", `${i}\n`); r.commit(`2020-0${i + 1}-01T00:00:00`); }
    const out = r.run("--since", "20.years", "--windows", "4");
    const row = line(out, " + ");
    const prof = row.match(/\[([^\]]*)\]/);
    assert.ok(prof && /\d/.test(prof[1]), "the window profile must carry numbers");
    assert.equal(prof[1].trim().split(/\s+/).length, 4, "the spread is the windows themselves");
    // A ratio with no denominator on the page is not interpretable.
    assert.ok(/of \d+c/.test(row), `the share needs its denominator: ${row}`);
    assert.match(out, /4 equal time windows/);
    assert.match(out, /"share" is/, "the unit must be stated once");
  } finally { r.clean(); }
});

test("no verdict word is ever emitted", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 30; i++) r.file(`p/f${i}.go`, "x\n".repeat(900));
    r.commit("2024-01-01T00:00:00");
    for (let i = 0; i < 6; i++) { r.file("a/f.go", `${i}\n`); r.file("b/f.go", `${i}\n`); r.commit(`2024-0${i + 2}-01T00:00:00`); }
    const out = r.run("--since", "20.years");
    for (const w of ["god file", "rising", "at-creation", "fading", "violation", "smell", "problem", "should be split"]) {
      assert.ok(!out.toLowerCase().includes(w), `verdict word leaked: ${w}`);
    }
  } finally { r.clean(); }
});

// ── One population ───────────────────────────────────────────────────────────
//
// The filesystem walk and the git log must admit the same paths, or the two
// halves of the page describe different repositories. On the pinned
// dependency-cruiser corpus the two strongest co-change rows named four
// directories, none of which was on disk.

test("a file absent from the current inventory casts no history vote", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 5; i++) { r.file("a/f.go", `${i}\n`); r.file("b/f.go", `${i}\n`); r.commit(`2024-0${i + 1}-01T00:00:00`); }
    rmSync(join(r.dir, "a"), { recursive: true });
    r.commit("2024-07-01T00:00:00");
    const out = r.run("--since", "20.years");
    assert.ok(!/a \+ b/.test(out), `a lead must name a directory the reader can open:\n${out}`);
    assert.match(line(out, "history     ") ?? "", /^history\s+5 commits touching source/, out);
  } finally { r.clean(); }
});

test("vendored, generated and dot-directory paths cast no co-change vote", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 5; i++) {
      r.file("src/a/f.go", `${i}\n`); r.file("src/b/f.go", `${i}\n`);
      r.file("vendor/lib/v.go", `${i}\n`);      // skipped directory
      r.file("src/api.pb.go", `${i}\n`);        // generated path
      r.file(".cache/c.go", `${i}\n`);          // dot-directory
      r.commit(`2024-0${i + 1}-01T00:00:00`);
    }
    const out = r.run("--since", "20.years");
    assert.equal(nums(line(out, "co-change   "))[1], 2, `only admitted paths set a commit's breadth:\n${out}`);
    const row = line(out, " + ");
    const share = Number(row.match(/(\d+)%/)[1]);
    // Three refused paths would split each commit's one vote five ways instead
    // of keeping it whole, which drops this pair below the reporting floor.
    assert.ok(share >= 80, `a refused path must not dilute the vote, got ${share}%: ${row}`);
    for (const refused of ["vendor", "api.pb.go", ".cache"]) {
      assert.ok(!out.includes(refused), `${refused} is not this repository's code, and may not appear as its subject`);
    }
  } finally { r.clean(); }
});

test("history counts only files admitted by the current inventory", () => {
  const r = repo(); r.init();
  try {
    r.file("p/a.go", "package p\n");
    r.commit("2024-01-01T00:00:00");
    // The marker is content-derived, so git's path alone cannot recognise it.
    r.file("p/generated.go", "// Code generated by tool. DO NOT EDIT.\npackage p\n");
    r.commit("2024-02-01T00:00:00");
    const h = line(r.run("--since", "20.years"), "history     ");
    assert.match(h, /^history\s+1 commit touching source since/, h);
  } finally { r.clean(); }
});

test("a submodule's paths cast no co-change vote", () => {
  const r = repo(); r.init();
  try {
    r.file(".gitmodules", '[submodule "vendorlib"]\n\tpath = libs/vendorlib\n\turl = https://example.com/x.git\n');
    for (let i = 0; i < 5; i++) {
      r.file("src/a/f.go", `${i}\n`); r.file("src/b/f.go", `${i}\n`);
      r.file("libs/vendorlib/v.go", `${i}\n`);
      r.commit(`2024-0${i + 1}-01T00:00:00`);
    }
    const out = r.run("--since", "20.years");
    // Another repository's code borrowed into this tree is not this tree's
    // weight, and it is not this tree's coupling either.
    assert.equal(nums(line(out, "co-change   "))[1], 2, `the submodule is not in this commit's breadth:\n${out}`);
    assert.ok(!/vendorlib/.test(out), "no submodule path may appear as a subject of this repository");
  } finally { r.clean(); }
});

test("the repository root is spelled the same in a co-change row as everywhere else", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 5; i++) { r.file("main.go", `${i}\n`); r.file("pkg/f.go", `${i}\n`); r.commit(`2024-0${i + 1}-01T00:00:00`); }
    // The ranking and the structure table both print "." for the root. A bare
    // leading space is not a directory a reader can open.
    const row = line(r.run("--since", "20.years"), " + ");
    assert.match(row, /\. \+ pkg/, `the root must carry its name: ${row}`);
  } finally { r.clean(); }
});

test("a move out of a refused path into the tree is still a relocation", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 5; i++) r.file(`vendor/lib/f${i}.go`, `body ${i}\n`.repeat(20));
    r.commit("2024-01-01T00:00:00");
    r.git("mv", "vendor", "src");
    r.commit("2024-02-01T00:00:00");
    // Neither side is judged: a relocation is a record of what moved, and a
    // repository is free to move code out of a directory this tool refuses.
    assert.match(r.run("--since", "20.years"), /vendor → src/);
  } finally { r.clean(); }
});

test("a docs edit does not lift a bulk creation out of the damping", () => {
  const plain = repo(); plain.init();
  const withDocs = repo(); withDocs.init();
  try {
    // The same five bulk-creation commits in both repositories; in one of them
    // each commit also edits a README. `edits` counted every path in a commit,
    // so that one edit read as maintenance and paid the full vote.
    for (const [r, docs] of [[plain, false], [withDocs, true]]) {
      for (let c = 0; c < 5; c++) {
        for (let i = 0; i < 25; i++) { r.file(`a/f${c}_${i}.go`, "x\n"); r.file(`b/f${c}_${i}.go`, "x\n"); }
        if (docs) r.file("README.md", `${c}\n`);
        r.commit(`2020-0${c + 1}-01T00:00:00`);
      }
    }
    const share = (r) => Number(line(r.run("--since", "20.years"), "a + b").match(/(\d+)%/)[1]);
    const bare = share(plain);
    assert.equal(share(withDocs), bare, "the README edit must change nothing about the pair");
    assert.ok(bare < 20, `five commits that only create files stay damped, got ${bare}%`);
  } finally { plain.clean(); withDocs.clean(); }
});

test("the history count names the population it counted", () => {
  const r = repo(); r.init();
  try {
    r.file("p/a.go", "1\n"); r.commit("2024-01-01T00:00:00");
    r.file("p/a.go", "2\n"); r.commit("2024-02-01T00:00:00");
    r.file("README.md", "docs\n"); r.commit("2024-03-01T00:00:00");
    // A documentation-only commit is not in this figure. A bare "N commits"
    // invites the reader to reconcile it with the number git would give them.
    assert.match(line(r.run("--since", "20.years"), "history     "), /^history\s+2 commits touching source since/);
  } finally { r.clean(); }
});

test("the activity horizon is the window when the window is shorter than the convention", () => {
  const r = repo(); r.init();
  try {
    // Dated against now, because --since is: a fixed calendar date cannot be
    // inside a thirty-day window on the day this suite is run.
    const ago = (n) => new Date(Date.now() - n * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
    r.file("old/x.go", "1\n"); r.commit(ago(400));
    for (const [i, d] of [20, 10, 2].entries()) { r.file("new/y.go", `${i}\n`); r.commit(ago(d)); }
    const long = line(r.run("--since", "20.years"), "activity");
    assert.equal(Number(long.match(/last (\d+) days/)[1]), 90, `over a long window the horizon is the convention: ${long}`);

    const short = r.run("--since", "30.days");
    const days = Number(line(short, "activity").match(/last (\d+) days/)[1]);
    const span = Number(line(short, "history     ").match(/spanning (\d+) days/)[1]);
    // The sentence said "the last 90 days" whatever was measured, so a
    // thirty-day window claimed sixty days it had never seen.
    assert.ok(days <= span, `the horizon must not exceed the window measured: ${days} > ${span}`);
    assert.ok(days <= 30, `nor the window asked for: ${days} > 30`);
  } finally { r.clean(); }
});

// ── Relocations ──────────────────────────────────────────────────────────────

test("a directory rename is reported as a relocation", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 5; i++) r.file(`old/f${i}.go`, `body ${i}\n`.repeat(20));
    r.commit("2024-01-01T00:00:00");
    r.git("mv", "old", "new");
    r.commit("2024-02-01T00:00:00");
    const out = r.run("--since", "20.years");
    assert.match(out, /relocations/);
    assert.ok(/old → new/.test(out), "the move must name both sides");
  } finally { r.clean(); }
});

test("a documentation move is still a relocation, and the section says it counts every file type", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 5; i++) r.file(`specs/s${i}.md`, `spec ${i}\n`.repeat(20));
    r.file("src/keep.go", "x\n");
    r.commit("2024-01-01T00:00:00");
    r.git("mv", "specs", "archive");
    r.commit("2024-02-01T00:00:00");
    const out = r.run("--since", "20.years");
    // A record, not a lead. The migration a repository has already done is the
    // best evidence of the one it is mid-way through, and filtering this table
    // to the source population deleted exactly that evidence.
    assert.ok(/specs → archive/.test(out), `a documentation move is history, not noise:\n${out}`);
    assert.match(line(out, "relocations"), /every file type, not only source/,
      "a file count that is wider here than everywhere else on the page must say so");
  } finally { r.clean(); }
});

test("a rename inside one directory is not a relocation", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 5; i++) r.file(`p/f${i}.go`, `body ${i}\n`.repeat(20));
    r.commit("2024-01-01T00:00:00");
    for (let i = 0; i < 5; i++) r.git("mv", `p/f${i}.go`, `p/g${i}.go`);
    r.commit("2024-02-01T00:00:00");
    assert.ok(!/→/.test(r.run("--since", "20.years")), "no directory moved");
  } finally { r.clean(); }
});

// ── Dependencies: the quarantine ─────────────────────────────────────────────

test("with no applicable analyzer, dependencies are not measured — never zero", () => {
  const r = repo();
  try {
    r.file("a/x.rb", "require 'b'\n"); r.file("b/y.rb", "require 'a'\n");
    const l = line(r.run(), "dependencies");
    assert.match(l, /not measured/);
    assert.ok(!/0 edges/.test(l), "an unmeasured graph must never render as an empty one");
  } finally { r.clean(); }
});

test("Go edges come from go list and the component count matches", () => {
  const r = repo();
  try {
    try { execFileSync("go", ["version"], { stdio: "ignore" }); } catch { return; }
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", 'package alpha\n\nimport _ "example.com/m/beta"\n');
    r.file("beta/b.go", "package beta\n");
    const l = line(r.run(), "dependencies");
    assert.match(l, /go list/);
    assert.ok(/\b1 edges?\b/.test(l), `expected one edge, got: ${l}`);
    assert.match(r.run(), /no mutually entangled group/);
  } finally { r.clean(); }
});

test("a module-name prefix is not an internal Go import", { skip: !hasGo() }, () => {
  const r = repo();
  try {
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", 'package alpha\n\nimport _ "example.com/more/pkg"\n');
    const l = line(r.run(), "dependencies");
    assert.match(l, /not measured/, `example.com/more is outside example.com/m: ${l}`);
    assert.doesNotMatch(l, /1 edge over 2 packages/, `a lexical prefix is not a module path boundary: ${l}`);
  } finally { r.clean(); }
});

test("a real Go cycle is impossible, and a .csproj cycle is found", () => {
  const r = repo();
  try {
    r.file("A/A.csproj", '<Project><ItemGroup><ProjectReference Include="../B/B.csproj" /></ItemGroup></Project>');
    r.file("A/a.cs", "class A {}");
    r.file("B/B.csproj", '<Project><ItemGroup><ProjectReference Include="../A/A.csproj" /></ItemGroup></Project>');
    r.file("B/b.cs", "class B {}");
    const out = r.run("--structure");
    assert.match(out, /ProjectReference/);
    assert.match(out, /1 mutually entangled group/);
    assert.match(out, /entangled: 2 projects/);
  } finally { r.clean(); }
});

test("ProjectReference reads XML quoting and attribute order without reading comments", () => {
  const r = repo();
  try {
    r.file("A/A.csproj", '<Project><ItemGroup><ProjectReference Include="../B/B.csproj" /></ItemGroup></Project>');
    r.file("A/a.cs", "class A {}");
    r.file("B/B.csproj", "<Project><ItemGroup><ProjectReference Condition=\"'x' == 'x'\" Include='../C/C.csproj' /></ItemGroup></Project>");
    r.file("B/b.cs", "class B {}");
    r.file("C/C.csproj", '<Project><!-- <ProjectReference Include="../A/A.csproj" /> --></Project>');
    r.file("C/c.cs", "class C {}");
    const out = r.run("--dir", "C");
    const load = line(out, "load on this subtree");
    assert.match(load, /fan-in 1 from outside \(top: B 1\)/, `the single-quoted B → C reference must be read: ${load}`);
    assert.doesNotMatch(out, /fan-out 1/, `the commented C → A reference must stay inert:\n${out}`);
  } finally { r.clean(); }
});

// ── Scope and budget ─────────────────────────────────────────────────────────

test("scanning a subdirectory keeps every path repository-relative", () => {
  const r = repo(); r.init();
  try {
    r.file("sub/a/x.go"); r.file("other/b/y.go");
    r.commit("2024-01-01T00:00:00");
    const out = execFileSync("node", [CLI, join(r.dir, "sub"), "--since", "20.years"], { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    assert.match(out, /paths are repository-relative/);
    // The leak the scope note promised not to have: history and dependencies
    // must be scoped too, or the reader is shown directories the tool said it
    // was not scanning.
    assert.ok(!/other\/b/.test(out), `a directory outside the scope leaked in:\n${out}`);
    assert.match(out, /^1 source file,/m, "only the scoped subtree is counted");
    const h = line(out, "history     ");
    assert.ok(/\b1 commit\b/.test(h), `history must be scoped too, got: ${h}`);
  } finally { r.clean(); }
});

test("the structure table honours its budget", () => {
  const r = repo();
  try {
    for (let d = 0; d < 200; d++) r.file(`d${d}/f.go`, "x\n".repeat(d + 1));
    const small = r.run("--structure", "--budget", "300");
    const large = r.run("--structure", "--budget", "3000");
    assert.ok(small.length < large.length, "a smaller budget must produce less");
    assert.match(small, /source-containing directories not shown/);
  } finally { r.clean(); }
});

test("no width of table fits the budget, and the smallest one is drawn anyway", () => {
  const r = repo();
  try {
    for (let i = 0; i < 40; i++) r.file(`d${i}/f.go`, "x\n".repeat(i + 1));
    const files = inventory(r.dir);
    const dirs = byDirectory(files, testConvention(files).isTest);
    // Called directly, because --budget clamps at 200 and 200 fits a row. The
    // binary search draws its seed before the first comparison and keeps it
    // when nothing fits, so a seed of twenty rows answered a budget of five
    // with twenty rows — the clamp hid it rather than preventing it.
    const table = renderL1({ dirs, hist: { available: false }, spans: [], budget: 5 });
    const rows = table.split("\n").filter((l) => /^\s+\d+f\b/.test(l));
    assert.equal(rows.length, 1, `the smallest table there is, got ${rows.length} rows:\n${table}`);
    assert.match(table, /\+39 source-containing directories not shown/, "and it still says what it did not show");
  } finally { r.clean(); }
});

test("--dir gives one subtree file by file", () => {
  const r = repo();
  try {
    r.file("keep/a.go", "x\n".repeat(30)); r.file("keep/b.go", "x\n");
    r.file("elsewhere/c.go", "x\n");
    const out = r.run("--dir", "keep");
    assert.ok(/keep\/a\.go/.test(out) && /keep\/b\.go/.test(out));
    assert.ok(!/elsewhere/.test(out), "only the named subtree");
  } finally { r.clean(); }
});

// ── Robustness ───────────────────────────────────────────────────────────────

test("an empty directory says so rather than failing", () => {
  const r = repo();
  try { assert.match(r.run(), /no source files found/); } finally { r.clean(); }
});

test("a repository with no git history still reports the filesystem facts", () => {
  const r = repo();
  try {
    r.file("p/a.go", "x\n");
    const out = r.run();
    assert.match(out, /^1 source file,/m);
    assert.match(out, /history\s+not measured/);
  } finally { r.clean(); }
});

test("binary and unreadable files do not crash the scan", () => {
  const r = repo();
  try {
    writeFileSync(join(r.dir, "blob.go"), Buffer.from([0, 1, 2, 3, 0, 255, 10]));
    r.file("p/ok.go", "x\n");
    assert.match(r.run(), /source file/);
  } finally { r.clean(); }
});

test("the repository is never modified by a scan", () => {
  const r = repo(); r.init();
  try {
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("p/a.go", "package p\n");
    r.commit("2024-01-01T00:00:00");
    const before = r.git("status", "--porcelain") + r.git("rev-parse", "HEAD");
    r.run("--since", "20.years", "--structure");
    assert.equal(r.git("status", "--porcelain") + r.git("rev-parse", "HEAD"), before);
  } finally { r.clean(); }
});

test("weight spreads across the windows it was given", () => {
  const r = repo(); r.init();
  try {
    // Two bursts far apart. Collapsing the windows would put everything in one.
    for (let i = 0; i < 3; i++) { r.file("a/f.go", `${i}\n`); r.file("b/f.go", `${i}\n`); r.commit(`2020-0${i + 1}-01T00:00:00`); }
    for (let i = 0; i < 3; i++) { r.file("a/f.go", `l${i}\n`); r.file("b/f.go", `l${i}\n`); r.commit(`2024-0${i + 1}-01T00:00:00`); }
    const row = line(r.run("--since", "20.years", "--windows", "4"), " + ");
    const cells = row.match(/\[([^\]]*)\]/)[1].trim().split(/\s+/).map(Number);
    assert.equal(cells.length, 4);
    assert.ok(cells.filter((c) => c > 0).length >= 2, `weight must land in more than one window, got ${cells}`);
  } finally { r.clean(); }
});

test("a commit that only adds files weighs less than one that edits", () => {
  const bulk = repo(); bulk.init();
  const edit = repo(); edit.init();
  try {
    // Same pair, same number of commits. In one repo every commit only adds
    // files, which is creation rather than coupling; in the other they edit.
    for (let i = 0; i < 5; i++) {
      bulk.file(`a/f${i}.go`, "x\n"); bulk.file(`b/f${i}.go`, "x\n");
      bulk.commit(`2020-0${i + 1}-01T00:00:00`);
    }
    edit.file("a/f.go", "x\n"); edit.file("b/f.go", "x\n");
    edit.commit("2020-01-01T00:00:00");
    for (let i = 0; i < 4; i++) {
      edit.file("a/f.go", `${i}\n`); edit.file("b/f.go", `${i}\n`);
      edit.commit(`2020-0${i + 2}-01T00:00:00`);
    }
    const share = (r) => {
      const l = line(r.run("--since", "20.years"), "a + b");
      return l ? Number(l.match(/(\d+)%/)[1]) : 0;
    };
    const e = share(edit), b = share(bulk);
    assert.ok(e > b + 20, `an edit must weigh clearly more than a bulk creation, got edit ${e}% vs bulk ${b}%`);
  } finally { bulk.clean(); edit.clean(); }
});

test("the major-author count applies its stated share threshold", () => {
  const r = repo(); r.init();
  try {
    r.file("p/f.go"); r.commit("2024-01-01T00:00:00", "Ann");
    // Ann 18, Bob 2: Bob clears 5% of 20, so two authors are major.
    for (let i = 0; i < 17; i++) { r.file("p/f.go", `a${i}\n`); r.commit("2024-02-01T00:00:00", "Ann"); }
    for (let i = 0; i < 2; i++) { r.file("p/f.go", `b${i}\n`); r.commit("2024-03-01T00:00:00", "Bob"); }
    const row = r.run("--since", "20.years", "--structure").split("\n").find((l) => /%\/\d+a/.test(l) && / p$/.test(l));
    assert.ok(/\d+%\/2a/.test(row), `two authors clear 5%, got: ${row}`);

    const s2 = repo(); s2.init();
    try {
      s2.file("p/f.go"); s2.commit("2024-01-01T00:00:00", "Ann");
      // Ann 39, Bob 1: Bob is 2.5%, below the threshold, so only one is major.
      for (let i = 0; i < 38; i++) { s2.file("p/f.go", `a${i}\n`); s2.commit("2024-02-01T00:00:00", "Ann"); }
      s2.file("p/f.go", "b\n"); s2.commit("2024-03-01T00:00:00", "Bob");
      const row2 = s2.run("--since", "20.years", "--structure").split("\n").find((l) => /%\/\d+a/.test(l) && / p$/.test(l));
      assert.ok(/\d+%\/1a/.test(row2), `only one author clears 5%, got: ${row2}`);
    } finally { s2.clean(); }
  } finally { r.clean(); }
});

test("an analyzer that resolves no edges reports not measured, not zero", () => {
  const r = repo();
  try {
    try { execFileSync("go", ["version"], { stdio: "ignore" }); } catch { return; }
    // Two real Go packages that do not import each other.
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", "package alpha\n");
    r.file("beta/b.go", "package beta\n");
    const l = line(r.run(), "dependencies");
    assert.match(l, /not measured/);
    assert.ok(!/\b0 edges\b/.test(l), "no edges resolved is not the same as no dependencies");
  } finally { r.clean(); }
});

test("a single rename is not yet a relocation", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 5; i++) r.file(`old/f${i}.go`, `body ${i}\n`.repeat(20));
    r.file("solo/one.go", "solo\n".repeat(20));
    r.commit("2024-01-01T00:00:00");
    r.git("mv", "solo/one.go", "elsewhere.go");     // one file: not a pattern
    r.commit("2024-02-01T00:00:00");
    const out = r.run("--since", "20.years");
    assert.ok(!/solo →/.test(out), `one moved file is not a relocation:\n${out}`);
  } finally { r.clean(); }
});

test("the active and dormant counts add up to the directories that exist", () => {
  const r = repo(); r.init();
  try {
    r.file("gone1/x.go"); r.file("gone2/x.go"); r.file("stays/y.go");
    r.commit("2024-01-01T00:00:00");
    rmSync(join(r.dir, "gone1"), { recursive: true });
    rmSync(join(r.dir, "gone2"), { recursive: true });
    r.file("stays/y.go", "2\n");
    r.commit("2024-02-01T00:00:00");
    const l = line(r.run("--since", "20.years"), "activity");
    const m = l.match(/(\d+) touched in the last \d+ days?, (\d+) not, (\d+) with no commit[^—]*— of (\d+) source-containing director/);
    assert.ok(m, `unexpected activity line: ${l}`);
    const [active, dormant, unseen, total] = m.slice(1, 5).map(Number);
    assert.equal(total, 1, "only one directory still exists");
    // Every directory must land in exactly one bucket, or the reader is shown
    // a count that quietly omits part of the tree.
    assert.equal(active + dormant + unseen, total,
      `${active} + ${dormant} + ${unseen} must equal ${total}`);
  } finally { r.clean(); }
});

test("a repository reached through a symlinked path is still scanned", () => {
  // Not an OS quirk: build the symlink explicitly, so the case is exercised
  // wherever the suite runs rather than only where /tmp happens to be one.
  const r = repo(); r.init();
  const link = join(tmpdir(), `lp-link-${process.pid}-${Date.now()}`);
  try {
    r.file("p/a.go", "x\n"); r.commit("2024-01-01T00:00:00");
    execFileSync("ln", ["-s", r.dir, link]);
    const out = execFileSync("node", [CLI, link, "--since", "20.years"], { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    assert.match(out, /^1 source file,/m, "a symlinked path must resolve to the same repository, not to a subdirectory of it");
    assert.ok(!/paths are repository-relative/.test(out), "the repository root reached by a symlink is still the root");
  } finally { rmSync(link, { force: true }); r.clean(); }
});

test("a graph covering a sliver of the tree is not measured", () => {
  const r = repo();
  try {
    // Three trivial C# projects among sixty directories: an analyzer runs and
    // resolves a real graph, but it covers too little to read as the tree's.
    for (let i = 0; i < 60; i++) r.file(`spread/d${i}/f${i}.cs`, "class X {}");
    for (const n of ["A", "B", "C"]) {
      r.file(`${n}/${n}.csproj`, '<Project><ItemGroup><ProjectReference Include="../A/A.csproj" /></ItemGroup></Project>');
      r.file(`${n}/${n.toLowerCase()}.cs`, `class ${n} {}`);
    }
    const l = line(r.run(), "dependencies");
    assert.match(l, /not measured/, `a sliver graph must not read as measured: ${l}`);
    assert.ok(/%\)/.test(l), "the coverage it did reach must be stated");
  } finally { r.clean(); }
});

test("an acyclic result is scoped to what the analyzer saw, not to the tree", () => {
  const r = repo();
  try {
    try { execFileSync("go", ["version"], { stdio: "ignore" }); } catch { return; }
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", 'package alpha\n\nimport _ "example.com/m/beta"\n');
    r.file("beta/b.go", "package beta\n");
    const out = r.run("--structure");
    assert.ok(!/graph is acyclic/.test(out), "a clean verdict must not come from the inexact module");
    assert.match(out, /no mutually entangled group/, "say what was searched, not what is true");
    // What was searched sits on the line above it, which is why the detail no
    // longer repeats the same fact in other words two lines later.
    assert.match(line(out, "dependencies"), /over 2 packages, via go list/, out);
    assert.equal(out.match(/mutually entangled group/g).length, 1,
      `one fact, said once: a second wording invites a difference that is not there:\n${out}`);
  } finally { r.clean(); }
});

test("history unavailable renders as a mark, never as a blank under a count header", () => {
  const r = repo();
  try {
    for (let i = 0; i < 4; i++) r.file(`p${i}/a.go`, "x\n");
    const out = r.run("--structure");
    assert.match(out, /history not measured/, "the header must say the column is unmeasured");
    const row = out.split("\n").find((l) => /\bp0$/.test(l));
    assert.ok(row && /\?/.test(row), `a cell must carry a mark, not a blank: ${row}`);
  } finally { r.clean(); }
});

test("a flat distribution says so instead of presenting insertion order as outliers", () => {
  const r = repo();
  try {
    for (let i = 0; i < 20; i++) r.file(`d${i}/f.go`, "x\n");
    const out = r.run();
    assert.match(out, /the distribution is flat/);
    assert.ok(!/largest source-containing directories/.test(out), "nothing is largest when everything is equal");
  } finally { r.clean(); }
});

test("a module in a subdirectory is measured, wherever .git sits", () => {
  const r = repo(); r.init();
  try {
    try { execFileSync("go", ["version"], { stdio: "ignore" }); } catch { return; }
    r.file("svc/go.mod", "module example.com/svc\n\ngo 1.21\n");
    r.file("svc/alpha/a.go", 'package alpha\n\nimport _ "example.com/svc/beta"\n');
    r.file("svc/beta/b.go", "package beta\n");
    r.commit("2024-01-01T00:00:00");
    const l = line(r.run("--since", "20.years"), "dependencies");
    assert.match(l, /go list/, `a nested module must still be analysed: ${l}`);
  } finally { r.clean(); }
});

test("an unreadable file does not enter the inventory as zero lines", () => {
  const r = repo();
  try {
    r.file("p/good.go", "x\n".repeat(10));
    const bad = r.file("p/bad.go", "x\n".repeat(10));
    execFileSync("chmod", ["000", bad]);
    const out = r.run();
    assert.match(out, /^1 source file,/m, "the unreadable file leaves the inventory");
    assert.equal(field(line(out, "lines per file"), "median"), 10, "it must not drag the median to zero");
    execFileSync("chmod", ["644", bad]);
  } finally { r.clean(); }
});

// ── Guards for deletions an independent reviewer found unprotected ───────────

test("p90 is a percentile, not the maximum", () => {
  const r = repo();
  try {
    for (let i = 0; i < 30; i++) r.file(`p/f${i}.go`, "x\n".repeat(10));
    r.file("p/huge.go", "x\n".repeat(1000));
    const l = line(r.run(), "lines per file");
    assert.equal(field(l, "max"), 1000);
    assert.ok(field(l, "p90") < field(l, "max"), `p90 must sit below the max: ${l}`);
    assert.equal(field(l, "median"), 10);
  } finally { r.clean(); }
});

test("merge commits are not counted as work", () => {
  const r = repo(); r.init();
  try {
    r.file("a/f.go", "1\n"); r.commit("2024-01-01T00:00:00");
    r.git("checkout", "-q", "-b", "side");
    r.file("b/g.go", "1\n"); r.commit("2024-02-01T00:00:00");
    r.git("checkout", "-q", "main");
    r.file("a/f.go", "2\n"); r.commit("2024-03-01T00:00:00");
    execFileSync("git", ["-C", r.dir, "-c", "user.name=A", "-c", "user.email=a@e.com",
      "-c", "commit.gpgsign=false", "merge", "--no-ff", "-q", "-m", "m", "side"],
      { env: { ...ENV, GIT_AUTHOR_DATE: "2024-04-01T00:00:00", GIT_COMMITTER_DATE: "2024-04-01T00:00:00" }, stdio: ["ignore", "pipe", "pipe"] });
    const n = nums(line(r.run("--since", "20.years"), "history     "))[0];
    assert.equal(n, 3, `three commits did work; the merge did not (got ${n})`);
  } finally { r.clean(); }
});

test("a pair below the reporting floor is not printed", () => {
  const r = repo(); r.init();
  try {
    // Two directories touched together exactly twice: below the floor.
    for (let i = 0; i < 2; i++) { r.file("a/f.go", `${i}\n`); r.file("b/f.go", `${i}\n`); r.commit(`2024-0${i + 1}-01T00:00:00`); }
    for (let i = 0; i < 6; i++) { r.file("z/f.go", `${i}\n`); r.commit(`2024-0${i + 3}-01T00:00:00`); }
    assert.ok(!/a \+ b/.test(r.run("--since", "20.years")), "a pair with too little support is not evidence");
  } finally { r.clean(); }
});

test("the window is bucketed by the date --since filters on", () => {
  const r = repo(); r.init();
  try {
    // A commit authored long ago but committed now — a rebase or a cherry-pick.
    // Bucketing by author date would stretch the span to years and drop every
    // pair into the final window.
    r.file("a/f.go", "1\n"); r.file("b/f.go", "1\n");
    r.git("add", "-A");
    execFileSync("git", ["-C", r.dir, "-c", "commit.gpgsign=false", "commit", "-qm", "old"], {
      env: { ...ENV, GIT_AUTHOR_DATE: "2016-01-01T00:00:00", GIT_COMMITTER_DATE: "2024-01-01T00:00:00" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (let i = 0; i < 4; i++) { r.file("a/f.go", `${i}\n`); r.file("b/f.go", `${i}\n`); r.commit(`2024-0${i + 2}-01T00:00:00`); }
    const days = nums(line(r.run("--since", "20.years"), "history     ")).pop();
    assert.ok(days < 400, `the span must follow the committer date, got ${days} days`);
  } finally { r.clean(); }
});

test("the resolved cutoff is printed beside the word the user typed", () => {
  const r = repo(); r.init();
  try {
    r.file("a/f.go"); r.commit("2024-01-01T00:00:00");
    const l = line(r.run("--since", "20.years"), "history     ");
    assert.match(l, /since \d{4}-\d{2}-\d{2} \(--since 20\.years\)/,
      `git accepts words it resolves to something else; the date it chose must be checkable: ${l}`);
  } finally { r.clean(); }
});

test("--dir accepts a trailing slash", () => {
  const r = repo();
  try {
    r.file("keep/a.go", "x\n".repeat(5));
    assert.match(r.run("--dir", "keep/"), /keep\/a\.go/);
  } finally { r.clean(); }
});

test("L2 lists the largest file first", () => {
  const r = repo();
  try {
    // Named so alphabetical order is the reverse of size order: a fixture where
    // the two coincide cannot tell a sort from a walk.
    r.file("p/a-big.go", "x\n".repeat(50)); r.file("p/m-small.go", "x\n"); r.file("p/z-mid.go", "x\n".repeat(10));
    const rows = r.run("--dir", "p").split("\n").filter((l) => /^\s+\d+L/.test(l));
    const order = rows.map((l) => l.trim().split(/\s+/).pop());
    assert.deepEqual(order, ["p/a-big.go", "p/z-mid.go", "p/m-small.go"], `largest first, got: ${order.join(" ")}`);
  } finally { r.clean(); }
});

test("a pair confined to one window says so", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 5; i++) { r.file("a/f.go", `${i}\n`); r.file("b/f.go", `${i}\n`); r.commit(`2020-0${i + 1}-01T00:00:00`); }
    for (let i = 0; i < 5; i++) { r.file("z/f.go", `${i}\n`); r.commit(`2024-0${i + 1}-01T00:00:00`); }
    const row = line(r.run("--since", "20.years"), "a + b");
    assert.match(row, /in one window/, `a burst confined to one window is not a trend: ${row}`);
  } finally { r.clean(); }
});

test("the manifest search descends past the repository root", () => {
  const r = repo();
  try {
    r.file("services/api/package.json", '{"name":"api","version":"1.0.0"}');
    r.file("services/api/src/index.js", "export const x = 1;\n");
    assert.match(r.run(), /Node\s+services\/api/, "a manifest below the root must be found");
  } finally { r.clean(); }
});

test("history stays inside the scope it was given", () => {
  const r = repo(); r.init();
  try {
    // `outside`, not `out`: `out` is a skipped directory, so the population
    // rule would refuse those paths before the scope rule ever saw them, and
    // the test would pass with the scope dropped entirely.
    r.file("sub/a/x.go"); r.file("outside/b/y.go"); r.commit("2024-01-01T00:00:00");
    for (let i = 0; i < 5; i++) { r.file("outside/b/y.go", `${i}\n`); r.file("outside/c/z.go", `${i}\n`); r.commit(`2024-0${i + 2}-01T00:00:00`); }
    const out = execFileSync("node", [CLI, join(r.dir, "sub"), "--since", "20.years"], { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(nums(line(out, "history     "))[0], 1, "only commits touching the scope count");
    assert.ok(!/outside\//.test(out), "no path outside the scope may appear");
  } finally { r.clean(); }
});

test("a subdirectory scan does not report relocations from outside its scope", () => {
  const r = repo(); r.init();
  try {
    r.file("sub/keep.go", "1\n");
    for (let i = 0; i < 5; i++) r.file(`outside/old/f${i}.md`, `spec ${i}\n`);
    r.commit("2024-01-01T00:00:00");
    r.git("mv", "outside/old", "outside/new");
    r.file("sub/keep.go", "2\n");
    r.commit("2024-02-01T00:00:00");
    const out = execFileSync("node", [CLI, join(r.dir, "sub"), "--since", "20.years"], {
      encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"],
    });
    assert.doesNotMatch(out, /outside\/old|outside\/new|→/,
      `an all-file relocation record still belongs to the requested subtree:\n${out}`);
  } finally { r.clean(); }
});

test("the layer depth is measured, not asserted", () => {
  const r = repo();
  try {
    // A chain of four projects: depth must follow the chain, not a constant.
    for (const [n, dep] of [["D", null], ["C", "D"], ["B", "C"], ["A", "B"]]) {
      const ref = dep ? `<ItemGroup><ProjectReference Include="../${dep}/${dep}.csproj" /></ItemGroup>` : "";
      r.file(`${n}/${n}.csproj`, `<Project>${ref}</Project>`);
      r.file(`${n}/${n.toLowerCase()}.cs`, `class ${n} {}`);
    }
    const out = r.run();
    const l = line(out, "load path is");
    assert.match(out, /max source-path depth 1/, `physical depth must carry its own unit:\n${out}`);
    assert.match(l, /load path is 4 layers deep/, `a four-link chain is four layers: ${l}`);
    assert.doesNotMatch(out, /, \d+ deep$/m, `bare depth must not conflate the physical tree with dependency layers:\n${out}`);
  } finally { r.clean(); }
});

test("the csproj search descends past the first level", () => {
  const r = repo();
  try {
    for (const n of ["A", "B"]) {
      const dep = n === "A" ? '<ItemGroup><ProjectReference Include="../B/B.csproj" /></ItemGroup>' : "";
      r.file(`src/nested/deep/${n}/${n}.csproj`, `<Project>${dep}</Project>`);
      r.file(`src/nested/deep/${n}/${n.toLowerCase()}.cs`, `class ${n} {}`);
    }
    const l = line(r.run(), "dependencies");
    assert.match(l, /ProjectReference/, `projects four levels down must still be found: ${l}`);
  } finally { r.clean(); }
});

test("the csproj walk says how many directories it did not search", () => {
  const r = repo();
  try {
    // Two projects the walk reaches, so there is a graph for the line to
    // qualify rather than an absence.
    for (const n of ["A", "B"]) {
      const dep = n === "A" ? '<ItemGroup><ProjectReference Include="../B/B.csproj" /></ItemGroup>' : "";
      r.file(`${n}/${n}.csproj`, `<Project>${dep}</Project>`);
      r.file(`${n}/${n.toLowerCase()}.cs`, `class ${n} {}`);
    }
    // And one past the bound. The walk refuses to open the thirteenth level, so
    // the project inside it is not in the graph — which is the fact the line
    // has to carry. Without it the two projects above read as all of them.
    const deep = Array.from({ length: 13 }, (_, i) => `d${i}`).join("/");
    r.file(`${deep}/Z/Z.csproj`, "<Project></Project>");
    r.file(`${deep}/Z/z.cs`, "class Z {}");
    const out = r.run();
    assert.match(line(out, "dependencies"), /2 projects/, `the reachable projects must still be measured: ${line(out, "dependencies")}`);
    const l = out.split("\n").find((x) => x.includes("not searched"));
    assert.ok(l, `a depth-bounded walk must say what it did not search:\n${out}`);
    assert.match(l, /1 directory sat deeper than the 12 levels this walk descends/, l);
    assert.match(l, /not searched for projects, nor anything under it/, l);
  } finally { r.clean(); }
});

test("the bounded Go module walk discloses what it did not search", { skip: !hasGo() }, () => {
  const r = repo();
  try {
    r.file("go.mod", "module example.com/root\ngo 1.21\n");
    r.file("main.go", 'package main\nimport _ "example.com/root/lib"\n');
    r.file("lib/lib.go", "package lib\n");
    const deep = "one/two/three/four/five";
    r.file(`${deep}/go.mod`, "module example.com/deep\ngo 1.21\n");
    r.file(`${deep}/deep.go`, "package deep\n");
    const out = r.run();
    const l = line(out, "sat deeper");
    assert.match(l ?? "", /1 directory sat deeper than the 4 levels this walk descends/, out);
    assert.match(l, /not searched for Go modules/, l);
  } finally { r.clean(); }
});

test("a go module is analysed without reaching the network", () => {
  const r = repo();
  try {
    try { execFileSync("go", ["version"], { stdio: "ignore" }); } catch { return; }
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", 'package alpha\n\nimport _ "example.com/m/beta"\n');
    r.file("beta/b.go", "package beta\n");
    // An empty module cache with no proxy: a module with no external imports
    // must still resolve, and nothing may be downloaded.
    const cache = mkdtempSync(join(tmpdir(), "lp-gomod-"));
    try {
      const out = execFileSync("node", [CLI, r.dir], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...ENV, GOMODCACHE: cache, GOPROXY: "https://invalid.invalid" },
      });
      assert.match(line(out, "dependencies"), /go list/, "an offline scan must still resolve internal edges");
    } finally { rmSync(cache, { recursive: true, force: true }); }
  } finally { r.clean(); }
});

test("a directory with no commit in the window is counted, not omitted", () => {
  const r = repo(); r.init();
  try {
    r.file("tracked/a.go", "x\n");
    r.commit("2024-01-01T00:00:00");
    // Present on disk, absent from the window: it belongs in the total.
    r.file("untracked/b.go", "x\n");
    const l = line(r.run("--since", "20.years"), "activity");
    const m = l.match(/(\d+) touched[^,]*, (\d+) not, (\d+) with no commit[^—]*— of (\d+) source-containing director/);
    assert.ok(m, `unexpected activity line: ${l}`);
    assert.equal(Number(m[3]), 1, `the directory with no commit must be counted: ${l}`);
    assert.equal(Number(m[4]), 2);
  } finally { r.clean(); }
});

test("every Go module in the repository is analysed, not only the root one", { skip: !hasGo() }, () => {
  const r = repo();
  try {
    r.file("go.mod", "module example.com/root\ngo 1.21\n");
    r.file("a/x/x.go", "package x\n");
    r.file("main.go", 'package main\nimport _ "example.com/root/a/x"\nfunc main(){}\n');
    r.file("sub/go.mod", "module example.com/sub\ngo 1.21\n");
    r.file("sub/b/y/y.go", "package y\n");
    r.file("sub/s.go", 'package sub\nimport _ "example.com/sub/b/y"\n');
    const l = line(r.run("--structure"), "dependencies");
    // Root alone is 1 edge over 2 packages; the nested module carries the rest.
    assert.match(l, /2 edges over 4 packages/, `the nested module must be analysed too: ${l}`);
  } finally { r.clean(); }
});

test("a go scan reaches no network and rewrites no go.mod", { skip: !hasGo() }, () => {
  const r = repo(); r.init();
  try {
    r.file("go.mod", "module example.com/root\ngo 1.21\n");
    r.file("a/x/x.go", "package x\n");
    r.file("main.go", 'package main\nimport _ "example.com/root/a/x"\nfunc main(){}\n');
    r.commit("2024-01-01T00:00:00");
    r.run("--structure");
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: r.dir, encoding: "utf8" });
    assert.equal(dirty.trim(), "", `the scan must leave the tree byte-identical, got: ${dirty}`);
  } finally { r.clean(); }
});

test("a submodule's files are not counted as this repository's code", () => {
  const r = repo();
  try {
    r.file("app/main.go", "x\n".repeat(4));
    r.file(".gitmodules", '[submodule "vendorlib"]\n\tpath = libs/vendorlib\n\turl = https://example.com/x.git\n');
    r.file("libs/vendorlib/big.go", "x\n".repeat(900));
    r.file("libs/vendorlib/deep/more.go", "x\n".repeat(900));
    const out = r.run();
    // Another repository's code borrowed into this tree is not this tree's
    // weight, and counting it moves every distribution it appears in.
    assert.match(out, /^1 source file, 4 lines/m, `the submodule must be excluded, got: ${line(out, "source file")}`);
    assert.doesNotMatch(out, /vendorlib/, "no submodule path may appear as a subject of this repository");
  } finally { r.clean(); }
});

test("compact --since spellings mean the duration, not a day of the month", () => {
  const r = repo(); r.init();
  try {
    // Chronological: --since prunes the walk, so an out-of-order HEAD stops it
    // at the first commit and the window would read empty for the wrong reason.
    r.file("a/f.go", "1\n"); r.commit("2025-01-15T00:00:00");
    r.file("a/f.go", "2\n"); r.commit("2026-08-01T00:00:00");
    // git reads a bare `1y` as ~19 days ago and `30d` as a future day-of-month;
    // both exit 0, so a wrong window would be silent rather than refused.
    const y = line(r.run("--since", "1y"), "history");
    assert.match(y, /1\.years/, `the rewrite must be disclosed: ${y}`);
    assert.match(y, /since 202[56]-/, y);
    const d = line(r.run("--since", "30d"), "history");
    assert.doesNotMatch(d, /not measured/, `30d must not resolve into the future: ${d}`);
    assert.match(d, /30\.days/, d);
  } finally { r.clean(); }
});

test("an ambiguous --since unit is refused, naming both spellings", () => {
  const r = repo(); r.init();
  try {
    r.file("a/f.go", "1\n"); r.commit("2026-08-01T00:00:00");
    const l = line(r.run("--since", "3m"), "history");
    assert.match(l, /not measured/, l);
    assert.match(l, /3\.months/, `both readings must be named: ${l}`);
    assert.match(l, /3\.minutes/, `both readings must be named: ${l}`);
  } finally { r.clean(); }
});

test("a --since git already reads as a duration is passed through unchanged", () => {
  const r = repo(); r.init();
  try {
    r.file("a/f.go", "1\n"); r.commit("2026-08-01T00:00:00");
    const l = line(r.run("--since", "12.months"), "history");
    assert.doesNotMatch(l, /→/, `nothing was rewritten, so nothing may claim to have been: ${l}`);
  } finally { r.clean(); }
});

// The bound the tool budgets against, read from the one place it is defined.
const CHARS_PER_TOKEN = Number(
  /const CHARS_PER_TOKEN = ([\d.]+);/.exec(readFileSync(join(dirname(CLI), "scan.mjs"), "utf8"))?.[1]);
const bound = (s) => Math.round(s.length / CHARS_PER_TOKEN);

test("--budget is a ceiling on the structure table, not a target", () => {
  const r = repo();
  try {
    for (let i = 0; i < 60; i++) r.file(`pkg/subsystem-${i}/service.go`, "x\n".repeat(20 + i));
    for (const budget of [200, 600, 1400]) {
      const lines = r.run("--structure", "--budget", String(budget)).split("\n");
      const i2 = lines.findIndex((l) => l.startsWith("  files lines tests"));
      assert.ok(i2 >= 0, "the structure table must be present");
      let j = i2 + 1;
      while (j < lines.length && lines[j].trim()) j++;
      const body = lines.slice(i2 + 1, j).join("\n");
      // The suite has no tokenizer, so it holds the tool to its own stated
      // bound; tests/measure.mjs is where that bound meets a real one.
      assert.ok(bound(body) <= budget, `budget ${budget} exceeded: ${bound(body)}`);
      assert.ok(bound(body) > budget * 0.5, `budget ${budget} wasted: only ${bound(body)} used`);
    }
  } finally { r.clean(); }
});

test("the token bound is defined once, not copied per call site", () => {
  assert.ok(CHARS_PER_TOKEN > 0, "scan.mjs must define CHARS_PER_TOKEN");
  const copies = [];
  for (const f of ["scan.mjs", "report.mjs", "loadpath.mjs", "deps.mjs"]) {
    const src = readFileSync(join(dirname(CLI), f), "utf8");
    for (const m of src.matchAll(/\.length\s*\/\s*(\d[\d.]*)/g)) copies.push(`${f}: /${m[1]}`);
  }
  // A second copy is how the estimate and the budget silently disagreed before.
  assert.deepEqual(copies, [], `divide-by-chars must go through CHARS_PER_TOKEN, found: ${copies.join(", ")}`);
});

test("the installed copy can name its own version", () => {
  const v = execFileSync("node", [CLI, "--version"], { encoding: "utf8" }).trim();
  assert.match(v, /^loadpath \d+\.\d+\.\d+$/, `--version must print a version, got: ${v}`);
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  // package.json does not travel with `npx skills add`; the constant does.
  assert.equal(v, `loadpath ${pkg.version}`, "the artefact and the package must agree");
});

test("an explicit future --since is refused, not reported as an empty history", () => {
  const r = repo(); r.init();
  try {
    r.file("a/f.go", "1\n"); r.commit("2026-01-01T00:00:00");
    const l = line(r.run("--since", "2099-06-01"), "history");
    // "0 commits" would read as a quiet repository rather than a bad window.
    assert.match(l, /future/, `a future cutoff must say so: ${l}`);
    assert.doesNotMatch(l, /^history\s+0 commits/, l);
  } finally { r.clean(); }
});

test("a module that fails to resolve is disclosed beside the edge count", { skip: !hasGo() }, () => {
  const r = repo();
  try {
    r.file("go.mod", "module example.com/root\ngo 1.21\n");
    r.file("a/x/x.go", "package x\n");
    r.file("main.go", 'package main\nimport _ "example.com/root/a/x"\nfunc main(){}\n');
    // A second module whose go.mod is unusable: the root still resolves, and a
    // reader must not take the partial graph for the whole one.
    r.file("broken/go.mod", "this is not a go.mod\n");
    r.file("broken/b.go", "package broken\n");
    const l = line(r.run("--structure"), "dependencies");
    assert.match(l, /1 of 2 modules resolved/, `the drop must be stated: ${l}`);
  } finally { r.clean(); }
});

test("a measured dependency graph appears in the default view, not only under --structure", { skip: !hasGo() }, () => {
  const r = repo();
  try {
    r.file("go.mod", "module example.com/root\ngo 1.21\n");
    r.file("a/x/x.go", "package x\n");
    r.file("main.go", 'package main\nimport _ "example.com/root/a/x"\nfunc main(){}\n');
    const l = line(r.run(), "dependencies");
    assert.match(l, /1 edge over 2 packages/, `the orient view must carry the graph: ${l}`);
    // The bug this covers rendered the literal string "undefined" here while
    // every other test stayed green.
    assert.doesNotMatch(l, /undefined|not measured/, l);
  } finally { r.clean(); }
});

// ── Spans: one ecosystem, one graph, side by side ───────────────────────────

test("a Go backend and a TS frontend are two spans, not one winner", () => {
  const r = repo();
  try {
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", 'package alpha\n\nimport _ "example.com/m/beta"\n');
    r.file("beta/b.go", "package beta\n");
    r.file("package.json", '{"name":"web","version":"1.0.0"}');
    r.file("tsconfig.json", "{}");
    r.file("src/ui/u.ts", 'import { c } from "../core/c";\nexport const u = c;\n');
    r.file("src/core/c.ts", "export const c = 1;\n");
    const out = r.run();
    const go = line(out, "dependencies (Go)");
    const node = line(out, "dependencies (Node)");
    // Both ecosystems are declared on this page, so both owe the reader a line.
    // Which of them a toolchain can measure here decides the line's content and
    // never whether it exists.
    assert.ok(go, `the Go span is missing:\n${out}`);
    assert.ok(node, `the Node span is missing:\n${out}`);
    if (hasGo()) assert.match(go, /1 edge over 2 packages, via go list/, go);
    else assert.match(go, /go is not on PATH/, go);
    if (hasMadge()) assert.match(node, /1 edge over 2 file directories, via madge/, node);
    else assert.match(node, /not measured — \S/, node);
    assert.ok(!/no analyzer applies/.test(out), `two declared ecosystems cannot be no ecosystems:\n${out}`);
  } finally { r.clean(); }
});

test("a Node span measures every declared source root", () => {
  const r = repo();
  try {
    r.file("package.json", '{"name":"root","private":true,"workspaces":["packages/*"]}');
    r.file("packages/x/package.json", '{"name":"x","version":"1.0.0"}');
    r.file("packages/y/package.json", '{"name":"y","version":"1.0.0"}');
    r.file("packages/x/a.js", 'import "../y/b.js";\n');
    r.file("packages/y/b.js", "export const b = 1;\n");
    r.file("app/package.json", '{"name":"app","private":true}');
    r.file("app/src/a/a.js", 'import "../b/b.js";\n');
    r.file("app/src/b/b.js", "export const b = 1;\n");
    const out = withMadge(`
const args = process.argv.slice(2);
const both = args.includes("packages") && args.includes("app");
process.stdout.write(JSON.stringify(both
  ? { "packages/x/a.js": ["packages/y/b.js"], "packages/y/b.js": [], "app/src/a/a.js": ["app/src/b/b.js"], "app/src/b/b.js": [] }
  : { "x/a.js": ["y/b.js"], "y/b.js": [] }));`, (env) =>
      execFileSync(process.execPath, [CLI, r.dir], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }));
    const l = line(out, "dependencies");
    assert.match(l, /2 edges over 4 file directories/, `packages/ and app/ are one Node span: ${l}`);
  } finally { r.clean(); }
});

test("layers and groups keep their span identity when ecosystems share directories", () => {
  const r = repo();
  try {
    r.file("package.json", '{"name":"polyglot","version":"1.0.0"}');
    r.file("tsconfig.json", "{}");
    r.file("src/A/a.ts", 'import "../B/b";\nexport const a = 1;\n');
    r.file("src/B/b.ts", 'import "../A/a";\nexport const b = 1;\n');
    r.file("src/A/A.csproj", '<Project><ItemGroup><ProjectReference Include="../B/B.csproj" /></ItemGroup></Project>');
    r.file("src/A/a.cs", "class A {}\n");
    r.file("src/B/B.csproj", '<Project><ItemGroup><ProjectReference Include="../A/A.csproj" /></ItemGroup></Project>');
    r.file("src/B/b.cs", "class B {}\n");
    const out = withMadge(`process.stdout.write(JSON.stringify({ "A/a.ts": ["B/b.ts"], "B/b.ts": ["A/a.ts"] }));`, (env) =>
      execFileSync(process.execPath, [CLI, r.dir, "--structure"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }));
    const csharp = out.split("dependencies (C#)\n")[1]?.split("dependencies (Node)\n")[0] ?? "";
    const node = out.split("dependencies (Node)\n")[1] ?? "";
    assert.match(csharp, /entangled g1:/, `the C# group keeps its page identity:\n${out}`);
    assert.match(node, /entangled g2:/, `the Node group keeps its page identity:\n${out}`);
    const row = out.split("\n").find((one) => /\d+f.*src\/A$/.test(one));
    assert.match(row ?? "", /C#:L\d g1/, `the layer cell must name its C# span: ${row}`);
    assert.match(row ?? "", /Node:L\d g2/, `the same cell must retain its Node span: ${row}`);
  } finally { r.clean(); }
});

test("a split-tree monorepo roots each analyzer at its own ecosystem", { skip: !hasGo() }, () => {
  const r = repo();
  try {
    r.file("backend/go.mod", "module example.com/svc\n\ngo 1.21\n");
    r.file("backend/alpha/a.go", 'package alpha\n\nimport _ "example.com/svc/beta"\n');
    r.file("backend/beta/b.go", "package beta\n");
    r.file("frontend/package.json", '{"name":"web","version":"1.0.0"}');
    r.file("frontend/src/index.js", "export const x = 1;\n");
    r.file("api/pyproject.toml", '[project]\nname = "api"\n');
    r.file("api/pkg/__init__.py", "x = 1\n");
    const out = r.run("--structure");
    assert.match(line(out, "dependencies (Go)"), /1 edge over 2 packages/, `the Go module is under backend/, not at the root:\n${out}`);
    // grimp is named only by an analyzer that was rooted where the pyproject
    // is. Rooted at the ancestor of every manifest it would find no project.
    assert.match(line(out, "dependencies (Python)"), /grimp/, `Python must be analysed at api/:\n${out}`);
    assert.ok(!/no analyzer applies/.test(out), out);
    // Nodes are the repository's directories, or the layer column joins to
    // nothing: the analyzer names them relative to its own root.
    assert.ok(/L\d\s+backend\/alpha$/m.test(out), `the layer column must carry repository-relative paths:\n${out}`);
  } finally { r.clean(); }
});

test("an ecosystem declared without its analyzer is a named absence, not silence", () => {
  const r = repo();
  const bin = mkdtempSync(join(tmpdir(), "lp-bin-"));
  try {
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", 'package alpha\n\nimport _ "example.com/m/beta"\n');
    r.file("beta/b.go", "package beta\n");
    // A PATH holding only what the tool itself needs. `go` is absent from it
    // whether or not this machine has one, so the case is exercised everywhere.
    for (const b of ["git", "sh"]) {
      const p = execFileSync("sh", ["-c", `command -v ${b} || true`], { encoding: "utf8" }).trim();
      if (p) execFileSync("ln", ["-s", p, join(bin, b)]);
    }
    execFileSync("ln", ["-s", process.execPath, join(bin, "node")]);
    const out = execFileSync(process.execPath, [CLI, r.dir], {
      encoding: "utf8", env: { ...ENV, PATH: bin }, stdio: ["ignore", "pipe", "pipe"],
    });
    const l = line(out, "dependencies");
    assert.match(l, /go is not on PATH/, `a Go repository with no toolchain is not a repository with no dependencies: ${l}`);
    assert.match(l, /1 Go module was not analysed/, `the reader must learn what the absence cost: ${l}`);
    assert.ok(!/no analyzer applies/.test(out), `the analyzer applies; it is not installed:\n${out}`);
  } finally { rmSync(bin, { recursive: true, force: true }); r.clean(); }
});

test("an application's private package.json beside src is a declared module", () => {
  const r = repo();
  try {
    // The ordinary frontend application: private, because npm's flag means
    // "do not publish", which is what an application is.
    r.file("package.json", '{"name":"app","private":true}');
    r.file("src/index.js", "export const x = 1;\n");
    const out = r.run();
    assert.match(out, /^ +Node +\.$/m, `a private application is a declared module:\n${out}`);
  } finally { r.clean(); }
});

test("workspace-noise package.json stay filtered", () => {
  const r = repo();
  try {
    r.file("package.json", '{"name":"root","version":"1.0.0"}');
    r.file("src/index.js", "export const x = 1;\n");
    // A workspace glob matches these; they declare nothing. On one real
    // repository this shape was 297 of 299 package.json files.
    for (const n of ["x", "y"]) {
      r.file(`packages/${n}/package.json`, '{"private":true,"version":"0.0.0"}');
      r.file(`packages/${n}/index.js`, "export const y = 1;\n");
    }
    const out = r.run();
    const block = out.split("declared modules")[1].split("\n\n")[0];
    assert.match(block, /^ +Node +\.$/m, `the real module must survive: ${block}`);
    assert.ok(!/packages\//.test(block), `a nameless private package is not a module: ${block}`);
  } finally { r.clean(); }
});

test("manifests sharing one name are templates, not modules — dropped and disclosed", () => {
  const r = repo();
  try {
    r.file("package.json", '{"name":"root","version":"1.0.0"}');
    r.file("src/index.js", "export const x = 1;\n");
    // Three scaffolds, private, each with its own src/, each carrying the same
    // name. No registry would take the collision, so none of them is a module —
    // and the first one is not either, which is why all three go.
    for (const n of ["vue", "react", "solid"]) {
      r.file(`scaffold/app-${n}/package.json`, '{"name":"starter","private":true}');
      r.file(`scaffold/app-${n}/src/main.js`, "export const y = 1;\n");
    }
    const out = r.run();
    const block = out.split("declared modules")[1].split("\n\n")[0];
    assert.match(block, /^ +Node +\.$/m, `the real module must survive: ${block}`);
    assert.ok(!/scaffold\//.test(block), `a copied name is not a module: ${block}`);
    // A drop of that size decides how the section reads, so it is disclosed.
    assert.match(block, /\+3 filtered: 3 manifests share one name \(starter\)/, block);
  } finally { r.clean(); }
});

test("a template-something directory is scaffolding, not a module", () => {
  const r = repo();
  try {
    r.file("package.json", '{"name":"root","version":"1.0.0"}');
    r.file("src/index.js", "export const x = 1;\n");
    // Named and public, and still not modules: a scaffold is what the path
    // says it is. Both separators these repositories use are covered.
    r.file("packages/template-vue/package.json", '{"name":"tmpl-vue","version":"1.0.0"}');
    r.file("packages/template-vue/src/main.js", "export const y = 1;\n");
    r.file("packages/template_react/package.json", '{"name":"tmpl-react","version":"1.0.0"}');
    r.file("packages/template_react/src/main.js", "export const z = 1;\n");
    // The separator is required, so a word that merely starts the same way is
    // still a module. Without it the rule would be a prefix match.
    r.file("packages/templating/package.json", '{"name":"templating","version":"1.0.0"}');
    r.file("packages/templating/src/main.js", "export const w = 1;\n");
    const block = r.run().split("declared modules")[1].split("\n\n")[0];
    assert.ok(!/template-vue/.test(block), `a hyphenated scaffold is not a module: ${block}`);
    assert.ok(!/template_react/.test(block), `an underscored scaffold is not a module: ${block}`);
    assert.match(block, /packages\/templating/, `templating is a module, not a template: ${block}`);
  } finally { r.clean(); }
});

test("a merged ecosystem name keeps a space between it and the path", () => {
  const r = repo();
  try {
    // Three manifests at one path merge into one eco name wider than the
    // column. Padding to the column alone then joins two fields into one token.
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("package.json", '{"name":"web","version":"1.0.0"}');
    r.file("tsconfig.json", "{}");
    r.file("alpha/a.go", "package alpha\n");
    const row = r.run().split("\n").find((l) => /^ {2}\S+\s+\.$/.test(l));
    assert.ok(row, `the declared row must keep its two fields apart:\n${r.run()}`);
  } finally { r.clean(); }
});

test("a subdirectory scan filters the span to the scope and states the crossing load", { skip: !hasGo() }, () => {
  const r = repo(); r.init();
  try {
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("cmd/cotx/main.go", 'package main\n\nimport _ "example.com/m/internal/world"\n\nfunc main() {}\n');
    r.file("internal/world/w.go", 'package world\n\nimport (\n\t_ "example.com/m/internal/ftk"\n\t_ "example.com/m/internal/world/store"\n)\n');
    r.file("internal/world/store/s.go", "package store\n");
    r.file("internal/ftk/f.go", "package ftk\n");
    r.commit("2024-01-01T00:00:00");
    const out = execFileSync("node", [CLI, join(r.dir, "internal", "world"), "--since", "20.years"],
      { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    const l = line(out, "dependencies");
    // The module is measured whole — an analyzer rooted at the subdirectory
    // finds no go.mod — and presented at the scope that was asked for.
    assert.match(l, /1 edge over 2 packages/, `the span must be confined to the scope: ${l}\n${out}`);
    const b = line(out, "crossings");
    assert.ok(b, `a confined span must state what crosses the line:\n${out}`);
    assert.match(b, /1 inbound from outside internal\/world \(top: cmd\/cotx\)/, b);
    assert.match(b, /1 outbound \(top: internal\/ftk\)/, b);
  } finally { r.clean(); }
});

test("a scope holding none of the declared ecosystem says so", { skip: !hasGo() }, () => {
  const r = repo(); r.init();
  try {
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", 'package alpha\n\nimport _ "example.com/m/beta"\n');
    r.file("beta/b.go", "package beta\n");
    r.file("tools/gen.py", "x = 1\n");
    r.commit("2024-01-01T00:00:00");
    const out = execFileSync("node", [CLI, join(r.dir, "tools"), "--since", "20.years"],
      { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    const l = line(out, "dependencies");
    // The module was measured and none of it is here. That is a different
    // sentence from "no analyzer applies", and from a graph of nothing.
    assert.match(l, /the Go graph holds no packages under tools/, l);
    assert.ok(!/0 edges/.test(l), `an empty scope is not an empty graph: ${l}`);
  } finally { r.clean(); }
});

test("a single-ecosystem repository keeps its unlabelled dependency line", () => {
  const r = repo();
  try {
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", 'package alpha\n\nimport _ "example.com/m/beta"\n');
    r.file("beta/b.go", "package beta\n");
    const out = r.run();
    assert.match(out, /^dependencies {2}\S/m, `one span carries no label:\n${out}`);
    assert.ok(!/dependencies \(/.test(out), `a label that never varies is a column of noise:\n${out}`);
  } finally { r.clean(); }
});

test("an ecosystem this tool ships no analyzer for is named, not omitted", () => {
  const r = repo();
  try {
    r.file("Cargo.toml", '[package]\nname = "t"\nversion = "0.1.0"\n');
    r.file("src/main.rs", "fn main() {}\n");
    const l = line(r.run(), "dependencies");
    assert.match(l, /no analyzer shipped for Rust/, `a declared ecosystem is answered, not skipped: ${l}`);
  } finally { r.clean(); }
});

test("source access and rendering stay on opposite sides of the seam", () => {
  const deps = readFileSync(join(dirname(CLI), "deps.mjs"), "utf8");
  const report = readFileSync(join(dirname(CLI), "report.mjs"), "utf8");
  // DESIGN.md, "Acquire ↔ render": source modules acquire facts; Report may
  // derive a view from supplied facts, but it may not open the repository,
  // invoke git, or invoke an analyzer itself.
  for (const idiom of ["padStart(", "padEnd(", "console.log("]) {
    assert.ok(!deps.includes(idiom), `deps.mjs lays out output with ${idiom}; that belongs to report.mjs`);
  }
  for (const source of ['"node:fs"', '"node:child_process"']) {
    assert.ok(!report.includes(source), `report.mjs imports ${source}; source access belongs before the render seam`);
  }
});

// ── Subtree load: what holds a subtree in place ──────────────────────────────
//
// A subtree is read to decide whether it can come out, and its own files do
// not answer that. What does is the load crossing its line in each direction.

test("--dir states who loads on the subtree and whom it loads on", { skip: !hasGo() }, () => {
  const r = repo();
  try {
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("cmd/cotx/main.go", 'package main\n\nimport _ "example.com/m/internal/world"\n\nfunc main() {}\n');
    r.file("internal/api/a.go", 'package api\n\nimport _ "example.com/m/internal/world/store"\n');
    r.file("internal/world/w.go", 'package world\n\nimport (\n\t_ "example.com/m/internal/ftk"\n\t_ "example.com/m/internal/world/store"\n)\n');
    r.file("internal/world/store/s.go", "package store\n");
    r.file("internal/ftk/f.go", "package ftk\n");
    const out = r.run("--dir", "internal/world");
    const inb = line(out, "fan-in"), outb = line(out, "fan-out");
    assert.ok(inb && outb, `both directions are facts, and both are needed:\n${out}`);
    // Two directories outside reach in, one of them through the nested
    // package: an edge into a subtree is an edge into every parent of it.
    assert.match(inb, /fan-in 2 from outside/, inb);
    assert.match(inb, /cmd\/cotx 1/, inb);
    assert.match(inb, /internal\/api 1/, inb);
    assert.match(outb, /fan-out 1 to outside \(top: internal\/ftk 1\)/, outb);
    // The edges that do not cross are load the subtree carries alone, and an
    // extraction takes them with it rather than negotiating them.
    assert.match(out, /1 edge stays inside internal\/world/, out);
  } finally { r.clean(); }
});

test("--dir on a repository no analyzer reads says the load is not measured, never zero", () => {
  const r = repo();
  try {
    r.file("a/x.rb", "require 'b'\n"); r.file("a/y.rb", "1\n"); r.file("b/z.rb", "1\n");
    const l = line(r.run("--dir", "a"), "load on this subtree");
    assert.match(l, /not measured/, l);
    // A subtree nothing depends on and a subtree nobody measured are opposite
    // conclusions, and the second one licenses the extraction the first does.
    assert.ok(!/fan-in 0/.test(l), `an unmeasured graph must never render as a free subtree: ${l}`);
  } finally { r.clean(); }
});

test("--dir dates each file by its last commit in the window, and marks the ones with none", () => {
  const r = repo(); r.init();
  try {
    r.file("p/old.go", "x\n"); r.commit("2024-01-01T00:00:00");
    r.file("p/new.go", "x\n"); r.commit("2024-06-01T00:00:00");
    r.file("p/never.go", "x\n");                       // on disk, never committed
    const out = r.run("--since", "20.years", "--dir", "p");
    const cell = (f) => line(out, f).trim().split(/\s+/).slice(-2)[0];
    // Asserted as an order rather than as two literal days: the renderer
    // prints UTC and the fixture commits in whatever zone the suite runs in,
    // and a test that pins both would pass in one hemisphere of the calendar.
    for (const f of ["p/old.go", "p/new.go"]) assert.match(cell(f), /^\d{4}-\d{2}-\d{2}$/, out);
    assert.ok(cell("p/new.go") > cell("p/old.go"),
      `each file carries its own last commit, not its directory's: ${cell("p/old.go")} then ${cell("p/new.go")}`);
    // Not old: unmeasured. A date borrowed from the directory, or a blank
    // under a date header, would say the opposite of what is known.
    assert.equal(cell("p/never.go"), "-", out);
  } finally { r.clean(); }
});

// ── Scatter ─────────────────────────────────────────────────────────────────
//
// Counted over distinct directories, never over files: twelve handlers in one
// directory is a directory with twelve files in it.

test("a name token spread across directories is reported with both counts", () => {
  const r = repo();
  try {
    for (let i = 0; i < 9; i++) r.file(`svc${i}/handler.go`, "x\n");
    r.file("svc0/order_handler.go", "x\n");
    r.file("svc0/payment_handler.go", "x\n");
    const l = line(r.run(), "scattered names");
    // Both counts, because eleven files across nine directories and eleven
    // across three are different findings with different fixes.
    assert.match(l, /handler ×11 across 9 source-containing directories/, l);
  } finally { r.clean(); }
});

test("stoplisted, short and numeric tokens do not scatter", () => {
  const r = repo();
  try {
    for (const d of ["alpha", "beta", "gamma", "delta"]) {
      r.file(`${d}/index.go`, "x\n");        // a role word, everywhere by convention
      r.file(`${d}/utils.go`, "x\n");        // the same
      r.file(`${d}/db.go`, "x\n");           // two letters carry no subject
      r.file(`${d}/x_2024.go`, "x\n");       // a bare number is a date or a version
    }
    const l = line(r.run(), "scattered names");
    assert.match(l, /none recur across 3 or more source-containing directories/, l);
  } finally { r.clean(); }
});

test("camelCase names split into tokens, so one subject spread thin is visible", () => {
  const r = repo();
  try {
    r.file("orders/orderHandler.go", "x\n");
    r.file("users/userHandler.go", "x\n");
    r.file("carts/cartHandler.go", "x\n");
    // Read whole, these are three names that recur nowhere; read as words,
    // they are one role standing in three places.
    const out = r.run();
    assert.match(line(out, "scattered names"), /names\s+handler ×3 across 3 source-containing directories/, out);
  } finally { r.clean(); }
});

test("a repository with no recurring token says so instead of dropping the line", () => {
  const r = repo();
  try {
    r.file("ledger/ledger.go", "x\n");
    r.file("ledger/posting.go", "x\n");
    r.file("archive/ledger.go", "x\n");      // two directories: under the floor
    const l = line(r.run(), "scattered names");
    // A section that vanishes when it finds nothing cannot be told from one
    // that was never computed.
    assert.match(l, /none recur across 3 or more source-containing directories/, l);
  } finally { r.clean(); }
});

// ── Move closure: snapshot and compare ──────────────────────────────────────

const scratch = (tag) => join(tmpdir(), `lp-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
const csproj = (r, n, dep) => r.file(`${n}/${n}.csproj`,
  `<Project>${dep ? `<ItemGroup><ProjectReference Include="../${dep}/${dep}.csproj" /></ItemGroup>` : ""}</Project>`);
// Whatever the command wrote to stderr before refusing, or null if it did not.
const refused = (fn) => { try { fn(); return null; } catch (e) { return String(e.stderr ?? ""); } };

test("a snapshot taken and compared against an unchanged tree reports no structural change", () => {
  const r = repo();
  const f = scratch("snap");
  try {
    for (const n of ["A", "B"]) r.file(`${n}/${n.toLowerCase()}.cs`, `class ${n} {}`);
    csproj(r, "A", "B"); csproj(r, "B", null);
    r.run("--snapshot", f);
    const snap = JSON.parse(readFileSync(f, "utf8"));
    assert.equal(snap.schema, 1);
    assert.equal(snap.version, JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")).version);
    assert.ok(!("at" in snap) && !("since" in snap), "a structural snapshot must carry no git-derived fields");
    assert.equal(snap.spans.length, 1, `the measured span must be recorded: ${JSON.stringify(snap.spans)}`);
    assert.equal(snap.spans[0].eco, "C#");
    const out = r.run("--compare", f);
    assert.match(out, /no structural change against the snapshot/, out);
    // The delta and nothing else: the reader has already seen the view the
    // snapshot came from.
    assert.ok(!/files per source-containing directory/.test(out), `the normal view must not be reprinted:\n${out}`);
    assert.ok(!/dependencies {2}\d/.test(out), `nor the span line it opens with:\n${out}`);
    assert.match(out, /lag by design/, `and what history cannot answer is said every time:\n${out}`);
  } finally { rmSync(f, { force: true }); r.clean(); }
});

test("compare reports a dependency node change even when edges and layers stay put", () => {
  const r = repo();
  const f = scratch("nodes");
  try {
    for (const n of ["A", "B", "C"]) r.file(`${n}/${n.toLowerCase()}.cs`, `class ${n} {}`);
    csproj(r, "A", "B"); csproj(r, "B", null);
    r.run("--snapshot", f);
    // A disconnected project changes the measured population without changing
    // an edge, a layer, a group, or the source-file layout.
    csproj(r, "C", null);
    const out = r.run("--compare", f);
    assert.match(out, /2 → 3 projects/, out);
    assert.ok(!/no structural change/.test(out), out);
  } finally { rmSync(f, { force: true }); r.clean(); }
});

test("compare names the group that dissolved and the one that formed, by their members", () => {
  const r = repo();
  const f = scratch("groups");
  try {
    for (const n of ["A", "B", "C", "D"]) r.file(`${n}/${n.toLowerCase()}.cs`, `class ${n} {}`);
    csproj(r, "A", "B"); csproj(r, "B", "A"); csproj(r, "C", null); csproj(r, "D", null);
    r.run("--snapshot", f);
    // The cycle moves: one group before and one after, two edges before and
    // two after, one layer before and one after. Only the members change, and
    // a comparison of counts cannot see it at all.
    csproj(r, "A", null); csproj(r, "B", null); csproj(r, "C", "D"); csproj(r, "D", "C");
    const out = r.run("--compare", f);
    assert.match(line(out, "group dissolved") ?? "", /A, B/, out);
    assert.match(line(out, "group formed") ?? "", /C, D/, out);
  } finally { rmSync(f, { force: true }); r.clean(); }
});

test("compare names the directories that appeared and went, and says how many it did not name", () => {
  const r = repo();
  const f = scratch("dirs");
  try {
    for (let i = 0; i < 8; i++) r.file(`was${i}/f.go`, "x\n");
    r.file("stays/f.go", "x\n");
    r.run("--snapshot", f);
    for (let i = 0; i < 8; i++) rmSync(join(r.dir, `was${i}`), { recursive: true });
    for (let i = 0; i < 8; i++) r.file(`now${i}/f.go`, "x\n");
    const out = r.run("--compare", f);
    const app = line(out, "appeared"), gone = line(out, "gone");
    assert.match(app ?? "", /8 appeared/, out);
    assert.match(gone ?? "", /8 gone/, out);
    assert.match(line(out, "appeared") ?? "", /^source-containing directories\s+8 appeared/, out);
    // A capped list that stops without saying so is a truncation the reader
    // cannot see.
    assert.match(app, /\+3 more/, app);
    assert.match(gone, /\+3 more/, gone);
  } finally { rmSync(f, { force: true }); r.clean(); }
});

test("--snapshot without a file is refused, and says why there is no default", () => {
  const r = repo();
  try {
    r.file("p/a.go", "x\n");
    const err = refused(() => r.run("--snapshot"));
    assert.ok(err !== null, "a missing path must be refused, not guessed at");
    assert.match(err, /--snapshot needs the file to write/, err);
    // The reason is the point: the only default worth having sits inside the
    // repository being read.
    assert.match(err, /read does not write/, err);
  } finally { r.clean(); }
});

test("compare on a file that is not a snapshot is refused, naming what it expected", () => {
  const r = repo();
  const bad = scratch("bad"), old = scratch("old");
  try {
    r.file("p/a.go", "x\n");
    writeFileSync(bad, "this file is not JSON\n");
    writeFileSync(old, '{"dirs":{},"spans":[]}\n');
    const e1 = refused(() => r.run("--compare", bad));
    assert.ok(e1 !== null, "a file that does not parse must be refused");
    assert.match(e1, /written by --snapshot/, e1);
    // An old unversioned shape is not a compatibility branch. Unknown records
    // fail closed before absent fields can become zeros.
    const e2 = refused(() => r.run("--compare", old));
    assert.ok(e2 !== null, "an old record is not the current snapshot schema");
    assert.match(e2, /snapshot schema 1/, e2);
  } finally { rmSync(bad, { force: true }); rmSync(old, { force: true }); r.clean(); }
});

test("compare refuses a malformed snapshot shape before rendering it", () => {
  const r = repo();
  const bad = scratch("malformed");
  try {
    r.file("A/a.cs", "class A {}");
    csproj(r, "A", null);
    writeFileSync(bad, JSON.stringify({
      version: "0.3.0", files: 1,
      dirs: { A: { files: 1, lines: 1 } },
      spans: [{ eco: "C#", unit: "project" }],
    }));
    const err = refused(() => r.run("--compare", bad));
    assert.ok(err !== null, "a partial span must be refused, not rendered");
    assert.match(err, /snapshot schema/, err);
    assert.ok(!/TypeError|\.mjs:\d+/.test(err), err);
  } finally { rmSync(bad, { force: true }); r.clean(); }
});

// ── The command line: what was typed, and what ran ───────────────────────────
//
// Every departure between the two is carried out of parse() rather than made
// quietly. A reader who typed a number and was shown the output of a different
// one had nothing on the page to tell them so.

// Whatever a successful run wrote to stderr. Notices live there beside the
// token bound, because stdout is measurements and a message in that stream
// would be read as one.
const stderrOf = (r, ...args) =>
  spawnSync("node", [CLI, r.dir, ...args], { encoding: "utf8", env: ENV }).stderr;

test("an unknown flag is refused by name rather than ignored", () => {
  const r = repo();
  try {
    r.file("p/a.go", "x\n");
    const err = refused(() => r.run("--bogus"));
    assert.ok(err !== null, "a flag this tool does not know must not be swallowed");
    assert.match(err, /--bogus is not a flag/, err);
    assert.match(err, /--help/, `the refusal must name the remedy: ${err}`);
  } finally { r.clean(); }
});

test("a flag whose value is missing is refused, not filled from the default", () => {
  const r = repo();
  try {
    r.file("p/a.go", "x\n");
    for (const flag of ["--since", "--budget", "--windows", "--cap", "--top", "--dir"]) {
      const err = refused(() => r.run(flag));
      assert.ok(err !== null, `${flag} with no value must be refused, not defaulted`);
      assert.ok(err.includes(`${flag} needs a value`), `${flag}: ${err}`);
    }
    // The next token being another flag is the same absence, one step quieter.
    const err = refused(() => r.run("--budget", "--structure"));
    assert.match(err ?? "", /--budget needs a value/, String(err));
  } finally { r.clean(); }
});

test("a value that is not a number is refused rather than read as the default", () => {
  const r = repo();
  try {
    r.file("p/a.go", "x\n");
    // `Number(x) || default` gave --budget wide and --budget 1600 one page.
    const err = refused(() => r.run("--budget", "wide"));
    assert.ok(err !== null, "a typo must not resolve to the default");
    assert.match(err, /--budget wide is not a number/, err);
  } finally { r.clean(); }
});

test("a clamped value says which number was used", () => {
  const r = repo();
  try {
    for (let i = 0; i < 40; i++) r.file(`d${i}/f.go`, "x\n");
    assert.match(stderrOf(r, "--structure", "--budget", "0"),
      /--budget 0 is below the floor of 200; using 200/,
      "a clamp the reader cannot see is a number they did not ask for");
    assert.match(stderrOf(r, "--windows", "99"), /--windows 99 is above the ceiling of 12; using 12/);
    assert.ok(!/using/.test(stderrOf(r, "--budget", "1600")), "a value inside the bounds is not news");
  } finally { r.clean(); }
});

test("a second repository is refused rather than silently dropped", () => {
  const r = repo();
  try {
    r.file("p/a.go", "x\n");
    const err = refused(() => r.run(r.dir));
    assert.ok(err !== null, "the second path was taken as the first and the rest dropped");
    assert.match(err, /2 repositories were given/, err);
  } finally { r.clean(); }
});

test("--dir names the flags it is ignoring", () => {
  const r = repo();
  try {
    r.file("keep/a.go", "x\n");
    const err = stderrOf(r, "--dir", "keep", "--structure", "--budget", "900", "--windows", "8", "--cap", "20", "--top", "4");
    assert.match(err, /--dir prints one subtree and stops/, err);
    for (const flag of ["--structure", "--budget", "--windows", "--cap", "--top"]) assert.ok(err.includes(flag), `${flag} was silently ignored: ${err}`);
    assert.ok(!/no effect here/.test(stderrOf(r, "--dir", "keep")), "a flag nobody typed is not being ignored");
  } finally { r.clean(); }
});

test("--compare names every history and presentation flag it ignores", () => {
  const r = repo();
  const f = scratch("compare-flags");
  try {
    r.file("keep/a.go", "x\n");
    r.run("--snapshot", f);
    const p = spawnSync("node", [CLI, r.dir, "--compare", f, "--since", "banana", "--windows", "8", "--cap", "20", "--top", "4", "--dir", "keep", "--structure", "--budget", "900"], { encoding: "utf8", env: ENV });
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stderr, /--compare prints only the recorded delta/, p.stderr);
    for (const flag of ["--since", "--windows", "--cap", "--top", "--dir", "--structure", "--budget"]) {
      assert.ok(p.stderr.includes(flag), `${flag} was silently ignored: ${p.stderr}`);
    }
  } finally { rmSync(f, { force: true }); r.clean(); }
});

// ── Disclosure: every truncation states what it dropped ──────────────────────

test("the language list says how many extensions it did not name", () => {
  const r = repo();
  try {
    for (const [i, e] of [".go", ".py", ".ts", ".rb", ".rs", ".java", ".kt"].entries()) r.file(`p/f${i}${e}`, "x\n");
    const l = line(r.run(), "languages");
    assert.match(l, /\+2 more/, `seven extensions and five named: ${l}`);
  } finally { r.clean(); }
});

test("the test-convention list says how many conventions it did not name", () => {
  const r = repo();
  try {
    for (let i = 0; i < 4; i++) {
      r.file(`p/a${i}_test.go`, "x\n");
      r.file(`p/b${i}.spec.ts`, "x\n");
      r.file(`p/c${i}.test.ts`, "x\n");
    }
    const l = line(r.run(), "tests       ");
    assert.match(l, /\+1 more/, `three conventions cleared the vote and two are named: ${l}`);
  } finally { r.clean(); }
});

test("the largest-directories list says how many source-containing directories it did not rank", () => {
  const r = repo();
  try {
    for (let i = 0; i < 20; i++) r.file(`d${i}/f.go`, "x\n");
    for (let i = 0; i < 9; i++) r.file(`wide/f${i}.go`, "x\n");
    assert.match(r.run(), /\+16 more source-containing directories, all smaller/, "five of twenty-one, and the list stopped without saying so");
  } finally { r.clean(); }
});

test("relocations say how many moves they did not show", () => {
  const r = repo(); r.init();
  try {
    for (let d = 0; d < 10; d++) for (let i = 0; i < 4; i++) r.file(`old${d}/f${i}.go`, `body ${i}\n`.repeat(20));
    r.commit("2024-01-01T00:00:00");
    for (let d = 0; d < 10; d++) r.git("mv", `old${d}`, `new${d}`);
    r.commit("2024-02-01T00:00:00");
    assert.match(r.run("--since", "20.years"), /\+2 moves not shown/, "ten moves, eight shown");
  } finally { r.clean(); }
});

test("co-change states the floor it applied and how many pairs cleared it unseen", () => {
  const r = repo(); r.init();
  try {
    // Four directories moving together: six pairs, every one above the floor.
    for (let i = 0; i < 6; i++) {
      for (const d of ["a", "b", "c", "d"]) r.file(`${d}/f.go`, `${i}\n`);
      r.commit(`2024-0${i + 1}-01T00:00:00`);
    }
    const out = r.run("--since", "20.years", "--top", "2");
    assert.match(out, /clears 0\.5 votes over 3 commits/,
      `the floor was a literal in scan.mjs and appeared nowhere in the output:\n${out}`);
    assert.match(out, /\+4 pairs above that floor, not shown \(--top 2\)/, out);
  } finally { r.clean(); }
});

test("the entangled-group list says how many groups it did not show", () => {
  const r = repo();
  try {
    for (const [a, b] of [["A", "B"], ["C", "D"], ["E", "F"], ["G", "H"]]) {
      csproj(r, a, b); csproj(r, b, a);
      r.file(`${a}/${a.toLowerCase()}.cs`, `class ${a} {}`);
      r.file(`${b}/${b.toLowerCase()}.cs`, `class ${b} {}`);
    }
    const out = r.run("--structure");
    assert.match(out, /4 mutually entangled groups/, out);
    assert.match(out, /\+1 more group\b/, `three groups shown of four:\n${out}`);
  } finally { r.clean(); }
});

test("the structure header says when the budget trimmed the table", () => {
  const r = repo();
  try {
    for (let i = 0; i < 200; i++) r.file(`d${i}/f.go`, "x\n".repeat(i + 1));
    assert.match(r.run("--structure", "--budget", "300"), /every source-containing directory the budget admits, largest first/,
      "the promise was printed above a table that had already dropped most of the tree");
    const big = r.run("--structure", "--budget", "20000");
    assert.match(big, /structure {3}every source-containing directory, largest first/, big);
    assert.ok(!/the budget admits/.test(big), "nothing was trimmed, so nothing may say it was");
  } finally { r.clean(); }
});

test("a history record that does not parse is counted, not dropped in silence", () => {
  const r = repo(); r.init();
  try {
    r.file("p/ok.go", "x\n"); r.commit("2024-01-01T00:00:00");
    // A path holding the byte this parser separates records on. git emits it
    // raw under core.quotePath=false, so that commit's record arrives in two
    // pieces and the second piece is not a commit.
    r.file(`p/a\u0001b.go`, "x\n"); r.commit("2024-02-01T00:00:00");
    assert.match(r.run("--since", "20.years"), /1 history record did not parse and was skipped/,
      "a parser that skips in silence cannot be told from a repository with nothing there");
  } finally { r.clean(); }
});

test("a manifest the noise rules refuse is counted and disclosed", () => {
  const r = repo();
  try {
    // The two silent drops: a private package.json with no source directory
    // beside it, and a scaffold. The section said "none found" for both, as
    // though the repository declared nothing at all.
    r.file("package.json", '{"private":true,"version":"0.0.0"}');
    r.file("tools/x.js", "export const x = 1;\n");
    r.file("packages/template-vue/package.json", '{"name":"tmpl","version":"1.0.0"}');
    r.file("packages/template-vue/src/main.js", "export const y = 1;\n");
    assert.match(r.run(), /\+2 filtered: 1 declaring no module of its own, 1 on a scaffold or fixture path/,
      "the name-collision drop already disclosed; these two did not");
  } finally { r.clean(); }
});

test("a binary file is not counted as source, and the drop is disclosed", () => {
  const r = repo();
  try {
    r.file("p/real.go", "x\n".repeat(10));
    // Newline bytes inside compiled output are not lines. Counted, this file
    // entered the total, the median and the p90 carrying a line count that is
    // a fact about its encoding and not about any code.
    writeFileSync(join(r.dir, "p", "blob.go"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 10, 10, 10, 10, 10, 0, 10]));
    const out = r.run();
    assert.match(out, /^1 source file, 10 lines/m, `a fabricated line count must not enter the totals:\n${out}`);
    assert.equal(field(line(out, "lines per file"), "median"), 10, "nor the distribution");
    assert.match(out, /1 file with a source extension and no line count \(1 binary\)/, out);
  } finally { r.clean(); }
});

// ── What the page spends on saying nothing ──────────────────────────────────

test("a single-author repository states it once and drops the share column", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 4; i++) r.file(`p${i}/f.go`, "x\n");
    r.commit("2024-01-01T00:00:00", "Ann");
    for (let i = 0; i < 3; i++) { r.file("p0/f.go", `${i}\n`); r.commit(`2024-0${i + 2}-01T00:00:00`, "Ann"); }
    const out = r.run("--since", "20.years", "--structure");
    assert.match(out, /one author holds every source-containing directory's commits/, out);
    assert.ok(!/%\/\d+a/.test(out), `the column was the same two figures on every row:\n${out}`);
    const header = out.split("\n").find((l) => /^ {2}files\b/.test(l));
    assert.ok(header && !/share/.test(header), `and the header may not name a column that is not there: ${header}`);
  } finally { r.clean(); }
});

test("a repository with more than one author keeps the share column", () => {
  const r = repo(); r.init();
  try {
    r.file("p/f.go", "x\n"); r.commit("2024-01-01T00:00:00", "Ann");
    r.file("p/f.go", "1\n"); r.commit("2024-02-01T00:00:00", "Bob");
    const out = r.run("--since", "20.years", "--structure");
    assert.ok(/%\/\d+a/.test(out), `a share that varies is a figure, not noise:\n${out}`);
    assert.ok(!/one author holds every source-containing directory/.test(out), out);
  } finally { r.clean(); }
});

test("the structure header sits over the columns it names", () => {
  const r = repo(); r.init();
  try {
    for (let i = 0; i < 3; i++) r.file(`p${i}/f.go`, "x\n".repeat(1000 * (i + 1)));
    r.commit("2024-01-01T00:00:00", "Ann");
    r.file("p0/f.go", "z\n"); r.commit("2024-02-01T00:00:00", "Bob");
    const lines = r.run("--since", "20.years", "--structure").split("\n");
    const i = lines.findIndex((l) => /^ {2}files\b/.test(l));
    assert.ok(i >= 0, `the structure table must be present:\n${lines.join("\n")}`);
    // A column is a position. Header and cells come from one set of widths, so
    // each name must end where the figure under it ends — the fixed header
    // string named one column while standing over another on every table.
    const ends = (l) => [...l.matchAll(/\S+/g)].map((m) => m.index + m[0].length);
    const head = ends(lines[i]).slice(0, -2);            // every column but "source-containing directory"
    assert.deepEqual(ends(lines[i + 1]).slice(0, head.length), head,
      `header\n${lines[i]}\nrow\n${lines[i + 1]}`);
  } finally { r.clean(); }
});

test("a count of one takes a singular noun", () => {
  const r = repo(); r.init();
  try {
    r.file("p/a.go", "x\n"); r.commit("2024-01-01T00:00:00");
    const out = r.run("--since", "20.years");
    for (const wrong of ["1 source files", "1 lines", "1 directories", "1 commits", "1 days", "1 pairs"]) {
      assert.ok(!out.includes(wrong), `"${wrong}" is a defect the reader corrects on every line carrying it:\n${out}`);
    }
    assert.match(out, /^1 source file, 1 line, 1 source-containing directory, max source-path depth 1$/m, out);
    assert.match(out, /1 commit touching source/, out);
  } finally { r.clean(); }
});

test("a maximum over a large array does not depend on the argument-list ceiling", () => {
  // Called directly: the cliff sits around 120,000 elements, and no fixture
  // this suite builds has a repository that wide. Math.max over a spread is an
  // argument list, and an argument list stops working there.
  const xs = Array.from({ length: 200000 }, (_, i) => i % 977);
  assert.equal(maxOf(xs), 976);
  assert.throws(() => Math.max(0, ...xs), RangeError, "the spread this replaced does not survive the same array");
});

// ── Transitive reach ────────────────────────────────────────────────────────

test("a high-fan-out node says how much of the graph it reaches", () => {
  const r = repo();
  try {
    // A reaches B, C and D directly, and B carries a tail: E, then F. Direct
    // fan-out is three; what a change to A arrives at is five.
    for (const n of ["A", "B", "C", "D", "E", "F"]) r.file(`${n}/${n.toLowerCase()}.cs`, `class ${n} {}`);
    r.file("A/A.csproj", `<Project><ItemGroup>${["B", "C", "D"].map((d) => `<ProjectReference Include="../${d}/${d}.csproj" />`).join("")}</ItemGroup></Project>`);
    csproj(r, "B", "E"); csproj(r, "E", "F");
    csproj(r, "C", null); csproj(r, "D", null); csproj(r, "F", null);
    const out = r.run("--structure");
    const l = line(out, "fan-out   3");
    assert.ok(l, `the fan-out row must be present:\n${out}`);
    assert.match(l, /reaches 5 of 6/, `a reader pricing a split needs the transitive count, not the direct one: ${l}`);
  } finally { r.clean(); }
});

// ── Provenance ──────────────────────────────────────────────────────────────

test("the analyzer names the toolchain that produced the graph", { skip: !hasGo() }, () => {
  const r = repo();
  try {
    r.file("go.mod", "module example.com/m\n\ngo 1.21\n");
    r.file("alpha/a.go", 'package alpha\n\nimport _ "example.com/m/beta"\n');
    r.file("beta/b.go", "package beta\n");
    const l = line(r.run(), "dependencies");
    // Two Go releases do not always resolve one module alike, so a reader
    // checking this figure on their own machine has to see which go answered.
    assert.match(l, /via go list -e -mod=readonly \(go\d+(\.\d+)*\)/, l);
  } finally { r.clean(); }
});

test("every fetch of madge names the version it runs", () => {
  // An unpinned `npx madge` resolves to whatever the cache holds, which makes
  // the graph a fact about the machine rather than about the repository. The
  // pin has to travel with every place that fetches it, or one of them runs a
  // different analyzer and nothing on the page says which.
  // The bare name comes out of the pin rather than being written here: this
  // file is one of the files it reads, and a literal would match itself.
  const [bare] = MADGE.split("@");
  const unpinned = new RegExp(`(?:["']${bare}["']|npx [^\\n]*?\\b${bare}\\b(?!@))`, "g");
  for (const f of ["skills/loadpath/scripts/deps.mjs", "tests/measure.mjs", "tests/loadpath.test.mjs", ".github/workflows/ci.yml"]) {
    // Comments are prose about this very problem — two of these files carry a
    // paragraph naming the unpinned form — so what is read here is the code.
    const src = readFileSync(join(HERE, "..", f), "utf8").replace(/^\s*(?:\/\/|#).*$/gm, "");
    for (const m of src.matchAll(unpinned)) assert.fail(`${f} fetches ${bare} unpinned: ${m[0]}`);
  }
  assert.match(MADGE, /^[a-z-]+@\d+\.\d+\.\d+$/, `the pin must name an exact version, got ${MADGE}`);
});

test("the token bound states the divisor it used, and the divisor is not optimistic", () => {
  const r = repo();
  try {
    for (let i = 0; i < 12; i++) r.file(`d${i}/f.go`, "x\n".repeat(20 + i));
    const res = spawnSync("node", [CLI, r.dir], { encoding: "utf8", env: ENV });
    const m = /≤(\d+) tokens \(upper bound: characters \/ ([\d.]+)/.exec(res.stderr);
    assert.ok(m, `the bound must state the divisor it used: ${res.stderr}`);
    // The bound is the text it was taken over, divided by the divisor it names.
    // console.log adds the newline that is not part of the measured text.
    assert.equal(Number(m[1]), Math.round((res.stdout.length - 1) / Number(m[2])),
      "the number printed must be the arithmetic the line describes");
    // Calibrated with tiktoken against this tool's densest output, which
    // measured 2.66 characters per token for a structure table body. A divisor
    // above that is optimistic on exactly the half --budget trims, and a budget
    // that can be exceeded is not a budget. A general "about 3.6" was 36% out.
    assert.ok(Number(m[2]) <= 2.66, `the divisor must sit under the densest shape it covers, got ${m[2]}`);
  } finally { r.clean(); }
});
