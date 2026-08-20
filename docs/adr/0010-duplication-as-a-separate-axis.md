# Near-duplicate detection is a separate axis from co-change

> **Status:** accepted, not yet implemented — no shingling exists in v0.2.1.

Hashing windows of ten consecutive normalised non-comment lines and aggregating collisions to directory pairs costs 1.2–2.2 s over a thousand files and about 127 tokens of output.

It earns its place on a measured redundancy test rather than on plausibility: the top duplicate pairs have co-change counts of 5–38 and appear nowhere in the top co-change list. The two axes are orthogonal. Co-change reports what does change together; duplication reports what should change together and does not — clone drift, which is the failure that costs.

Three filters each measurably matter: skip comment lines or licence headers dominate the result, exclude ancestor/descendant directory pairs, and separate tests from source or test scaffolding swamps everything.
