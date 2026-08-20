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

- **Analysis is language-specific even when reasoning is not.** Route to the ecosystem's own analyzer — `go list`, `grimp`, `madge`, `.csproj` XML — and reimplement none of them. Enforcement tools such as `go-arch-lint` and `ArchUnit` are where a project takes a rule it wants checked; this skill has no rule format and does not call them.
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

**Dependencies** — the only module permitted to be inexact. Hides which external analyzer to try, **where to root it**, how to parse it, and how to label provenance. Returns one **span** per declared ecosystem — that ecosystem's own graph, measured by its own analyzer at the common ancestor of its own manifests — and a named absence rather than a number wherever a graph cannot be had. Spans are never merged: `go list` counts packages and madge counts file directories, so their sum has no unit. The entry point no longer chooses a root, because one root for the whole repository is what made a Go backend beside a Node frontend report that no analyzer applied to either. See `docs/adr/0013`.

**Report** — renders facts at a requested depth. Hides formatting, alignment, truncation, and the token budget. No other module prints — including the quarantine, which returns a reason as data and never the sentence a reader sees. `tests/loadpath.test.mjs` holds it to that: `deps.mjs` may not contain a padding or logging call.

### The seams

**Measure ↔ render.** Nothing computes and prints in the same place. v0.1.0 violated this throughout, which is why its truncation was silent and why one claim came to live in four files.

**Exact ↔ inferred.** Inventory and History are exact by construction; Dependencies is the quarantine. When it returns `NotMeasured`, nothing else is affected. An agent must be able to tell a number's trustworthiness from *which module produced it*, not from a disclaimer in prose.

**Filesystem ↔ git.** Two independent sources, neither silently substituting for the other. Every module speaks repo-root-relative paths; that is an invariant of the common layer. v0.1.0 left this boundary unowned, so its two projections used different path namespaces and its own instruction to read them side by side could not be followed.

### Structure expresses it

`scripts/scan.mjs` holds Inventory and History, `scripts/report.mjs` holds Report, `scripts/loadpath.mjs` is the entry point — everything exact. `scripts/deps.mjs` holds the quarantine — everything inexact.

Two measurement bounds live in `scan.mjs` beside the other shared numerics, because a budget the renderer enforces and an estimate the entry point prints must be the same number. They were not: the constant was written twice, and the copies diverged by 36% on exactly the output the budget trims.

The file boundary *is* the exact/inferred seam, visible from a directory listing without reading code. Measurement and rendering are separated for the second reason the seams section gives: in v0.1.0 nothing that computed was stopped from printing, so truncation went undisclosed and one claim came to live in four files. A single file would leave all four modules as function groupings, which is a shallow expression of the design.

### Facts, not verdicts

The tool emits measurements and the agent judges them. v0.1.0's verdicts were wrong three times — its cycles were fabricated, its `rising` label inverted on constant coupling, its god-file threshold was unsourced — while the underlying figures were never wrong. A line count, a commit count, and a per-window profile are facts. "God file", "rising", and "this is a cycle" are judgements, and they belong to the reader.

Progressive disclosure carries this: the default output orients at directory level, drill-downs are requested by name, and the footer signposts what can be asked next. Its measured cost is recorded once, in `tests/measure-baseline.json`, and nowhere else. Withholding a fact is not disclosure; pre-digesting it into a verdict is not either.

## Progressive disclosure, per module

Disclosure is an algorithm, not a flag. Each module discloses in three layers, and the layer boundary is chosen so the agent can decide where to look next without paying for detail it will not read.

| | L0 — orient | L1 — structure | L2 — detail |
|---|---|---|---|
| **Inventory** | robust distribution summary plus deviation ranking, O(F log F) | flat table ordered by mass, binary-searched to a token budget, O(V log V) | file level for one named subtree, O(F_subtree) |
| **History** | age, commit count, active/dormant split, O(C) | weighted co-change with breadth cap and time windows, O(Σ min(k,cap)²) | not built |
| **Dependency** | per declared ecosystem: which analyzer ran, layers deep, entangled group count — or a named absence, O(V+E) | entangled groups with their anchors, and each directory's layer and group carried on its own row, O(V+E) | not built; an edge list would contradict the rule above it |

**L0 is the norms and the outliers. L1 is the structure. L2 is the detail.** Inventory's L0 summarises a distribution and ranks by deviation from it; History's and Dependency's L0 report totals and could do the same, which is the clearest unclaimed improvement in the tool.

### Why the distribution comes first

`cmd/cotx 56f` is uninterpretable alone. `files per directory: median 7, p90 32, max 136` makes every later row readable, and turns `136f` into *19× the median* — which is a fact about the distribution, checkable and exact, not a verdict. One line buys the meaning of every line after it.

L0 is around twenty lines and carries the file and line totals, tree depth, language mix, test ratio, both distributions, repository age, the active-versus-dormant split, the modules declared by manifests, and the four directories furthest from the repository's own norms. It also answers which analyzer to run, because the manifest names the ecosystem.

### Why the structure table must meet a budget

A flat directory table does not scale: on a 3,154-directory repository it runs to about 14,000 tokens, the same failure as the per-file table it replaced.

What ships is a flat list ordered by mass, truncated by **binary search over how many rows survive** until the rendering fits the budget — Aider's repo map approach, and a departure from the recursive tree rollup this document once specified. The tree rollup was prototyped and not built: it gives each subtree an allowance and collapses the rest into a per-parent `+N more`, which reads better on a deep tree, and it is recorded here as the shape to revisit if depth ever becomes the problem. The shipped table scales with the budget rather than with the repository, and states once how many directories it did not show.

## What the agent actually receives

A skill's markdown is paid once, when it triggers. A script's output is paid on **every invocation**, and no budget constrains it. The description costs about 95 tokens per turn and SKILL.md about 2,060 once, against a scan that costs several hundred to a few thousand every time it runs — the figures live in `tests/measure-baseline.json`.

**The output budget is therefore the primary design constraint, and SKILL.md's length is the secondary one.** The published 500-line guidance governs the markdown; nothing governs the thing that actually dominates.

### One rule generates the output design

Whatever the tool computes, the agent receives as a linear sequence of tokens. A graph does not arrive as a graph; it arrives as whichever serialisation was chosen. And a model cannot reliably chase pointers — locating a line, holding it, and finding the next is exactly where multi-hop reasoning over serialised edges breaks down.

> **Any fact that takes more than one lookup to obtain must be precomputed.**

This is what v0.1.0 got wrong in *shape*, independently of its accuracy: it handed over a list of triangles, which is a fragment of a traversal's input, where the reader needed the traversal's result. An edge list asks the agent to find cycles, compute reach, and sort topologically — three things it cannot do reliably. Strongly connected components, layer numbers, and transitive reach counts are the same information after the traversal has been done for it.

The division of labour follows: **the tool traverses, the agent judges.** Traversal is what a model is bad at and a program is exact at; judgement is the reverse.

### The shape that survives serialisation

A sorted table of self-contained rows, each directory a feature vector — files, lines, tests, commits, commit share, last touched, layer and group. Transitive reach and a normalised cumulative dependency figure belong here and are not built; both are one pass over a graph the tool already holds.

- **No cross-line joins.** Each row is readable alone, because the norms are stated once at the top.
- **Order carries meaning.** Rows are ranked by deviation from those norms, so the agent does not have to sort — something it can do but not reliably across many rows.
- **No raw graphs.** Only traversal results.

Paths carry the tree, and a full path on every row beats indentation: indentation's failure mode is attributing a row to the wrong parent, and it fails silently, while verbosity only costs tokens. Sorted paths group as a tree anyway.

No embeddings. The one vector worth having is that feature row, and similarity reasoning over it belongs to the agent. Path-token similarity measures naming convention rather than structure — the same trap as connascence locality, where 68% of edges sat at distance 2 purely because the tree was flat.

## Structural direction is the skill's; domain direction is the project's

The skill must be able to say which way to move without inventing an architecture. The line is that **structural invariants hold for any domain, and domain shape does not**.

| The skill says | The skill never says |
|---|---|
| Dependencies should run one way; a cycle is a fact with known costs | whether `billing` and `settlement` belong apart |
| Things that change together belong together, and it is measurable | what this domain's subjects are |
| Transitive reach should fall toward a hierarchy | which architectural style to adopt |
| Load-bearing paths do not move | what the target architecture is |
| A migration separates prepare, coexist, migrate, cut over, stabilize, remove | |

Splitting one subject from another is a domain decision. Making the dependency graph acyclic is not.

"Reasonable" then has two sources, and neither is invented. The first is **the repository's own norms** — whether 136 files in a directory is a problem is judged against this repository's median of 7, not against a threshold this skill made up. The second is **a structural invariant stated with its cost**: not "you should split this", but "this directory is transitively reachable from 80 others, so a change to any one of its subjects reaches all 80; splitting by subject lowers that number, and costs N moved files and one broken import path."

That is knowledge about consequences, and the agent applies it. A third source sits above both: where the project has recorded its own architecture, that record is the domain authority, and this skill reads it without writing it.
