# Context

Vocabulary this project uses precisely. A term here means what this file says, not what it means in ordinary use.

**Load path** — how dependency runs through a codebase: each directory bears the weight of everything that imports it. The metaphor is structural engineering, where the load path is how weight travels from where it is applied down to the ground. Tracing it is how you learn what a structure really is.

**Projection** — the directory tree understood as the physical shadow of decisions made elsewhere: the product's subjects, the architecture's decisions, and observed reality. A tree either expresses those faithfully or lies about them.

**Drift** — divergence between a projection and the design it should express. Drift requires a referent: structure judged from code alone has nothing to be drift *from*.

**Signal** — a countable measurement that opens a question. A signal never closes one. Non-technical causes leave fingerprints identical to genuine design problems, so no signal licenses a boundary move.

**Subject** — what a directory is *about*, named in the project's own vocabulary. `billing`, `session`, `market`. Not a role (`managers`), not a layer (`services`), not a gap-holder (`utils`, `common`, `shared`, `core`, `misc`).

**Seam** *(Michael Feathers)* — a place where behaviour can be altered without editing at that place. Where the seam falls on disk is this project's concern; what sits behind it is `codebase-design`'s.

**Load-bearing path** — a path declared frozen, vendored, generated, or archived. An invariant of every proposal, not a caveat on it.

**Projection separation** — static dependency, change affinity, runtime interaction, and shared data are different graphs over the same code. They are read side by side and never merged; an acceptable edge in one never excuses an invalid edge in another.

**Sound over-approximation** — the dependency detection finds every real edge and some false ones. The consequence is asymmetric trust: absence of a cycle is trustworthy, presence of one wants a glance.
