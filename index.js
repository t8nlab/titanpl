#!/usr/bin/env node

/* 
 * The Titan CLI has been completely rewritten and moved to packages/cli. 
 * This file remains for backward compatibility and redirects execution to the new CLI.
 */
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const newCliPath = path.join(__dirname, "packages", "cli", "index.js");

const args = process.argv.slice(2);
const child = spawn("node", [newCliPath, ...args], {
  stdio: "inherit",
  cwd: process.cwd()
});

child.on("close", (code) => {
  process.exit(code);
});