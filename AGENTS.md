# Loadpath

An Agent Skill that keeps a codebase's structure legible while an agent builds in it.

## Read first

1. `CONTEXT.md` — the glossary. Use its words exactly.
2. `DESIGN.md` — the root principles and module design. These are acceptance criteria for any change.
3. `docs/adr/` — recorded decisions. Do not re-litigate one without new evidence.
4. `docs/evidence.md` — what each measurement rests on, and what no source supports.

## Agent skills

Matt Pocock's engineering skills are configured for this repo. `docs/agents/issue-tracker.md` says where issues live, `docs/agents/triage-labels.md` fixes the label vocabulary, `docs/agents/domain.md` records the doc layout.

## The rule that decides most questions

The tool emits Leads, never verdicts. A measurement points at code worth reading; a Finding exists only after the code was read. When a change would make the tool assert something rather than measure something, it is the wrong change.
