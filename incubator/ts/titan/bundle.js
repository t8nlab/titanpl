import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/* ------------------------------------------------------------------
   Node Builtin Rewrite Map
------------------------------------------------------------------ */

const NODE_BUILTIN_MAP = {
  "fs": "@titanpl/node/fs",
  "node:fs": "@titanpl/node/fs",

  "path": "@titanpl/node/path",
  "node:path": "@titanpl/node/path",

  "os": "@titanpl/node/os",
  "node:os": "@titanpl/node/os",

  "crypto": "@titanpl/node/crypto",
  "node:crypto": "@titanpl/node/crypto",

  "process": "@titanpl/node/process",
  "node:process": "@titanpl/node/process",

  "events": "@titanpl/node/events",
  "node:events": "@titanpl/node/events",

  "util": "@titanpl/node/util",
  "node:util": "@titanpl/node/util"
};

/* ------------------------------------------------------------------
   Titan Node Compatibility Plugin
------------------------------------------------------------------ */

const titanNodeCompatPlugin = {
  name: "titan-node-compat",
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      const replacement = NODE_BUILTIN_MAP[args.path];
      if (!replacement) return;

      // MUST return absolute path for esbuild
      const resolved = require.resolve(replacement);
      return { path: resolved };
    });
  }
};

/* ------------------------------------------------------------------
   Main Bundle Entry
------------------------------------------------------------------ */

export async function bundle() {
  const root = process.cwd();
  const actionsDir = path.join(root, "app", "actions");
  const outDir = path.join(root, "server", "src", "actions");

  await bundleJs(actionsDir, outDir);
}

/* ------------------------------------------------------------------
   Bundle JS Actions
------------------------------------------------------------------ */

async function bundleJs(actionsDir, outDir) {
  if (!fs.existsSync(actionsDir)) return;

  fs.mkdirSync(outDir, { recursive: true });

  // Clean old bundles
  const oldFiles = fs.readdirSync(outDir);
  for (const file of oldFiles) {
    fs.unlinkSync(path.join(outDir, file));
  }

  const files = fs
    .readdirSync(actionsDir)
    .filter(f => f.endsWith(".js") || f.endsWith(".ts"));

  if (files.length === 0) return;

  for (const file of files) {
    const actionName = path.basename(file, path.extname(file));
    const entry = path.join(actionsDir, file);
    const outfile = path.join(outDir, actionName + ".jsbundle");

    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "iife",
      globalName: "__titan_exports",
      platform: "node",          // important for npm libs
      target: "es2020",
      logLevel: "silent",
      plugins: [titanNodeCompatPlugin],

      banner: {
        js: "var Titan = t;"
      },

      footer: {
        js: `
(function () {
  const fn =
    __titan_exports["${actionName}"] ||
    __titan_exports.default;

  if (typeof fn !== "function") {
    throw new Error("[Titan] Action '${actionName}' not found or not a function");
  }

  globalThis["${actionName}"] = globalThis.defineAction(fn);
})();
`
      }
    });
  }
}