/**
 * Bundle.js
 * Handles esbuild bundling with comprehensive error reporting
 * RULE: This file handles ALL esbuild errors and prints error boxes directly
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
 * Rewrites Node builtins to @titanpl/node shims
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

/**
 * Titan Node Compatibility Plugin
 * Rewrites require/import of Node builtins
 * Returns absolute paths (required by esbuild)
 */
const titanNodeCompatPlugin = {
  name: "titan-node-compat",
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (NODE_BUILTIN_MAP[args.path]) {
        try {
          const resolved = require.resolve(NODE_BUILTIN_MAP[args.path]);
          return { path: resolved };
        } catch (e) {
          throw new Error(
            `[Titan] Failed to resolve Node shim: ${NODE_BUILTIN_MAP[args.path]}`
          );
        }
      }
    });
  }
};

/**
 * Get Titan version for error branding
 */
function getTitanVersion() {
  try {
    const pkgPath = require.resolve("titanpl/package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
  } catch (e) {
    return "0.1.0";
  }
}

/**
 * Custom error class for bundle errors
 */
export class BundleError extends Error {
  constructor(message, errors = [], warnings = []) {
    super(message);
    this.name = 'BundleError';
    this.errors = errors;
    this.warnings = warnings;
    this.isBundleError = true;
  }
}

/**
 * Validate entry file exists
 */
async function validateEntryPoint(entryPoint) {
  const absPath = path.resolve(entryPoint);

  if (!fs.existsSync(absPath)) {
    throw new BundleError(
      `Entry point does not exist: ${entryPoint}`,
      [{ text: `Cannot find file: ${absPath}`, location: { file: entryPoint } }]
    );
  }

  try {
    await fs.promises.access(absPath, fs.constants.R_OK);
  } catch {
    throw new BundleError(
      `Entry point is not readable: ${entryPoint}`,
      [{ text: `Cannot read file: ${absPath}`, location: { file: entryPoint } }]
    );
  }
}

/**
 * Bundles a single file
 */
export async function bundleFile(options) {
  const {
    entryPoint,
    outfile,
    format = 'iife',
    minify = false,
    sourcemap = false,
    platform = 'neutral',
    globalName = '__titan_exports',
    target = 'es2020',
    banner = {},
    footer = {}
  } = options;

  await validateEntryPoint(entryPoint);

  const outDir = path.dirname(outfile);
  await fs.promises.mkdir(outDir, { recursive: true });

  try {
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile,
      format,
      globalName,
      platform,
      target,
      banner,
      footer,
      minify,
      sourcemap,
      logLevel: 'silent',
      logLimit: 0,
      write: true,
      metafile: false,
      plugins: [titanNodeCompatPlugin],
    });

    if (result.errors?.length) {
      throw new BundleError(
        `Build failed with ${result.errors.length} error(s)`,
        result.errors,
        result.warnings || []
      );
    }

  } catch (err) {
    if (err.errors?.length) {
      throw new BundleError(
        `Build failed with ${err.errors.length} error(s)`,
        err.errors,
        err.warnings || []
      );
    }

    throw new BundleError(
      `Unexpected build error: ${err.message}`,
      [{ text: err.message, location: { file: entryPoint } }]
    );
  }
}

/**
 * Main bundler
 */
export async function bundle() {
  const root = process.cwd();
  const actionsDir = path.join(root, 'app', 'actions');
  const bundleDir = path.join(root, 'server', 'src', 'actions');

  if (fs.existsSync(bundleDir)) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
  }
  await fs.promises.mkdir(bundleDir, { recursive: true });

  if (!fs.existsSync(actionsDir)) return;

  const files = fs.readdirSync(actionsDir).filter(f =>
    (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts')
  );

  for (const file of files) {
    const actionName = path.basename(file, path.extname(file));
    const entryPoint = path.join(actionsDir, file);
    const outfile = path.join(bundleDir, actionName + ".jsbundle");

    try {
      await bundleFile({
        entryPoint,
        outfile,
        format: 'iife',
        globalName: '__titan_exports',
        platform: 'node',
        target: 'es2020',
        banner: { js: "var Titan = t;" },
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

    } catch (error) {

      console.error();

      const titanVersion = getTitanVersion();

      if (error.isBundleError && error.errors?.length) {
        for (let i = 0; i < error.errors.length; i++) {
          const errorInfo = parseEsbuildError(error.errors[i]);
          if (error.errors.length > 1) {
            errorInfo.title = `Build Error ${i + 1}/${error.errors.length}`;
          }
          errorInfo.titanVersion = titanVersion;
          console.error(renderErrorBox(errorInfo));
          console.error();
        }
      } else {
        const errorInfo = {
          title: 'Build Error',
          file: entryPoint,
          message: error.message || 'Unknown error',
          titanVersion
        };
        console.error(renderErrorBox(errorInfo));
      }

      throw new Error('__TITAN_BUNDLE_FAILED__');
    }
  }
}
