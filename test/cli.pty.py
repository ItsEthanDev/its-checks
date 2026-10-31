"""Real source CLI + Clack keyboard checks. Python standard library; no terminal mocks."""
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
    def __init__(self, entry, cwd):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 140, 0, 0))
        env = {k: v for k, v in os.environ.items() if k not in ("CI", "NO_COLOR")}
        env.update(TERM="xterm-256color", FORCE_COLOR="0")
        self.process = subprocess.Popen(["bun", str(entry)], cwd=cwd, stdin=slave, stdout=slave, stderr=slave, env=env)
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
        deadline = time.monotonic() + 15
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
        raise AssertionError(f"Missing {text!r}; terminal output:\n{ANSI.sub('', self.output)}")

    def send(self, keys):
        os.write(self.master, keys.encode())

    def finish(self, expected):
        deadline = time.monotonic() + 15
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
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="its-checks-cli-")
        self.root = Path(self.temp.name)
        checkout = self.root / "executed-checkout"
        checkout.mkdir()
        shutil.copytree(REPO / "src", checkout / "src")
        (checkout / "node_modules").symlink_to(REPO / "node_modules", target_is_directory=True)
        (checkout / "package.json").write_text('{"type":"module"}')
        self.entry = checkout / "src/cli.ts"
        self.policy = checkout / "policy"
        self.project = self.root / "target"
        self.project.mkdir()
        self.write(self.policy / "bundle.json", {"schemaVersion": 1, "source": {
            "repository": "https://github.com/example/fork", "revision": "a" * 40, "selectionSchema": "schemas/selections.schema.json"}})
        self.write(self.policy / "typescript/base/bundle.json", {"name": "Base", "inputs": [
            {"id": "count", "prompt": "Number of fixtures?", "type": "number", "default": 0,
             "destination": {"file": ".oxlintrc.json", "field": ["fixtureCount"]}},
            {"id": "enabled", "prompt": "Enable fixture?", "type": "boolean", "default": False,
             "destination": {"file": ".oxlintrc.json", "field": ["fixtureEnabled"]}},
            {"id": "label", "prompt": "Fixture label?", "type": "string", "default": "fixture",
             "destination": {"file": ".oxlintrc.json", "field": ["fixtureLabel"]}}]})
        self.write(self.policy / "typescript/base/files/.oxlintrc.json", {"fixtureCount": 0, "fixtureEnabled": False, "fixtureLabel": "fixture"})
        self.write(self.policy / "typescript/integrations/example/bundle.json", {"name": "Example integration", "inputs": [
            {"id": "stylesheet", "prompt": "Stylesheet path?", "type": "path", "default": "src/app.css",
             "destination": {"file": ".oxfmtrc.json", "field": ["stylesheet"]}}]})
        self.write(self.policy / "typescript/integrations/example/files/.oxfmtrc.json", {"stylesheet": "placeholder"})
        self.write(self.policy / "typescript/automation/ci/bundle.json", {"name": "Example automation"})
        self.write(self.policy / "typescript/automation/ci/files/.github/workflows/check.yml", "# its-checks: managed\nname: Checks\non: push\n")
        # Native empty npm state: no dependencies, installs, scripts, or process substitution.
        self.write(self.project / "package.json", {"name": "fixture", "packageManager": "npm@11.19.0"})
        self.write(self.project / "package-lock.json", {"lockfileVersion": 3, "packages": {"": {}}})
        self.write(self.project / "node_modules/.package-lock.json", {"lockfileVersion": 3, "packages": {}})
        self.terminals = []

    def tearDown(self):
        for terminal in self.terminals:
            terminal.close()
        self.temp.cleanup()

    def write(self, destination, value):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(value if isinstance(value, str) else json.dumps(value) + "\n")

    def terminal(self):
        terminal = Terminal(self.entry, self.project)
        self.terminals.append(terminal)
        return terminal

    def state(self):
        return {str(p.relative_to(self.project)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.project.rglob("*") if p.is_file()}

    def answers(self, terminal, first=False):
        terminal.expect("Number of fixtures?")
        if first:
            terminal.send("\x7fbad\r")
            terminal.expect("Enter a finite number.")
            terminal.send("\x7f\x7f\x7f2\r")
        else:
            terminal.expect("2")  # actual editable prefill, not just saved-state inspection
            terminal.send("\r")
        terminal.expect("Enable fixture?")
        terminal.send("\r")
        terminal.expect("Fixture label?")
        terminal.expect("fixture")
        terminal.send("\r")
        terminal.expect("Stylesheet path?")
        terminal.expect("src/app.css")
        if first:
            terminal.send("\x7f" * len("src/app.css") + "../bad\r")
            terminal.expect("Enter a safe path relative to the target package")
            terminal.send("\x7f" * len("../bad") + "src/app.css\r")
        else:
            terminal.send("\r")

    def test_keyboard_first_run_prefills_matching_rerun_and_decline(self):
        first = self.terminal()
        first.expect("Choose integrations")
        first.expect("Example integration")
        first.send(" \r")  # Space toggles; Enter confirms, Clack's real keyboard handler
        first.expect("Choose automation")
        first.send(" \r")
        self.answers(first, first=True)
        first.expect("Read-only change plan")
        text = first.finish(0)
        self.assertIn("creation: .oxlintrc.json", text)
        self.assertIn("Completed:", text)
        self.assertNotIn("Apply this plan", text)
        saved = json.loads((self.project / ".its-checks.json").read_text())
        self.assertEqual(saved["integrations"], ["example"])
        self.assertEqual(saved["automation"], ["ci"])
        self.assertEqual(saved["answers"]["base"], {"count": 2, "enabled": False, "label": "fixture"})
        before = self.state()
        second = self.terminal()
        second.expect("Choose integrations")
        second.send("\r")  # accepts preselection without toggling
        second.expect("Choose automation")
        second.send("\r")
        self.answers(second)
        text = second.finish(0)
        self.assertIn("Already up to date. No writes or installation.", text)
        self.assertNotIn("Apply this plan", text)
        self.assertEqual(self.state(), before)
        third = self.terminal()
        third.expect("Choose integrations")
        third.send("\r")
        third.expect("Choose automation")
        third.send(" \r")  # deselect existing automation
        self.answers(third)
        third.expect("removal: .github/workflows/check.yml")
        third.expect("Apply this plan, including replacements and removals?")
        third.send("\r")  # safe default is No
        text = third.finish(0)
        self.assertIn("Plan declined. No project writes or installation.", text)
        self.assertEqual(self.state(), before)
        if os.environ.get("ITS_CHECKS_SHOW_TERMINAL"):
            print("\nCaptured Clack removal/decline rendering:\n" + text)
        print("\nInspected real Clack rendering: Space/Enter selections, number validation, false/number/string/path prefills; creation plan; no-op outro; removal plan and single declined confirmation.")

    def test_manager_ambiguity_and_input_cancellation_are_read_only(self):
        self.write(self.project / "yarn.lock", "# conflicting manager evidence\n")
        before = self.state()
        terminal = self.terminal()
        terminal.expect("Choose integrations")
        terminal.send(" \r")
        terminal.expect("Choose automation")
        terminal.send("\r")
        terminal.expect("Number of fixtures?")
        terminal.send("\r")
        terminal.expect("Enable fixture?")
        terminal.send("\r")
        terminal.expect("Fixture label?")
        terminal.send("\r")
        terminal.expect("Stylesheet path?")
        terminal.send("\x03")
        terminal.finish(130)
        self.assertEqual(self.state(), before)
        other = self.terminal()
        other.expect("Choose integrations")
        other.send("\r")
        other.expect("Choose automation")
        other.send("\r")
        other.expect("Number of fixtures?")
        other.send("\r")
        other.expect("Enable fixture?")
        other.send("\r")
        other.expect("Fixture label?")
        other.send("\r")
        other.expect("Conflicting package-manager evidence")
        other.expect("yarn.lock")
        other.expect("Which package manager should modify this package?")
        other.send("\x03")
        text = other.finish(130)
        self.assertIn("Cancelled before application", text)
        self.assertEqual(self.state(), before)

    def test_ctrl_c_cancellation_has_no_writes(self):
        before = self.state()
        terminal = self.terminal()
        terminal.expect("Choose integrations")
        terminal.send("\x03")
        text = terminal.finish(130)
        self.assertIn("Cancelled before application. No project writes or installation.", text)
        self.assertEqual(self.state(), before)

    def test_noninteractive_rejected_before_missing_policy_or_project_reads(self):
        shutil.rmtree(self.policy)
        (self.project / "package.json").unlink()
        before = self.state()
        result = subprocess.run(["bun", str(self.entry)], cwd=self.project, input="", capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires an interactive terminal", result.stderr)
        self.assertNotIn("ENOENT", result.stderr)
        self.assertEqual(self.state(), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
