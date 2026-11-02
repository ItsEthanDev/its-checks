import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { Effect } from "effect";
import { parse, type ParseError } from "jsonc-parser";

import { commitPattern } from "./selections.ts";

const exec = promisify(execFile);
const read = (file: string) =>
  fs.readFile(file, "utf8").catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return undefined;
    throw cause;
  });
const gitCommit = (ref: unknown): string | undefined => {
  if (typeof ref !== "string" || !/^(?:github:|git\+)/.test(ref)) return undefined;
  const hash = ref.slice(ref.lastIndexOf("#") + 1);
  return commitPattern.test(hash) ? hash : undefined;
};
const origin = (ref: string) => {
  const value = ref
    .split("#")[0]!
    .replace(/^git\+https:\/\/github\.com\//i, "github:")
    .replace(/\.git$/i, "");
  return value.startsWith("github:") ? value.toLowerCase() : value;
};

/** Best-effort local provenance of the executing package, never the target cwd or
 * remote HEAD. Unknown/missing metadata must not prevent setup or fabricate a pin.
 * Cache metadata is not an attestation against manually modified cache contents. */
export function executingCommit(packageRoot: string): Effect.Effect<string | undefined> {
  return Effect.promise(async () => {
    try {
      const root = await fs.realpath(packageRoot);
      const gitDirectory = await fs
        .lstat(path.join(root, ".git"))
        .catch((cause: NodeJS.ErrnoException) => {
          if (cause.code === "ENOENT") return undefined;
          throw cause;
        });
      if (gitDirectory) {
        const env = {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
          ),
          GIT_OPTIONAL_LOCKS: "0",
        };
        const git = async (args: string[]) =>
          (await exec("git", ["-C", root, ...args], { env, timeout: 5000 })).stdout.trim();
        if ((await fs.realpath(await git(["rev-parse", "--show-toplevel"]))) !== root)
          return undefined;
        if (await git(["status", "--porcelain", "--untracked-files=all"])) return undefined;
        const hash = await git(["rev-parse", "HEAD"]);
        return commitPattern.test(hash) ? hash : undefined;
      }
      // npm/npx and Bunx place the unscoped CLI directly in this node_modules.
      // Do not search arbitrary ancestors, where a target's Git/lock state could live.
      if (path.basename(path.dirname(root)) !== "node_modules") return undefined;
      const cache = path.dirname(path.dirname(root));
      const [npm, bun] = await Promise.all([
        read(path.join(cache, "package-lock.json")),
        read(path.join(cache, "bun.lock")),
      ]);
      if (npm !== undefined && bun !== undefined) return undefined;
      if (npm !== undefined)
        return gitCommit(
          JSON.parse(npm).packages?.[`node_modules/${path.basename(root)}`]?.resolved,
        );
      if (bun === undefined) return undefined;
      const errors: ParseError[] = [];
      const lock = parse(bun, errors, { allowTrailingComma: true });
      if (errors.length) return undefined;
      const name = path.basename(root),
        entry = lock?.packages?.[name]?.[0];
      if (typeof entry !== "string" || !entry.startsWith(`${name}@`)) return undefined;
      const resolved = entry.slice(name.length + 1),
        full = gitCommit(resolved);
      if (full) return full;
      // Bun 1.4 GitHub resolutions contain only an abbreviated hash. A full
      // requested pin is usable only when origin and resolved prefix agree.
      const request = lock.workspaces?.[""]?.dependencies?.[name],
        requested = gitCommit(request);
      const short = resolved.split("#")[1];
      return requested &&
        typeof request === "string" &&
        short &&
        /^[a-f0-9]{7,64}$/.test(short) &&
        origin(request) === origin(resolved) &&
        requested.startsWith(short)
        ? requested
        : undefined;
    } catch {
      return undefined;
    }
  });
}
