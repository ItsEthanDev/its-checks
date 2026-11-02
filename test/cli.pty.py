"""Real source/installed CLI + Clack keyboard checks; fixed policy, no terminal mocks."""
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
    def __init__(self, command, cwd):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 140, 0, 0))
        env = {k: v for k, v in os.environ.items() if k not in ("CI", "NO_COLOR")}
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
        package_root = os.environ.get("ITS_CHECKS_PACKAGE_ROOT")
        if package_root:
            # Copy only the isolated production installation, never checkout dependencies.
            shutil.copytree(package_root, checkout, symlinks=True)
            self.entry = checkout / "node_modules/.bin/its-checks"
            self.command = [str(self.entry)]  # Exercise the installed bin and its Node shebang.
            self.policy = checkout / "node_modules/its-checks/policy"
            shutil.rmtree(self.policy)
        else:
            checkout.mkdir()
            shutil.copytree(REPO / "bin", checkout / "bin")
            shutil.copytree(REPO / "src", checkout / "src")
            (checkout / "node_modules").symlink_to(REPO / "node_modules", target_is_directory=True)
            (checkout / "package.json").write_text('{"type":"module"}')
            self.entry = checkout / "bin/its-checks.js"
            self.command = ["node", str(self.entry)]
            self.policy = checkout / "policy"
        self.project = self.root / "target"
        self.project.mkdir()
        self.write(self.policy / "bundle.json", {"schemaVersion": 1, "source": {
            "repository": "https://github.com/example/fork", "selectionSchema": "schemas/its-checks.schema.json"}})
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
        # Empty offline npm fixture: normal installs have no dependencies or lifecycle scripts.
        self.write(self.project / ".npmrc", "offline=true\naudit=false\nfund=false\n")
        self.write(self.project / "package.json", {"name": "fixture"})
        # A target project's compiler settings must not configure this tool's loader.
        self.write(self.project / "tsconfig.json", "{ deliberately invalid tsconfig }")
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
        terminal = Terminal(self.command, self.project)
        self.terminals.append(terminal)
        return terminal

    def state(self):
        return {str(p.relative_to(self.project)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.project.rglob("*") if p.is_file()}

    def configuration_state(self):
        return {name: state for name, state in self.state().items()
                if not name.startswith("node_modules/") and name != "package-lock.json"}

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
        self.assertEqual(saved["source"], "https://github.com/example/fork")
        self.assertNotIn("schemaVersion", saved)
        self.assertNotIn("commit", saved, "copied source/archive fixtures have no known Git revision")
        self.assertEqual(saved["answers"]["base"], {"count": 2, "enabled": False, "label": "fixture"})
        before = self.configuration_state()
        second = self.terminal()
        second.expect("Choose integrations")
        second.send("\r")  # accepts preselection without toggling
        second.expect("Choose automation")
        second.send("\r")
        self.answers(second)
        text = second.finish(0)
        self.assertIn("Completed: 0 file changes; dependencies completed.", text)
        self.assertNotIn("Apply this plan", text)
        self.assertEqual(self.configuration_state(), before)
        before = self.state()
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
        print("\nInspected real Clack rendering: Space/Enter selections, number validation, false/number/string/path prefills; creation plan; matching configuration with normal install; removal plan and single declined confirmation.")

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

    def base_answers(self, terminal):
        terminal.expect("Choose integrations")
        terminal.send("\r")
        terminal.expect("Choose automation")
        terminal.send("\r")
        for question in ["Number of fixtures?", "Enable fixture?", "Fixture label?"]:
            terminal.expect(question)
            terminal.send("\r")

    def commit_fixture(self, directory):
        for args in [["init", "--quiet"], ["add", "."], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]]:
            subprocess.run(["git", *args], cwd=directory, check=True, capture_output=True)
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=directory, text=True).strip()

    def test_clean_generator_commit_is_recorded_and_matching_rerun_stays_noop(self):
        commit = self.commit_fixture(self.policy.parent)
        first = self.terminal()
        self.base_answers(first)
        first.finish(0)
        self.assertEqual(json.loads((self.project / ".its-checks.json").read_text())["commit"], commit)
        before = self.configuration_state()
        second = self.terminal()
        self.base_answers(second)
        self.assertIn("Completed: 0 file changes; dependencies completed.", second.finish(0))
        self.assertEqual(self.configuration_state(), before)

    def test_target_git_commit_is_not_generator_identity(self):
        self.commit_fixture(self.project)
        first = self.terminal()
        self.base_answers(first)
        first.finish(0)
        self.assertNotIn("commit", json.loads((self.project / ".its-checks.json").read_text()))

    def test_policy_edit_reaches_output_without_changing_entrypoint(self):
        entry_bytes = self.entry.read_bytes()
        first = self.terminal()
        self.base_answers(first)
        first.finish(0)
        policy_file = self.policy / "typescript/base/files/.oxlintrc.json"
        policy = json.loads(policy_file.read_text())
        policy["fixturePolicyEdit"] = "changed without rebuilding"
        self.write(policy_file, policy)
        second = self.terminal()
        self.base_answers(second)
        second.expect("Apply this plan, including replacements and removals?")
        second.send("y\r")
        text = second.finish(0)
        self.assertIn("Completed:", text)
        self.assertEqual(json.loads((self.project / ".oxlintrc.json").read_text())["fixturePolicyEdit"], policy["fixturePolicyEdit"])
        self.assertEqual(self.entry.read_bytes(), entry_bytes)

    def test_invalid_saved_intent_fails_without_mutation(self):
        unsupported = {"$schema": "https://github.com/example/fork/raw/main/schemas/its-checks.schema.json",
                       "schemaVersion": 1, "source": {"repository": "https://github.com/example/fork",
                       "selectionSchema": "schemas/its-checks.schema.json"},
                       "integrations": [], "automation": [], "answers": {}}
        for content in ["{broken", unsupported]:
            with self.subTest(content=content):
                self.write(self.project / ".its-checks.json", content)
                before = self.state()
                terminal = self.terminal()
                text = terminal.finish(1)
                self.assertIn("Setup failed.", text)
                self.assertIn(".its-checks.json", text)
                self.assertNotIn("Choose integrations", text)
                self.assertNotIn("Completed:", text)
                self.assertEqual(self.state(), before)

    def headless(self, *args, cwd=None):
        return subprocess.run([*self.command, *map(str, args)], cwd=cwd or self.project,
                              input="", capture_output=True, text=True, timeout=20)

    def headless_config(self):
        return {"integrations": ["example"], "automation": ["ci"], "answers": {
            "base": {"count": 2, "enabled": False, "label": "headless"},
            "integrations/example": {"stylesheet": "styles/site.css"}}}

    def make_plan(self, config=None):
        config_file = self.root / "setup.json"
        plan_file = self.root / "setup.plan.json"
        self.write(config_file, self.headless_config() if config is None else config)
        result = self.headless("plan", "--config", config_file, "--out", plan_file, "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), json.loads(plan_file.read_text()))
        self.assertEqual(result.stderr, "")
        return plan_file

    def test_headless_options_discovers_inputs_without_a_target_manifest(self):
        (self.project / "package.json").unlink()
        before = self.state()
        result = self.headless("options", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        options = json.loads(result.stdout)
        self.assertEqual(options["base"]["inputs"][0]["id"], "count")
        self.assertEqual(options["integrations"][0]["id"], "example")
        self.assertEqual(options["automation"][0]["id"], "ci")
        self.assertEqual(self.state(), before)

    def test_headless_plan_is_read_only_and_apply_uses_saved_target_from_another_directory(self):
        before = self.state()
        plan_file = self.make_plan()
        self.assertEqual(self.state(), before)
        self.assertEqual(plan_file.stat().st_mode & 0o777, 0o600)
        plan = json.loads(plan_file.read_text())
        self.assertEqual(plan["plan"]["snapshot"]["root"], str(self.project))
        self.write(self.root / "setup.json", "not read again during apply")
        result = self.headless("apply", plan_file, "--json", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "completed")
        self.assertEqual(report["dependencyWork"], "completed")
        self.assertEqual(json.loads((self.project / ".oxlintrc.json").read_text())["fixtureCount"], 2)
        self.assertEqual(json.loads((self.project / ".oxfmtrc.json").read_text())["stylesheet"], "styles/site.css")
        self.assertTrue((self.project / ".github/workflows/check.yml").is_file())
        # Reuse saved intent as input, with paths relative to cwd, then explicitly deselect automation.
        config = json.loads((self.project / ".its-checks.json").read_text())
        config["automation"] = []
        self.write(self.project / "setup.json", config)
        result = self.headless("plan", "--config", "setup.json", "--out", "local.plan.json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("removal: .github/workflows/check.yml", result.stdout)
        self.assertIn("including lifecycle scripts", result.stdout)
        result = self.headless("apply", "local.plan.json", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.project / ".github/workflows/check.yml").exists())

    def test_headless_missing_invalid_and_ambiguous_inputs_fail_without_writes(self):
        invalid_configs = [
            ({"integrations": [], "automation": []}, "answers"),
            ({"integrations": [], "automation": [], "answers": {}}, "Missing explicit answer"),
            ({"integrations": ["unknown"], "automation": [], "answers": {}}, "Unknown bundle ID"),
        ]
        for config, message in invalid_configs:
            with self.subTest(message=message):
                self.write(self.root / "setup.json", config)
                before = self.state()
                result = self.headless("plan", "--config", self.root / "setup.json",
                                       "--out", self.root / "bad.plan.json", "--json")
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertIn(message, json.loads(result.stderr)["error"]["message"])
                self.assertFalse((self.root / "bad.plan.json").exists())
                self.assertEqual(self.state(), before)
        self.write(self.project / "yarn.lock", "# conflicting evidence\n")
        self.write(self.root / "setup.json", self.headless_config())
        before = self.state()
        result = self.headless("plan", "--config", self.root / "setup.json",
                               "--out", self.root / "bad.plan.json", "--json")
        self.assertEqual(result.returncode, 1)
        self.assertIn("packageManager", json.loads(result.stderr)["error"]["message"])
        self.assertEqual(self.state(), before)
        config = self.headless_config()
        config["packageManager"] = "npm"
        self.make_plan(config)
        self.assertEqual(self.state(), before)

    def test_headless_stale_target_or_manager_evidence_is_rejected_without_writes(self):
        for relative in [".oxlintrc.json", "yarn.lock"]:
            with self.subTest(relative=relative):
                plan_file = self.make_plan()
                self.write(self.project / relative, "changed after planning\n")
                before = self.state()
                result = self.headless("apply", plan_file, "--json")
                self.assertEqual(result.returncode, 1)
                self.assertIn("Target changed since planning", json.loads(result.stderr)["error"]["message"])
                self.assertEqual(self.state(), before)
                (self.project / relative).unlink()
                plan_file.unlink()

    def test_headless_changed_generator_is_rejected_without_writes(self):
        plan_file = self.make_plan()
        # Detect both policy changes and implementation-only changes, even without Git metadata.
        for changed in [self.policy / "typescript/base/files/.oxlintrc.json",
                        self.policy.parent / "src/inputs.ts"]:
            original = changed.read_bytes()
            changed.write_bytes(original + b"\n")
            before = self.state()
            result = self.headless("apply", plan_file, "--json")
            self.assertEqual(result.returncode, 1)
            self.assertIn("Generator changed", json.loads(result.stderr)["error"]["message"])
            self.assertEqual(self.state(), before)
            changed.write_bytes(original)

    def test_headless_invalid_command_and_plan_fail_without_writes(self):
        self.write(self.root / "malformed.plan.json", {"schemaVersion": 99})
        before = self.state()
        for args in [("plan",), ("apply",), ("options", "--unknown"),
                     ("apply", self.root / "malformed.plan.json")]:
            result = self.headless(*args, "--json")
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertEqual(json.loads(result.stderr)["error"]["code"], "OperationError")
            self.assertEqual(self.state(), before)

    def test_headless_output_never_overwrites_files_or_occupies_a_planned_destination(self):
        plan_file = self.make_plan()
        original = plan_file.read_bytes()
        before = self.state()
        alias = self.root / "target-alias"
        alias.symlink_to(self.project, target_is_directory=True)
        for output in [plan_file, self.project / "package.json", self.project / ".oxlintrc.json",
                       alias / ".oxlintrc.json"]:
            result = self.headless("plan", "--config", self.root / "setup.json", "--out", output, "--json")
            self.assertEqual(result.returncode, 1, result.stdout)
            json.loads(result.stderr)
            self.assertEqual(self.state(), before)
            self.assertEqual(plan_file.read_bytes(), original)

    def test_headless_install_failure_reports_partial_work_and_retains_configuration(self):
        self.write(self.project / "package.json", {"name": "fixture", "scripts": {"install": "exit 23"}})
        plan_file = self.make_plan()
        result = self.headless("apply", plan_file, "--json")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        error = json.loads(result.stderr)["error"]
        self.assertEqual(error["code"], "ApplicationError")
        self.assertEqual(error["details"]["phase"], "dependencies")
        self.assertEqual(error["details"]["report"]["status"], "failed")
        self.assertIn("install-dependencies", [op["kind"] for op in error["details"]["report"]["incomplete"]])
        self.assertTrue((self.project / ".its-checks.json").is_file())
        self.assertTrue((self.project / ".oxlintrc.json").is_file())

    def test_noninteractive_rejected_before_missing_policy_or_project_reads(self):
        shutil.rmtree(self.policy)
        (self.project / "package.json").unlink()
        before = self.state()
        result = subprocess.run(self.command, cwd=self.project, input="", capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires an interactive terminal", result.stderr)
        self.assertNotIn("ENOENT", result.stderr)
        self.assertEqual(self.state(), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
