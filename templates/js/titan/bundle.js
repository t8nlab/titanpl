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

/**
 * Get Titan version for error branding
 */
function getTitanVersion() {
    try {
        const require = createRequire(import.meta.url);
        const pkgPath = require.resolve("@ezetgalaxy/titan/package.json");
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
 * Validates that the entry point exists and is readable
 * @param {string} entryPoint - Entry file path
 * @throws {BundleError} If file doesn't exist or isn't readable
 */
async function validateEntryPoint(entryPoint) {
    const absPath = path.resolve(entryPoint);

    if (!fs.existsSync(absPath)) {
        throw new BundleError(
            `Entry point does not exist: ${entryPoint}`,
            [{
                text: `Cannot find file: ${absPath}`,
                location: { file: entryPoint }
            }]
        );
    }

    try {
        await fs.promises.access(absPath, fs.constants.R_OK);
    } catch (err) {
        throw new BundleError(
            `Entry point is not readable: ${entryPoint}`,
            [{
                text: `Cannot read file: ${absPath}`,
                location: { file: entryPoint }
            }]
        );
    }
}

/**
 * Bundles a single JavaScript/TypeScript file using esbuild
 * @param {Object} options - Bundle options
 * @returns {Promise<void>}
 * @throws {BundleError} If bundling fails
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

    // Validate entry point exists
    await validateEntryPoint(entryPoint);

    // Ensure output directory exists
    const outDir = path.dirname(outfile);
    await fs.promises.mkdir(outDir, { recursive: true });

    try {
        // Run esbuild with error logging enabled
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
            logLevel: 'silent', // We handle all errors ourselves
            logLimit: 0,
            color: false,
            write: true,
            metafile: false,
        });

        // Check for errors in the result
        if (result.errors && result.errors.length > 0) {
            throw new BundleError(
                `Build failed with ${result.errors.length} error(s)`,
                result.errors,
                result.warnings || []
            );
        }

    } catch (err) {
        if (err.errors && err.errors.length > 0) {
            // This is an esbuild error with detailed error information
            throw new BundleError(
                `Build failed with ${err.errors.length} error(s)`,
                err.errors,
                err.warnings || []
            );
        }

        // Other unexpected errors
        throw new BundleError(
            `Unexpected build error: ${err.message}`,
            [{
                text: err.message,
                location: { file: entryPoint }
            }]
        );
    }
}

/**
 * Main bundle function - scans app/actions and bundles all files
 * RULE: This function handles ALL esbuild errors and prints error boxes directly
 * RULE: After printing error box, throws Error("__TITAN_BUNDLE_FAILED__")
 * @returns {Promise<void>}
 */
export async function bundle() {
    const root = process.cwd();
    const actionsDir = path.join(root, 'app', 'actions');
    const bundleDir = path.join(root, 'server', 'src', 'actions');

    // Ensure bundle directory exists and is clean
    if (fs.existsSync(bundleDir)) {
        fs.rmSync(bundleDir, { recursive: true, force: true });
    }
    await fs.promises.mkdir(bundleDir, { recursive: true });

    // Check if actions directory exists
    if (!fs.existsSync(actionsDir)) {
        return; // No actions to bundle
    }

    // Get all JS/TS files in actions directory
    const files = fs.readdirSync(actionsDir).filter(f =>
        (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts')
    );

    if (files.length === 0) {
        return; // No action files
    }

    // Bundle each action file
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
                platform: 'neutral',
                target: 'es2020',
                minify: false,
                sourcemap: false,
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
        } catch (error) {
            // RULE: Handle esbuild errors HERE and print error boxes
            if (error.isBundleError && error.errors && error.errors.length > 0) {
                // Print error box for each esbuild error
                console.error(); // Empty line for spacing

                const titanVersion = getTitanVersion();

                for (let i = 0; i < error.errors.length; i++) {
                    const esbuildError = error.errors[i];
                    const errorInfo = parseEsbuildError(esbuildError);

                    // Add error number to title if multiple errors
                    if (error.errors.length > 1) {
                        errorInfo.title = `Build Error ${i + 1}/${error.errors.length}`;
                    }

                    // Add Titan version
                    errorInfo.titanVersion = titanVersion;

                    // Print the error box
                    console.error(renderErrorBox(errorInfo));

                    if (i < error.errors.length - 1) {
                        console.error(); // Empty line between errors
                    }
                }

                console.error(); // Empty line after all errors
            } else {
                // Other errors
                console.error();
                const errorInfo = {
                    title: 'Build Error',
                    file: entryPoint,
                    message: error.message || 'Unknown error',
                    titanVersion: getTitanVersion()
                };
                console.error(renderErrorBox(errorInfo));
                console.error();
            }

            // RULE: Throw special error to signal bundle failure
            throw new Error('__TITAN_BUNDLE_FAILED__');
        }
    }
}