import chokidar from "chokidar";
import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import { bundle } from "./bundle.js";
import { buildMetadata } from "./builder.js";
import { createRequire } from "module";
import os from "os";

const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

function getTitanVersion() {
    try {
        const require = createRequire(import.meta.url);
        const pkgPath = require.resolve("@titanpl/cli/package.json");
        return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
    } catch (e) {
        return "1.0.0";
    }
}

function getEngineBinaryPath(root) {
    // First: check if the CLI pre-resolved this for us (correct module context)
    if (process.env.TITAN_ENGINE_BINARY && fs.existsSync(process.env.TITAN_ENGINE_BINARY)) {
        return process.env.TITAN_ENGINE_BINARY;
    }

    const platform = os.platform();
    const arch = os.arch();
    const binName = platform === 'win32' ? 'titan-server.exe' : 'titan-server';
    const pkgName = `@titanpl/engine-${platform}-${arch}`;

    // 1. Monorepo search (dev environment)
    let current = root;
    for (let i = 0; i < 5; i++) {
        const potentialRelease = path.join(current, 'engine', 'target', 'release', binName);
        if (fs.existsSync(potentialRelease)) return potentialRelease;
        const potentialDebug = path.join(current, 'engine', 'target', 'debug', binName);
        if (fs.existsSync(potentialDebug)) return potentialDebug;

        // Check sibling monorepo folder for test-apps
        const siblingRelease = path.join(current, 'titanpl', 'engine', 'target', 'release', binName);
        if (fs.existsSync(siblingRelease)) return siblingRelease;
        const siblingDebug = path.join(current, 'titanpl', 'engine', 'target', 'debug', binName);
        if (fs.existsSync(siblingDebug)) return siblingDebug;
        const siblingPkg = path.join(current, 'titanpl', 'packages', pkgName.replace('@titanpl/', ''), 'bin', binName);
        if (fs.existsSync(siblingPkg)) return siblingPkg;

        current = path.dirname(current);
    }

    // 2. Search relative to @titanpl/cli (where optionalDependencies are installed)
    try {
        const req = createRequire(import.meta.url);
        const cliPkgPath = req.resolve('@titanpl/cli/package.json');
        const cliDir = path.dirname(cliPkgPath);
        const cliNodeModulesBin = path.join(cliDir, 'node_modules', pkgName, 'bin', binName);
        if (fs.existsSync(cliNodeModulesBin)) return cliNodeModulesBin;

        const nodeModulesDir = path.dirname(path.dirname(cliDir));
        const parentNodeModulesBin = path.join(nodeModulesDir, pkgName, 'bin', binName);
        if (fs.existsSync(parentNodeModulesBin)) return parentNodeModulesBin;
    } catch (e) { }

    // 3. Search in the project's own node_modules directly
    try {
        const req = createRequire(import.meta.url);
        const pkgPath = req.resolve(`${pkgName}/package.json`);
        const binPath = path.join(path.dirname(pkgPath), 'bin', binName);
        if (fs.existsSync(binPath)) return binPath;
    } catch (e) { }

    // Walk upwards from current dir searching for node_modules/@titanpl/engine-...
    let searchDir = process.cwd();
    for (let i = 0; i < 5; i++) {
        const nmBin = path.join(searchDir, 'node_modules', pkgName, 'bin', binName);
        if (fs.existsSync(nmBin)) return nmBin;
        const parent = path.dirname(searchDir);
        if (parent === searchDir) break;
        searchDir = parent;
    }

    // 4. Fallback: check common global npm paths
    const globalSearchRoots = [
        process.env.npm_config_prefix,
        path.join(os.homedir(), '.npm-global'),
        '/usr/local/lib',
        '/usr/lib'
    ].filter(Boolean);

    for (const gRoot of globalSearchRoots) {
        const gBin = path.join(gRoot, 'node_modules', pkgName, 'bin', binName);
        if (fs.existsSync(gBin)) return gBin;
        const libNodeModulesBin = path.join(gRoot, 'lib', 'node_modules', pkgName, 'bin', binName);
        if (fs.existsSync(libNodeModulesBin)) return libNodeModulesBin;
    }

    try {
        const globalModules = execSync('npm root -g').toString().trim();
        const globalBin = path.join(globalModules, pkgName, 'bin', binName);
        if (fs.existsSync(globalBin)) return globalBin;
    } catch (e) { }

    return null;
}

let serverProcess = null;

async function killServer() {
    if (!serverProcess) return;

    return new Promise((resolve) => {
        if (serverProcess.killed || serverProcess.exitCode !== null) {
            serverProcess = null;
            resolve();
            return;
        }

        let isDone = false;
        const onExit = () => {
            if (isDone) return;
            isDone = true;
            serverProcess = null;
            setTimeout(resolve, 300); // Grace period for OS socket release
        };

        serverProcess.on('exit', onExit);
        serverProcess.on('error', onExit);

        try {
            serverProcess.kill('SIGKILL');
        } catch (e) { }

        setTimeout(onExit, 800); // Fallback
    });
}

function startServer(root, outDir) {
    const binaryPath = getEngineBinaryPath(root);
    if (!binaryPath) {
        console.error(red("[TitanPL] Error: Could not find engine binary. Ensure you have installed the correct engine package."));
        return;
    }

    const distPath = path.resolve(root, "dist");

    serverProcess = spawn(binaryPath, ['run', distPath, '--watch'], {
        stdio: 'inherit',
        env: {
            ...process.env,
            TITAN_ENV: 'development',
            Titan_Dev: '1'
        }
    });

    serverProcess.on('error', (err) => {
        if (err.code === 'ENOENT') {
            console.error(red("[TitanPL] Failed to start engine: Binary not found."));
        } else {
            console.error(red(`[TitanPL] Engine error: ${err.message}`));
        }
    });
}

export async function dev(options) {
    const root = options.root || process.cwd();
    const outDir = options.outDir || path.join(root, "dist");

    const version = getTitanVersion();

    console.clear();
    console.log("");
    console.log(`  ${bold(cyan("⏣ Titan Planet"))}   ${gray("v" + version)}   ${yellow("[ Dev Mode ]")}`);
    console.log("");
    console.log(`  ${gray("Type:       ")} JS Actions`);
    console.log(`  ${gray("Hot Reload: ")} ${green("Enabled")}`);

    if (fs.existsSync(path.join(root, ".env"))) {
        console.log(`  ${gray("Env:        ")} ${yellow("Loaded")}`);
    }
    console.log("");

    const runBuildCycle = async () => {
        try {
            await killServer();

            await buildMetadata(root, outDir);
            await bundle({ root, outDir });

            console.log(cyan(`\n[TitanPL] Starting Engine...`));
            startServer(root, outDir);
        } catch (err) {
            if (err.message !== '__TITAN_BUNDLE_FAILED__') {
                console.error(red(`[TitanPL] Build failed: ${err.message}`));
            }
            console.log(yellow("\n[TitanPL] Waiting for fixes before restarting orbit..."));
        }
    };

    // Initial build
    await runBuildCycle();

    // Watch for changes inside app/
    const appDir = path.join(root, "app");
    const envFile = path.join(root, ".env");
    const tEnvFile = path.join(root, "t.env");

    const watcher = chokidar.watch([appDir, envFile, tEnvFile], {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    });

    let buildTimer = null;
    watcher.on("all", async (event, file) => {
        if (!file) return;
        const relPath = path.relative(root, file);
        if (relPath.startsWith("dist") || relPath.startsWith(".titan") || relPath.startsWith("server") || relPath.startsWith("node_modules")) return;

        if (buildTimer) clearTimeout(buildTimer);
        buildTimer = setTimeout(() => {
            console.clear();
            console.log(cyan(`[TitanPL] File changed: ${relPath}. Rebuilding...`));
            runBuildCycle();
        }, 300); // Debounce
    });

    // Cleanup on exit
    process.on('SIGINT', async () => {
        await killServer();
        process.exit(0);
    });

    return watcher;
}
