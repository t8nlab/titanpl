/**
 * Bundle.js (TypeScript Version)
 * Handles esbuild bundling with comprehensive error reporting and TypeScript type checking
 */

import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import ts from 'typescript';
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

/**
 * Run TypeScript type checking
 */
async function checkTypes(root) {
    const tsconfigPath = path.join(root, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) return;

    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
        throw new BundleError("Failed to load tsconfig.json", [configFile.error]);
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        root
    );

    const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    if (diagnostics.length > 0) {
        const errors = diagnostics.map(d => {
            const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
            if (d.file) {
                const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
                return {
                    title: 'TypeScript Error',
                    message: message,
                    file: d.file.fileName,
                    line: line + 1,
                    column: character + 1,
                    location: `at ${d.file.fileName}:${line + 1}:${character + 1}`,
                    codeFrame: `${line + 1} | ${d.file.text.split('\n')[line]}\n${' '.repeat(String(line + 1).length)} | ${' '.repeat(character)}^`
                };
            }
            return { title: 'TypeScript Error', message: message };
        });

        throw new BundleError(`TypeScript checking failed with ${diagnostics.length} error(s)`, errors);
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
 * Main TS Bundler
 */
export async function bundle(options = {}) {
    const root = options.root || process.cwd();
    const outDir = options.outDir || path.join(root, 'dist');
    const titanVersion = getTitanVersion();

    // 1. Mandatory Type Check for TS apps
    try {
        await checkTypes(root);
    } catch (error) {
        console.error();
        if (error.isBundleError && error.errors?.length) {
            for (let i = 0; i < error.errors.length; i++) {
                const errorInfo = error.errors[i];
                errorInfo.titanVersion = titanVersion;
                console.error(renderErrorBox(errorInfo));
                console.error();
            }
        } else {
            console.error(renderErrorBox({ title: 'TypeScript Error', message: error.message, titanVersion }));
        }
        throw new Error('__TITAN_BUNDLE_FAILED__');
    }

    // 2. Bundle Actions
    const actionsDir = path.join(root, 'app', 'actions');
    const bundleDir = path.join(outDir, 'actions');

    if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
    fs.mkdirSync(bundleDir, { recursive: true });

    if (!fs.existsSync(actionsDir)) return;

    const files = fs.readdirSync(actionsDir).filter(f => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'));

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
