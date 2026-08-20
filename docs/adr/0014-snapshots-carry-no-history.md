# A snapshot carries layout and spans, never history

Restructuring is the work this skill exists to support, and the obvious way to check a move is to measure before and after. Two of the three axes answer immediately: a renamed directory is renamed the moment it lands, and `go list` reads the new import paths on the next run. The third does not. History is append-only, and a window twelve months wide holds every commit that touched the old arrangement for twelve months more.

It does worse than lag. A migration is performed in the phases this skill prescribes — prepare, coexist, migrate, cut over — and each of those phases is a commit touching the old home and the new one together, which is exactly the shape co-change reads as affinity. The denominator makes it louder rather than quieter: a directory the migration created has no commits but the migration's own, so the pair's share is taken over a base of four or five and lands near the top of the page. The old side meanwhile leaves the page entirely, because a pair naming a directory the tree no longer has is dropped by the join against the live tree. Activity inverts the same way, since a directory created yesterday is by construction one of the recently touched.

So the snapshot records what a move changes the moment it lands — the file and directory layout, and each measured span's edges, nodes, layer depth and entangled group membership — and nothing derived from git. `--compare` reports the delta over exactly those, and closes by naming the axes it did not compare and why, on every run, because the reader who needs that sentence is the one who did not think to ask for it.

## Alternatives rejected

**Record co-change and activity too, and diff them.** The window slides between the two scans, so commits enter at the near end and leave at the far end whatever the reader did; the delta would be mostly the calendar, with the migration's own commits on top. It also fails ADR 0012 on that ADR's terms: a vote-sum minus a vote-sum carries neither the spread, nor the bucket parameter, nor the denominator that made the original readable, and there is nothing left on the page to read the difference against.

**Reset the window so the "after" starts at the move.** That reports a repository whose history begins at the refactor, which is not a repository that exists. Choosing a window for the answer it produces is the failure `--since` normalisation exists to prevent, arriving through the front door.

**Record every span, measured or not.** A span that could not be measured has no edges, no layers and no groups, and recording zeros for it would make installing a toolchain read as a restructuring — the conflation of "not measured" with "measured zero" that ADR 0013 refused for the span line itself. Only measured spans enter the record. A span present on one side alone is then reported as a gap in the comparison rather than as a move, and does not suppress the sentence saying nothing structural changed.

## Consequences

`--compare` cannot tell a reader whether the affinity they moved on has gone. It can tell them the layout and the graph moved as intended, and that the other question has to be asked again later. That division is the honest one, and the closing line states it rather than leaving the absence to be noticed.

The comparison a history-derived figure supports is across windows of one repository, not across a refactor. `--since` is the parameter that makes it, and the window it resolved to is already printed beside every figure it governs.

A snapshot is a record rather than a lead, so it carries the version that wrote it, and `--compare` refuses a file without one instead of reading absent fields as zeros. A shape this tool did not write is not a shape it can diff.
