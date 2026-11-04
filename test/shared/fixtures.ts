import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { TestContext } from "node:test";

import { Effect } from "effect";

import {
  loadPolicy,
  type LoadedPolicy,
  type SourceStore,
  type SourceConfig,
} from "../../src/modules/policy/index.ts";
import { json, objects } from "./assertions.ts";
export const revision = { repository: "example/fork", commit: "a".repeat(40) };
interface Fixture {
  readonly root: string;
  readonly policy: string;
  readonly project: string;
  readonly write: (relative: string, content: string | object) => Promise<string>;
  readonly add: (id: string, declaration?: object) => Promise<void>;
  readonly store: SourceStore;
  readonly config: (bundles?: readonly string[]) => SourceConfig;
  readonly load: (bundles?: readonly string[]) => Promise<LoadedPolicy>;
}
const config = (bundles: readonly string[] = ["base"]): SourceConfig => ({
  ...revision,
  bundles,
  answers: {},
});
export async function fixture(t: TestContext): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-checks-bundles-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const policy = path.join(root, "policy");
  const project = path.join(root, "project");
  await fs.mkdir(policy);
  await fs.mkdir(project);
  const add = async (id: string, declaration: object = { name: id }) => {
    const file = path.join(policy, id, "bundle.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    let existing: ReturnType<typeof json> = {};
    try {
      existing = json(await fs.readFile(file, "utf8"));
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        throw cause;
      }
    }
    await fs.writeFile(
      file,
      JSON.stringify({
        description: id,
        ...(id === "base" ? {} : { requires: ["base"] }),
        ...(existing.name === undefined ? {} : { name: existing.name }),
        ...(existing.files === undefined ? {} : { files: existing.files }),
        ...declaration,
      }),
    );
  };
  const write = async (relative: string, content: string | object) => {
    const destination = path.join(policy, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(
      destination,
      typeof content === "string" ? content : JSON.stringify(content),
    );
    const [id, directory, ...tail] = relative.split("/");
    if (id !== undefined && directory === "files") {
      const declarationFile = path.join(policy, id, "bundle.json");
      const declaration = json(await fs.readFile(declarationFile, "utf8"));
      const target = tail.join("/");
      let format: string | undefined;
      if (/\.jsonc?$/.test(target)) {
        format = target.endsWith("jsonc") ? "jsonc" : "json";
      }
      const files = objects(declaration.files ?? []).filter((file) => file.target !== target);
      files.push({
        source: `files/${target}`,
        target,
        operation: format === undefined ? "replace" : "compose",
        ...(format === undefined ? {} : { format }),
      });
      await fs.writeFile(declarationFile, JSON.stringify({ ...declaration, files }));
    }
    return destination;
  };
  await add("base", {
    name: "TypeScript",
    scripts: { check: "oxlint ." },
    devDependencies: { oxlint: "1.0.0" },
  });
  await write("base/files/.oxlintrc.json", { rules: { "no-debugger": "error" } });
  await fs.writeFile(
    path.join(project, "package.json"),
    '{"name":"untouched","scripts":{"install":"exit 99"}}\n',
  );
  const store: SourceStore = {
    resolve: (repository, commit) =>
      Effect.succeed({
        repository: repository.toLowerCase(),
        commit: commit ?? revision.commit,
        root: policy,
      }),
  };
  const load = (bundles: readonly string[] = ["base"]) =>
    Effect.runPromise(loadPolicy(policy, bundles, revision));
  return { root, policy, project, write, add, store, config, load };
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
