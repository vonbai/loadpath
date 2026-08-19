# The tool emits Leads, never verdicts

v0.1.0 emitted judgements — "this is a cycle", "this file is a god file", "this coupling is rising" — and all three were wrong in ways the underlying figures were not. The cycles were substring artifacts in a Go module where the compiler forbids cycles; the `rising` label inverted on constant coupling and flipped on one skewed commit date; the 800-line threshold had no source. The figures behind them were never wrong.

So the tool emits measurements and the reading agent judges them. A line count, a commit count, and a per-window profile are facts; "god file", "rising", and "this is a cycle" are readings, and they belong to whoever read the code.

## Consequences

The output is longer and less immediately satisfying than a list of problems. That is the trade accepted: a wrong verdict costs a restructuring around a fiction, while an unread fact costs nothing.
