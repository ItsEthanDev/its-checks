#!/usr/bin/env node
import { tsImport } from "tsx/esm/api";

// The target project's tsconfig must not affect the executed tool.
await tsImport("../src/cli.ts", { parentURL: import.meta.url, tsconfig: false });
