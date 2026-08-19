# v0.1.0 is withdrawn rather than patched

Three independent adversarial reviews found the same class of defect: the release's headline safety property — "no cycle here is trustworthy" — was false outside Go, its published precision figure described code that had already changed, and its test suite let 14 of 20 one-line feature deletions pass. On the one repository it was validated against, every cycle it reported was fabricated.

The defects were not in the implementation but in the contract, so patching would have left a document whose claims the code could not meet. v0.1.0 is marked unusable and v0.2.0 is built to `DESIGN.md`, which was written from the failure.

## Consequences

Anyone who installed v0.1.0 has a tool that reports false cycles on Go repositories. The release notes say so.
