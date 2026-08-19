# Design

The root principles this skill is built to. They are the acceptance criteria for any change, and they came from watching v0.1.0 fail against them.

## What this skill is for

An agent building software drifts. Directories accumulate without a subject, dependencies acquire directions nobody chose, and a structure that once expressed a design stops expressing it. The cost lands later, on maintenance and on migration, when the tree has to be understood by someone who was not there.

This skill is **auxiliary to that work**: it keeps architecture, directory structure, file structure, and dependency relationships legible while the agent builds, so the codebase stays maintainable and migratable. It is not a report generator, not a knowledge map, and not an architecture authority.

## The root principle: the agent reads the code

**A probe never drives. The agent reads the real code and verifies.**

Measurement widens recall — it points at places worth reading, and it computes what eyes cannot, which is history. It does not produce findings. A finding exists only after the agent has read the code the measurement pointed at and confirmed what is there.

v0.1.0 inverted this and the failure was total: it reported six dependency cycles in a Go module, which the compiler makes impossible, and named a hub of a tangle that does not exist. Every one was a substring artifact. A reader trusting the probe would have restructured around a fiction.

Three rules follow, and they are not negotiable:

- **Every emitted signal is a lead, and the report must say so in the words it uses.** No signal is phrased as a conclusion.
- **Confidence is reported per signal, not per tool.** Counting files is exact. Reading git history is exact. Guessing at imports is not, and the three must never share a voice.
- **Where the tool cannot measure, it says "not measured" and never a number that reads as clean.** A silent zero is worse than an admitted gap, because the agent stops looking.

## Product requirements

**Single source of truth.** Each fact has one home. The vocabulary lives in one place, each rule's evidence lives in one place, and no claim is restated in a second file where the two can drift apart. v0.1.0 shipped the same sentence in four files; when the underlying claim turned out to be false, it was false in four places.

**Single user journey.** One way in and one way through: *notice something → measure to widen recall → read the code → decide*. Not a menu of modes, not a second entry point for the same question.

**Deep module.** A lot of behaviour behind a small interface. The skill's surface is its description plus one script invocation; everything else — the canon, the language conventions, the evidence — sits behind pointers and loads only when reached.

**Narrow seam.** The seam between this skill and its neighbours is one sentence wide: where a seam falls on disk is this skill; what sits behind it is `codebase-design`; what a published interface promises is `api-and-interface-design`. That sentence lives where the agent will read it, not in a file that ships nowhere.

## Constraints that decide implementation

- **Enforcement is language-specific even when reasoning is not.** Route to `dependency-cruiser`, `import-linter`, `go-arch-lint`, `ArchUnit`. Reimplementing them in a heuristic is strictly worse.
- **Performance is not the constraint.** A full scan of a 1281-file repository runs in 136 ms; ripgrep would make it 26 ms. Nothing may be added for speed. A dependency must buy *accuracy* or it does not enter.
- **A claim ships with its reproduction or it does not ship.** v0.1.0's headline precision figure was measured on a private repository at an unrecorded commit with a harness that exists nowhere — and it described code that had since changed. Either the corpus is public and pinned and the harness is in the repo, or the number states its own unreproducibility.
- **The test suite must kill feature deletions.** v0.1.0's suite let 14 of 20 one-line feature deletions pass, including the line that broke its own recall claim. Mutation survival is a release blocker, not a metric.

## What this skill does not do

It does not invent an architecture. Where a project records its own module model, vocabulary, or laws, that record is the authority and the work is making the tree express it.

It does not enforce rules. It has no rule format and no gate.

It does not turn a score into a verdict. Non-technical causes — turnover, schedule pressure, lost knowledge — leave fingerprints identical to genuine design problems. A signal licenses a question and never a boundary move.

## Module design

Four modules, three seams. The arrangement exists to contain one specific failure: in v0.1.0 an inexact measurement discredited the exact ones, because nothing separated them.

**Inventory** — walks the filesystem and returns exact per-file facts. Hides the walk, skip rules, extension classification, line and byte counting, test-file recognition, and encoding failures. One implementation, so no adapter interface: a function, not a seam.

**History** — reads git and returns exact per-path commit facts and co-change. Hides git invocation, NUL-safe parsing, quote-escaped and non-ASCII paths, object-format width, shallow-clone detection, window bucketing, and vote weighting. `unavailable` is a first-class return value, never a printed sentence.

**Dependencies** — the only module permitted to be inexact. Hides which external analyzer to try, how to parse it, and how to label provenance. Returns `NotMeasured` rather than a number when no analyzer applies.

**Report** — renders facts at a requested depth. Hides formatting, alignment, truncation, and the token budget. No other module prints.

### The seams

**Measure ↔ render.** Nothing computes and prints in the same place. v0.1.0 violated this throughout, which is why its truncation was silent and why one claim came to live in four files.

**Exact ↔ inferred.** Inventory and History are exact by construction; Dependencies is the quarantine. When it returns `NotMeasured`, nothing else is affected. An agent must be able to tell a number's trustworthiness from *which module produced it*, not from a disclaimer in prose.

**Filesystem ↔ git.** Two independent sources, neither silently substituting for the other. Every module speaks repo-root-relative paths; that is an invariant of the common layer. v0.1.0 left this boundary unowned, so its two projections used different path namespaces and its own instruction to read them side by side could not be followed.

### Structure expresses it

Two files. `scripts/scan.py` holds Inventory, History, Report, and the CLI — everything exact. `scripts/deps.py` holds the quarantine — everything inexact.

The file boundary *is* the exact/inferred seam, visible from a directory listing without reading code. A single file would leave the modules as function groupings, which is a shallow expression of the design; five files would be structure created ahead of a second caller, which this skill's own placement rule forbids.

### Facts, not verdicts

The tool emits measurements and the agent judges them. v0.1.0's verdicts were wrong three times — its cycles were fabricated, its `rising` label inverted on constant coupling, its god-file threshold was unsourced — while the underlying figures were never wrong. A line count, a commit count, and a per-window profile are facts. "God file", "rising", and "this is a cycle" are judgements, and they belong to the reader.

Progressive disclosure carries this: the default output orients at directory level for roughly 2k tokens on a 1400-file repository, drill-downs are requested by name, and the footer signposts what can be asked next. Withholding a fact is not disclosure; pre-digesting it into a verdict is not either.

## Progressive disclosure, per module

Disclosure is an algorithm, not a flag. Each module discloses in three layers, and the layer boundary is chosen so the agent can decide where to look next without paying for detail it will not read.

| | L0 — orient | L1 — structure | L2 — detail |
|---|---|---|---|
| **Inventory** | robust distribution summary plus deviation ranking, O(F log F) | adaptive tree rollup by greedy top-down budget split, O(V log V) | file level for one named subtree, O(F_subtree) |
| **History** | age, commit count, active/dormant split, O(C) | weighted co-change with breadth cap and time windows, O(Σ min(k,cap)²) | per-directory churn |
| **Dependency** | which analyzer ran, layers deep, entangled group count, NCCD — or Not measured, O(V+E) | DSM layer table with entangled groups and their anchors, O(V+E) | edge list and back edges |

**L0 is the norms and the outliers. L1 is the structure. L2 is the detail.** The L0 algorithm is the same in every module: summarise the distribution, then rank by deviation from it.

### Why the distribution comes first

`cmd/cotx 56f` is uninterpretable alone. `files per directory: median 7, p90 32, max 136` makes every later row readable, and turns `136f` into *19× the median* — which is a fact about the distribution, checkable and exact, not a verdict. One line buys the meaning of every line after it.

Measured: an 18-line L0 costs about 164 tokens on a 1281-file repository and carries the file and line totals, tree depth, language mix, test ratio, both distributions, repository age, the active-versus-dormant split, the modules declared by manifests, and the four directories furthest from the repository's own norms. It also answers which analyzer to run, because the manifest names the ecosystem.

### Why the tree rollup must adapt

A flat directory table does not scale. Measured on a 3154-directory repository it is about 14,000 tokens — the same failure as the per-file table it replaced. The greedy budget split gives each subtree an allowance proportional to its mass and collapses any subtree that cannot afford a line into its parent's `+N more`. Measured at one budget: 141 directories render in 16 lines, 3154 in 31. The summary scales with the repository's shape rather than its size.
