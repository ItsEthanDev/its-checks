import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { Effect, Schema } from "effect";
import { parse, type ParseError } from "jsonc-parser";

import { commitPattern } from "../policy/index.ts";

const exec = promisify(execFile);
const decodeNpmLock = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      packages: Schema.optionalKey(
        Schema.Record(
          Schema.String,
          Schema.Struct({ resolved: Schema.optionalKey(Schema.Unknown) }),
        ),
      ),
    }),
  ),
);
const decodeBunLock = Schema.decodeUnknownSync(
  Schema.Struct({
    packages: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.Unknown))),
    workspaces: Schema.optionalKey(
      Schema.Record(
        Schema.String,
        Schema.Struct({
          dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
        }),
      ),
    ),
  }),
);
const read = (file: string) =>
  fs.readFile(file, "utf8").catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw cause;
  });
const gitCommit = (ref: unknown): string | undefined => {
  if (typeof ref !== "string" || !/^(?:github:|git\+)/.test(ref)) {
    return undefined;
  }
  const hash = ref.slice(ref.lastIndexOf("#") + 1);
  return commitPattern.test(hash) ? hash : undefined;
};
const origin = (ref: string) => {
  const value = ref
    .slice(0, !ref.includes("#") ? ref.length : ref.indexOf("#"))
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
      const gitDirectory = await fs.lstat(path.join(root, ".git")).catch((cause: unknown) => {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return undefined;
        }
        throw cause;
      });
      return gitDirectory !== undefined ? await checkoutCommit(root) : await cacheCommit(root);
    } catch {
      return undefined;
    }
  });
}

async function checkoutCommit(root: string) {
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    GIT_OPTIONAL_LOCKS: "0",
  };
  const git = async (args: string[]) =>
    (await exec("git", ["-C", root, ...args], { env, timeout: 5000 })).stdout.trim();
  if ((await fs.realpath(await git(["rev-parse", "--show-toplevel"]))) !== root) {
    return undefined;
  }
  if ((await git(["status", "--porcelain", "--untracked-files=all"])).length > 0) {
    return undefined;
  }
  const hash = await git(["rev-parse", "HEAD"]);
  return commitPattern.test(hash) ? hash : undefined;
}

async function cacheCommit(root: string) {
  // npm/npx and Bunx place the unscoped CLI directly in this node_modules.
  // Do not search arbitrary ancestors, where a target's Git/lock state could live.
  if (path.basename(path.dirname(root)) !== "node_modules") {
    return undefined;
  }
  const cache = path.dirname(path.dirname(root));
  const [npm, bun] = await Promise.all([
    read(path.join(cache, "package-lock.json")),
    read(path.join(cache, "bun.lock")),
  ]);
  if (npm !== undefined && bun !== undefined) {
    return undefined;
  }
  if (npm !== undefined) {
    return gitCommit(
      decodeNpmLock(npm).packages?.[`node_modules/${path.basename(root)}`]?.resolved,
    );
  }
  if (bun === undefined) {
    return undefined;
  }
  return bunCommit(root, bun);
}

function bunCommit(root: string, bun: string) {
  const errors: ParseError[] = [];
  const value: unknown = parse(bun, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    return undefined;
  }
  const lock = decodeBunLock(value);
  const name = path.basename(root),
    entry = lock.packages?.[name]?.[0];
  if (typeof entry !== "string" || !entry.startsWith(`${name}@`)) {
    return undefined;
  }
  const resolved = entry.slice(name.length + 1),
    full = gitCommit(resolved);
  if (full !== undefined) {
    return full;
  }
  return matchingBunRequest(resolved, lock.workspaces?.[""]?.dependencies?.[name]);
}

function matchingBunRequest(resolved: string, request: unknown) {
  // Bun 1.4 GitHub resolutions contain only an abbreviated hash. A full
  // requested pin is usable only when origin and resolved prefix agree.
  const requested = gitCommit(request);
  const short = resolved.split("#")[1];
  return requested !== undefined &&
    typeof request === "string" &&
    short !== undefined &&
    /^[a-f0-9]{7,64}$/.test(short) &&
    origin(request) === origin(resolved) &&
    requested.startsWith(short)
    ? requested
    : undefined;
}
