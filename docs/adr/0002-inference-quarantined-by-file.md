# Inference lives in its own file

Measurement in this tool comes in two kinds. Counting files, counting lines and reading git history are exact by construction. Guessing at import meaning without a parser is not — and in v0.1.0 the inexact half discredited the exact half, because nothing separated them.

Dependency inference therefore lives alone in `scripts/deps.mjs`; everything exact lives in `scripts/scan.mjs`. The file boundary *is* the exact/inferred seam, visible from a directory listing without reading code.

## Considered options

Splitting by feature — one file per signal — was rejected: it groups by what a reader already sees in the output and hides the only distinction that decides whether a number can be trusted. A single file was rejected because it leaves the modules as function groupings, which is how v0.1.0 let one bad measurement contaminate the rest.
