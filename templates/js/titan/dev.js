import chokidar from "chokidar";
import { spawn, execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { bundle } from "./bundle.js";

// Required for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Colors
import { createRequire } from "module";

// Colors
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

function getTitanVersion() {
    try {
        // 1. Try resolving from node_modules (standard user case)
        const require = createRequire(import.meta.url);
        // We look for @ezetgalaxy/titan/package.json
        const pkgPath = require.resolve("@ezetgalaxy/titan/package.json");
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        return pkg.version;
    } catch (e) {
        try {
            // 2. Fallback for local dev (path to repo root)
            const localPath = path.join(__dirname, "..", "..", "..", "package.json");
            if (fs.existsSync(localPath)) {
                const pkg = JSON.parse(fs.readFileSync(localPath, "utf-8"));
                if (pkg.name === "@ezetgalaxy/titan") {
                    return pkg.version;
                }
            }
        } catch (e2) { }
    }
    return "0.1.0"; // Fallback
}

let serverProcess = null;
let isKilling = false;

// ... (killServer same as before) 
async function killServer() {
    if (!serverProcess) return;

    isKilling = true;
    const pid = serverProcess.pid;
    const killPromise = new Promise((resolve) => {
        if (serverProcess.exitCode !== null) return resolve();
        serverProcess.once("close", resolve);
    });

    if (process.platform === "win32") {
        try {
            execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' });
        } catch (e) {
            // Ignore errors if process is already dead
        }
    } else {
        serverProcess.kill();
    }

    try {
        await killPromise;
    } catch (e) { }
    serverProcess = null;
    isKilling = false;
}

async function startRustServer(retryCount = 0) {
    const waitTime = retryCount > 0 ? 2000 : 1000;

    await killServer();
    await new Promise(r => setTimeout(r, waitTime));

    const serverPath = path.join(process.cwd(), "server");
    const startTime = Date.now();

    if (retryCount > 0) {
        console.log(yellow(`[Titan] Retrying Rust server (Attempt ${retryCount})...`));
    }

    serverProcess = spawn("cargo", ["run", "--jobs", "1"], {
        cwd: serverPath,
        stdio: "inherit",
        shell: true,
        env: { ...process.env, CARGO_INCREMENTAL: "0" }
    });

    serverProcess.on("close", async (code) => {
        if (isKilling) return;
        const runTime = Date.now() - startTime;
        if (code !== 0 && code !== null && runTime < 15000 && retryCount < 5) {
            await startRustServer(retryCount + 1);
        } else if (code !== 0 && code !== null && retryCount >= 5) {
            console.log(red(`[Titan] Server failed to start after multiple attempts.`));
        }
    });
}

async function rebuild() {
    // process.stdout.write(gray("[Titan] Preparing runtime... "));
    const start = Date.now();
    try {
        execSync("node app/app.js", { stdio: "ignore" });
        await bundle();
        // console.log(green("Done"));
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(gray(`   A new orbit is ready for your app in ${elapsed}s`));
        console.log(green(`   Your app is now orbiting Titan Planet`));
    } catch (e) {
        console.log(red("Failed"));
        console.log(red("[Titan] Failed to prepare runtime. Check your app/app.js"));
    }
}

async function startDev() {
    const root = process.cwd();
    // Check if Rust actions exist by looking for .rs files in app/actions
    const actionsDir = path.join(root, "app", "actions");
    let hasRust = false;
    if (fs.existsSync(actionsDir)) {
        hasRust = fs.readdirSync(actionsDir).some(f => f.endsWith(".rs"));
    }

    const mode = hasRust ? "Rust + JS Actions" : "JS Actions";
    const version = getTitanVersion();

    console.clear();
    console.log("");
    console.log(`  ${bold(cyan("Titan Planet"))}   ${gray("v" + version)}   ${yellow("[ Dev Mode ]")}`);
    console.log("");
    console.log(`  ${gray("Type:       ")} ${mode}`);
    console.log(`  ${gray("Hot Reload: ")} ${green("Enabled")}`);

    if (fs.existsSync(path.join(root, ".env"))) {
        console.log(`  ${gray("Env:        ")} ${yellow("Loaded")}`);
    }
    console.log(""); // Spacer

    // FIRST BUILD
    try {
        await rebuild();
        await startRustServer();
    } catch (e) {
        console.log(red("[Titan] Initial build failed. Waiting for changes..."));
    }

    // ... watcher logic same as before but using color vars ...
    const watcher = chokidar.watch(["app", ".env"], {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
    });

    let timer = null;
    watcher.on("all", async (event, file) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
            console.log(""); // Spacer before reload logs
            if (file.includes(".env")) {
                console.log(yellow("[Titan] Env Refreshed"));
            } else {
                console.log(cyan(`[Titan] Change: ${path.basename(file)}`));
            }
            try {
                await killServer();
                await rebuild();
                await startRustServer();
            } catch (e) {
                console.log(red("[Titan] Build failed -- waiting for changes..."));
            }
        }, 1000);
    });
}

// Handle graceful exit to release file locks
async function handleExit() {
    console.log("\n[Titan] Stopping server...");
    await killServer();
    process.exit(0);
}

process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);

startDev();
