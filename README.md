# Loadpath

[![License: MIT](https://img.shields.io/badge/License-MIT-2f6f62.svg)](LICENSE)

An Agent Skill that traces how a codebase carries its weight — where code sits, which way dependencies run, which paths are frozen, and what the repository has already moved.

在建筑里，**荷载路径**是重量传到地基的路线。依赖就是代码库的荷载路径：每个目录承受着所有 import 它的东西的重量。目录树是别处已做出的决策的**投影**——它要么表达那些决策，要么在说谎。

Loadpath 追踪真实的荷载路径。它**指向值得读的代码，不替你下判断**。产品主路径只有一条：**先读项目权威 → 全局定向 → 聚焦结构或子树 → 读代码 → 决策 → 验证迁移结果**；各个参数只是逐层披露，不是互相竞争的模式。

## What it emits

One command, 830–1,721 tokens across the four pinned corpora (36 to 1,093 source files), and 931–3,706 with `--structure`. Those are upper bounds: the divisor is calibrated with tiktoken against this tool's densest output, not a general prose ratio.

- **the distribution first** — median, p90 and max files per **Source-containing directory** and lines per file, so every row after it is readable. That directory is only the direct parent of an admitted source file; container-only and unsupported-file directories are outside the population. `136f` means nothing until `median 7` is on the page; then it is 19× the median.
- **Source-path depth** — the maximum repository-relative segment count to a Source-containing directory, named as physical orientation. It is not dependency Layer depth and carries no quality threshold.
- **scattered names** — name tokens recurring across Source-containing directories, counted over distinct directories rather than files, role words refused. One Subject spread across the tree, or a layer name standing where a Subject name should be.
- **activity** — what Source-containing directories were touched recently, and what was not. A row with no recent commits is *unmeasured*, not known to be safe.
- **commit share** — the top author's fraction of a Source-containing directory's commits, beside the raw count.
- **relocations** — what this repository has already moved, from git's rename records, counting every file type rather than only source. The migration already done is usually the best evidence of the one in progress.
- **co-change** — Source-containing directories changing in the same commits, one commit casting one vote split across the pairs it implies, with the vote it received in every window and the denominator its share is taken over.
- **dependencies** — from the ecosystem's own analyzer, named in the output, one Span per ecosystem the repository declares. Entanglement as *groups*, named Layer depth, and how much of the graph the widest fan-out nodes reach.

`--structure` adds every Source-containing directory and the entangled groups. `--dir PATH` gives one subtree file by file, with each file's last touch and the load crossing the subtree's line in both directions. File-level means placement, size, test convention and last touch; Loadpath does not claim to parse symbols or interfaces inside files. `--snapshot FILE` records a scan's layout and Spans; `--compare FILE` prints only what moved since — and says, every time, that co-change and activity lag a move by design.

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
| Go | `go list -e -mod=readonly`, modules through depth 4 | package = directory | `go` on PATH, warm module cache |
| C# | `.csproj` `<ProjectReference>` | project | nothing |
| Python | `grimp` | module directory | `pip install grimp` |
| Node/TS | `madge@8.0.0`, every existing `src/lib/packages/apps/app/web` root | file directory | a warm npx cache |
| anything else | — | — | named as an absence, never omitted |

Calling a real analyzer is not the same as trusting it: the dominant failure mode of the Node tools is silent empty output, so every result passes a sanity check before it is believed, and a failed check reports Not measured rather than zero.

## Install

Requires Node 18 or newer. Filesystem and history measurements need nothing else; dependency spans have the analyzer requirements above.

```bash
npx --yes skills add vonbai/loadpath@v0.4.0 --global
```

The unpinned form, `vonbai/loadpath`, tracks the development state on `main`; prefer the pinned release above. Releases are cut directly from a locally verified commit. This repository has no hosted CI workflow.

`node ~/.agents/skills/loadpath/scripts/loadpath.mjs --version` says what an installed copy actually is. Update with `npx --yes skills update loadpath --global`; remove with `npx --yes skills remove loadpath --global`.

Verify:

```bash
node ~/.agents/skills/loadpath/scripts/loadpath.mjs /path/to/repo
```

## Verification

Everything published here is recomputed by the repository itself. There is **one release check**: run `npm test` once on the commit being tagged — acceptance, contract and measurement, about half a minute — then publish it directly. Hosted matrices and mutation campaigns are deliberately not release gates.

- `node --test tests/loadpath.test.mjs` — 140 acceptance tests over synthetic repositories built per case.
- `node tests/mutate.mjs` — 8 one-line feature deletions selected across the product's highest-consequence contracts. It is an opt-in diagnostic after risky test or architecture changes, not a release gate or a coverage claim.
- `node tests/measure.mjs` — every published figure recomputed from four pinned public repositories, one of them a Go+TypeScript monorepo that holds the span contract to real bytes, and compared against `tests/measure-baseline.json`. A pin that does not resolve fails the run.
- `node tests/contract.mjs` — the skill's frontmatter, budget, pointers and vocabulary.

## Evidence

`DESIGN.md` holds the principles and the module design; `docs/adr/` records fifteen decisions and what each traded away; `docs/research/findings.md` records what the research supports, what it rules out, and what nothing supports — including three measurements this tool emits with no predictive validation, said plainly rather than quietly kept.

## License

MIT
