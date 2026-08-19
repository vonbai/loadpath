# Cache keyed on git state, and the delta comes free

The cache key is the git state — `HEAD` plus a hash of the dirty working tree — compared on each run, in the manner GitNexus invalidates its index by comparing the indexed `lastCommit` against `HEAD`. Nothing cleverer is warranted: a full scan takes 136 ms, so the cache exists to enable comparison, not to save time.

Two cached runs diff into the report that matters during development — *what did this change make worse* — which is the one form of the output that survives the objection that absolute signals are noise on a repository whose problems are already known.
