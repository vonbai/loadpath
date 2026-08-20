# Evidence

What each measurement rests on, what was rejected, and what nothing supports. `skills/loadpath/references/canon.md` carries the design canon; this file carries the empirical trail. `docs/research/findings.md` carries the full research record behind both.

Every figure below is recomputed by `tests/measure.mjs` from pinned public commits, or is stated with the corpus it came from.

## Dependency edges

**Method.** No parsing and no guessing. `scripts/deps.mjs` runs the ecosystem's own analyzer, names it in the output, and reports **Not measured** where none applies.

| Ecosystem | Analyzer | Granularity |
|---|---|---|
| Go | `go list -e -mod=readonly -json ./...`, per module | package = directory |
| C# | `.csproj` `<ProjectReference>` | project |
| Python | `grimp` | module directory |
| Node/TS | `madge --extensions --ts-config` | file directory |

**Verified.** On a 1,281-file Go module, `go list` plus iterative Tarjan returns **93 packages, 418 internal edges, 0 strongly connected components** — matching `go list` ground truth exactly, with `git status` byte-identical before and after.

**Why not parse.** Substring matching of directory paths was tried, published, and withdrawn. It measured 94.3% precision at one repository root and **43.5% one directory down**, where short names like `io`, `db` and `work` match ordinary English prose in comments. Recall was worse: on standard TypeScript and Python layouts it returned nothing at all on textbook cycles, because relative imports and dotted package names never contain a repo-relative directory path. On the one Go module it was validated against it reported **fourteen cycles where the compiler makes cycles impossible**.

Per-language import regexes recover recall but cannot resolve aliases, re-exports or dynamic imports. For Python the gap is closable by no parser at all: `from x import y` leaves `y` ambiguous between a module and an attribute, so a parser must emit both — 7,644 edges against grimp's 3,061 on one real corpus. Only the module table settles it.

**Why an analyzer is still not trusted.** The dominant failure mode of the Node tools is silent empty output rather than an error: `madge` returns `{}` without `--extensions`, and `dependency-cruiser` returns `modules: []` against current TypeScript. Every analyzer result therefore passes a sanity check — edges present, and the node count covering a fifth or more of the subtree the analyzer was pointed at — and a failed check reports Not measured, never zero. Measuring coverage against the whole repository rather than against that subtree would reject a correct graph for looking where it was sent.

**One module is not one repository.** `go list ./...` stops at the module it runs in, so a repository holding several `go.mod` files was analysed only at its root: on one real repository that was 290 of 420 packages, reported as a complete graph. Every module is now analysed where it lives and its package paths are rebased onto the repository, so each node is one repo-relative directory. Where a module fails to resolve, the count of modules that did is printed beside the edge count rather than left to be inferred.

**One ecosystem is not one repository.** A tree holding `backend/go.mod` beside `frontend/package.json` printed both declared modules and then, on the same page, `dependencies not measured — no analyzer applies to this repository`. Reproduced on a synthetic tree of that shape, and traced to two independent causes. The analyzer was rooted once, at the common ancestor of every manifest — which for a split tree is the repository root, where neither `go list` nor madge finds a project. And the analyzer list returned the first answer, so where Go and TypeScript sat at the same root the Go graph was returned and every TypeScript edge was silently absent. Each ecosystem is now rooted at the ancestor of its own manifests and reported as its own span, with its own unit; an ecosystem whose analyzer cannot run here is named rather than omitted, which separates "no `go` on PATH" from "not a Go repository". See `docs/adr/0013`.

**A subtree is scoped after measurement, not before.** Scanning a subdirectory of a Go repository fell back to rooting the analyzer at the scanned prefix, where there is no `go.mod`, and reported no analyzer at all for a subtree of a module the same tool measures at the root. Rooting an analyzer at the subtree would also lose the edges the reader is asking about, since every import that crosses into the subtree comes from outside it. The module is measured whole, the coverage check is applied to what the analyzer was pointed at, and the span is then confined to the scope — with the edges crossing the scope line counted in each direction and their busiest counterparts named, rather than dropped in silence.

**Read-only is not automatic.** Three analyzers in this space mutate state as a side effect: `cargo metadata` writes `Cargo.lock` and reaches the registry, `GOFLAGS=-mod=mod` rewrites `go.mod` and reaches the network, `dotnet package list` auto-restores on .NET 10+. `-mod=readonly` is passed explicitly, and so is `GOPROXY=off`: without it a scan of a module with a cold cache downloads its whole dependency tree, which is not what a read does. A vendored module still resolves every internal edge offline; one that is not vendored resolves none, and that is reported as a cold cache with the command that fixes it rather than as an absence of dependencies.

## Token figures

Every published token count is an **upper bound**, not an estimate — a budget that can be exceeded is not a budget. The divisors were measured with `tiktoken` over this repository's own bytes; `o200k_base` and `cl100k_base` agree to within 1%.

| Shape | Measured | Divisor used |
|---|---|---|
| SKILL.md prose | 4.55 chars/token | 4.4 |
| orient view | 3.81 chars/token | 2.6 |
| structure page | 2.96 chars/token | 2.6 |
| structure table body | 2.66 chars/token | 2.6 |

Two divisors, because prose and a table of paths and numbers do not tokenize alike and a single ratio must be wrong somewhere. The previous single "about 3.6" was **36% optimistic on exactly the output `--budget` trims**: a stated budget of 1,600 emitted about 2,170 real tokens. Measured against a real tokenizer afterwards, `--budget` 400, 800 and 1,600 now yield 391, 753 and 1,468 — under the stated ceiling in every case, and within 8% of it, so the bound is tight rather than merely safe.

## History windows

Git parses `--since 1y` as a **date, not a duration**. It resolves to about nineteen days ago; `6mo` to fourteen; `30d` to a day-of-month, which on most days is in the *future*, so the window holds nothing. All three exit 0. Compact spellings are normalised to the dotted form git reads as a duration, the rewrite is printed beside the window it produced, and a unit that is genuinely ambiguous — a bare `3m`, months to some readers and minutes to others — is refused with both spellings named rather than guessed at.

## Graph structure

**Components, not cycles.** Enumerating cycles of length two and three had a **56% false-negative rate on cycle membership** on a real graph, and the miss rate rose with tangle size — degrading exactly where it matters. Length two and three are not a category; they are an artifact of how many loops were typed. Tarjan is O(V+E) and reports the set: *these N directories are one module wearing N names.* The iterative formulation is required — recursive Tarjan raises at around 1,500 nodes, and real repositories exceed that.

**Layer depth is free.** Steward's design-structure-matrix partitioning is exactly SCC condensation followed by a topological order, so the layer count comes out of the same pass. It answers what a cycle list cannot: how far weight travels before it reaches something that depends on nothing.

## Co-change

Four arXiv papers, read in isolation, decided its shape.

**Grade evidence per event; never count it.** *Many-Objective Software Remodularization using NSGA-III* (arXiv:2005.06510v1) sums per-event weights so irrelevant history contributes exactly zero rather than diluting a score. `scan.mjs` applies the same shape: each commit casts one vote split across the pairs it implies, so a wide commit cannot mint a dense clique, and an all-additions commit is damped further as creation rather than coupling.

**Normalise, then read the rate of change.** *Understanding Architecture Erosion* (arXiv:2103.11392v1) reports practitioners tracking smell *density* across releases rather than absolute counts, because code size shifts underneath the comparison. Weighted votes are bucketed into time windows for the same reason, and the window count is printed as the parameter it is.

**Cap the breadth, and say so.** At breadth 100 a pair's share of one vote is 2×10⁻⁴, so 2,475 such commits would be needed to reach the reporting floor. Capping at 30 preserved a top-15 ranking exactly while cutting a third of the pair operations. The excluded count is disclosed: they are sweeps, not coupling.

**An average alone is not reportable.** On identical predictions a model reached an expected calibration error of 2–3% — which looks excellent — while its maximum hit 99–100%, because opposing regions cancel in the mean. Each pair therefore carries its per-window profile, which is the spread, and the denominator its share is taken over.

### Rejected after reading

**Commit message text as a signal.** arXiv:2212.12168v2 proposes matching a violation vocabulary against commit messages. Declined on two independent grounds: arXiv:2103.11392v1 dropped GitHub as a data source because under 0.1% of Issue and Commit hits were erosion-related, so erosion is essentially never *named* in history; and the proposing paper's corpus is code review prose with roughly 97% false positives on raw keyword matching before human labelling.

**A single composite score.** Scoring many objectives at once produces a large set of mutually equivalent answers with no principled way to choose among them, and refactoring can make established metrics look worse. Two independent axes that agree is evidence; several averaged is noise.

**Community detection.** Twenty Louvain seeds produced twenty distinct partitions with modularity spread across 0.233–0.262, and the resolution limit — roughly √(2m), which was 30.7 edges on the measured graph — sits an order of magnitude above the three-edge module this tool reasons about. See `docs/adr/0007`.

## Commit-share concentration

In a defect model over 25 releases of 7 systems against 59 confounders and 54 static product metrics, the top author's share of commits to a file took the **first** importance rank group and the count of authors above a 5% share the second — above every static size and complexity metric. Blame-derived line ownership ranked sixth and was explicitly called weakly associated, which together with its cost (3.4 s per 200 files) rules `git blame` out twice over.

The raw commit count is that metric's ingredient, not the metric. Both are printed, because the ratio is undefined exactly where activity is absent.

## The caveat that outranks every measurement

A large share of architecture erosion causes are non-technical — turnover, knowledge vaporisation, schedule pressure, communication failure. These leave a fingerprint indistinguishable from genuine design coupling while implying that no boundary should move.

No score licenses a refactor. It licenses a question.

## What nothing supports

- **No source validates that directory-level co-change tracks erosion.** The practitioner study explicitly declines the causal claim. Co-change stays on the Common Closure Principle — a design argument, not a predictive one — and the output says so in those words.
- **Test-file counts were evaluated by no retained paper** as a predictor of anything.
- **No retained paper evaluates name scatter as a predictor** of defects, erosion or anything else. A token recurring across directories is a Parnas and Common Closure heuristic — it asks whether one subject has been spread across several places, or a role word put where a subject name belongs — and it is emitted as that question. Its constants are convention like every other constant here, and are listed with them below rather than a second time in this line.
- **Every retained result is per-file or per-commit.** Nothing licenses aggregating them to a directory, which is the unit this tool emits. Directory rollups inherit no authority from this evidence.
- **No source supplies a threshold, a precision figure, or a window length.** Every constant that shapes a measurement here is tunable convention rather than a principled value. This is the register of them, and each is listed with the file that spends it, because a constant whose home nobody can name is a constant nobody tunes. The numbers are not restated in another document.

  **`loadpath.mjs`, where the command line is read.** `--since` defaults to `12.months`; `--budget` to 1600 tokens with a floor of 200; `--windows` to 4, clamped to the range 2 to 12; the breadth cap to 30, with a floor of 2; `--top` to 12 pairs. A value outside a bound is moved to the bound and the move is printed on stderr, so the number that ran is never quietly a different number from the one typed.

  **`scan.mjs`, where the exact half is measured.** A pair of directories becomes a relocation at 3 files moved. A test-path convention wins on `max(3, 20%)` of the leading vote, so a second convention has to be real before it is named. The activity horizon is `min(90 days, the window)`: ninety is the convention, and a window shorter than that cannot be asked a ninety-day question, so the line prints the number of days it actually reached back. An all-additions commit's vote is damped to 0.15, because creation is not coupling. A co-change pair is printed once it clears 0.5 votes over 3 commits of whichever directory moved less often. A name token counts as scattered at 3 directories, the widest 3 are printed, and role words are refused by a stoplist. An author holding 5% of a directory's commits counts as a major author. The token bounds are 2.6 characters per token for tool output and 4.4 for prose, measured as above. The manifest walk descends 3 directories below the root.

  **`report.mjs`, where the page is cut to size.** The L0 caps are 5 languages, 2 test conventions, 5 largest directories, 8 relocations, 3 entangled groups and 3 fan-out rows, and a node reaches that last list at 3 or more outward edges with 1 or fewer inward. A comparison names 5 members of a group that formed or dissolved, and reports a directory whose mass moved by more than a fifth. The commit-share column is dropped where every directory's top author holds every one of its commits. Every one of these states what it dropped; the rule is in `DESIGN.md`.

  **`deps.mjs`, where the graph is traversed.** Transitive reach is computed below 20,000 components and reported as not measured above it, because past that the closure costs more than the answer. The 5 busiest counterpart directories are named beside a crossings count. The Go module walk descends 4 directories below the root and the `.csproj` walk 12.

  Two thresholds here are borrowed rather than invented, and both are named where they are used: git's 8,000-byte binary sniff in `scan.mjs`, and the analyzer coverage gate described above under *Why an analyzer is still not trusted*. Operational limits — subprocess timeouts, `maxBuffer` ceilings — are not measurement constants at all: they bound what a call may cost rather than what a figure means, and they live at their call sites.
- **No retained paper measured whether any presentation reduces over-trust** in a reader. The presentation rules here rest on evidence about what figures hide, not on measured reader behaviour.
- **No study establishes that a table is read more reliably than JSON.** The token cost is measured — JSON runs about 2× a table for the same content — and the comprehension advantage is reasoning from mechanism, stated as such.

## Known limits

Where this measures less than the page suggests, with what each one would take to close. A limit nobody wrote down is a limit that gets rediscovered as a defect.

**A shared root dilutes the coverage gate.** A span is believed only if its analyzer covered a fifth or more of the source directories in the scope it was pointed at. madge is pointed at a source directory and a src-layout Python package at its own package root, so those denominators are theirs alone. `go list` and the `.csproj` reader are pointed at the ancestor of their own manifests, and where two ecosystems declare themselves at one repository root that ancestor is the root — so the denominator becomes every source directory in the tree, the other ecosystem's included. A Go module sharing a root with a large TypeScript tree is then judged on a denominator most of which no Go analyzer was ever going to reach, and a correct graph can be refused for it. Split trees measure cleanly, since each span is rooted at the ancestor of its own manifests: `backend/go.mod` beside `frontend/package.json` gives each of them its own subtree to be judged on. Closing it means counting the directories that could belong to the ecosystem rather than every directory in scope, and it is unmeasured here because no corpus of that shape is pinned.

**The scaffold filter reads one spelling per rule.** The manifest path filter refuses a `template/` or `templates/` path *segment*, and separately a segment beginning `template-`, `template_` or `template.`. The first does not match `template-vanilla`, which is how vite spells sixteen of them; the second was added for that case and its count is in `docs/research/findings.md`. The bound on growth is the principle recorded there: a scaffold spelling enters the filter when a real repository demonstrates it and the demonstration is recorded with its count, never in anticipation. `starter-` and `example-` are out for exactly that reason.

**`SOURCE_EXT` is deferred, with a criterion.** Shell, SQL, protobuf, Terraform and their neighbours are not counted as source, so a repository whose load-bearing code lives in them measures as smaller than it is, and its directories carry no lines. The criterion for admitting a type is that load-bearing code is written in it, not that the extension exists — and the population changes one type per release, so a baseline that moves afterwards has one cause to look for rather than several.

**Five mutants are not exercised, and the list prints on every run.** `tests/mutate.mjs` cannot kill these on an ordinary developer machine, and the count is published as a list rather than folded into a coverage number:

- `-mod=readonly` dropped from `go list` — readonly is already the default in a module with a complete `go.mod`; the difference shows only where `GOFLAGS=-mod=mod` is set in the environment, which the suite will not set on a contributor's machine.
- `GOPROXY=off` turned back to `direct` — asserting a negative about the network needs an isolated machine; on a warm cache both settings resolve identically.
- madge losing `--extensions` — needs a warm npx cache. This is the exact silent-empty-output failure the sanity gate exists for, and the gate itself is covered.
- madge losing `--ts-config` — needs a warm npx cache and a repository with path aliases.
- the Python analyzer looking only at the repository root — needs grimp installed, and the suite does not `pip install`.

Two of the five guard the read-only law, which is why it is stated in `DESIGN.md` and asserted by two acceptance tests rather than left to the mutation count.

**A walk with a depth bound is a truncation, and one of the two still says nothing.** Two analyzers bound their own search. The `.csproj` walk stops 12 directories below where it was rooted and returns the directories it refused as data, which the span renders on a line of its own — it had gathered that count and dropped it on the floor for as long as the bound had existed, which made it the one truncation in the tool that stated nothing. The Go module walk stops 4 directories down and counts nothing at all, so a `go.mod` nested deeper than that leaves the span quietly short: the same shape, still open, and closable the same way.
