/**
 * Bundle.js (JavaScript Version)
 * Handles esbuild bundling with error reporting
 */

import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { renderErrorBox, parseEsbuildError } from './error-box.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Required for resolving node_modules inside ESM
const require = createRequire(import.meta.url);

/**
 * Titan Node Builtin Rewrite Map
 */
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
  "util": "@titanpl/node/util",
  "node:util": "@titanpl/node/util",
};

const titanNodeCompatPlugin = {
  name: "titan-node-compat",
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (NODE_BUILTIN_MAP[args.path]) {
        try {
          const resolved = require.resolve(NODE_BUILTIN_MAP[args.path]);
          return { path: resolved };
        } catch (e) {
          throw new Error(`[TitanPL] Failed to resolve Node shim: ${NODE_BUILTIN_MAP[args.path]}`);
        }
      }
    });
  }
};

function getTitanVersion() {
  try {
    const pkgPath = require.resolve("@titanpl/cli/package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
  } catch (e) {
    return "1.0.0";
  }
}

export class BundleError extends Error {
  constructor(message, errors = [], warnings = []) {
    super(message);
    this.name = 'BundleError';
    this.errors = errors;
    this.warnings = warnings;
    this.isBundleError = true;
  }
}

async function validateEntryPoint(entryPoint) {
  const absPath = path.resolve(entryPoint);
  if (!fs.existsSync(absPath)) {
    throw new BundleError(`Entry point does not exist: ${entryPoint}`, [{ text: `Cannot find file: ${absPath}`, location: { file: entryPoint } }]);
  }
}

/**
 * Bundles a single file
 */
export async function bundleFile(options) {
  const { entryPoint, outfile, format = 'iife', globalName = '__titan_exports', target = 'es2020' } = options;

  await validateEntryPoint(entryPoint);

  const outDir = path.dirname(outfile);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  try {
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile,
      format,
      globalName,
      platform: 'node',
      target,
      logLevel: 'silent',
      plugins: [titanNodeCompatPlugin],
      banner: { js: "var Titan = t;" },
      footer: options.footer || {}
    });

    if (result.errors?.length) {
      throw new BundleError(`Build failed`, result.errors);
    }
  } catch (err) {
    if (err.errors) throw new BundleError(`Build failed`, err.errors);
    throw err;
  }
}

/**
 * Main JS Bundler
 */
export async function bundle(options = {}) {
  const root = options.root || process.cwd();
  const outDir = options.outDir || path.join(root, 'dist');
  const titanVersion = getTitanVersion();

  const actionsDir = path.join(root, 'app', 'actions');
  const bundleDir = path.join(outDir, 'actions');

  if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  if (!fs.existsSync(actionsDir)) return;

  const files = fs.readdirSync(actionsDir).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const actionName = path.basename(file, path.extname(file));
    const entryPoint = path.join(actionsDir, file);
    const outfile = path.join(bundleDir, actionName + ".jsbundle");

    try {
      await bundleFile({
        entryPoint,
        outfile,
        footer: {
          js: `
(function () {
  const fn = __titan_exports["${actionName}"] || __titan_exports.default;
  if (typeof fn !== "function") throw new Error("[TitanPL] Action '${actionName}' not found or not a function");
  globalThis["${actionName}"] = globalThis.defineAction(fn);
})();`
        }
      });
    } catch (error) {
      console.error();
      if (error.isBundleError && error.errors?.length) {
        for (const err of error.errors) {
          const errorInfo = parseEsbuildError(err);
          errorInfo.titanVersion = titanVersion;
          console.error(renderErrorBox(errorInfo));
          console.error();
        }
      } else {
        console.error(renderErrorBox({ title: 'Build Error', message: error.message, titanVersion }));
      }
      throw new Error('__TITAN_BUNDLE_FAILED__');
    }
  }
}
