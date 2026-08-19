# Research findings

Everything the v0.2.0 rewrite must apply, and everything it must not build. Measured on this machine unless marked otherwise. Cited papers are standard attributions carried from a research pass whose citation-verification agents did not return — spot-check before quoting any of them into `references/canon.md`, which holds a higher provenance bar.

---

## 1. Dependency edges: native analyzers only

A developer working in language X has language X's toolchain. Toolchain availability correlates with repository language almost perfectly, so a native analyzer is the normal case, not a lucky one.

### Per ecosystem

| Ecosystem | Command | Granularity | Gate |
|---|---|---|---|
| **Go** | `go list -e -mod=readonly -json ./...` | package = **directory** | `which go` |
| **Python** | `grimp` | file | package importable, no syntax errors |
| **Node/TS** | `madge --json --extensions ts --ts-config ./tsconfig.json` | file | warm npx cache |
| **C/C++** | `clang -MM -MG` with no `-I` | file | `clang --version` |
| **C#** | `.csproj` `<ProjectReference>` XML | project | **none** |
| Java, Rust, Ruby, PHP | — | — | **Not measured** |

**Go is the best case and it is exact for this tool.** `Imports` is the union across a package's `GoFiles`, so it is package-level — and in Go one directory is one package, which is precisely the granularity here. Measured 0.245 s for 93 packages. With an emptied module cache and `GOPROXY=off` it still emitted every internal edge in 0.21 s (80/93 flagged `Incomplete`, `Deps` degraded, internal edges intact). It survives a syntax error in a function body; only a broken import block degrades it. Output is a **concatenated JSON stream, not an array**.

Verified end to end: `go list` plus iterative Tarjan on the cotx repository returns **93 packages, 418 internal edges, 0 strongly connected components** — matching ground truth exactly, where the substring method fabricated 14 cycles. `git status` was byte-identical before and after.

**Python needs grimp, not stdlib `ast`, and the reason is semantic.** grimp is Rust-backed, installs in 3.8 s, and ran Django's 883 files in 0.036 s against `ast`'s 0.536 s. But the decisive number is correctness: on Django, `ast` emitted **7,644** internal edges against grimp's **3,061**, because `from django.db import models` is ambiguous — `models` may be a module or an attribute, and a parser cannot tell, so it must emit both. grimp knows which modules exist. **No regex and no parser can fix this; it needs the module table.** Sharp edge: one unparseable `.py` anywhere raises `SourceSyntaxError` and kills the whole graph, with no skip flag. Takes a module name, not a path. Call grimp directly — `import-linter` is a contract linter built on it, not a graph dumper.

**C# is free.** `<ProjectReference>` in `.csproj` XML is regex-grade effort for exact project-level edges with no toolchain at all.

**Java is a different cost class.** `jdeps` reads `.class`, a directory, a JAR, or a class name — never `.java`. So Java requires a successful `mvn`/`gradle` build. Output is DOT, never JSON. **Operational trap: macOS ships `/usr/bin/jdeps` and `/usr/bin/javac` as stubs with no JDK installed**, so `which jdeps` succeeds. Probe with `jdeps --version` and check the exit code.

**Rust has no cheap path.** `cargo metadata` is crate-level; `targets[].src_path` names only the crate root and knows nothing of `src/foo/inner.rs`. `cargo-modules` gives real module edges and works despite type errors, but costs 1m12s wall to install and is DOT-only.

**C/C++: `-MG` is the flag that makes it cheap.** `clang -MM` alone is a flat transitive closure for one translation unit, not edges. `clang -MM -MG` with no `-I` emits the as-written specifiers unresolved and survives a body syntax error. The real precondition is `-D`, not `-I`: `#ifdef FEATURE_X / #include "featurex.h"` is silently skipped without `-DFEATURE_X`. Do not design around `compile_commands.json` — zero were found on this machine.

### Two operational rules

**Three "read-only" tools mutate state.** `cargo metadata` writes `Cargo.lock` and hits the registry index. `GOFLAGS=-mod=mod` **rewrites `go.mod`, creates `go.sum`, and hits the network** (measured). `dotnet package list` auto-restores on .NET 10+. Always pass `--frozen` / `-mod=readonly` / `--no-restore`, and assert the working tree is unchanged after any analyzer run.

**The dominant Node failure mode is silent empty output, not an error.** `dependency-cruiser` declares `typescript >=2.0.0 <7.0.0` while npm `latest` is 7.0.2, so installing current TypeScript makes it report typescript not-found and **silently return `modules: []`**; it also crashed with `Invalid string length` on a densely cyclic 1500-file corpus. madge without `--extensions ts` returns `{}`; without `--ts-config` it misses aliases; webpack aliases fail silently in every configuration tried. madge's last publish is 2024-08-05.

**Therefore: calling a real tool is not the same as trusting it.** Every analyzer invocation needs a sanity assertion — edges > 0, node count ≈ file count — and a failed assertion reports **Not measured**, never zero.

---

## 2. Graph algorithms

### Cycles: iterative Tarjan SCC, not enumeration

Enumerating 2- and 3-cycles has a **56% false-negative rate on cycle membership** on the target repository — 18 of 32 entangled directories silently absent — and the miss rate rises with tangle size, degrading exactly where it matters. Length 2 and 3 are not a category; they are an artifact of how many loops were typed. Of 626 elementary circuits in one tangle, the enumeration reports 9.

Tarjan is O(V+E), measured 0.07 ms on the target and 0.020 s at V=20,000/E=100,000, in **23 non-blank lines**. **Use the iterative formulation**: recursive Tarjan survives a 900-node chain and raises `RecursionError` at 1500.

Output shape is the real gain. "These 27 directories are one module wearing 27 names" is checkable; "here are 12 triangles" invites whack-a-mole on edges that will not dissolve the blob.

*(Caveat: the 27-directory SCC above was computed on the substring-derived graph. On `go list` ground truth the same repository has zero SCCs. The algorithmic comparison stands; that particular finding was an artifact — which is itself the argument for native analyzers.)*

### DSM layering: free once Tarjan exists

Steward's design-structure-matrix partitioning **is** SCC condensation followed by a topological sort — the blocks that cannot be triangularised are exactly the non-trivial SCCs. **7 lines** on top of Tarjan, O(V+E), measured 0.52 ms.

```
Load path is 8 layers deep over 63 independent blocks.
  layer 2: 1 block, 27 dirs   <-- CYCLIC
```

Four things a cycle list cannot say: how **deep** the load path is; **where** in it each tangle sits (near the foundation is far worse news than near the top); that the **majority is clean**; and it is deterministic. Use `graphlib.TopologicalSorter` on the condensation, where it cannot raise.

### Feedback arc set: ship the set, never call it minimal

Eades–Lin–Smyth greedy, linear time, 22 lines, 0.21 ms. Scoped per SCC it returned 6 edges against the global run's 8 — scoping is strictly better and free. Removing them makes the graph acyclic, verified.

But an exhaustive search found **no set of size ≤4 and a valid set of size 5** — and the size-5 solution **cuts different edges**. Two valid answers, no principled way to choose. Stability was fine (40 shuffled runs gave the identical set); optimality was not. Label it: *a sufficient set, not the minimum, and not a recommendation.* FAS is NP-complete and APX-hard.

### Do not build

**Community detection.** Measured on the target: 20 Louvain seeds produced **20 distinct partitions**, community counts 4–7, modularity 0.233–0.262 — mutually contradictory answers, all near-equally optimal, with 13–23% of directory pairs classified differently run to run. Label propagation collapsed to one 92-directory community, Q = 0.000, on every seed. And the resolution limit is fatal regardless of algorithm: modularity cannot resolve communities below ~√(2m) internal edges, which is **30.7** here, while a 3-directory module has ~3 — **an order of magnitude below the detection floor**. Leiden fixes connectivity, not degeneracy or resolution. Girvan–Newman is O(m²n); spectral needs an eigendecomposition and numpy.

**Johnson's elementary circuits.** Fast enough (626 circuits in <10 ms) and unprintable. A complete digraph on 27 nodes has ~10²⁷ circuits, and nothing bounds the count. 626 lines of circuit listing reads as 626 problems when it is one.

**Apriori / FP-growth.** At k=2 both reduce to pair counting, which the tool already does. Pushed to k=5 on real history: **150,669 patterns in 64 s** versus 1,594 pairs in 0.5 ms, and downward-closure pruning did nothing because the data is dense at low support.

### Cheap metrics

**Ca / Ce / I** — 2 lines, O(V+E). **Print all three together**: I is a ratio of raw counts, so `Ce=1, Ca=0` scores 1.00 identically to `Ce=71, Ca=0`.

**Abstractness A and distance D cannot be computed** — A needs a parser to know what an abstract type is, so the whole main-sequence apparatus is out of reach. Fabricating A would break the rule that an unmeasured thing must never read as measured.

**Lakos NCCD** — one honest number, O(V·E), 15 lines. CCD is the sum over components of the size of each one's transitive closure including itself; the balanced-binary-tree denominator is CCD_tree(N) = (N+1)·log₂(N+1) − N, verified exact for perfect trees h=1..15. Its value is that it can be **re-measured after a change** to confirm the change helped.

**Connascence** is qualitative — no published distance metric. The computable half measures tree shape, not coupling: 68% of edges sat at distance 2 simply because the tree is flat. Skip.

---

## 3. Co-change

**Breadth cap ~30, and it is a correctness argument.** With one-commit-one-vote weighting, a pair's take from a commit of breadth k is 2/(k(k−1)):

| k | per-pair vote | commits needed to cross the 0.5 threshold |
|---|---|---|
| 10 | 2.2e-2 | 22 |
| 30 | 2.3e-3 | 217 |
| 100 | 2.0e-4 | **2,475** |
| 1000 | 2.0e-6 | **249,750** |

A breadth-100 commit spends work quadratic in 100 to deliver a vote that **provably cannot influence the output**. Measured: capping at 30 preserves the top-15 ranking *exactly* while cutting 33% of pair operations; only below k=10 does ranking shift. **Disclose the count** — "N commits wider than 30 directories excluded as sweeps".

The pathological case is not one wide commit but many: 20,000 commits × 100 directories ≈ 10⁸ pair-ops. Formatter runs, licence sweeps, generated re-emits and vendored drops all produce exactly that.

**Data structures: the naive choice wins.** Measured at 10⁶ entries — `Counter[(str,str)]` bulk-constructed took 0.043 s / 41.9 MB; an index map with packed integer keys took 0.686 s / 73.0 MB. String keys are shared references so a tuple key costs 56 bytes, and the index map adds a dict lookup plus int boxing per operation. **Do not index-map.** Bulk construction via `Counter(combinations(sorted(dirs), 2))` hits CPython's C-level fast path for ~2× free.

*(These are Python measurements. ADR 0004 selects Node, so re-measure before assuming the same shape in JS `Map`.)*

---

## 4. Parsing and git correctness

**`graphlib.TopologicalSorter` reports exactly one cycle and stops.** On a graph with three independent 2-cycles it names one. Strictly less informative than Tarjan at identical cost. Use it only for layering the condensation.

**Peeling sources and sinks does not find the cyclic core** — it left 73 nodes where the truth was 32, because a node on a path between two cycles survives peeling.

**Git parsing must be NUL-safe.** Git C-quotes any path containing non-ASCII, a quote, a backslash, a tab or a newline, so `"结算.go"` parses its extension as `.go"` and the file is dropped — silently. Use `-z`, or `-c core.quotePath=false`. This project ships a bilingual README; CJK paths are in scope.

**Object-format width is not 40.** A SHA-256 repository yields 64-character OIDs; a hardcoded `{40}` drops every commit and reports the repository as having no history.

**Shallow clones fabricate statistics.** `--depth 1` showed every file as added, turning a repository with 0% wide commits into one reading 100%. Check `git rev-parse --is-shallow-repository` and print a truncation warning instead of numbers.

**Unparseable `--since` values silently zero everything.** Git resolves a bad date to *now* and exits 0, so `--since 1y` — a natural thing to type — reports a 16-commit repository as empty. Validate the value.

**Test-file recognition must take a path, not a basename.** `"/test" in path` can never fire when the caller passes a bare filename, and `^tests?$` can never match a name that carried a source extension. `FooTest.java`, `FooTests.cs`, `FooSpec.scala`, `conftest.py` and `__tests__/setup.ts` are all classified as implementation. Excluding tests is the single change that moved substring precision from 68% to 94%, and it only worked for Go naming.

---

## 5. Facts that need no parsing at all

**Manifests declare module boundaries exactly, for free.** `go.mod`, `package.json` workspaces, `Cargo.toml` members, `pom.xml` modules, `.csproj` `<ProjectReference>`, Bazel `BUILD` visibility. These are *declared*, not inferred — a first-class exact fact, and reading them also tells the tool which analyzer to run.

**Cache invalidation is a one-line rule.** GitNexus compares the indexed `lastCommit` against `HEAD`. Key the cache on git state, and a repeat run is instant while two runs diff into "what did this change make worse" — which is the delta report, obtained for free once the cache exists.

**Tree-sitter is not lightweight to maintain.** GitNexus vendors grammars and runs **three dedicated CI workflows** just to build prebuilds and monitor grammar versions, with a per-language call-extractor config for each of 12 languages. That is the maintenance cost of the parse-everything route, and it is the reason this tool does not take it.

---

## 6. Budgets, measured

| | |
|---|---|
| Full scan, 1281-file repository | **136 ms** |
| Walk + line count, 1454 files | node 0.08 s / python 0.07 s |
| ripgrep vs Python for the same scan | 26 ms vs 75 ms |
| 17,420-file repository, full scan | 2.7 s |

**Performance is not the constraint and never was.** Nothing may be added for speed; a dependency must buy accuracy.

Output token cost, 1454-file repository:

| Format | Lines | Tokens |
|---|---|---|
| Per file | 1454 | ~21,900 |
| Per directory + top 3 files | 595 | ~4,550 |
| **Per directory only** | **141** | **~2,260** |

Directory-level default, file-level on request.
