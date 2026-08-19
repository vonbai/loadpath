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

---

## 7. Additions from the full algorithm report

**DSM layering makes the "backwards edge" signal implementable.** SKILL.md carried a signal it admitted could not fire — "only a project that has declared a direction can have this one." A DSM order is a *derived* direction, so edges running against it are the closest checkable approximation, and unlike a cycle list the claim is falsifiable against a project's stated architecture. The signal moves from unimplementable to computed, for free.

**The per-directory transitive reach table quantifies "load with nothing above it".**

```
depends on 89 of 92 dirs   fan-out 13  fan-in 2   cmd/cotx
depends on 80 of 92 dirs   fan-out 71  fan-in 3   internal/application
depends on 81 of 92 dirs   fan-out 18  fan-in 0   internal/testsupport/packet0001
```

Reaching 80 of 92 directories with fan-in 3 is the orchestrator signal, as a number rather than an impression.

**Do not render an ASCII DSM matrix.** At 92 directories that is a 92×92 grid — unreadable in a terminal and worthless to an agent reading text. The ordered partition with layer numbers is the artifact; the matrix is one way to draw it, and the wrong one here.

**If community detection is ever built anyway, only one form is honest.** Run the optimizer 20× with different seeds and report only the node pairs that land together in ≥95% of runs, labelled *directories that every run groups together* rather than as a partition. It degrades gracefully to "no stable grouping found", which is the correct answer on the graph measured. Roughly 70 lines. Still not recommended — see ADR 0007.

**Two citations want verification before they enter `canon.md`**, which holds a higher provenance bar than this file: the Eades–Lin–Smyth guarantee wording (|FAS| ≤ m/2 − n/6) and Louvain's complexity, which is empirical rather than a proven bound. The research pass's citation-verification agents did not return. Every empirical number in this document is a direct measurement and is reproducible.

**The ELS guarantee is vacuous at this scale.** Its bound on the target was ≤219.7 edges against an actual result of 8 — 36× looser than the answer, so it certifies nothing useful. Ship the set on its measured merit, not on the guarantee.

---

## 8. Other fact modalities

Measured on `cli/cli` (1,356 files, 11,794 commits, 714 authors), `vitejs/vite` (2,797 files, 9,591 commits), and this machine's largest local repository.

**One git pass yields nearly everything.** `git log --no-merges -M --format=... --name-status` over all history costs **0.15–0.32 s** and returns file lists, add/delete/rename status, author and date together. Switching from `--name-only` to `--name-status -M` costs nothing measurable (0.265 s vs 0.256 s) and unlocks three findings below.

**Two traps.** On a blobless partial clone (`--filter=blob:none`) the identical command took **2 m 03 s instead of 0.165 s** — a 700× penalty, because git refetches trees over the network. And `git blame` costs 3.4 s per 200 files, which rules out the entire line-level metric family: survival curves, half-life, burndown.

### Ship

**Directory relocation events.** Aggregating rename records to their highest differing path prefix yields the repository's migration history — vite's `packages → playground` (778 files), `create-app → create-vite`; cli/cli's `command → pkg`, `cmd → pkg`, `internal → pkg`. Free, about **24 tokens for six lines**, and **absent from code-maat, hercules and git-of-theseus** — all three inventories were fetched and checked. A skill about structure and migration that cannot say what this repository has already moved is missing the most on-thesis history fact available.

**Code age distribution per directory — oldest, median, newest.** The triple discriminates three states that a last-touched date cannot: `internal/crypto` with all three equal is a **bulk import** (69 files in one day); `command/` with a newest well behind the repository's is a **dead predecessor**; `api/` spanning 2019→2026 is **long-lived and live**. About 183 tokens for 15 rows. Two caveats measured: it degenerates to noise on a young repository, so emit it conditionally; and it must be intersected with `git ls-files` or it reports directories that no longer exist. Without stitching the rename chain, a directory move resets the apparent age of everything in it.

**Near-duplicate directory pairs by normalised line shingling.** Hash every window of K consecutive normalised non-comment lines, aggregate collisions to directory pairs. 1.2–2.2 s over ~1,000 files, about 127 tokens at K=10.

The decisive result is a redundancy test: the top duplicate pairs have co-change counts of 5–38 and **appear nowhere in the top co-change list** (161, 70, 70, 66…). **Duplication and co-change are orthogonal.** Co-change says what does change together; duplication says what *should* change together and does not — clone drift, which is the dangerous case. It surfaced real architecture: `secret/set ↔ variable/set`, `search/issues ↔ search/prs`, `gpg-key/delete ↔ ssh-key/delete`.

Parameter sensitivity at K=4/6/10 gave 45/18/4 pairs with the top pair stable throughout; **K=10 gives high precision and a tiny output**. Three filters each measurably matter: skip comment lines or licence headers dominate; exclude ancestor/descendant pairs; separate tests from source or test scaffolding swamps everything.

**Generated and vendored classification.** A marker grep over all tracked files takes 0.057 s. github-linguist's `generated.rb` carries **74 heuristics**, the majority pure path patterns — every lockfile, `node_modules`, `Pods/`, `Carthage/Build`, `.idea` — with only a few needing a content peek (`// Code generated ... DO NOT EDIT.`, average line length > 110 for minified). `.gitattributes linguist-generated` is free and exact where declared. **This is not a report line; it is a filter that makes every other fact more accurate, and it should be built first.**

**Test convention inference.** Path-regex voting over `git ls-files` correctly inferred `*_test.go` for cli/cli (362 votes) and `__tests__/` for vite (503 votes). About 15 tokens, and an agent needs it. The per-directory test *ratio* derived from it is unreliable — fixtures inside test directories and out-of-tree e2e testing both distort it.

### Manifests are exact but not automatically meaningful

This corrects the earlier framing. vite's `pnpm-workspace.yaml` globs match **297 of 299 `package.json` files** — not a module boundary but nearly the whole repository, including 20+ `template-*` scaffolds and 100+ playground fixtures. The real architectural modules number **three**.

The filter that works: require `name` present **and** `private` absent (298 → 20), then exclude paths containing `__tests__`, `node_modules`, `playground`, `fixtures` (20 → 3). The same trap appears in Go: cli/cli's only nested `go.mod` is a CodeQL test fixture.

**Ecosystem trap: vite's root `package.json` has no `workspaces` field at all** — it is pnpm-only, so a tool reading only that field misses every pnpm monorepo.

**The gold tier is the six declarations that give exact intra-repo *edges*, not just boundaries**: `.csproj ProjectReference` (~2.5 M public occurrences), `tsconfig references` (~993 k), Cargo path dependencies, Gradle `project(':x')`, Maven modules, Bazel `deps`. Since source-derived edges are quarantined as inexact, this is the one place an exact edge is available for free.

### Presentation format

Measured on identical 5×7 data, chars/4 proxy — treat as ratios:

| CSV | fixed-width | markdown | indented tree | YAML | compact JSON | indented JSON |
|---|---|---|---|---|---|---|
| 83 | 107 | 114 | 116 | 146 | 161 | 201 |

**JSON costs about 2× a table for the same content.** Dense rows are cheap: 15 rows × 5 columns ≈ 183 tokens.

**On what a model actually reads best, the evidence is thin and must not be overclaimed.** The one verified study — arXiv 2411.10541, *Does Prompt Formatting Have Any Impact on LLM Performance?* — shows GPT-3.5-turbo varying by up to **40%** across plain text, Markdown, JSON and YAML, with GPT-4 substantially more stable. That establishes format matters, especially for weaker models. **It does not establish that tables beat JSON**, and no study was found comparing tables against indented trees for hierarchical data. Token cost is measured; comprehension advantage is reasoning from mechanism, and this document should say so.

Worth knowing: **repomix defaults to XML and justifies it by citing Anthropic's prompt-engineering guidance, not by any measurement** — a cited authority now widely repeated as an empirical result.

**Aider's repo map is the transferable prior art**: a 1,024-token budget, PageRank over a file-reference graph to rank inclusions, and a **binary search over content volume to hit the budget within 15%** rather than a hardcoded top-N. Lines truncated at 100 characters to defend against minified code. The binary search is better than the fixed budget split recorded in `DESIGN.md` and should replace it.

### Caching inverts

| operation | cost |
|---|---|
| full history pass | 0.151 s |
| incremental, last 200 commits | 0.012 s |
| content shingle scan | 1.2–2.2 s |
| `git blame`, 200 files | 3.4 s |
| `git ls-files -s \| shasum` | ~0.01 s |

**History facts are too cheap to cache** — recomputing costs less than invalidation complexity. **Content facts need the cache**, keyed per file on the blob OID from `git ls-files -s`, which correctly covers uncommitted work where `HEAD^{tree}` does not.

**No surveyed baseline survives a rename.** dependency-cruiser's known-violations file identifies by (rule, from, to) — path-based. ArchUnit's `FreezingArchRule` stores full violation text and matches with a line-number-stripping matcher, so it survives line movement but not a rename. Semgrep's `--baseline-commit` leaves its matching identity undocumented. Since rename records are free in the pass already being run, **a rename-aware baseline would improve on all three.**

One delta signal falls out of the age fact at no cost: *this change touches a dormant directory*. Tested against 50 commits it fired zero times — a low-noise alarm, which makes it a good delta signal and a poor default line.

### Reject

- **Fix-commit density / SZZ-lite** — measured flat at 5–13% across every top directory; a constant multiple of touch count, adding no ranking information.
- **Bus factor** — the phenomenon is real (arXiv 2412.00313: 89% of 36,000+ projects lost their core team at least once, only 27% recovered), but arXiv 2508.09828 finds the widely adopted degree-based heuristic significantly outperformed. The cheap version is the inaccurate one, and bot commits (4–5%) plus email aliasing (~3%) contaminate it further.
- **Ownership concentration** — top-owner share ranged only 0.11–0.29 and largely tracks directory size. Its one striking outlier was a dead directory the age fact already explains.
- **Line survival, half-life, burndown** — requires blame replay; git-of-theseus concedes it is slow and hercules only claims to be less slow.
- **Per-directory test ratio** — fixtures inside test directories and out-of-tree e2e testing make it unreliable.
- **Encoding, line-ending, BOM and whitespace anomalies** — lint noise, not architecture.
- **Directory depth distributions** — no evidence of decision value.
- **DSM grids as rendered matrices** — quadratic in tokens, unaffordable at any useful size. The ordered partition remains the artifact.
- **JSON as the report format** — about 2× a table with no evidence of better comprehension.
- **RefactoringMiner / RefDiff** — requires AST parsing.

---

## 9. Which measurements have empirical support

A NeuroArxiv Research Run over cs.SE, cs.HC and cs.LG, ten papers retained, five read in isolation, three at full text. It bears directly on which columns L0 should carry — including three that turn out to have none.

**Scope first, or the conclusions will be misapplied.** Every paper here studies *defect prediction*. Loadpath is not a defect predictor and must never imply risk. A finding of "no evidence this predicts defects" therefore does not condemn a measurement whose justification is a design principle; it condemns any wording that implies risk. That distinction governs everything below.

### The one measurement that ranked first

**Commit-share concentration, not commit count.** In a defect model over 25 releases of 7 systems with 59 confounders and 54 static product metrics, `OWN_COMMIT` — the top author's share of commits to a file — took the first ScottKnott ESD rank group and `MAJOR_COMMIT` — the count of authors above a 5% share — the second, above every static size and complexity metric. In local explanation, `OWN_COMMIT` was the single top-supporting metric for a median 97% of correctly predicted defective files.

**The commit count already collected is the raw ingredient, not the metric that won.** The winner is a normalised ratio. The change is small: key the per-window accumulator by `(path, author)` rather than `path`, and emit the top author's share, the count of authors above a stated 5% share, and the count of files with zero commits in that window — beside the raw count, never instead of it.

**Blame-derived line ownership ranked sixth and was explicitly called weakly associated with defect-proneness.** Combined with its 3.4 s per 200 files, `git blame` is ruled out twice over. If blame data ever appears in this tool it is an authorship figure, never a risk figure.

### What the evidence demotes

None of these reached any project's top-3 importance group across six projects: diffusion counts of files and directories touched, distinct-developer counts, developer experience, review-comment counts. And **`AGE` — time since the modified files last changed — reached top-3 in only one project of six**, which caps how much weight a last-touched date should carry. That is a direct correction to the L0 design, which had promoted it.

The one classic repository metric that did reach a top-3 group, in four of six projects, is **`LT`: the number of lines in the modified files *before* the change**. Pre-change file size is the size figure worth surfacing, which supports keeping lines-per-file.

The strongest predictors found anywhere in the evidence are structural, not historical — AST nodes added, maximum depth of added nodes, method count — and they outrank every history metric. Three of the four need a grammar and a per-change diff. Only method count and pre-change method-body size are snapshot-computable, and they are the honest candidates if language-agnosticism is ever relaxed.

### Three columns with no support, stated plainly

- **Co-change pairs received support from no retained paper.** Its nearest relative, unique changes to the modified files, reached no project's top-3. Whether co-change weight predicts anything is unresolved by this evidence. It stays, on the Common Closure Principle — a design argument, not a predictive one — and must be labelled as such.
- **Test-file counts were evaluated by no retained paper** as a predictor of anything.
- **Every retained result is per-file or per-commit. Nothing licenses aggregating any of them to a directory**, which is the unit this tool emits. Directory rollups inherit no support from this evidence and must not borrow its authority.

### The pitfall that governs the dormant column

Between **19% and 67% of files received no commits during a release cycle**, so a window-scoped concentration figure is undefined exactly there — and **0% to 18% of those untouched files still carried a post-release defect**.

> Silence in the history reads as safety, and it is not.

Any dormant-directory count must be worded so a reader cannot draw the opposite conclusion.

### Presentation: an average can be flattering and wrong at once

Measured, on identical predictions: a model reached **ECE 2–3%, which looks excellent, while its MCE hit 99–100%**, because overconfident and underconfident regions cancel in the mean. Separately, a logistic regression on added lines alone scored **AUC 0.75 with recall 0.078** — a raw size count producing a plausible ranking while detecting almost nothing.

Three constraints follow for every aggregate this tool prints:

1. **Emit the spread and the worst case beside the average.** For the time-window profile that means the min–max across windows, not just the weighted total.
2. **State the bucketing as a parameter.** On identical data, 50 bins produced systematically higher miscalibration than 15, and equal-width bins higher than adaptive. A window count is a parameter, and an undisclosed parameter is a hidden assumption.
3. **Flag when mass concentrates in one bucket.** That concentration is the signal; the mean over it is not.

A fourth guards against self-deception: **compute every measurement as-of the point of use.** Training on data unavailable at that point collapsed one model's reported F-measure by 38.5% and 45.7% once removed — hindsight inflates apparent signal.

And a caution about repair: post-hoc correction can fix the number and break the decision. Platt scaling cut one model's ECE from 35% to 2–3% while compressing its probabilities below the decision threshold, so almost nothing would have been flagged.

### Open threads this run did not close

No retained paper measured whether any presentation actually reduces over-trust in a reader, human or agent. The presentation half rests on design argument and on evidence about what figures hide, not on measured reader behaviour — and that is partly a search-plan limitation, since `trust calibration` in cs.HC returned autonomous-vehicle work rather than developer-tool research. A second run targeting static-analysis warning actionability, overreliance, and cognitive forcing functions would be the honest way to close it.

The 5% major-contributor threshold is inherited from earlier work rather than derived, and no retained paper tested its sensitivity.
