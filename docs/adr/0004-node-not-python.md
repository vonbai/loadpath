# Implemented in plain Node ESM, not Python or shell

The advertised install is `npx skills add`, so every user of this skill already has Node. Python is a second runtime requirement: on macOS `python3` arrives with the Xcode command line tools rather than the base system, and the version that does arrive is the deprecated 3.9. Shell was never viable — macOS ships bash 3.2, which has no associative arrays, making graph work and NUL-safe git parsing impractical.

Measured throughput decided nothing: a full walk of a 1454-file repository takes 0.08 s in Node and 0.07 s in Python. Both sibling skill repositories are Node.

Plain `.mjs` with JSDoc types, not TypeScript: a build step is too much weight for a few hundred lines, and the shipped artefact should be the file that runs.
