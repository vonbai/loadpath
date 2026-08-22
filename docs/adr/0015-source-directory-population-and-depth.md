# Source-directory population and every depth name their unit

Inventory groups admitted source files by their direct parent. It does not enumerate the physical tree: a container such as `src/`, a documentation-only directory, and an empty directory have no row. Yet the page called that population “directories”, promised `--structure` showed “every directory”, and ended the first line with a bare `3 deep`. The first two claims were wider than the measurement; the third could be read as physical nesting, dependency Layer depth, or the depth of a module's interface.

The public vocabulary therefore names four different things:

- the **Source population** is the current, readable, non-generated set admitted by Inventory;
- a **Source-containing directory** is the direct parent of one or more of those files;
- **Source-path depth** is the repository-relative segment count to such a directory, emitted only as the maximum orientation fact;
- **Layer depth** is the number of layers in one dependency Span after entangled units collapse.

Inventory, Scatter, current-file History, snapshots and the structure table use Source-containing directories and say so. The snapshot field remains `dirs` so this wording correction does not manufacture a schema migration; its closed schema already records the same population. Relocations remain wider because ADR 0009 records every renamed file type.

Source-path depth carries no pass/fail value and no recommended maximum. Every new path segment must instead earn its level by naming a Subject, expressing a language- or project-enforced seam, or preserving a Load-bearing path constraint. Adjacent levels that repeat the same taxonomy collapse. Conventional containers such as `src`, `internal`, `tests` and `packages` remain valid when the ecosystem or repository makes them do real work.

The structure view remains a flat, mass-ordered table with a full path on every row. A recursive parent rollup is deferred until a pinned deep-tree fixture demonstrates that the budgeted table loses parent context needed for a real placement decision; Source-path depth alone is not that evidence.

## Alternatives rejected

**Keep “directory” as shorthand.** It makes a true implementation sound like a whole-filesystem inventory and leaves a reader unable to reconcile the count with the tree they can see.

**Enumerate every physical directory.** Container-only and unsupported-file directories have none of the file, line, test or current-source History facts the table exists to compare. Adding empty rows would widen the product without making a placement decision more legible.

**Set a maximum directory depth.** No retained source or pinned corpus ties a segment count to a maintenance decision. A two-level taxonomy can be redundant and a five-level import seam can be load-bearing; the number cannot decide between them.

**Build recursive hierarchy now.** Full paths preserve ancestry for each row, while mass order preserves the highest-information rows under the token budget. A second hierarchy is justified only by evidence that this combination loses a consequential parent relationship.

## Consequences

The CLI becomes more explicit and slightly longer. Container-only directories are intentionally absent and no output may call their absence a complete tree. Physical depth, dependency Layer depth and Deep module design can now coexist on one page without sharing an unlabeled number. Internal declarations, symbols and interfaces remain a reading task rather than a new parser axis.
