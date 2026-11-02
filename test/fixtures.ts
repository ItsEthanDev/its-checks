import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { TestContext } from "node:test";

export async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-checks-bundles-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const policy = path.join(root, "policy");
  const project = path.join(root, "project");
  const write = async (relative: string, content: string | object) => {
    const destination = path.join(policy, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(
      destination,
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
    return destination;
  };
  const add = async (key: string, declaration: object = { name: key }) => {
    await write(`typescript/${key}/bundle.json`, declaration);
  };
  await write("bundle.json", {
    schemaVersion: 1,
    source: {
      repository: "https://github.com/example/fork",
      selectionSchema: "schemas/its-checks.schema.json",
    },
  });
  await add("base", {
    name: "TypeScript",
    scripts: { check: "oxlint ." },
    devDependencies: { oxlint: "1.0.0" },
    migration: { removeFiles: ["prettier.config.js"], removeDevDependencies: ["prettier"] },
  });
  await write("typescript/base/files/.oxlintrc.json", { rules: { "no-debugger": "error" } });
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(project, "package.json"),
    '{"name":"untouched","scripts":{"install":"exit 99"}}\n',
  );
  return { root, policy, project, write, add };
}

export async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(relative: string) {
    for (const name of (await fs.readdir(path.join(directory, relative))).toSorted()) {
      const key = path.join(relative, name);
      const stat = await fs.lstat(path.join(directory, key));
      if (stat.isDirectory()) {
        await walk(key);
      } else {
        result[key] = stat.isSymbolicLink()
          ? `link:${await fs.readlink(path.join(directory, key))}`
          : await fs.readFile(path.join(directory, key), "utf8");
      }
    }
  }
  await walk("");
  return result;
}
