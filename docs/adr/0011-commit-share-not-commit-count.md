# Emit commit-share concentration beside the commit count

In a defect model over 25 releases of 7 systems, weighed against 59 confounders and 54 static product metrics, the top author's share of commits to a file took the first importance rank group and the count of authors above a 5% share took the second — above every static size and complexity metric. Blame-derived line ownership ranked sixth and was explicitly described as weakly associated.

The commit count this tool already collects is the raw ingredient, not the metric that carried the signal. Keying the per-window accumulator by `(path, author)` rather than `path` yields the ratio at no extra pass.

The ratio is emitted **beside** the count, never instead of it, because it is undefined exactly where activity is absent — and between 19% and 67% of files receive no commits in a given window while 0% to 18% of those still carry a later defect. A quiet directory must not read as a safe one.

## Consequences

`git blame` stays out on two independent grounds: 3.4 s per 200 files, and a measured sixth-place ranking. If blame data ever enters this tool it is an authorship figure and is labelled as one.
