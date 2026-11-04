import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { Effect } from "effect";

import { BundleError } from "./bundle-errors.ts";
import { safePath } from "./bundle-io.ts";
import { commitPattern } from "./selections.ts";

const exec = promisify(execFile);
/** The external GitHub transport; tests can provide isolated local repositories. */
export interface SourceTransport {
  readonly resolve: (repository: string) => Promise<string>;
  readonly materialize: (repository: string, commit: string, destination: string) => Promise<void>;
}
export interface SourceStore {
  readonly resolve: (
    repository: string,
    commit?: string,
  ) => Effect.Effect<{ repository: string; commit: string; root: string }, BundleError>;
}
export function repositoryIdentity(value: string): string {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(value) ||
    [".", ".."].includes(value.split("/")[1] ?? "")
  ) {
    throw new Error("Expected GitHub owner/repo");
  }
  return value.toLowerCase();
}
const git = async (args: string[]) =>
  (
    await exec("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
  ).stdout;
async function materializeBlob(args: readonly string[], entry: string, destination: string) {
  const match = /^(100644|100755) blob ([a-f0-9]+)\t(.+)$/s.exec(entry);
  if (match === null) {
    throw new Error("Policy must contain regular files, not symlinks or submodules");
  }
  const [, mode, blob, relative] = match;
  if (relative === undefined || !safePath(relative)) {
    throw new Error("Unsafe policy path");
  }
  const { stdout: content } = await exec(
    "git",
    ["-c", "core.hooksPath=/dev/null", ...args, "cat-file", "blob", blob ?? ""],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  const file = path.join(destination, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, { mode: mode === "100755" ? 0o755 : 0o644 });
}
const githubTransport: SourceTransport = {
  resolve: async (repository) => {
    const result = await git(["ls-remote", `https://github.com/${repository}.git`, "HEAD"]);
    return result.split(/\s/)[0] ?? "";
  },
  materialize: async (repository, commit, destination) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "its-checks-fetch-"));
    try {
      await git(["init", "--bare", "--template=", temporary]);
      const args = [`--git-dir=${temporary}`];
      await git([
        ...args,
        "fetch",
        "--depth=1",
        "--no-tags",
        `https://github.com/${repository}.git`,
        commit,
      ]);
      const tree = await git([...args, "ls-tree", "-rz", "--full-tree", commit, "policy/"]);
      if (tree.length === 0) {
        throw new Error("Repository revision has no policy/ directory");
      }
      for (const entry of tree.split("\0").filter((value) => value.length > 0)) {
        await materializeBlob(args, entry, destination);
      }
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  },
};
async function cached(destination: string, commit: string) {
  try {
    return (await fs.readFile(path.join(destination, ".ready"), "utf8")) === commit;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return false;
    }
    throw cause;
  }
}
async function publish(temporary: string, destination: string, commit: string) {
  try {
    await fs.rename(temporary, destination);
  } catch (cause) {
    if (!(await cached(destination, commit))) {
      throw cause;
    }
  }
}
async function populate(
  repository: string,
  commit: string,
  destination: string,
  transport: SourceTransport,
) {
  if (await cached(destination, commit)) {
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = await fs.mkdtemp(`${destination}-`);
  try {
    await transport.materialize(repository, commit, temporary);
    const stat = await fs.lstat(path.join(temporary, "policy"));
    if (!stat.isDirectory()) {
      throw new Error("Expected policy/ directory");
    }
    await fs.writeFile(path.join(temporary, ".ready"), commit);
    await publish(temporary, destination, commit);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
/** Cache only complete immutable revisions; failed fetches never become cache hits. */
export function createSourceStore(
  options: { readonly cache?: string; readonly transport?: SourceTransport } = {},
): SourceStore {
  const cache =
    options.cache ??
    path.join(
      process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
      "its-checks",
      "policies",
    );
  const transport = options.transport ?? githubTransport;
  return {
    resolve: (reference, requested) =>
      Effect.tryPromise({
        try: async () => {
          const repository = repositoryIdentity(reference);
          const commit = requested ?? (await transport.resolve(repository));
          if (!commitPattern.test(commit)) {
            throw new Error("Expected an exact policy commit");
          }
          const destination = path.join(cache, repository, commit);
          await populate(repository, commit, destination, transport);
          return { repository, commit, root: path.join(destination, "policy") };
        },
        catch: (cause) =>
          new BundleError({
            bundle: reference,
            source: reference,
            field: "source",
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  };
}
