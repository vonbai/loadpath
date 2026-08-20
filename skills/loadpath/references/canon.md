# Canon

The sources behind each rule. Reach for these when a placement call is contested, when a team disagrees about layer-first organization, or when a rule needs its reasoning restored rather than its conclusion repeated.

## Decompose by what changes, not by what happens

**Parnas, "On the Criteria To Be Used in Decomposing Systems into Modules" (CACM, 1972).** The origin of everything in this skill. Parnas built one system twice: once decomposed by the steps of its flowchart, once by **information hiding** — each module holding one design decision secret from the rest. Same program, same output; only the second survived change.

His conclusion is unusually blunt for a 1972 paper: it is almost always incorrect to begin decomposition from a flowchart. Begin instead from a list of the design decisions most likely to change, and give each one a module to hide in.

This is why layer-first trees fail. `controllers/ services/ models/` *is* the flowchart decomposition — modules named for the processing step they perform. It reads as organized and behaves as though nothing were, because a change to one design decision cuts across every layer at once.

The practical form: ask what a module *hides*, not what it *does*.

## Things that change together live together

**Common Closure Principle** (Robert C. Martin, package cohesion principles). Gather into one package the things that change for the same reasons at the same times. The package, not the class, is the unit of release and of change; cohesion at that level is measured in co-change, not in conceptual similarity.

The companion principles constrain the same boundary from other directions — Common Reuse (things used together are packaged together, so a consumer never drags in what it does not use) and Reuse/Release Equivalence (the unit of reuse is the unit of release).

Why this skill treats git history as evidence: co-change is the one measurement that cannot be argued with. Two directories that always change together were one subject all along, whatever their names claim.

## The tree should name the domain

**Robert C. Martin, "Screaming Architecture" (2011).** A building's floor plan screams *library* or *house*. A codebase's top-level tree should scream what the system is for. If it screams Rails, Spring, or Next.js, the framework has been projected where the product belongs.

Martin's sharpest line: frameworks are tools to be used, not architectures to be conformed to. An architecture derived from a framework cannot be derived from the use cases.

The test: show the top-level directory listing to someone who knows the business but not the code. If they cannot tell what the system does, the tree is projecting the wrong source.

## Package by component

**Simon Brown, "Modular Monoliths" / package-by-component.** The middle path between package-by-layer (scatters every change) and package-by-feature (can leave a component's internals public). A component bundles everything for one coarse-grained capability behind one public type, keeping the rest package-private — a **seam** the compiler enforces rather than a convention the team remembers.

Useful because it names what "group by subject" means at the scale where it gets hard: a subject large enough to have internals worth hiding.

## Boundaries follow language

**Eric Evans, *Domain-Driven Design*.** A bounded context is where a term stops meaning one thing and starts meaning another. Package boundaries that follow context boundaries stay stable, because the vocabulary that justifies them is the vocabulary the domain already enforces.

This is the link between a project's glossary and its tree: when a term has one owner, its code has one home. Take the domain model from the project's own record — this skill reads that record, it does not write it.

## Structure and behaviour are different changes

**Kent Beck, *Tidy First?* (2023).** Small structural changes — renaming, extracting, moving — are a distinct species from behavioural change and belong in their own commits. Mixed together, neither is reviewable: the diff shows a thousand moved lines and hides the one that changed meaning.

Beck's economic argument matters as much as the hygiene one: tidying is an option purchased on future change, so tidy where change is actually arriving. It is why this skill demands a measured signal before a move rather than a general sense of untidiness.

## Seams

**Michael Feathers, *Working Effectively with Legacy Code*.** A seam is a place where behaviour can be altered without editing at that place. Where the seam goes is its own decision, separate from what sits behind it.

Shared vocabulary with `codebase-design`, deliberately: that skill decides what goes behind the seam, this one decides where on disk the seam falls.

## Modules should be deep

**John Ousterhout, *A Philosophy of Software Design*.** Depth is behaviour per unit of interface. Shallow modules — a thin wrapper per file, a directory of one-function files — multiply interfaces without hiding anything, and the cost of learning them exceeds what they save.

The structural reading: a directory whose files each expose everything to each other is one module wearing many filenames.

## Coupling should weaken with distance

**Meilir Page-Jones, connascence.** Two pieces of code are connascent when changing one requires changing the other. The forms range from weak (name) to strong (execution order, timing, identity). The rule that matters for placement: the stronger the connascence, the closer together the code should sit — strong forms inside one module, only the weakest crossing a package boundary.

The most precise available answer to "how far apart may these live?"

## Structure mirrors the organization

**Conway's Law (1967).** A system's structure copies the communication structure of the organization that built it. Applied deliberately — the "inverse Conway manoeuvre" — team boundaries are chosen to produce the module boundaries wanted.

The warning for solo and small-team work: with no organizational boundaries to mirror, nothing external will produce module boundaries for you. They have to be chosen and defended on purpose, which is why an unmanaged tree drifts toward one flat package.

## Measuring drift: what the research supports

Four arXiv papers, read in isolation, behind the co-change scoring in `scripts/scan.mjs`. They agree on more than they disagree, and what they rule out is as useful as what they support.

**Drift needs a referent.** Knieke, Rausch & Schindler, *Tackling Software Architecture Erosion* (arXiv:2104.13919v1) define erosion as inconsistency between a declared architecture and its implementation. Drift judged from code alone has nothing to be drift *from*. Two consequences carry into practice: a violation means the *pair* is inconsistent, so amending a stale declaration is a first-class outcome rather than a retreat; and violations are aggregated into one named pattern before being reported, never surfaced instance by instance. It is a two-page position paper with no implementation or evaluation — framing, not evidence.

**Grade evidence per event; never count it.** Mkaouer et al., *Many-Objective Software Remodularization using NSGA-III* (arXiv:2005.06510v1) never counts historical events as one each; it sums weights from an operation-compatibility table so irrelevant history contributes exactly zero instead of diluting a score. `scan.mjs` applies the same shape: each commit casts one vote split across the pairs it implies, so a wide tangled commit cannot mint a dense clique, and an all-additions commit is damped further as creation rather than coupling. The paper's own machinery does not transfer — eight hours of optimization, call graphs, and Java-specific refactoring recovery — and the authors concede the history objective is separable and droppable.

**Normalize, then read the rate of change.** Li, Liang, Soliman & Avgeriou, *Understanding Architecture Erosion* (arXiv:2103.11392v1) report the practice of tracking architectural smell *density* across releases rather than absolute counts, because code size shifts underneath the comparison. `scan.mjs` buckets weighted votes into time windows for the same reason: a burst at creation and coupling that keeps rising are different facts. The same study licenses the advisory register — of thirteen tools practitioners named, none claims to detect erosion itself, only symptoms with an established connection to it — and it closes one door: erosion is essentially never *named* in commit history, so commit message text is a dead channel.

**One caveat outranks every score.** That study's cause taxonomy finds a large share of erosion causes are non-technical — turnover, knowledge vaporization, schedule pressure, communication failure. These leave a co-change fingerprint indistinguishable from genuine design coupling while implying that no boundary should move. No score can license a refactor; it can only license a question.

**Name findings from a grounded vocabulary.** Li, Liang & Avgeriou, *Warnings: Violation Symptoms Indicating Architecture Erosion* (arXiv:2212.12168v2) hand-labelled 606 genuine violation symptoms out of 21,583 keyword hits — roughly 97% false positives before human judgement. Structural inconsistency is the largest category at 205, and the one that module-boundary advice concerns. That precision figure is the standing argument against any lexical detector.

**What no source supplies.** None validates that directory-level co-change tracks erosion at all; the practitioner study explicitly declines the causal claim. None supplies a threshold, a precision figure, or a window length — so every constant in `scan.mjs` is tunable convention, not a principled value, and should be read that way.

## Dependencies must run one way

**Acyclic Dependencies Principle** (Robert C. Martin). No cycles in the package dependency graph. A cycle makes every package in it one release unit: none can be built, tested, versioned, or replaced without the others, and none can be deleted to discover what it was holding up. The two repairs are the same two that have always existed — move the shared thing both need into a third package both may depend on, or invert one edge behind an interface the depended-on side owns.

**Stable Dependencies Principle** and **Stable Abstractions Principle** give direction to the edges that remain: depend toward things that change less often, and let a package that many depend on be abstract in proportion. Fan-in and fan-out are the crude measurement of both — a directory with high fan-out and near-zero fan-in sits at the top of the load path, which is correct for an entry point and a smell anywhere else.

### Where the edges come from

`scripts/deps.mjs` does not parse imports. It runs each declared ecosystem's own analyzer — `go list`, `grimp`, `madge`, or `.csproj` XML — at that ecosystem's own root, names it in the output, and returns one graph per ecosystem. The graphs stand side by side and are never added together, because their units differ; an ecosystem that cannot be measured here is a **named absence**.

The alternative was tried and published, and it failed in both directions. Substring matching of directory paths measured 94.3% precision at one repository root and **43.5% one directory down**, where short names like `io`, `db` and `work` match ordinary English prose in comments. Recall was worse: on standard TypeScript and Python layouts it returned nothing at all on textbook cycles, because relative imports and dotted package names never contain a repo-relative directory path. On the one Go module it was validated against it reported fourteen cycles where the compiler makes cycles impossible.

Per-language import regexes recover recall but cannot resolve aliases, re-exports or dynamic imports — and for Python the gap is not closable by any parser: `from x import y` leaves `y` ambiguous between a module and an attribute, so a parser must emit both, which on one real corpus meant 7,644 edges against grimp's 3,061. Only the module table settles it.

Calling a real analyzer is not the same as trusting it. The dominant failure mode of the Node tools is **silent empty output** — `madge` returns `{}` without `--extensions`, and `dependency-cruiser` returns `modules: []` against current TypeScript — so every result passes a sanity check, and a failed check reports Not measured rather than zero.

## Keep the projections separate

Static imports, change affinity, runtime interaction, shared data, and failure propagation are different graphs over the same code. Merging them produces a number that cannot be acted on, and worse, lets an acceptable edge in one projection excuse an invalid edge in another. Read them side by side; require two independent axes to agree before proposing a move.

This is also the practical form of a warning from the remodularization literature: scoring many objectives at once produces a large set of mutually equivalent answers with no principled way to choose among them. Two axes that agree is evidence; seven axes averaged is noise.

## Load-bearing walls

The idea that some code is frozen and must survive a restructuring intact has one good primitive in the wild — ArchUnit's `FreezingArchRule`, which records existing violations as an accepted baseline so a rule can be adopted on a legacy codebase without a flag day, and fails only on *new* violations. It is Java-only, and nothing in the agent-skill ecosystem exposes or generalizes it.

The discipline it encodes transfers regardless of tooling: a boundary is only real if something checks it, and on legacy code the checkable claim is not "no violations" but "no new violations." Treat a frozen path the same way — the invariant is that the proposal does not add a change to it, and a proposal that needs one says so as its finding.

## On canonical layouts

`golang-standards/project-layout` is not a Go team standard and has been publicly disputed by Go maintainers; its `pkg/` convention in particular is widely argued against. Treat any "standard layout" repository as one team's convention rather than an authority, and prefer the ecosystem's own documentation — which is what `references/language-conventions.md` records.
