# Read history with `--name-status -M`, and report relocation events

The history pass already runs; switching it from `--name-only` to `--name-status -M` costs nothing measurable — 0.265 s against 0.256 s on a 2,797-file repository — and returns rename records, add/delete status, author and date in the same pass.

Aggregating those rename records to their highest differing path prefix yields the repository's migration history in about 24 tokens: which directory became which, when, and how many files moved. code-maat, hercules and git-of-theseus were each checked and none reports it.

A skill about structure and migration that cannot say what a repository has already moved is missing the most on-thesis history fact available, and it is free.

## Consequences

Rename records also give a baseline identity that survives a rename, which nothing surveyed — dependency-cruiser, ArchUnit's `FreezingArchRule`, Semgrep's `--baseline-commit` — currently does.
