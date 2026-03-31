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

const createTitanRootResolverPlugin = (root) => {
  return {
    name: "titan-root-resolver",
    setup(build) {
      // Handle paths starting with ./ or ../ manually to check root first if needed
      build.onResolve({ filter: /^\.\.?\// }, args => {
        const potentialPath = path.join(root, args.path.replace(/^\.\//, ''));
        if (fs.existsSync(potentialPath)) {
          return { path: potentialPath };
        }
        // Fallback to default
        return null;
      });

      // Special handling for paths that looks like project folders
      const projectFolders = ['app', 'config', 'db', 'public', 'static', 'views', 'auth'];
      build.onResolve({ filter: new RegExp(`^(${projectFolders.join('|')})(\\/|$)`) }, args => {
        return { path: path.join(root, args.path) };
      });
    }
  };
};

const createTitanNodeCompatPlugin = (root) => {
  const rootRequire = createRequire(path.join(root, 'package.json'));

  return {
    name: "titan-node-compat",
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (NODE_BUILTIN_MAP[args.path]) {
          const shimPkg = NODE_BUILTIN_MAP[args.path];
          try {
            // 1. Try to resolve from project root (local node_modules)
            const resolved = rootRequire.resolve(shimPkg);
            return { path: resolved };
          } catch (e) {
            try {
              // 2. Fallback to CLI's own context
              const resolved = require.resolve(shimPkg);
              return { path: resolved };
            } catch (e2) {
              throw new Error(`[TitanPL] Failed to resolve Node shim: ${shimPkg}. Ensure @titanpl/node is installed.`);
            }
          }
        }
      });
    }
  };
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
    const root = options.root || process.cwd();
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile,
      format,
      globalName,
      platform: 'node',
      target,
      logLevel: 'silent',
      absWorkingDir: root,
      plugins: [
        createTitanRootResolverPlugin(root),
        createTitanNodeCompatPlugin(root)
      ],
      alias: {
        "app": path.join(root, "app"),
        "config": path.join(root, "config"),
        "db": path.join(root, "db"),
        "public": path.join(root, "public"),
        "static": path.join(root, "static"),
        "views": path.join(root, "views"),
        "auth": path.join(root, "auth"),
      },
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
        root,
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
