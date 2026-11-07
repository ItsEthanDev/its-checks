"""Real CLI, Git transport and Clack keyboard checks using isolated local policies."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time
import unittest

REPO = Path(__file__).resolve().parents[1]
ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")


class Terminal:
    def __init__(self, command, cwd, env):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 140, 0, 0))
        env = {k: v for k, v in env.items() if k not in ("CI", "NO_COLOR")}
        env.update(TERM="xterm-256color", FORCE_COLOR="0")
        self.process = subprocess.Popen(command, cwd=cwd, stdin=slave, stdout=slave, stderr=slave, env=env)
        os.close(slave)
        self.output = ""
        self.cursor = 0

    def read(self, timeout=0.1):
        if select.select([self.master], [], [], timeout)[0]:
            try:
                self.output += os.read(self.master, 65536).decode("utf8", errors="replace")
            except OSError as error:
                if error.errno != errno.EIO:
                    raise

    def expect(self, text):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            clean = ANSI.sub("", self.output)
            index = clean.find(text, self.cursor)
            if index >= 0:
                self.cursor = index + len(text)
                return
            if self.process.poll() is not None:
                self.read()
                break
            self.read()
        raise AssertionError(f"Missing {text!r}; output:\n{ANSI.sub('', self.output)}")

    def send(self, keys):
        os.write(self.master, keys.encode())

    def finish(self, expected):
        deadline = time.monotonic() + 20
        while self.process.poll() is None and time.monotonic() < deadline:
            self.read()
        if self.process.poll() is None:
            raise AssertionError("CLI did not exit\n" + ANSI.sub("", self.output))
        self.read()
        assert self.process.returncode == expected, ANSI.sub("", self.output)
        return ANSI.sub("", self.output)

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait()
        os.close(self.master)


class CliChecks(unittest.TestCase):
    def write(self, destination, value):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(value if isinstance(value, str) else json.dumps(value) + "\n")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="its-checks-cli-")
        self.root = Path(self.temp.name)
        package_root = os.environ.get("ITS_CHECKS_PACKAGE_ROOT")
        if package_root:
            self.command = [str(Path(package_root) / "node_modules/.bin/its-checks")]
        else:
            self.command = ["node", str(REPO / "bin/its-checks.js")]
        source = self.root / "source"
        self.policy = source / "policy"
        self.write(self.policy / "base/bundle.json", {
            "name": "Fixture tooling", "description": "Typed inputs",
            "note": "**MIGRATION NOTE**\n\nRead docs/guide.md and work through its TODO.", "inputs": [
                {"id": "count", "prompt": "Number of fixtures?", "type": "number", "default": 0,
                 "destination": {"file": "config.json", "field": ["count"]}},
                {"id": "enabled", "prompt": "Enable fixture?", "type": "boolean", "default": False,
                 "destination": {"file": "config.json", "field": ["enabled"]}}],
            "files": [{"source": "files/config.json", "target": "config.json", "operation": "compose", "format": "json"}]})
        self.write(self.policy / "base/files/config.json", {"count": 0, "enabled": False})
        self.write(self.policy / "ci/bundle.json", {"name": "Fixture workflow", "description": "Automation", "files": [
            {"source": "files/workflow.yml", "target": ".github/workflows/quality.yml", "operation": "replace"}]})
        self.write(self.policy / "ci/files/workflow.yml", "name: Fixture\n")
        self.write(self.policy / "example/bundle.json", {"name": "Fixture integration", "description": "Requires shared", "requires": ["shared"]})
        self.write(self.policy / "shared/bundle.json", {"name": "Shared implementation", "description": "Dependency only", "hidden": True})
        for args in [["init", "--quiet"], ["add", "."], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]]:
            subprocess.run(["git", *args], cwd=source, check=True, capture_output=True)
        self.commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
        self.env = {**os.environ, "XDG_CACHE_HOME": str(self.root / "cache"), "GIT_CONFIG_COUNT": "1",
                    "GIT_CONFIG_KEY_0": f"url.file://{source}.insteadOf", "GIT_CONFIG_VALUE_0": "https://github.com/example/fork.git"}
        self.project = self.root / "target"
        self.write(self.project / "package.json", {"name": "fixture", "packageManager": "npm@10.0.0"})
        self.write(self.project / ".npmrc", "offline=true\naudit=false\nfund=false\n")
        self.write(self.project / "tsconfig.json", "{ deliberately invalid tsconfig }")
        self.terminals = []

    def tearDown(self):
        for terminal in self.terminals:
            terminal.close()
        self.temp.cleanup()

    def terminal(self, *args):
        terminal = Terminal(self.command + list(args), self.project, self.env)
        self.terminals.append(terminal)
        return terminal

    def state(self):
        return {str(p.relative_to(self.project)): p.read_bytes() for p in self.project.rglob("*") if p.is_file()}

    def test_picker_inputs_pinned_rerun_and_declined_removal(self):
        first = self.terminal("add", "example/fork")
        first.expect("Choose example/fork")
        first.send(" \x1b[B \x1b[B \r")
        first.expect("Included dependency example/fork:shared")
        first.expect("Number of fixtures?")
        first.send("\x7fbad\r")
        first.expect("Enter a finite number.")
        first.send("\x7f\x7f\x7f2\r")
        first.expect("Enable fixture?")
        first.send("\r")
        first.expect("Read-only change plan")
        first.expect("Apply this plan")
        first.send("y\r")
        output = first.finish(0)
        self.assertIn("MIGRATION NOTE", output)
        self.assertLess(output.index("Completed:"), output.index("MIGRATION NOTE"))
        self.assertNotIn("**MIGRATION NOTE**", output)
        state = json.loads((self.project / ".its-checks.json").read_text())
        self.assertEqual(state["sources"][0]["commit"], self.commit)
        self.assertEqual(state["sources"][0]["bundles"], ["base", "ci", "example"])
        self.assertEqual(state["sources"][0]["answers"], {"base": {"count": 2, "enabled": False}})
        second = self.terminal()
        second.expect("Choose example/fork")
        second.send("\r")
        second.expect("Number of fixtures?")
        second.expect("2")
        second.send("\r")
        second.expect("Enable fixture?")
        second.send("\r")
        second.expect("Apply this plan")
        second.send("y\r")
        output = second.finish(0)
        self.assertIn("Completed: 0 file changes", output)
        self.assertIn("MIGRATION NOTE", output)
        before = self.state()
        third = self.terminal("remove", "example/fork")
        third.expect("removal: .github/workflows/quality.yml")
        third.expect("Apply this plan")
        third.send("\r")
        output = third.finish(0)
        self.assertIn("Plan declined", output)
        self.assertNotIn("MIGRATION NOTE", output)
        self.assertEqual(self.state(), before)

    def test_no_implicit_source_and_cancellation_are_read_only(self):
        before = self.state()
        self.assertIn("No policy sources configured", self.terminal().finish(0))
        terminal = self.terminal("add", "example/fork")
        terminal.expect("Choose example/fork")
        terminal.send("\x03")
        self.assertIn("Cancelled before application", terminal.finish(130))
        self.assertEqual(self.state(), before)

    def test_update_resolves_new_commit_and_cleans_removed_file_declarations(self):
        config = self.root / "setup.json"
        self.write(config, {"schemaVersion": 2, "sources": [{"repository": "example/fork", "commit": self.commit,
                   "bundles": ["ci"], "answers": {}}]})
        plan = self.root / "first.plan.json"
        planned = self.cli("plan", "--config", str(config), "--out", str(plan))
        self.assertEqual(planned.returncode, 0, planned.stderr)
        applied = self.cli("apply", str(plan))
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertNotIn("MIGRATION NOTE", applied.stdout)
        self.write(self.policy / "ci/bundle.json", {"name": "Fixture workflow", "description": "Retired output", "files": []})
        source = self.policy.parent
        subprocess.run(["git", "add", "."], cwd=source, check=True, capture_output=True)
        subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "retire workflow"], cwd=source, check=True, capture_output=True)
        updated = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
        terminal = self.terminal("update", "example/fork")
        terminal.expect("removal: .github/workflows/quality.yml")
        terminal.expect("Apply this plan")
        terminal.send("y\r")
        terminal.finish(0)
        self.assertFalse((self.project / ".github/workflows/quality.yml").exists())
        self.assertEqual(json.loads((self.project / ".its-checks.json").read_text())["sources"][0]["commit"], updated)

    def cli(self, *args):
        return subprocess.run(self.command + list(args), cwd=self.project, env=self.env, capture_output=True, text=True, timeout=30)

    def test_headless_real_git_transport_plan_apply_and_stale_rejection(self):
        options = self.cli("options", "example/fork", "--json")
        self.assertEqual(options.returncode, 0, options.stderr)
        discovered = json.loads(options.stdout)
        self.assertEqual(discovered["commit"], self.commit)
        config = self.root / "setup.json"
        self.write(config, {"schemaVersion": 2, "sources": [{"repository": "example/fork", "commit": self.commit,
                   "bundles": ["base", "ci", "example"], "answers": {"base": {"count": 3, "enabled": True}}}]})
        plan = self.root / "setup.plan.json"
        before = self.state()
        planned = self.cli("plan", "--config", str(config), "--out", str(plan), "--json")
        self.assertEqual(planned.returncode, 0, planned.stderr)
        expected_notes = [{"bundle": "example/fork:base", "name": "Fixture tooling",
                           "message": "**MIGRATION NOTE**\n\nRead docs/guide.md and work through its TODO."}]
        self.assertEqual(json.loads(planned.stdout)["plan"]["notes"], expected_notes)
        self.assertEqual(self.state(), before)
        applied = self.cli("apply", str(plan), "--json")
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertEqual(json.loads(applied.stdout)["notes"], expected_notes)
        self.assertEqual(json.loads((self.project / "config.json").read_text()), {"count": 3, "enabled": True})
        stale = self.cli("apply", str(plan), "--json")
        self.assertEqual(stale.returncode, 1)
        self.assertIn("changed", stale.stderr.lower())
        self.assertNotIn("MIGRATION NOTE", stale.stdout + stale.stderr)

        next_plan = self.root / "rerun.plan.json"
        self.assertEqual(self.cli("plan", "--config", str(config), "--out", str(next_plan)).returncode, 0)
        plain = self.cli("apply", str(next_plan))
        self.assertEqual(plain.returncode, 0, plain.stderr)
        self.assertLess(plain.stdout.index("Completed:"), plain.stdout.index("MIGRATION NOTE"))
        self.assertIn("Fixture tooling", plain.stdout)
        self.assertNotIn("**MIGRATION NOTE**", plain.stdout)


if __name__ == "__main__":
    unittest.main()
