# Language conventions

Per-language norms for physical layout. The rules in SKILL.md decide *what* the grouping is; these decide how that grouping is spelled in a given ecosystem. Follow the project's existing convention over anything here — consistency beats correctness in layout.

## Go

- **The package is the unit, and the directory is the package.** A directory cannot hold two packages, so every grouping decision is a directory decision. This makes prefix-as-package especially visible: `account_commands.go`, `host_commands.go` in one directory are Go telling you the package boundary is missing.
- `cmd/<binary>/` holds one main package per binary and as little else as possible. Command wiring belongs here; behaviour does not. A `cmd/` directory that grows past a handful of files is holding logic that belongs in an importable package.
- `internal/` blocks import from outside the module — it is a compiler-enforced seam, not a naming convention. Use it for everything not deliberately published.
- Tests live beside the code, same directory. `foo_test.go` in package `foo` for internal tests; package `foo_test` in the same directory for black-box tests through the public interface. Prefer the latter — it tests the interface a caller actually has.
- Package names are lowercase, single word, no underscores, and are read at every call site as a qualifier: `market.Series` not `marketdata.MarketDataSeries`. Stutter is a naming smell, not a structural one, but it usually means the package name and the type name are competing to be the subject.
- Avoid a `pkg/` directory. It says nothing that `internal/` or the module path does not.

## TypeScript / Node

- Group by feature directory, each exporting through a single `index.ts`. That index is the package interface; anything not exported from it is private by convention.
- Prefer one exported concept per file. Barrel files that re-export everything defeat the interface they appear to create and cost build time.
- Tests either colocated (`foo.test.ts` beside `foo.ts`) or in a mirrored `tests/` tree. Colocated is preferred — it keeps the change local.
- In monorepos, a workspace package is the real seam. Split into a package when there is a second real consumer or an independent release cadence — not to make the tree look modular.
- `src/` is worth it only when the repo root also holds non-source directories worth separating from.

## Python

- The importable package directory is the unit. `src/<package>/` layout keeps tests from importing the working tree by accident and is worth the extra level.
- Tests in a top-level `tests/` mirroring the package tree. Colocating tests inside the shipped package puts test code in the distribution.
- `__init__.py` defines the package interface. Keep it to re-exports and nothing else; logic there runs on import and is hard to trace.
- Avoid deep module nesting to express taxonomy. Import paths are read constantly; depth is a tax on every one of them.

## Rust

- The crate is the seam; modules are the grouping within it. Split into a workspace crate for independent compilation or release, not for tidiness.
- Prefer `foo/mod.rs` → `foo.rs` plus a `foo/` directory (the 2018+ form); it keeps the module's own code out of the directory listing of its children.
- Unit tests in-file under `#[cfg(test)]`; integration tests in `tests/`, which sees only the public interface. The split is the same black-box/white-box decision as Go's.

## Cross-language

- **Generated code lives in its own directory, is marked generated, and is never edited by hand.** If it must be edited, it is not generated.
- **Vendored or archived trees are frozen bytes.** Layout discipline does not authorize touching them.
- **Configuration at the level it configures.** Repo-wide config at the root; package-specific config beside the package. Root config that only one package reads is a fact stored away from its owner.

## Repository shapes

Language decides spelling; shape decides what the top level is for.

**Library.** The public import path is the product. The top level is the interface, and everything a consumer must not depend on sits behind a compiler-enforced barrier (`internal/`, package-private, a non-exported index). A library whose top level lists its implementation has published its internals whatever the docs claim.

**Application.** The top level is the domain: `billing/`, `settlement/`, `onboarding/`. Entry points are thin and obviously named; framework wiring is a leaf, never the organizing principle. This is where **screaming** applies most directly — the top-level listing is the system's table of contents.

**Monorepo.** A workspace package is a real seam with a real cost: its own build, versioning, and dependency edges. Split into one when there is an independent consumer or an independent release cadence — the Reuse/Release Equivalence criterion — rather than to make the tree look modular. Shared code earns a package once a second workspace depends on it; before that it lives with its one caller. Keep the dependency graph acyclic and visible; a cycle between workspace packages is one package written as two.

**Services.** One repository per service where teams and deploys are independent; one repository with a package per service where they are not. Contracts shared between services live where their ownership is unambiguous — a published schema package or a generated client. Copying a contract into both sides produces two facts that will disagree.

**Data and ML.** Separate the three things that change on different clocks: pipeline code (changes with the logic), configuration and parameters (change per run), and artifacts — data, models, checkpoints (change constantly, and belong in object storage or a registry). Notebooks are exploration; when a notebook's logic becomes something others depend on, it moves into a package and the notebook imports it. A `notebooks/` directory that production imports from is a package waiting to be extracted.

**Infrastructure as code.** Group by deployable unit and by blast radius, so what a change can break is legible from where it sits. Environments are values, not directories: per-environment copies of a stack diverge silently, and the divergence surfaces during an incident. Keep one shared definition and one parameter file per environment.

**Documentation-heavy.** Documents follow their subject, not their genre. A `guides/ reference/ tutorials/` split is the layer-first mistake in prose: every change to one subject scatters across all three. Group by subject and let genre be a heading inside it, with one exception — a top-level entry point that orients a new reader.
