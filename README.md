# Loadpath

[![License: MIT](https://img.shields.io/badge/License-MIT-2f6f62.svg)](LICENSE)

An Agent Skill that traces how a codebase carries its weight — where code sits, which way dependencies run, which paths are frozen, and what the repository has already moved.

在建筑里，**荷载路径**是重量传到地基的路线。依赖就是代码库的荷载路径：每个目录承受着所有 import 它的东西的重量。目录树是别处已做出的决策的**投影**——它要么表达那些决策，要么在说谎。

Loadpath 追踪真实的荷载路径。它**指向值得读的代码，不替你下判断**。

## What it emits

One command, 729–1,517 tokens across the three pinned corpora (36 to 1,093 source files), and 837–3,523 with `--structure`. Those are upper bounds: the divisor is calibrated with tiktoken against this tool's densest output, not a general prose ratio.

- **the distribution first** — median, p90 and max files per directory and lines per file, so every row after it is readable. `136f` means nothing until `median 7` is on the page; then it is 19× the median.
- **scattered names** — name tokens recurring across directories, counted over distinct directories rather than files, role words refused. One subject spread across the tree, or a layer name standing where a subject name should be.
- **activity** — what was touched recently, and what was not. A directory with no recent commits is *unmeasured*, not known to be safe.
- **commit share** — the top author's fraction of a directory's commits, beside the raw count.
- **relocations** — what this repository has already moved, from git's rename records, counting every file type rather than only source. The migration already done is usually the best evidence of the one in progress.
- **co-change** — directories changing in the same commits, one commit casting one vote split across the pairs it implies, with the vote it received in every window and the denominator its share is taken over.
- **dependencies** — from the ecosystem's own analyzer, named in the output, one graph per ecosystem the repository declares. Entanglement as *groups*, and how many layers deep the load path runs.

`--structure` adds every directory and the entangled groups. `--dir PATH` gives one subtree file by file, with each file's last touch and the load crossing the subtree's line in both directions. `--snapshot FILE` records a scan's layout and spans; `--compare FILE` prints only what moved since — and says, every time, that co-change and activity lag a move by design.

## The rule it is built on

**Measurement points; you read.** The tool produces leads. A finding exists after someone reads the code a lead points at.

Its predecessor inverted this and reported six dependency cycles in a Go module, where the compiler makes them impossible — every one a substring artifact. [v0.1.0 is withdrawn](https://github.com/vonbai/loadpath/releases/tag/v0.1.0) and the whole design was rewritten around not repeating it.

Three consequences run through the output:

- **"Not measured" is never zero.** Where no analyzer applies the output says so.
- **A number licenses a question, not a move.** Turnover and schedule pressure leave fingerprints identical to design problems.
- **It never invents an architecture.** Where a project records its own, that record is the authority.

## Dependencies: analyzers, never guesses

Loadpath does not parse imports. It runs the ecosystem's own analyzer and names it in the output, or reports Not measured. Measurement is **per ecosystem, side by side**: a repository declaring two of these gets two labelled graphs, each rooted where that ecosystem's manifests are, never merged into one — their units differ — and never one standing for the other.

| Ecosystem | Analyzer | Granularity | Needs |
|---|---|---|---|
| Go | `go list -e -mod=readonly`, every module | package = directory | `go` on PATH, warm module cache |
| C# | `.csproj` `<ProjectReference>` | project | nothing |
| Python | `grimp` | module directory | `pip install grimp` |
| Node/TS | `madge` | file directory | a warm npx cache |
| anything else | — | — | named as an absence, never omitted |

Calling a real analyzer is not the same as trusting it: the dominant failure mode of the Node tools is silent empty output, so every result passes a sanity check before it is believed, and a failed check reports Not measured rather than zero.

## Install

Requires Node 18 or newer. No dependencies.

```bash
npx --yes skills add vonbai/loadpath@v0.2.2 --global
```

The unpinned form, `vonbai/loadpath`, tracks `main`: every change there has passed the four suites below on a developer machine, but only a release-tagged state has run them across Node 18, 22 and 24 on Linux with a cold analyzer cache.

`node ~/.agents/skills/loadpath/scripts/loadpath.mjs --version` says what an installed copy actually is. Update with `npx --yes skills update loadpath --global`; remove with `npx --yes skills remove loadpath --global`.

Verify:

```bash
node ~/.agents/skills/loadpath/scripts/loadpath.mjs /path/to/repo
```

## Verification

Everything published here is recomputed by the repository itself. These four are the gate a change passes before it lands, run locally; the same battery runs on Node 18, 22 and 24 at each release tag, which is where cross-platform behaviour and a cold analyzer cache are worth paying for.

- `node --test tests/loadpath.test.mjs` — 103 acceptance tests over synthetic repositories built per case.
- `node tests/mutate.mjs` — 87 one-line feature deletions; **a surviving mutant fails the build.** v0.1.0's suite let 14 of 20 pass, including the line that broke its own headline claim. Three are marked *equivalent* — a second guard already produces the same observable, so they are asserted to survive and a kill means the stated proof went stale — and five are listed every run as *not exercised*, with the toolchain each would need. The number is never the claim; the list is.
- `node tests/measure.mjs` — every published figure recomputed from three pinned public repositories and compared against `tests/measure-baseline.json`. A pin that does not resolve fails the run.
- `node tests/contract.mjs` — the skill's frontmatter, budget, pointers and vocabulary.

## Evidence

`DESIGN.md` holds the principles and the module design; `docs/adr/` records fourteen decisions and what each traded away; `docs/research/findings.md` records what the research supports, what it rules out, and what nothing supports — including three measurements this tool emits with no predictive validation, said plainly rather than quietly kept.

## License

MIT
