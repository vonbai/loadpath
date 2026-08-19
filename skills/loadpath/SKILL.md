---
name: loadpath
description: Reads how a codebase carries its weight — where code sits, which direction dependencies run, which boundaries must not move, and where the structure has drifted from the design it should express. Use when creating a package, directory, or repository; when deciding where something belongs; when a package has grown unwieldy or a filename prefix keeps repeating; when dependencies run backwards or form a cycle; when one change touches many directories; when planning an extraction, split, or migration toward a target structure; or when judging whether a layout still matches the architecture.
---

# Loadpath

In a building, the **load path** is how weight travels from where it is applied down to the ground. Every member either carries load or is decoration, and you learn what a structure really is by tracing that path — not by reading the floor plan.

A codebase has one too. Dependencies are the load path: each module bears the weight of everything that imports it. **The tree is a projection** of decisions made elsewhere, and it either expresses them faithfully or lies about them. This skill traces the real load path, compares it against the design it should express, and plans the moves that change it without bringing anything down.

Structure projects three sources, in this order of authority:

1. **The product's subjects** — what the system is *about*. A reader opening the tree should hear it **scream** the domain: `billing`, `settlement`, `onboarding`. A tree that screams its framework has projected the tooling instead of the product.
2. **The architecture's decisions** — what is hidden from what. Parnas's criterion is the one that matters: decompose along the **design decisions most likely to change**, so each module hides one, never along the steps of a flowchart. Layer-first trees (`controllers/`, `services/`, `models/`) are the flowchart decomposition rediscovered.
3. **Observed reality** — the dependency graph and the change history. This is the empirical check on the first two, and the only one that cannot be argued with.

**The skill reads these sources; it never writes them.** Where a project has recorded its own architecture — its module model, its vocabulary, its laws — that record is the authority, and the work is making the tree express it. Proposing a different architecture is a different job.

## Placement

Answer in order and stop at the first rule that decides.

1. **Does an existing subject already own this behaviour?** Put it there. A new home is a claim that no existing one fits; make the claim before acting on it.
2. **What changes with it?** Code that moves in the same commit belongs in the same directory — the **common closure** criterion. This outranks everything below it.

   New code has no history to measure, so predict instead: **name a requirement likely to change, and list the files that change with it.** Run it for two or three plausible changes; the list that keeps recurring is the subject. This is Parnas's method working forward from the decisions most likely to change.
3. **Which way does the load run?** A thing belongs on the side of a seam that lets dependencies point one way. If placing it here would make two directories depend on each other, it belongs in neither — it belongs in a third that both may depend on, or inside one of them entirely.
4. **What decision does it hide?** If it exists to keep a choice — a format, a protocol, a vendor, a schema — from leaking, it belongs beside that choice's other keepers, behind one **seam**.
5. **Would a reader look for it here?** Name the directory with the project's own vocabulary, for the subject a reader already has in mind.
6. **Is the second caller real yet?** Create a package or seam when the second real caller exists, not in anticipation. Anticipatory structure is the most expensive kind to remove, because it looks deliberate.

**Done when** the placement is justified by one of these rules named aloud, the direction of dependency is stated, and the directory's name is a subject from the project's vocabulary.

### Naming

Directory names are singular nouns naming the subject — `billing`, `session`, `market` — carrying the project's own words. File names name their subject; reaching for a disambiguating suffix is the prefix signal below, arriving early.

When no subject name comes, that is the finding, and it is worth more than any directory you could create to hold the gap: the code's purpose is not yet understood. Say so, and place the file with its nearest co-changing neighbour until it is. Names like `utils`, `common`, `shared`, `core`, `misc` mark that gap permanently and then accumulate.

## Reading the load path

`scripts/scan.py` measures every signal below for any language, Python 3 standard library only. Measure before claiming.

**Keep the projections separate.** Static dependency, change affinity, runtime interaction, and shared data are different graphs of the same code. Read them side by side and require two to agree before acting — but never let an acceptable edge in one excuse an invalid edge in another.

### Dependency direction

The load must run one way. Two directories that depend on each other are one module wearing two names: neither can be understood, tested, or replaced alone, and neither can be deleted to find out what it was holding up.

- **Cycle** — *Signal: a two- or three-directory cycle.* Break it by finding the shared thing both need and moving it into a third directory both may depend on, or by inverting one edge behind an interface the depended-on side owns.
- **Cycle hub** — *Signal: one directory inside many cycles.* The tangle is anchored there; start there rather than at whichever cycle you noticed first.
- **Load with nothing above it** — *Signal: high fan-out, near-zero fan-in.* An orchestrator that depends on everything and that nothing depends on. Legitimate at an entry point, a smell anywhere else.
- **Backwards edge** — *Signal: a dependency pointing against the project's declared layering.* Only a project that has declared a direction can have this one; without a declaration there is no backwards.

The detection is deliberately a sound over-approximation: it finds every real edge and some false ones, so **"no cycle here" is trustworthy and "a cycle here" wants a glance.** Route enforcement to the ecosystem's own tool where one exists — `dependency-cruiser`, `import-linter`, `go-arch-lint`, `ArchUnit` — rather than reimplementing it.

### Layout drift

**Flat sprawl** — *>20 source files, 0 subdirectories.* More than one subject, and the line was never drawn.

**Prefix-as-package** — *≥3 files sharing a name prefix.* **The prefix is a package that was never created.** The author knew the grouping and expressed it in the only place available.

**God file** — *>800 lines, or >3× the directory median.* Several subjects appended rather than placed.

**Test inversion** — *test:impl > 2:1 with no subdirectories.* Read the test file names; they usually name the packages that should exist.

**Orphan and pass-through** — a single-file directory, or a directory whose only child is another directory. Inline or collapse.

### Change affinity

**Scatter** — *a typical feature commit touches >4 directories.* The direct violation of common closure, nearly always layer-first organization.

**Coupling across a seam** — *a high weighted score whose trend is `rising`.* Read the trend, never the score alone: `rising` is coupling that grew after both directories existed, which is the case worth acting on, while `at-creation` and `fading` describe how the code was introduced or a seam already healing.

**A score licenses a question and never a move.** Non-technical causes — turnover, deadline pressure, lost knowledge — leave a fingerprint identical to genuine design coupling.

## Load-bearing walls

Some paths must not change: frozen legacy, vendored trees, generated output, an archived baseline, a published import path. These are load-bearing, and the rule is the same as in a building — **you may not remove the member until the load it carries has somewhere else to go.**

Treat a declared frozen boundary as an invariant of every proposal, not a caveat on it: name the frozen paths before planning, check each proposed move against them, and where a proposal needs a frozen path to change, say so as the finding rather than routing around it. A structure proposal that quietly edits frozen bytes is not a proposal, it is a defect.

## Moving load

Restructuring is the transfer of load from one arrangement to another while the building stays standing. Moving files is cheap; moving them badly is expensive, because it destroys history and review context.

- Keep structural change and behavioural change in separate commits. A move mixed with an edit is unreviewable, and the mixture hides both.
- Move on a measured signal toward a named subject, one subject at a time, stopping when the signal clears. A reorganization that changes everything cannot be verified.
- For anything larger than one move, separate the phases and name which one you are in: **prepare** (create the target, no callers yet) → **coexist** (both live, one declared the source of truth) → **migrate** (move callers) → **cut over** → **stabilize** → **remove**. Skipping coexistence is what turns a migration into an outage.
- Say plainly which steps are reversible. A file move is; a published import path, a persisted format, or an external effect is not, and calling either a rollback is a lie.
- Public import paths are an interface; changing one is a breaking change and gets the same treatment.

## Reference

- `references/language-conventions.md` — how the grouping is spelled per ecosystem, and what the top level is for in a library, application, monorepo, service, data, infrastructure, or documentation repository.
- `references/canon.md` — the sources behind each rule, and what the research does *not* support, for arguing a contested call.
- `scripts/scan.py` — deterministic measurement of every signal above. `python3 scan.py [REPO] [--since 12.months] [--top N]`.
