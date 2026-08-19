# Triage labels

Two category roles and five state roles, at their default names.

## Category

| Role | Label |
|---|---|
| Bug | `bug` |
| Feature | `enhancement` |

## State

| Role | Label | Meaning |
|---|---|---|
| Needs triage | `needs-triage` | Arrived raw; not yet categorised |
| Needs info | `needs-info` | Blocked on an answer from the reporter |
| Needs grilling | `needs-grilling` | Categorised, but the shape of the work is still foggy |
| Ready for agent | `ready-for-agent` | Self-contained enough for an agent to implement |
| Blocked | `blocked` | Waiting on another issue |

Only issues that arrived raw get triaged. Tickets produced by `to-tickets` are already agent-ready.
