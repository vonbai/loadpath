"""Acceptance tests for scan.py, run against synthetic repositories built here.

Each test constructs the exact shape a signal is supposed to catch, and asserts
both that the signal fires and — where the distinction matters — that it does
not fire on the shape it must not confuse with it.
"""

import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCAN = os.path.join(ROOT, "skills", "loadpath", "scripts", "scan.py")


def write(base, path, text=""):
    full = os.path.join(base, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as fh:
        fh.write(text)
    return full


def git(base, *args, env=None):
    e = dict(os.environ)
    e.update({
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
    })
    if env:
        e.update(env)
    return subprocess.run(["git", "-C", base, *args], capture_output=True, text=True, env=e)


def scan(base, *args):
    r = subprocess.run([sys.executable, SCAN, base, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError(f"scan.py exited {r.returncode}\n{r.stderr}")
    return r.stdout


def section(out, name):
    """Return only the named section's body, so a match cannot leak in from another."""
    start = out.find(f"=== {name}")
    if start < 0:
        raise AssertionError(f"section {name!r} missing from output:\n{out}")
    nxt = out.find("\n=== ", start + 1)
    return out[start:nxt if nxt > 0 else len(out)]


class FlatSprawl(unittest.TestCase):
    def test_fires_over_twenty_files_with_no_subdirectory(self):
        with tempfile.TemporaryDirectory() as d:
            for i in range(25):
                write(d, f"wide/f{i}.go", "package wide\n")
            body = section(scan(d), "Flat sprawl")
            self.assertIn("wide", body)

    def test_silent_when_the_directory_has_subdirectories(self):
        with tempfile.TemporaryDirectory() as d:
            for i in range(25):
                write(d, f"wide/f{i}.go", "package wide\n")
            write(d, "wide/inner/g.go", "package inner\n")
            self.assertIn("none", section(scan(d), "Flat sprawl"))


class SharedNameToken(unittest.TestCase):
    def test_fires_on_a_trailing_token(self):
        with tempfile.TemporaryDirectory() as d:
            for n in ("account", "host", "plan"):
                write(d, f"cmd/{n}_commands.go", "package cmd\n")
            body = section(scan(d), "Shared name token")
            self.assertIn("cmd", body)

    def test_fires_on_a_leading_token(self):
        with tempfile.TemporaryDirectory() as d:
            for n in ("open", "close", "resume"):
                write(d, f"p/session_{n}.go", "package p\n")
            self.assertIn("session", section(scan(d), "Shared name token"))

    def test_does_not_count_a_file_and_its_own_test_as_two(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "cmd/account_commands.go", "package cmd\n")
            write(d, "cmd/account_commands_test.go", "package cmd\n")
            write(d, "cmd/host_commands.go", "package cmd\n")
            self.assertIn("none", section(scan(d), "Shared name token"))


class GodFile(unittest.TestCase):
    def test_fires_over_eight_hundred_lines(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "pkg/big.go", "x\n" * 900)
            write(d, "pkg/small.go", "x\n" * 10)
            self.assertIn("big.go", section(scan(d), "God files"))


class TestInversion(unittest.TestCase):
    def test_fires_when_tests_outnumber_implementation_two_to_one(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "p/a.go", "")
            for i in range(3):
                write(d, f"p/a{i}_test.go", "")
            self.assertIn("p", section(scan(d), "Test inversion"))


class Dependencies(unittest.TestCase):
    def test_finds_a_two_directory_cycle(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "alpha/a.go", 'import "m/beta"\n')
            write(d, "beta/b.go", 'import "m/alpha"\n')
            body = section(scan(d), "Dependencies")
            self.assertIn("Two-directory cycles: 1", body)
            self.assertIn("alpha", body)
            self.assertIn("beta", body)

    def test_a_one_way_edge_is_not_a_cycle(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "alpha/a.go", 'import "m/beta"\n')
            write(d, "beta/b.go", "package beta\n")
            self.assertIn("Two-directory cycles: 0", section(scan(d), "Dependencies"))

    def test_test_files_cannot_create_an_edge(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "alpha/a.go", "package alpha\n")
            write(d, "alpha/a_test.go", 'import "m/beta"\n')
            write(d, "beta/b.go", 'import "m/alpha"\n')
            self.assertIn("Two-directory cycles: 0", section(scan(d), "Dependencies"))

    def test_a_parent_child_prefix_is_not_an_edge(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "host/a.go", "package host\n")
            write(d, "host/credential/b.go", "package credential\n")
            body = section(scan(d), "Dependencies")
            self.assertTrue("none found" in body or "Two-directory cycles: 0" in body, body)

    def test_finds_a_three_directory_cycle(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "one/a.go", 'import "m/two"\nimport "m/three"\n')
            write(d, "two/b.go", 'import "m/one"\nimport "m/three"\n')
            write(d, "three/c.go", 'import "m/one"\nimport "m/two"\n')
            self.assertIn("Three-directory cycles: 1", section(scan(d), "Dependencies"))


class CoChange(unittest.TestCase):
    def _repo(self, d):
        git(d, "init", "-q", "-b", "main")
        return d

    def _commit(self, d, files, when):
        for f in files:
            write(d, f, os.urandom(8).hex())
        git(d, "add", "-A")
        git(d, "commit", "-qm", "c", env={"GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when})

    def test_a_wide_commit_cannot_outweigh_repeated_narrow_ones(self):
        """One commit is one vote split across the pairs it implies."""
        with tempfile.TemporaryDirectory() as d:
            self._repo(d)
            wide = [f"w{i}/f.go" for i in range(8)]
            self._commit(d, wide, "2020-01-01T00:00:00")
            for i in range(6):
                self._commit(d, ["a/f.go", "b/f.go"], f"2020-0{i+2}-01T00:00:00")
            body = section(scan(d, "--since", "20.years"), "Co-change")
            lines = [l for l in body.splitlines() if "score" in l and "<->" in l]
            self.assertTrue(lines, f"no pairs scored:\n{body}")
            self.assertIn("a  <->  b", lines[0], f"narrow pair should rank first:\n{body}")

    def test_a_creation_burst_reads_as_at_creation_not_rising(self):
        with tempfile.TemporaryDirectory() as d:
            self._repo(d)
            for i in range(5):
                self._commit(d, ["x/f.go", "y/f.go"], f"2020-01-0{i+1}T00:00:00")
            for i in range(6):
                self._commit(d, ["z/f.go"], f"2024-0{i+1}-01T00:00:00")
            body = section(scan(d, "--since", "20.years"), "Co-change")
            row = [l for l in body.splitlines() if "x  <->  y" in l]
            self.assertTrue(row, f"pair missing:\n{body}")
            self.assertNotIn("rising", row[0], f"a creation burst is not rising:\n{row[0]}")


class Robustness(unittest.TestCase):
    def test_empty_directory_does_not_crash(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIn("Flat sprawl", scan(d))

    def test_non_git_directory_reports_unavailable_rather_than_failing(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "p/a.go", "package p\n")
            self.assertIn("unavailable", section(scan(d), "Co-change"))

    def test_skips_vendored_and_dependency_trees(self):
        with tempfile.TemporaryDirectory() as d:
            for i in range(30):
                write(d, f"node_modules/pkg/f{i}.js", "")
                write(d, f"vendor/lib/f{i}.go", "")
            self.assertIn("none", section(scan(d), "Flat sprawl"))


if __name__ == "__main__":
    unittest.main()
