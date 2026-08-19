# Loadpath

[![CI](https://github.com/vonbai/loadpath/actions/workflows/ci.yml/badge.svg)](https://github.com/vonbai/loadpath/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f6f62.svg)](LICENSE)

An Agent Skill that reads how a codebase carries its weight — where code sits, which direction dependencies run, which boundaries must not move, and where the structure has drifted from the design it should express.

在建筑里，**荷载路径**是重量从受力点传到地基的路线。每根构件要么承重，要么是装饰；你不是靠读平面图，而是靠追这条路径，才知道一个结构究竟是什么。

代码库也有一条。依赖就是荷载路径：每个模块承受着所有 import 它的东西的重量。**目录树是一个投影**——投影的是别处已经做出的决策，它要么忠实表达，要么在说谎。Loadpath 追踪真实的荷载路径，把它和应当表达的设计对照，并规划改变它而不压塌任何东西的移动。

## What it does

- **Placement** — a six-rule ladder for where a new package, directory, or file belongs, including the one rule that works before any history exists.
- **Dependency direction** — directed edges between directories, two- and three-directory cycles, and the hub where a tangle is anchored. Language-agnostic and parser-free.
- **Layout drift** — flat sprawl, prefix-as-package, god files, test inversion, orphans and pass-through directories.
- **Change affinity** — weighted co-change over time windows, reported as `rising`, `steady`, `at-creation`, or `fading`, so a burst at creation reads differently from coupling that keeps growing.
- **Load-bearing walls** — frozen, vendored, generated, and archived paths as an invariant of every proposal rather than a caveat on it.
- **Moving load** — the phases a restructuring passes through, and which of its steps are actually reversible.

## What it is not

It does not invent an architecture. Where a project has recorded its own module model, vocabulary, or laws, that record is the authority and the work is making the tree express it.

It does not enforce dependency rules. Enforcement belongs in the ecosystem's own tool — `dependency-cruiser`, `import-linter`, `go-arch-lint`, `ArchUnit` — which parse properly and take a rule file. The reasoning is language-agnostic; the enforcement is not.

It does not turn a score into a verdict. A signal opens a question and never licenses a boundary move.

## Install

Requires Python 3.9 or newer for the measurement script. No other dependencies — standard library only.

```bash
npx --yes skills add vonbai/loadpath --global
```

That installs to `~/.agents/skills/loadpath`, which Codex reads directly as a user-level skill and which Claude Code reaches through `~/.claude/skills/loadpath`.

Verify:

```bash
python3 ~/.agents/skills/loadpath/scripts/scan.py /path/to/repo
```

## Use

Ask for it by name, or let the agent reach for it when it hits a placement or structure question:

```
loadpath: where should this new package go?
loadpath: scan this repo and tell me where the tangle is
loadpath: I want to extract the session handling — plan the move
```

The script measures; the skill decides what the measurements mean.

```
python3 scan.py [REPO] [--since 12.months] [--top N]
```

## How much to trust the dependency graph

Edges are found by looking for one directory's path inside another's non-test source. Every real import contains the path it imports, so the method is a sound over-approximation.

Measured against `go list` ground truth on a 1281-file Go repository: **100% recall, 94.4% precision** once test files are excluded. Test files were the entire source of the false positives.

That asymmetry is the contract: **"no cycle here" is trustworthy; "a cycle here" wants a glance.**

## Evidence

Every rule traces to a source, and `skills/loadpath/references/canon.md` records both what the research supports and what it does not. The measurement design in particular rests on four arXiv papers read in isolation — see [docs/evidence.md](docs/evidence.md) for the research trail, including the two findings that were considered and rejected.

## License

MIT
