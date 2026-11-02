import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

type Diagnostic = { code: string; severity: number };
type Message = {
  id?: number;
  method?: string;
  params?: { uri?: string; diagnostics?: Diagnostic[] };
  result?: unknown;
  error?: unknown;
};

/** Exercise the real server protocol, including unsaved current-file changes. */
export async function assertOxlintLsp(options: {
  root: string; executable: string; file: string; broken: string; fixed: string; codes: readonly string[];
}) {
  const filename = path.join(options.root, options.file);
  const uri = pathToFileURL(filename).href;
  await fs.writeFile(filename, options.broken);
  const server = spawn(options.executable, ["oxlint", "--lsp"], { cwd: options.root, stdio: "pipe" });
  let stderr = "";
  let buffer = Buffer.alloc(0);
  let nextId = 0;
  const pending = new Map<number, (message: Message) => void>();
  let onDiagnostics: ((diagnostics: Diagnostic[]) => void) | undefined;
  const send = (message: object) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
    server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    server.stdin.write(body);
  };
  server.stderr.on("data", (data) => { stderr += data.toString(); });
  server.stdout.on("data", (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);
    while (true) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())![1]);
      if (buffer.length < end + 4 + length) return;
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()) as Message;
      buffer = buffer.subarray(end + 4 + length);
      if (message.id !== undefined && message.method) send({ id: message.id, result: null });
      else if (message.id !== undefined) pending.get(message.id)?.(message);
      else if (message.method === "textDocument/publishDiagnostics" && message.params?.uri === uri) {
        onDiagnostics?.(message.params.diagnostics ?? []);
      }
    }
  });
  const wait = <T>(subscribe: (resolve: (value: T) => void) => () => void): Promise<T> => new Promise((resolve, reject) => {
    const failed = (error: Error) => { cleanup(); reject(error); };
    const exited = () => failed(new Error(`Oxlint LSP exited unexpectedly: ${stderr}`));
    const timeout = setTimeout(() => failed(new Error(`Timed out waiting for Oxlint LSP: ${stderr}`)), 15_000);
    const unsubscribe = subscribe((value) => { cleanup(); resolve(value); });
    const cleanup = () => {
      clearTimeout(timeout);
      unsubscribe();
      server.off("error", failed);
      server.off("exit", exited);
    };
    server.once("error", failed);
    server.once("exit", exited);
  });
  const request = (method: string, params: unknown) => {
    const id = ++nextId;
    const result = wait<Message>((resolve) => { pending.set(id, resolve); return () => { pending.delete(id); }; });
    send({ id, method, params });
    return result;
  };
  const diagnostics = (predicate: (values: Diagnostic[]) => boolean) => wait<Diagnostic[]>((resolve) => {
    onDiagnostics = (values) => { if (predicate(values)) resolve(values); };
    return () => { onDiagnostics = undefined; };
  });
  const hasErrors = (values: Diagnostic[]) => options.codes.every((code) =>
    values.some((value) => value.code === code && value.severity === 1));
  try {
    const initialized = await request("initialize", {
      processId: process.pid, rootUri: pathToFileURL(options.root).href,
      capabilities: {},
      initializationOptions: { typeAware: true, run: "onType", configPath: ".oxlintrc.json" },
    });
    assert.equal(initialized.error, undefined, JSON.stringify(initialized));
    send({ method: "initialized", params: {} });
    const initial = diagnostics(hasErrors);
    send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescript", version: 1, text: options.broken } } });
    await initial;
    const cleared = diagnostics((values) => values.length === 0);
    send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: options.fixed }] } });
    await cleared;
    const restored = diagnostics(hasErrors);
    send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 3 }, contentChanges: [{ text: options.broken }] } });
    await restored;
    const shutdown = await request("shutdown", null);
    assert.equal(shutdown.error, undefined);
    const exited = new Promise<number | null>((resolve) => server.once("exit", resolve));
    send({ method: "exit", params: null });
    assert.equal(await exited, 0, stderr);
  } finally {
    server.stdin.end();
    if (server.exitCode === null) server.kill();
    await fs.rm(filename, { force: true });
  }
}
