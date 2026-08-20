# Dependencies are spans, one per ecosystem, never one merged graph

A repository holding `backend/go.mod` beside `frontend/package.json` printed its two declared modules and then, four lines below them on the same page, `dependencies not measured — no analyzer applies to this repository`. Two causes, both reproduced: the single analyzer root was the common ancestor of every manifest, which for a split tree is the repository root, where neither `go list` nor madge finds a project; and the analyzer list returned the first answer, so where Go and TypeScript sat at one root the Go graph was returned and every TypeScript edge was silently absent.

The unit is what forbids the obvious repair. `go list` counts packages, madge counts file directories, `.csproj` counts projects, grimp counts module directories. A sum over those is a number with no unit, and a layer depth over their union is a depth of nothing.

So each declared ecosystem is measured by its own analyzer, rooted at the common ancestor of its own manifests, and reported as its own **span** — `dependencies (Go)` beside `dependencies (Node)`, each carrying its own unit, its own layer depth and its own entangled groups. An ecosystem whose analyzer cannot run is a named absence: a toolchain that is not installed, a project directory that is not there, an ecosystem this tool ships no analyzer for. Never a missing line.

## Alternatives rejected

**One merged graph.** It would have to state a unit, and there is none to state. The only honest label for the union of packages and file directories is "nodes", which is the shape v0.1.0 emitted and ADR 0006 withdrew.

**First answer wins.** This is what shipped. Its failure is silent partiality: a correct graph, correctly labelled, standing for a repository half of which it never looked at.

**Disclosure only** — one graph plus a sentence naming the ecosystems that were not measured. It keeps the contradiction on the page and asks prose to defuse it, which is the move DESIGN.md rejects in "Measure ↔ render": a number that needs a disclaimer beside it to be read correctly is the wrong number.

## Consequences

A polyglot repository pays one line per ecosystem, and a repository declaring an ecosystem this tool cannot analyse pays a line to say so. That cost is the point: the alternative is a page that contradicts itself.

Entangled groups are numbered across the page rather than within a span, so `g1` names one group wherever a reader meets it. Layer numbers stay per span, because a layer count is a depth within one graph and comparing depths across ecosystems compares nothing.
