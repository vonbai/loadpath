---
name: loadpath
description: Traces a codebase's load path — where code sits, which way dependencies run, which paths are frozen. Use when creating a package or directory, or deciding where something belongs; when a filename token keeps repeating or one change touches many directories; when dependencies form a cycle; when planning an extraction, split, or migration.
---

# Loadpath

In a building the **load path** is how weight travels to the ground. Dependencies are a codebase's: each directory bears the weight of everything importing it, and you learn what a structure really is by tracing that path rather than reading the floor plan.

The tree is a **projection** of decisions made elsewhere — the product's subjects, the architecture's choices — and it either expresses them or lies about them.

## The rule that governs everything here

**Measurement points; you read.** `scripts/loadpath.mjs` widens recall and computes what a reader cannot — history, reachability, entanglement. It produces **leads**. A **finding** exists after you have read the code a lead points at.

Its predecessor inverted this and reported six dependency cycles in a Go module, where the compiler makes them impossible. Every one was a substring artifact.

Three consequences hold in every use:

- **"Not measured" is never zero.** Where no analyzer applies the output says so, and silence about a thing is not evidence about it.
- **A number licenses a question, not a move.** Turnover, deadline pressure and lost knowledge leave fingerprints identical to design problems.
- **Where a project records its own architecture, that record is the authority.** Read `CONTEXT.md`, ADRs, `CLAUDE.md` first, and make the tree express them.

## Run it

```
node scripts/loadpath.mjs [REPO]                orient — 785–1,635 tokens measured
node scripts/loadpath.mjs [REPO] --structure    every directory, plus entangled groups
node scripts/loadpath.mjs [REPO] --dir PATH     one subtree, file by file, with the load
                                                crossing its line and each file's last touch
node scripts/loadpath.mjs [REPO] --snapshot F   also record this scan's layout and spans
node scripts/loadpath.mjs [REPO] --compare F    only what moved since that snapshot
```

`--since 12.months` sets the history window, `--budget 1600` the structure table's token allowance. Requires Node 18+ and nothing else.

## Reading the output

**The distribution comes before every row that uses it.** `136f` is meaningless until `median 7` is on the page; then it is 19× the median, which is a fact you can check.

- **files and lines per directory** — median, p90, max. Everything below is read against these.
- **scattered names** — name tokens recurring across directories, counted over distinct directories rather than files, with role words such as `util` and `index` refused. A token in nine directories is one subject spread across the tree, or a layer name standing where a subject name should be; which of the two it is, you learn by opening them.
- **activity** — directories touched recently, and how many were not. A directory with no recent commits is *unmeasured*, not known to be safe: on real repositories a fifth to two thirds of files go untouched in a window while some of them still carry later defects.
- **top author N% of Mc** — the share of commits by the largest contributor, beside the raw count. Concentration ranked first among 65 metrics in a defect study where the raw count did not; it is undefined where nothing was committed, which is why both are printed.
- **relocations** — what this repository has already moved, from git's rename records. The migration it has already done is usually the best evidence of the one it is mid-way through. Alone on the page this is a record rather than a lead, so it counts every file a rename touched and not only source, and its header says so; the side a move came from is expected to be gone.
- **co-change** — directories changing in the same commits, one commit casting one vote split across the pairs it implies, bucketed into time windows. Each row carries the vote it received in every window, and the denominator the share is taken over, because an average can look excellent while its worst case is total. Commits wider than the cap are sweeps, not coupling, and their count is disclosed.
- **dependencies** — one **span** per ecosystem the repository declares, each measured by that ecosystem's own analyzer, named in the output. Spans stand side by side and are never added together: a Go package and a TypeScript file directory are not the same unit. An ecosystem that cannot be measured here says so and says why. Where that reason names a remedy — a toolchain to install, a cache to warm — put the command to the user for approval rather than running it, because a read must not change the machine; carry on with the exact measurements meanwhile, and raise it only when the task rests on the dependency graph. Entanglement is reported as **groups**: inside a group nothing can be built, tested, or replaced alone. Layer depth is how far weight travels before it reaches something that depends on nothing, and a node listed for its fan-out also carries how many of that graph's nodes it reaches transitively — which is what a change to it arrives at.

**Done reading when** every emitted section has produced either a lead you will follow or an explicit "nothing here", and you have said which.

## Placing something new

Answer in order; stop at the first rule that decides.

1. **Does an existing subject own this behaviour?** Put it there. A new home claims none fits — make the claim.
2. **What changes with it?** Code that moves in the same commit belongs in the same directory: the **common closure** criterion, which outranks everything below.
   New code has no history, so predict instead — **name a requirement likely to change and list the files that change with it.** Run it for two or three plausible changes; the list that recurs is the subject. This is Parnas's method, working forward from the decisions most likely to change.
3. **Which way does the load run?** A thing belongs where dependencies can point one way. If placing it here makes two directories depend on each other, it belongs in neither — in a third both may depend on, or wholly inside one.
4. **What decision does it hide?** If it exists to keep a format, protocol, vendor or schema from leaking, it belongs with that choice's other keepers, behind one **seam**.
5. **Would a reader look here?** Name the directory for the subject, in the project's own words.
6. **Is the second caller real?** Create a package or seam when the second real caller exists. Anticipatory structure is the most expensive kind to remove, because it looks deliberate.

**Done when** the placement names which rule decided it, states the direction of dependency, and the directory carries a subject from the project's vocabulary.

Directory names are singular nouns naming the subject — `billing`, `session`, `market`. When no subject name comes, that is the finding, and it is worth more than any directory you could create to hold the gap: the code's purpose is not yet understood. Say so, and place the file with its nearest co-changing neighbour until it is.

## Load-bearing paths

Frozen, vendored, generated and archived paths are load-bearing: **the member does not come out until the load it carries has somewhere else to go.** Name them before planning, check each proposed move against them, and where a proposal needs one to change, say that as the finding. A proposal that quietly edits frozen bytes is a defect.

## Moving load

Restructuring transfers load while the building stands.

- Take a snapshot before you move anything and compare after: layout and spans answer at once, so the comparison tells you whether the signal you moved on has actually cleared — while co-change and activity still describe the tree you left, and will until the window fills.
- Keep structural and behavioural change in separate commits. A move mixed with an edit is unreviewable and hides both.
- Move on a measured signal toward a named subject, one subject at a time, stopping when the signal clears.
- Beyond one move, name the phase you are in: **prepare** (target exists, no callers) → **coexist** (both live, one declared the source of truth) → **migrate** (move callers) → **cut over** → **stabilize** → **remove**. Skipping coexistence turns a migration into an outage.
- Say which steps reverse. A file move does; a published import path, a persisted format, or an external effect does not, and calling either a rollback is a lie.

## Neighbours

Where a seam falls on disk is this skill. What sits behind it is `codebase-design`. What a published interface promises is `api-and-interface-design` and `deprecation-and-migration`. Domain vocabulary belongs to `domain-modeling`, and this skill reads it without writing it.

## Reference

- `references/canon.md` — the source behind each rule, and what the research does not support.
- `references/language-conventions.md` — how the grouping is spelled per ecosystem, and what the top level is for in a library, application, monorepo, service, data or infrastructure repository.
