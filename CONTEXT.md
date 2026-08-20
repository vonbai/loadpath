# Loadpath

A skill that keeps a codebase's structure legible while an agent builds in it. This glossary fixes the words; the reasoning lives in `DESIGN.md` and `docs/adr/`.

## Language

### What the tool produces

**Lead**:
An emitted measurement that points at code worth reading. It is the tool's only output class.
_Avoid_: finding, signal, issue, violation, smell

**Finding**:
What exists after the agent has read the code a Lead pointed at and confirmed what is there. The tool never produces one.
_Avoid_: result, detection, verdict

**Exact**:
A number read directly from the filesystem or from git history. Counting files, counting lines, counting commits.
_Avoid_: accurate, reliable, verified

**Inferred**:
A number produced by guessing at meaning without a parser. Confined to one module and labelled at every use.
_Avoid_: estimated, approximate, heuristic

**Not measured**:
A first-class result meaning no method applied here. Distinct from a measurement of zero, and never rendered as one.
_Avoid_: none, empty, clean, no results

### What the tool measures

**Affinity**:
Directories that change in the same commits. Measured from history, exact.
_Avoid_: coupling, temporal coupling, change coupling

**Dependency**:
One directory needing another to compile or run. Measured by a native analyzer, or Not measured.
_Avoid_: coupling, boundary, reference

**Span**:
One ecosystem's dependency graph, measured by that ecosystem's own analyzer at that ecosystem's own root. A repository has as many spans as it declares ecosystems; spans are reported side by side and never merged, because their units differ. A span that cannot be measured is a named absence, never silence.
_Avoid_: the dependency graph, analyzer pass, ecosystem view

**Load path**:
The direction dependency runs through a codebase — each directory bears the weight of everything that imports it. The reading that gives the project its name.
_Avoid_: dependency chain, call graph

### What the structure means

**Projection**:
The directory tree understood as the physical shadow of decisions made elsewhere — the product's subjects and the architecture's decisions. Used only of the tree.
_Avoid_: reflection, mapping, view

**Axis**:
One independent way of looking at the same code — inventory, history, dependency. Two axes agreeing is evidence; one axis alone is a Lead.
_Avoid_: projection, dimension, signal source

**Drift**:
Divergence between the tree and the design it should express. Requires a declared design to diverge from; a tree read alone cannot show it.
_Avoid_: erosion, decay, rot

**Subject**:
What a directory is about, named in the project's own vocabulary. `billing`, `session`, `market` — not a role, not a layer, not a name for the absence of one.
_Avoid_: concern, domain, component, module

**Seam** *(Michael Feathers)*:
A place where behaviour can be altered without editing at that place. Where a seam falls on disk is this project's concern; what sits behind it belongs to `codebase-design`.
_Avoid_: boundary, interface, layer

**Load-bearing path**:
A path the project has declared frozen, vendored, generated, or archived. An invariant of every proposal.
_Avoid_: excluded, ignored, protected
