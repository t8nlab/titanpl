/**
 * Dev.js
 * Titan development server with hot reload
 * RULE: This file shows ONLY clean error messages - no raw logs, no stack traces
 */

import chokidar from "chokidar";
import { spawn, execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Premium colors
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

function getTitanVersion() {
    try {
        const require = createRequire(import.meta.url);
        const pkgPath = require.resolve("@ezetgalaxy/titan/package.json");
        return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
    } catch (e) {
        try {
            let cur = __dirname;
            for (let i = 0; i < 5; i++) {
                const pkgPath = path.join(cur, "package.json");
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                    if (pkg.name === "@ezetgalaxy/titan") return pkg.version;
                }
                cur = path.join(cur, "..");
            }
        } catch (e2) { }

        try {
            const output = execSync("tit --version", { encoding: "utf-8" }).trim();
            const match = output.match(/v(\d+\.\d+\.\d+)/);
            if (match) return match[1];
        } catch (e3) { }
    }
    return "0.1.0";
}

let serverProcess = null;
let isKilling = false;
let isFirstBoot = true;

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

const delay = (ms) => new Promise(res => setTimeout(res, ms));

let spinnerTimer = null;
const frames = ["⏣", "⟐", "⟡", "⟠", "⟡", "⟐"];
let frameIdx = 0;

function startSpinner(text) {
    if (spinnerTimer) clearInterval(spinnerTimer);
    process.stdout.write("\x1B[?25l"); // Hide cursor
    spinnerTimer = setInterval(() => {
        process.stdout.write(`\r  ${cyan(frames[frameIdx])} ${gray(text)}`);
        frameIdx = (frameIdx + 1) % frames.length;
    }, 80);
}

function stopSpinner(success = true, text = "") {
    if (spinnerTimer) {
        clearInterval(spinnerTimer);
        spinnerTimer = null;
    }
    process.stdout.write("\r\x1B[K"); // Clear line
    process.stdout.write("\x1B[?25h"); // Show cursor
    if (text) {
        if (success) {
            console.log(`  ${green("✔")} ${green(text)}`);
        } else {
            console.log(`  ${red("✖")} ${red(text)}`);
        }
    }
}

async function startRustServer(retryCount = 0) {
    const maxRetries = 3;
    const waitTime = retryCount > 0 ? 500 : 200;

    await killServer();
    await delay(waitTime);

    const serverPath = path.join(process.cwd(), "server");
    const startTime = Date.now();

    startSpinner("Stabilizing your app on its orbit...");

    let isReady = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const slowTimer = setTimeout(() => {
        if (!isReady && !isKilling) {
            startSpinner("Still stabilizing... (the first orbit takes longer)");
        }
    }, 15000);

    serverProcess = spawn("cargo", ["run", "--quiet"], {
        cwd: serverPath,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CARGO_INCREMENTAL: "1", TITAN_DEV: "1" }
    });

    serverProcess.on("error", (err) => {
        stopSpinner(false, "Orbit stabilization failed");
    });

    serverProcess.stdout.on("data", (data) => {
        const out = data.toString();

        if (!isReady) {
            stdoutBuffer += out;
            if (stdoutBuffer.includes("Titan server running") || stdoutBuffer.includes("████████╗")) {
                isReady = true;
                clearTimeout(slowTimer);
                stopSpinner(true, "Your app is now orbiting Titan Planet");

                if (isFirstBoot) {
                    process.stdout.write(stdoutBuffer);
                    isFirstBoot = false;
                } else {
                    const lines = stdoutBuffer.split("\n");
                    for (const line of lines) {
                        const isBanner = line.includes("Titan server running") ||
                            line.includes("████████╗") ||
                            line.includes("╚══") ||
                            line.includes("   ██║") ||
                            line.includes("   ╚═╝");
                        if (!isBanner && line.trim()) {
                            process.stdout.write(line + "\n");
                        }
                    }
                }
                stdoutBuffer = "";
            }
        } else {
            process.stdout.write(data);
        }
    });

    // Monitor stderr for port binding errors
    serverProcess.stderr.on("data", (data) => {
        stderrBuffer += data.toString();
    });

    serverProcess.on("close", async (code) => {
        clearTimeout(slowTimer);
        if (isKilling) return;
        const runTime = Date.now() - startTime;

        if (code !== 0 && code !== null) {
            // Check for port binding errors
            const isPortError = stderrBuffer.includes("Address already in use") ||
                stderrBuffer.includes("address in use") ||
                stderrBuffer.includes("os error 10048") || // Windows
                stderrBuffer.includes("EADDRINUSE") ||
                stderrBuffer.includes("AddrInUse");

            if (isPortError) {
                if (retryCount < 3) {
                    // It's likely the previous process hasn't fully released the port
                    await delay(1000);
                    await startRustServer(retryCount + 1);
                    return;
                }

                stopSpinner(false, "Orbit stabilization failed");

                // Try to read intended port
                let port = 3000;
                try {
                    const routesConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "server", "routes.json"), "utf8"));
                    if (routesConfig && routesConfig.__config && routesConfig.__config.port) {
                        port = routesConfig.__config.port;
                    }
                } catch (e) { }

                console.log("");

                console.log(red("⏣  Your application cannot enter this orbit"));
                console.log(red(`↳  Another application is already bound to port ${port}.`));
                console.log("");

                console.log(yellow("Recommended Actions:"));
                console.log(yellow("  1.") + " Release the occupied orbit (stop the other service).");
                console.log(yellow("  2.") + " Assign your application to a new orbit in " + cyan("app/app.js"));
                console.log(yellow("     Example: ") + cyan(`t.start(${port + 1}, "Titan Running!")`));
                console.log("");

                return;
            }


            stopSpinner(false, "Orbit stabilization failed");

            // // Debug: Show stderr if it's not empty and not a port error
            // if (stderrBuffer && stderrBuffer.trim()) {
            //     console.log(gray("\n[Debug] Cargo stderr:"));
            //     console.log(gray(stderrBuffer.substring(0, 500))); // Show first 500 chars
            // }

            if (runTime < 15000 && retryCount < maxRetries) {
                await delay(2000);
                await startRustServer(retryCount + 1);
            } else if (retryCount >= maxRetries) {
                console.log(gray("\n[Titan] Waiting for changes to retry..."));
            }
        }
    });
}

function prepareRuntime() {
    try {
        const nm = path.join(process.cwd(), "node_modules");
        const titanPkg = path.join(nm, "@titan");
        const routePkg = path.join(titanPkg, "route");

        if (!fs.existsSync(nm)) fs.mkdirSync(nm, { recursive: true });
        if (!fs.existsSync(titanPkg)) fs.mkdirSync(titanPkg, { recursive: true });

        if (!fs.existsSync(routePkg)) {
            fs.mkdirSync(routePkg, { recursive: true });
            fs.writeFileSync(path.join(routePkg, "package.json"), JSON.stringify({
                name: "@titan/route",
                main: "../../../titan/titan.js",
                type: "module"
            }, null, 2));
        }
    } catch (e) {
        // Ignore errors
    }
}

/**
 * Rebuild JS runtime
 * RULE: Only show "✖ Runtime preparation failed" on error
 * RULE: No raw logs, no stack traces, no console.error output
 */
async function rebuild() {
    try {
        // Execute app.js - pipe both stdout and stderr to capture and filter
        const result = execSync("node app/app.js", {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"]
        });

        // If succeeded, just print stdout (usually empty unless successful logs)
        if (result) process.stdout.write(result);
    } catch (e) {
        stopSpinner(false, "Runtime preparation failed");

        // RULE: Search for the error box in the output and print ONLY that
        // This removes Node.js version, stack traces, etc.
        const output = (e.stdout || "") + (e.stderr || "");

        // Find the box content - look for the start border (accounting for ANSI color)
        // Match from the first ┌ up to the last ┘
        const startIdx = output.indexOf('┌');
        const endIdx = output.lastIndexOf('┘');

        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            // Include potential ANSI codes before/after borders
            let box = output.substring(startIdx - 5, endIdx + 1 + 5);
            // Clean up to ensure we start/end at ANSI boundaries or borders
            const realStart = box.indexOf('\x1b[31m┌');
            const realEnd = box.lastIndexOf('┘\x1b[0m');

            if (realStart !== -1 && realEnd !== -1) {
                console.error("\n" + box.substring(realStart, realEnd + 5) + "\n");
            } else {
                // Fallback to simpler match
                const simpleBox = output.substring(startIdx, endIdx + 1);
                console.error("\n" + red(simpleBox) + "\n");
            }
        } else if (e.stderr && !e.stderr.includes("Node.js v")) {
            console.error(red(e.stderr.trim()));
        }

        throw e;
    }
}

async function startDev() {
    prepareRuntime();
    const root = process.cwd();
    const actionsDir = path.join(root, "app", "actions");
    let hasRust = false;
    if (fs.existsSync(actionsDir)) {
        hasRust = fs.readdirSync(actionsDir).some(f => f.endsWith(".rs"));
    }

    const isTs = fs.existsSync(path.join(root, "tsconfig.json")) ||
        fs.existsSync(path.join(root, "app", "app.ts"));

    let mode = "";
    if (hasRust) {
        mode = isTs ? "Rust + TS Actions" : "Rust + JS Actions";
    } else {
        mode = isTs ? "TS Actions" : "JS Actions";
    }
    const version = getTitanVersion();

    console.clear();
    console.log("");
    console.log(`  ${bold(cyan("⏣ Titan Planet"))}     ${gray("v" + version)}    ${yellow("[ Dev Mode ]")}`);
    console.log("");
    console.log(`  ${gray("Type:       ")} ${mode}`);
    console.log(`  ${gray("Hot Reload: ")} ${green("Enabled")}`);

    if (fs.existsSync(path.join(root, ".env"))) {
        console.log(`  ${gray("Env:        ")} ${yellow("Loaded")}`);
    }
    console.log("");

    try {
        await rebuild();
        await startRustServer();
    } catch (e) {
        console.log(gray("\n[Titan] Waiting for changes to retry..."));
    }

    const watcher = chokidar.watch(["app", ".env"], {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
    });

    let timer = null;
    watcher.on("all", async (event, file) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
            try {
                await killServer();
                await rebuild();
                await startRustServer();
            } catch (e) {
                console.log(gray("\n[Titan] Waiting for changes to retry..."));
            }
        }, 300);
    });
}

async function handleExit() {
    stopSpinner();
    console.log(gray("\n[Titan] Stopping server..."));
    await killServer();
    process.exit(0);
}

process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);

startDev();
