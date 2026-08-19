# Evidence

What each measurement rests on, what was rejected, and what nothing supports. `skills/loadpath/references/canon.md` carries the design canon; this file carries the empirical trail.

## Dependency detection

**Method.** Directed edges between directories are found by looking for one directory's path inside another's non-test source. Every real import contains the path it imports, so the method is a sound over-approximation. Parent/child pairs are excluded — a parent's path is a prefix of its child's and would otherwise register as a dependency.

**Validation.** Measured against `go list -deps=false -json ./...` ground truth on a 1281-file, 93-directory Go repository:

| Variant | Edges | Precision | Recall |
|---|---|---|---|
| All files, all lines | 614 | 68.1% | 100% |
| Import-shaped lines only | 612 | 68.3% | 100% |
| **Test files excluded** | **443** | **94.4%** | **100%** |
| Test files excluded + import-shaped lines | 442 | 94.6% | 100% |

Two findings decided the implementation. Test files were the entire source of the false positives; restricting to import-shaped lines added 0.2 points and was dropped as complexity that buys nothing. And recall stayed at 100% throughout, which is the load-bearing half: **absence of a cycle is trustworthy, presence of one wants a glance.**

**Not built.** Enforcement. Every mature rule enforcer is language-bound — `dependency-cruiser` (JS/TS), `import-linter` (Python), `go-arch-lint` (Go), `ArchUnit` (JVM), `ArchUnitNET` (.NET) — and most take a machine-readable rule file an agent can author and diff. Reimplementing that in a heuristic would be strictly worse than routing to it. The reasoning is language-agnostic; the enforcement is not.

## Co-change weighting

Four arXiv papers, read in isolation, decided the shape of the co-change score.

**Grade evidence per event; never count it.** *Many-Objective Software Remodularization using NSGA-III* (arXiv:2005.06510v1) sums per-event weights from an operation-compatibility table so irrelevant history contributes exactly zero rather than diluting a score. `scan.py` applies the same shape: each commit casts one vote split across the pairs it implies, so a wide tangled commit cannot mint a dense clique, and an all-additions commit is damped further as creation rather than coupling. The paper's own machinery does not transfer — eight hours of optimization, call graphs, Java-specific refactoring recovery — and the authors concede the history objective is separable.

**Normalize, then read the rate of change.** *Understanding Architecture Erosion* (arXiv:2103.11392v1) reports practitioners tracking architectural smell *density* across releases rather than absolute counts, because code size shifts underneath the comparison. `scan.py` buckets weighted votes into time windows for the same reason, reporting `rising`, `steady`, `at-creation`, or `fading`.

**Drift needs a referent.** *Tackling Software Architecture Erosion* (arXiv:2104.13919v1) defines erosion as inconsistency between a declared architecture and its implementation, and makes amending a stale declaration a first-class outcome rather than a retreat. It is a two-page position paper with no implementation or evaluation — framing, not evidence.

**Name findings from a grounded vocabulary.** *Warnings: Violation Symptoms Indicating Architecture Erosion* (arXiv:2212.12168v2) hand-labelled 606 genuine violation symptoms out of 21,583 keyword hits. Structural inconsistency is the largest category at 205, and the one module-boundary advice concerns.

### Rejected after reading

**Commit message text as a signal.** arXiv:2212.12168v2 proposes matching a violation vocabulary against commit messages. Declined on two independent grounds: arXiv:2103.11392v1 dropped GitHub as a data source because under 0.1% of Issue and Commit hits were erosion-related, so erosion is essentially never *named* in commit history; and the proposing paper's own corpus is code review prose rather than commit messages, with no per-source precision reported and roughly 97% false positives on raw keyword matching before human labelling.

**A single composite score.** arXiv:2005.06510v1 reports that scoring many objectives at once produces a large set of mutually equivalent answers with no principled way to choose among them. arXiv:2104.13919v1 separately cites evidence that refactoring can make established metrics look worse. Two independent axes that agree is evidence; several axes averaged is noise.

## The caveat that outranks every measurement

arXiv:2103.11392v1's cause taxonomy finds a large share of architecture erosion causes are non-technical — turnover, knowledge vaporization, schedule pressure, communication failure. These leave a co-change fingerprint indistinguishable from genuine design coupling while implying that no boundary should move.

No score licenses a refactor. It licenses a question.

## What nothing supports

- **No source validates that directory-level co-change tracks architecture erosion.** The practitioner study explicitly declines the causal claim.
- **No source supplies a threshold, a precision figure, or a window length** for these signals. Every constant in `scan.py` — 20 files, 3 shared tokens, 800 lines, 2:1, 4 windows — is tunable convention, not a principled value, and should be read that way.
- **No source describes how a language-agnostic, directory-level intended architecture should be expressed.** A declared referent would make drift measurable rather than inferable; the format has no prior art to copy.
