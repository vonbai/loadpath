#!/usr/bin/env python3
"""Fail the build if the skill's frontmatter or budget regresses."""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(ROOT, "skills", "loadpath", "SKILL.md")
errors = []

text = open(SKILL).read()
m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
if not m:
    errors.append("SKILL.md has no frontmatter block")
else:
    fm = m.group(1)
    name = re.search(r"^name:\s*(\S+)", fm, re.M)
    desc = re.search(r"^description:\s*(.+)", fm, re.M | re.S)
    if not name or name.group(1) != "loadpath":
        errors.append(f"name must be 'loadpath', got {name.group(1) if name else None!r}")
    if not desc:
        errors.append("description is missing")
    elif len(" ".join(desc.group(1).split())) < 80:
        errors.append("description is too short to route on")
    if "allowed-tools" in fm:
        errors.append("declaring allowed-tools raises the machine's tool surface; keep it out")

lines = text.count("\n") + 1
if lines > 500:
    errors.append(f"SKILL.md is {lines} lines; the budget is 500")
approx_tokens = len(text) / 3.2
if approx_tokens > 5000:
    errors.append(f"SKILL.md is ~{approx_tokens:.0f} tokens; the budget is 5000")

for rel in ("references/canon.md", "references/language-conventions.md", "scripts/scan.py"):
    p = os.path.join(ROOT, "skills", "loadpath", rel)
    if not os.path.exists(p):
        errors.append(f"SKILL.md points at {rel}, which does not exist")

for ref in re.findall(r"`(references/[\w.-]+|scripts/[\w.-]+)`", text):
    p = os.path.join(ROOT, "skills", "loadpath", ref)
    if not os.path.exists(p):
        errors.append(f"broken pointer in SKILL.md: {ref}")

if errors:
    print("FAIL")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print(f"OK  SKILL.md {lines} lines, ~{approx_tokens:.0f} tokens, pointers resolve")
