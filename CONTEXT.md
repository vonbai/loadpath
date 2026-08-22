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

**Snapshot**:
The immediate signals of one scan (layout and spans), recorded to compare a restructuring's before and after. History is not in it: history is append-only and lags a move by design.
_Avoid_: baseline, checkpoint, dump

### What the tool measures

**Source population**:
Current, readable, non-generated files in the requested scope whose extensions Inventory admits, after vendored, build-output and submodule paths are skipped. Inventory, Scatter, current-file History and layout Leads all use this population; Relocations deliberately do not.
_Avoid_: all files, repository files, codebase files

**Source-containing directory**:
The direct parent of one or more files in the Source population. A container-only directory and a directory holding only unsupported file types are not members of this population.
_Avoid_: directory, source directory, every directory

**Source-path depth**:
The number of repository-relative path segments to a Source-containing directory. The tool emits the maximum as an orientation fact only; it is not Layer depth and is not a quality threshold.
_Avoid_: depth, tree depth, directory depth

**Affinity**:
Source-containing directories that change in the same commits. Measured from history, exact.
_Avoid_: coupling, temporal coupling, change coupling

**Scatter**:
A name token recurring across several Source-containing directories. A lead that one subject is spread across the tree — or that a layer name is standing where a subject name should be. Counted over distinct Source-containing directories, not files.
_Avoid_: duplication, naming smell, convention

**Dependency**:
A unit in one Span needing another to compile or run. The unit is named by that ecosystem's analyzer; it may be a package, project, module directory or file directory. Measured by a native analyzer, or Not measured.
_Avoid_: coupling, boundary, reference

**Span**:
One ecosystem's dependency graph, measured by that ecosystem's own analyzer at that ecosystem's own root. A repository has as many spans as it declares ecosystems; spans are reported side by side and never merged, because their units differ. A span that cannot be measured is a named absence, never silence.
_Avoid_: the dependency graph, analyzer pass, ecosystem view

**Load path**:
The direction dependency runs through a Span — each unit bears the weight of everything that imports it. The reading that gives the project its name.
_Avoid_: dependency chain, call graph

**Layer depth**:
The number of layers along the longest dependency route in one measured Span after mutually entangled units are collapsed together. It has no physical-directory meaning.
_Avoid_: depth, Source-path depth, module depth

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

**Deep module** *(John Ousterhout)*:
Much behaviour hidden behind a small interface. A quality relationship, not a count of files, path segments or dependency layers.
_Avoid_: deep directory, Source-path depth, Layer depth

**Seam** *(Michael Feathers)*:
A place where behaviour can be altered without editing at that place. Where a seam falls on disk is this project's concern; what sits behind it belongs to `codebase-design`.
_Avoid_: boundary, interface, layer

**Load-bearing path**:
A path the project has declared frozen, vendored, generated, or archived. An invariant of every proposal.
_Avoid_: excluded, ignored, protected
