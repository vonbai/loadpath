#!/usr/bin/env python3
"""Measure the drift signals in SKILL.md. Python 3 standard library only.

    python3 scan.py [REPO] [--since 12.months] [--top N]

Prints one section per signal. Every number is a measurement; whether it is a
problem is the reading agent's call.

The co-change section is the reason this script exists: the Common Closure
Principle is a claim about history, and history cannot be eyeballed.
"""

import argparse
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

SOURCE_EXT = {
    ".go", ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".rs", ".java", ".kt",
    ".rb", ".php", ".cs", ".swift", ".c", ".h", ".cc", ".cpp", ".hpp", ".m",
    ".scala", ".ex", ".exs", ".clj", ".hs", ".ml", ".sol", ".zig", ".dart",
}
SKIP_DIR = {
    ".git", "node_modules", "vendor", "target", "dist", "build", ".venv",
    "venv", "__pycache__", ".next", ".nuxt", "coverage", ".tox", "third_party",
    "Pods", ".gradle", ".idea", ".mypy_cache", ".pytest_cache", "bin", "obj",
}
TEST_RE = re.compile(r"(^test_|_test\.|\.test\.|\.spec\.|^tests?$|_spec\.)", re.I)


def is_test(path):
    base = os.path.basename(path)
    return bool(TEST_RE.search(base)) or "/test" in path.lower()


def walk(root):
    """Yield (dirpath_relative, [source filenames])."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIR and not d.startswith(".")]
        src = [f for f in filenames if os.path.splitext(f)[1] in SOURCE_EXT]
        rel = os.path.relpath(dirpath, root)
        yield ("." if rel == "." else rel), sorted(src), sorted(dirnames)


def section(title):
    print(f"\n=== {title} ===")


def flat_sprawl(tree):
    section("Flat sprawl  (>20 source files, 0 subdirectories)")
    hits = [(d, len(f)) for d, f, subs in tree if len(f) > 20 and not subs]
    for d, n in sorted(hits, key=lambda x: -x[1]):
        print(f"  {n:>4} files  0 subdirs   {d}")
    if not hits:
        print("  none")


def shared_name_token(tree):
    """A name token carried by several files in one directory is a package that
    was never created: the author knew the grouping and expressed it in the only
    place the layout left available. Position matters only for the report --
    `account_commands`, `host_commands`, `plan_commands` names `commands` just as
    surely as `session_open`, `session_close` names `session`.
    """
    section("Shared name token  (>=3 files in one directory sharing a token)")
    found = False
    for d, files, _ in tree:
        carriers = defaultdict(set)
        position = {}
        for f in files:
            stem = os.path.splitext(f)[0]
            stem = re.sub(r"(_test|\.test|\.spec|_spec)$", "", stem)
            parts = [t for t in re.split(r"[_\-.]|(?<=[a-z0-9])(?=[A-Z])", stem) if t]
            if len(parts) < 2:
                continue
            base = re.sub(r"(_test|\.test|\.spec|_spec)?\.[^.]+$", "", f)
            for i, tok in enumerate(parts):
                t = tok.lower()
                carriers[t].add(base)
                position.setdefault(t, set()).add("leading" if i == 0 else
                                                 "trailing" if i == len(parts) - 1 else "middle")
        for tok, members in sorted(carriers.items(), key=lambda kv: -len(kv[1])):
            if len(members) < 3:
                continue
            where = "/".join(sorted(position[tok]))
            found = True
            print(f"  {len(members):>4} files  '{tok}' ({where})   {d}")
    if not found:
        print("  none")


def god_files(root, tree):
    section("God files  (>800 lines, or >3x the directory median)")
    hits = []
    for d, files, _ in tree:
        counts = []
        for f in files:
            p = os.path.join(root, d, f) if d != "." else os.path.join(root, f)
            try:
                with open(p, "rb") as fh:
                    counts.append((sum(1 for _ in fh), f))
            except OSError:
                continue
        if not counts:
            continue
        med = sorted(n for n, _ in counts)[len(counts) // 2]
        for n, f in counts:
            if n > 800 or (med > 0 and n > 3 * med and n > 300):
                hits.append((n, med, os.path.join(d, f) if d != "." else f))
    for n, med, p in sorted(hits, reverse=True)[:20]:
        print(f"  {n:>5} lines  (dir median {med:>4})   {p}")
    if not hits:
        print("  none")


def test_inversion(tree):
    section("Test inversion  (test:impl > 2:1 with no subdirectories)")
    hits = []
    for d, files, subs in tree:
        if subs:
            continue
        t = sum(1 for f in files if is_test(f))
        i = len(files) - t
        if i and t / i > 2:
            hits.append((t / i, t, i, d))
    for r, t, i, d in sorted(hits, reverse=True):
        print(f"  {t:>3} tests / {i:<3} impl  ({r:.1f}:1)   {d}")
    if not hits:
        print("  none")


def orphans_and_depth(tree):
    section("Orphans and depth  (single-file dirs; dirs whose only child is a dir)")
    hits = []
    for d, files, subs in tree:
        if d == ".":
            continue
        if len(files) == 1 and not subs:
            hits.append(("single file", d))
        if not files and len(subs) == 1:
            hits.append(("pass-through", d))
    for kind, d in hits[:25]:
        print(f"  {kind:<13}  {d}")
    if not hits:
        print("  none")


def co_change(root, since, top, windows=4):
    """Weighted co-change. Each commit casts one vote split among the directory
    pairs it implies, so a wide tangled commit cannot mint a dense clique, and a
    bulk-creation commit is damped further. Votes are bucketed into time windows
    so a burst at creation reads differently from coupling that keeps rising.
    """
    section(f"Co-change  (weighted, {windows} time windows, since {since})")
    try:
        out = subprocess.run(
            ["git", "-C", root, "log", f"--since={since}", "--name-status",
             "--pretty=format:%x00%H %at", "--no-merges"],
            capture_output=True, text=True, timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"  unavailable: {e}")
        return
    if out.returncode != 0:
        print("  unavailable: not a git repository, or no history")
        return

    commits, cur, when, adds, edits = [], set(), None, 0, 0
    def flush():
        if cur and when is not None:
            commits.append((when, frozenset(cur), adds, edits))
    for line in out.stdout.split("\n"):
        if line.startswith("\x00"):
            flush()
            cur, adds, edits = set(), 0, 0
            m = re.match(r"\x00[0-9a-f]{40} (\d+)", line)
            when = int(m.group(1)) if m else None
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status, path = parts[0][:1], parts[-1]
        if os.path.splitext(path)[1] not in SOURCE_EXT:
            continue
        d = os.path.dirname(path)
        if not d or any(seg in SKIP_DIR for seg in d.split("/")):
            continue
        cur.add(d)
        if status == "A":
            adds += 1
        else:
            edits += 1
    flush()

    if not commits:
        print("  no source-file commits in range")
        return

    times = sorted(c[0] for c in commits)
    lo, hi = times[0], times[-1]
    span = max(hi - lo, 1)

    breadths = sorted(len(c[1]) for c in commits)
    wide = sum(1 for b in breadths if b > 4)
    print(f"  {len(commits)} commits touching source")
    print(f"  Scatter: {wide} commits ({100*wide//len(commits)}%) touch >4 directories")
    print(f"  Median directories per commit: {breadths[len(breadths)//2]}")

    pair = defaultdict(lambda: [0.0] * windows)
    own = defaultdict(lambda: [0.0] * windows)
    for ts, dirs, adds, edits in commits:
        k = len(dirs)
        if k < 2:
            for d in dirs:
                own[d][min(int((ts - lo) * windows // span), windows - 1)] += 1.0
            continue
        # one commit, one vote, split across the pairs it implies
        vote = 2.0 / (k * (k - 1))
        # a commit that only adds files is creation, not coupling
        if edits == 0:
            vote *= 0.15
        w = min(int((ts - lo) * windows // span), windows - 1)
        ds = sorted(dirs)
        for d in ds:
            own[d][w] += 1.0
        for i in range(len(ds)):
            for j in range(i + 1, len(ds)):
                pair[(ds[i], ds[j])][w] += vote

    def trend(v):
        first, last = v[0], v[-1]
        later = sum(v[1:])
        if later == 0:
            return "at-creation"
        if last > first and later > first:
            return "rising"
        if first > 0 and later < first * 0.5:
            return "fading"
        return "steady"

    rows = []
    for (a, b), v in pair.items():
        total = sum(v)
        if total < 0.5:
            continue
        base = min(sum(own[a]), sum(own[b]))
        if base < 3:
            continue
        rows.append((total / base, total, trend(v), v, a, b))

    print("\n  Strongest weighted pairs. 'score' is shared vote over the rarer")
    print("  directory's own commits; 'profile' is that vote across time windows.")
    if not rows:
        print("    none above threshold")
        return
    for norm, total, tr, v, a, b in sorted(rows, reverse=True)[:top]:
        prof = " ".join(f"{x:.1f}" for x in v)
        print(f"    score {norm:5.2f}  [{prof}]  {tr:<11}  {a}  <->  {b}")
    print("\n  Read the trend, not the score alone. 'rising' is coupling that grew after")
    print("  both directories existed - the case worth acting on. 'at-creation' and")
    print("  'fading' are artifacts of how the code was introduced, not of its design.")
    print("  A high score still licenses a question, never a boundary move: non-technical")
    print("  causes leave the same fingerprint as genuine design coupling.")


IMPORT_RE = {
    ".go": [r'"([^"\n]+)"'],
    ".py": [r"^\s*from\s+([.\w]+)\s+import", r"^\s*import\s+([.\w]+)"],
    ".rs": [r"^\s*(?:pub\s+)?use\s+([\w:]+)"],
    ".java": [r"^\s*import\s+(?:static\s+)?([\w.]+)"],
    ".kt": [r"^\s*import\s+([\w.]+)"],
    ".cs": [r"^\s*using\s+(?:static\s+)?([\w.]+)"],
    ".rb": [r"""^\s*require(?:_relative)?\s+['"]([^'"]+)['"]"""],
    ".php": [r"^\s*use\s+([\w\\]+)"],
    ".swift": [r"^\s*import\s+(\w+)"],
    ".scala": [r"^\s*import\s+([\w.]+)"],
    ".ex": [r"^\s*(?:import|alias|use)\s+([\w.]+)"],
    ".exs": [r"^\s*(?:import|alias|use)\s+([\w.]+)"],
    ".dart": [r"""^\s*import\s+['"]([^'"]+)['"]"""],
}
for _e in (".ts", ".tsx", ".js", ".jsx", ".mjs"):
    IMPORT_RE[_e] = [r"""\bfrom\s+['"]([^'"]+)['"]""",
                     r"""\brequire\(\s*['"]([^'"]+)['"]""",
                     r"""\bimport\s*\(\s*['"]([^'"]+)['"]"""]
for _e in (".c", ".h", ".cc", ".cpp", ".hpp", ".m"):
    IMPORT_RE[_e] = [r'#\s*include\s+"([^"]+)"']

# Extensions whose import syntax carries no path at all; a reference cannot be
# resolved to a directory, so the language is reported as unsupported rather
# than measured as empty.
PATHLESS = {".swift"}


def _refs(text, ext):
    out = []
    for pat in IMPORT_RE.get(ext, []):
        out += re.findall(pat, text, re.M)
    return out


def _resolve(ref, from_dir, dirs, dir_tails):
    """Map one import reference onto a known directory, or None."""
    if ref.startswith("."):
        if re.match(r"^\.[\w]", ref):                 # python dotted module
            norm = ref.lstrip(".").replace(".", "/")
            cand = os.path.normpath(os.path.join(from_dir, norm))
        else:                                          # ./ or ../ path
            cand = os.path.normpath(os.path.join(from_dir, ref))
        cand = os.path.dirname(cand) if cand not in dirs else cand
        return cand if cand in dirs else None
    norm = ref.replace("::", "/").replace("\\", "/")
    if "/" not in norm:
        norm = norm.replace(".", "/")
    norm = norm.strip("/")
    if not norm:
        return None
    parts = norm.split("/")
    # Longest suffix of the reference that names a real directory.
    for i in range(len(parts)):
        tail = "/".join(parts[i:])
        if tail in dirs:
            return tail
        hit = dir_tails.get(tail)
        if hit and len(hit) == 1:
            return next(iter(hit))
    for i in range(len(parts) - 1, 0, -1):
        tail = "/".join(parts[i:-1]) if len(parts) > 1 else ""
        if tail and tail in dirs:
            return tail
    return None


def dependencies(root, tree):
    """Directed dependency edges between directories, read from import syntax.

    Per-language import patterns, resolved onto known directories. Where a
    repository's language has no pattern here, that is reported rather than
    silently counted as zero: an unmeasured graph must never read as a clean one.

    This is evidence for a reading agent, not a verdict. Route enforcement, and
    any claim that needs to be exact, to the ecosystem's own analyzer.
    """
    section("Dependencies  (import references, non-test source)")
    dirs = {d for d, files, _ in tree if d != "." and files}
    dir_tails = defaultdict(set)
    for d in dirs:
        parts = d.split("/")
        for i in range(len(parts)):
            dir_tails["/".join(parts[i:])].add(d)

    edges, seen_ext, unsupported = set(), Counter(), Counter()
    for d, files, _ in tree:
        if d == "." or not files:
            continue
        for f in files:
            if is_test(f):
                continue
            ext = os.path.splitext(f)[1]
            seen_ext[ext] += 1
            if ext not in IMPORT_RE or ext in PATHLESS:
                unsupported[ext] += 1
                continue
            try:
                with open(os.path.join(root, d, f), errors="replace") as fh:
                    text = fh.read()
            except OSError:
                continue
            for ref in _refs(text, ext):
                target = _resolve(ref, d, dirs, dir_tails)
                if target and target != d:
                    edges.add((d, target))

    covered = sum(n for e, n in seen_ext.items() if e in IMPORT_RE and e not in PATHLESS)
    total = sum(seen_ext.values())
    if total:
        print(f"  Read {covered}/{total} non-test source files "
              f"({100 * covered // max(total, 1)}% of the tree)")
    if unsupported:
        names = ", ".join(f"{e or '(none)'}×{n}" for e, n in unsupported.most_common(6))
        print(f"  Not read — no import pattern for: {names}")
        print("  Treat the graph below as partial. Read those files yourself.")
    if not edges:
        print("  No edges resolved. This is 'not measured', not 'no dependencies'.")
        return

    out = defaultdict(set)
    for a, b in edges:
        out[a].add(b)
    fan_in = Counter()
    for _, b in edges:
        fan_in[b] += 1
    print(f"  {len(edges)} edges over {len(dirs)} directories")

    two = sorted({tuple(sorted((a, b))) for a, b in edges if a in out.get(b, ())})
    print(f"\n  Two-directory cycles: {len(two)}")
    for a, b in two:
        print(f"    {a}  <->  {b}")

    three = set()
    for a in out:
        for b in out[a]:
            for c in out.get(b, ()):
                if c != a and a in out.get(c, ()):
                    three.add(tuple(sorted((a, b, c))))
    print(f"\n  Three-directory cycles: {len(three)}")
    for t in sorted(three)[:15]:
        print(f"    {'  ->  '.join(t)}")

    in_cycle = Counter()
    for a, b in two:
        in_cycle[a] += 1
        in_cycle[b] += 1
    for t in three:
        for d in t:
            in_cycle[d] += 1
    if in_cycle:
        print("\n  Hubs — a directory inside many cycles anchors the tangle:")
        for d, n in in_cycle.most_common(6):
            print(f"    in {n:>2} cycles   fan-out {len(out[d]):>3}  fan-in {fan_in[d]:>3}   {d}")

    print("\n  A cycle means neither directory can be understood, tested, or replaced")
    print("  alone. Confirm each one by reading the imports before acting: this is a")
    print("  regex over import syntax, not a resolved module graph. Keep it separate")
    print("  from the co-change graph — static dependency and change affinity are")
    print("  different projections of the same code.")


def co_change(root, since, top, windows=4):
    """Weighted co-change. Each commit casts one vote split among the directory
    pairs it implies, so a wide tangled commit cannot mint a dense clique, and a
    bulk-creation commit is damped further. Votes are bucketed into time windows
    so a burst at creation reads differently from coupling that keeps rising.
    """
    section(f"Co-change  (weighted, {windows} time windows, since {since})")
    try:
        out = subprocess.run(
            ["git", "-C", root, "log", f"--since={since}", "--name-status",
             "--pretty=format:%x00%H %at", "--no-merges"],
            capture_output=True, text=True, timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"  unavailable: {e}")
        return
    if out.returncode != 0:
        print("  unavailable: not a git repository, or no history")
        return

    commits, cur, when, adds, edits = [], set(), None, 0, 0
    def flush():
        if cur and when is not None:
            commits.append((when, frozenset(cur), adds, edits))
    for line in out.stdout.split("\n"):
        if line.startswith("\x00"):
            flush()
            cur, adds, edits = set(), 0, 0
            m = re.match(r"\x00[0-9a-f]{40} (\d+)", line)
            when = int(m.group(1)) if m else None
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status, path = parts[0][:1], parts[-1]
        if os.path.splitext(path)[1] not in SOURCE_EXT:
            continue
        d = os.path.dirname(path)
        if not d or any(seg in SKIP_DIR for seg in d.split("/")):
            continue
        cur.add(d)
        if status == "A":
            adds += 1
        else:
            edits += 1
    flush()

    if not commits:
        print("  no source-file commits in range")
        return

    times = sorted(c[0] for c in commits)
    lo, hi = times[0], times[-1]
    span = max(hi - lo, 1)

    breadths = sorted(len(c[1]) for c in commits)
    wide = sum(1 for b in breadths if b > 4)
    print(f"  {len(commits)} commits touching source")
    print(f"  Scatter: {wide} commits ({100*wide//len(commits)}%) touch >4 directories")
    print(f"  Median directories per commit: {breadths[len(breadths)//2]}")

    pair = defaultdict(lambda: [0.0] * windows)
    own = defaultdict(lambda: [0.0] * windows)
    for ts, dirs, adds, edits in commits:
        k = len(dirs)
        if k < 2:
            for d in dirs:
                own[d][min(int((ts - lo) * windows // span), windows - 1)] += 1.0
            continue
        # one commit, one vote, split across the pairs it implies
        vote = 2.0 / (k * (k - 1))
        # a commit that only adds files is creation, not coupling
        if edits == 0:
            vote *= 0.15
        w = min(int((ts - lo) * windows // span), windows - 1)
        ds = sorted(dirs)
        for d in ds:
            own[d][w] += 1.0
        for i in range(len(ds)):
            for j in range(i + 1, len(ds)):
                pair[(ds[i], ds[j])][w] += vote

    def trend(v):
        first, last = v[0], v[-1]
        later = sum(v[1:])
        if later == 0:
            return "at-creation"
        if last > first and later > first:
            return "rising"
        if first > 0 and later < first * 0.5:
            return "fading"
        return "steady"

    rows = []
    for (a, b), v in pair.items():
        total = sum(v)
        if total < 0.5:
            continue
        base = min(sum(own[a]), sum(own[b]))
        if base < 3:
            continue
        rows.append((total / base, total, trend(v), v, a, b))

    print("\n  Strongest weighted pairs. 'score' is shared vote over the rarer")
    print("  directory's own commits; 'profile' is that vote across time windows.")
    if not rows:
        print("    none above threshold")
        return
    for norm, total, tr, v, a, b in sorted(rows, reverse=True)[:top]:
        prof = " ".join(f"{x:.1f}" for x in v)
        print(f"    score {norm:5.2f}  [{prof}]  {tr:<11}  {a}  <->  {b}")
    print("\n  Read the trend, not the score alone. 'rising' is coupling that grew after")
    print("  both directories existed - the case worth acting on. 'at-creation' and")
    print("  'fading' are artifacts of how the code was introduced, not of its design.")
    print("  A high score still licenses a question, never a boundary move: non-technical")
    print("  causes leave the same fingerprint as genuine design coupling.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("repo", nargs="?", default=".")
    ap.add_argument("--since", default="12.months", help="git log --since value")
    ap.add_argument("--top", type=int, default=15, help="co-change pairs to print")
    a = ap.parse_args()

    root = os.path.abspath(a.repo)
    if not os.path.isdir(root):
        sys.exit(f"not a directory: {root}")

    tree = [(d, f, s) for d, f, s in walk(root) if f or s]
    total = sum(len(f) for _, f, _ in tree)
    print(f"Scanned {root}\n{total} source files in {len(tree)} directories")

    flat_sprawl(tree)
    shared_name_token(tree)
    god_files(root, tree)
    test_inversion(tree)
    orphans_and_depth(tree)
    dependencies(root, tree)
    co_change(root, a.since, a.top)
    print("\nSignals open questions; they do not close them.")


if __name__ == "__main__":
    main()
