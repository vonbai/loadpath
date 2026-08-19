# Dependency edges route to native analyzers, or report Not measured

Substring matching of directory paths measured 94.3% precision at one repository root and 43.5% one directory down, where short English-word directory names match ordinary prose. On the validation repository every reported cycle was false. Per-language import regexes recover recall across ecosystems but still cannot resolve aliases, re-exports, or dynamic imports.

So the tool does not guess. It shells out to the ecosystem's own analyzer when one is present — `go list -json`, `madge`, `grimp`, `jdeps` — labels the provenance, and otherwise reports Not measured.

## Consequences

Coverage drops to whatever analyzers a machine happens to have, and on a repository with none the dependency axis is simply absent. That is the trade: an absent axis costs a reader nothing, and a fabricated one costs them a restructuring.
