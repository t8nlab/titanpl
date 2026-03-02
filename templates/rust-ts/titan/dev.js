import chokidar from "chokidar";
import { spawn, execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import esbuild from "esbuild";
import { createRequire } from "module";

// Required for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Colors
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

function getTitanVersion() {
    try {
        const require = createRequire(import.meta.url);
        const pkgPath = require.resolve("titanpl/package.json");
        return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
    } catch (e) {
        try {
            // Check levels up to find the framework root
            let cur = __dirname;
            for (let i = 0; i < 5; i++) {
                const pkgPath = path.join(cur, "package.json");
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                    if (pkg.name === "titanpl") return pkg.version;
                }
                cur = path.join(cur, "..");
            }
        } catch (e2) { }

        try {
            // Fallback to calling tit --version
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
    // If TS is broken, don't start
    if (isTs && !isTsHealthy) {
        stopSpinner(false, "Waiting for TypeScript errors to be fixed...");
        return;
    }

    const waitTime = retryCount > 0 ? 1000 : 500;

    await killServer();
    await delay(waitTime);

    const serverPath = path.join(process.cwd(), "server");
    const startTime = Date.now();

    startSpinner("Stabilizing your app on its orbit...");

    let isReady = false;
    let stdoutBuffer = "";
    let buildLogs = "";

    // If it takes more than 30s, update the message
    const slowTimer = setTimeout(() => {
        if (!isReady && !isKilling) {
            startSpinner("Still stabilizing... (the first orbit takes longer)");
        }
    }, 30000);

    serverProcess = spawn("cargo", ["run", "--quiet"], {
        cwd: serverPath,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CARGO_INCREMENTAL: "1" }
    });

    serverProcess.on("error", (err) => {
        stopSpinner(false, "Failed to start orbit");
        console.error(red(`[Titan] Error: ${err.message}`));
    });

    serverProcess.stderr.on("data", (data) => {
        const str = data.toString();
        if (isReady) {
            process.stderr.write(data);
        } else {
            buildLogs += str;
        }
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
                    // On subsequent reloads, only print non-banner lines from the buffer
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
                stopSpinner(false, "Orbit stabilization failed");
                console.log("");

                console.log(red("⏣  Your application cannot enter this orbit"));
                console.log(red("↳  Another application is already bound to this port."));
                console.log("");

                console.log(yellow("Recommended Actions:"));
                console.log(yellow("  1.") + " Release the occupied orbit (stop the other service).");
                console.log(yellow("  2.") + " Assign your application to a new orbit in " + cyan("app/app.js"));
                console.log(yellow("     Example: ") + cyan('t.start(3001, "Titan Running!")'));
                console.log("");

                return;
            }


            stopSpinner(false, "Orbit stabilization failed");

            // Debug: Show stderr if it's not empty and not a port error
            if (stderrBuffer && stderrBuffer.trim()) {
                console.log(gray("\n[Debug] Cargo stderr:"));
                console.log(gray(stderrBuffer.substring(0, 500))); // Show first 500 chars
            }

            if (runTime < 15000 && retryCount < maxRetries) {
                await delay(2000);
                await startRustServer(retryCount + 1);
            } else if (retryCount >= maxRetries) {
                console.log(gray("\n[Titan] Waiting for changes to retry..."));
            }
        }
    });
}

async function rebuild() {
    if (isTs && !isTsHealthy) return; // Don't rebuild if TS is broken

    try {
        const root = process.cwd();
        const appTs = path.join(root, "app", "app.ts");
        const dotTitan = path.join(root, ".titan");
        const compiledApp = path.join(dotTitan, "app.js");

        if (fs.existsSync(appTs)) {
            if (!fs.existsSync(dotTitan)) fs.mkdirSync(dotTitan, { recursive: true });

            await esbuild.build({
                entryPoints: [appTs],
                outfile: compiledApp,
                bundle: true,
                platform: "node",
                format: "esm",
                external: ["fs", "path", "esbuild", "chokidar", "typescript"],
                logLevel: "silent"
            });

            execSync(`node "${compiledApp}"`, { stdio: "inherit" });
        } else {
            execSync("node app/app.js", { stdio: "ignore" });
        }
    } catch (e) {
        stopSpinner(false, "Failed to prepare runtime");
        console.log(red(`[Titan] Error: ${e.message}`));
    }
}

let tsProcess = null;
let isTsHealthy = false; // STRICT: Assume unhealthy until checked

function startTypeChecker() {
    const root = process.cwd();
    if (!fs.existsSync(path.join(root, "tsconfig.json"))) return;

    let tscPath;
    try {
        const require = createRequire(import.meta.url);
        tscPath = require.resolve("typescript/bin/tsc");
    } catch (e) {
        tscPath = path.join(root, "node_modules", "typescript", "bin", "tsc");
    }

    if (!fs.existsSync(tscPath)) {
        return;
    }

    const args = [tscPath, "--noEmit", "--watch", "--preserveWatchOutput", "--pretty"];

    tsProcess = spawn(process.execPath, args, {
        cwd: root,
        stdio: "pipe",
        shell: false
    });

    tsProcess.stdout.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
            if (line.trim().includes("File change detected") || line.trim().includes("Starting compilation")) {
                isTsHealthy = false;
                continue;
            }
            if (line.includes("Found 0 errors")) {
                isTsHealthy = true;
                // TS is happy, so we rebuild and restart (or start) the server
                rebuild().then(startRustServer);

            } else if (line.includes("error TS")) {
                isTsHealthy = false;
                if (serverProcess) {
                    console.log(red(`[Titan] TypeScript error detected. Stopping server...`));
                    killServer();
                }
                process.stdout.write(line + "\n");
            } else if (line.match(/Found [1-9]\d* error/)) {
                isTsHealthy = false;
                if (serverProcess) {
                    console.log(red(`[Titan] TypeScript compilation failed. Stopping server...`));
                    killServer();
                }
                process.stdout.write(line + "\n");
            } else if (line.trim()) {
                process.stdout.write(gray(`[TS] ${line}\n`));
            }
        }
    });

    tsProcess.stderr.on("data", (data) => {
        process.stdout.write(data);
    });
}

let isTs = false;

async function startDev() {
    const root = process.cwd();
    const actionsDir = path.join(root, "app", "actions");
    let hasRust = false;
    if (fs.existsSync(actionsDir)) {
        hasRust = fs.readdirSync(actionsDir).some(f => f.endsWith(".rs"));
    }

    isTs = fs.existsSync(path.join(root, "tsconfig.json")) ||
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
    console.log(`  ${bold(cyan("⏣ Titan Planet"))}   ${gray("v" + version)}   ${yellow("[ Dev Mode ]")}`);
    console.log("");
    console.log(`  ${gray("Type:       ")} ${mode}`);
    console.log(`  ${gray("Hot Reload: ")} ${green("Enabled")}`);

    if (fs.existsSync(path.join(root, ".env"))) {
        console.log(`  ${gray("Env:        ")} ${yellow("Loaded")}`);
    }
    console.log("");

    if (isTs) {
        startTypeChecker();
    } else {
        // If no TS, start immediately
        try {
            await rebuild();
            await startRustServer();
        } catch (e) {
        }
    }

    const watcher = chokidar.watch(["app", ".env"], {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
    });

    let timer = null;
    watcher.on("all", async (event, file) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
            // If TS, we rely on TCS to trigger the rebuild (via Found 0 errors)
            // We verify path safety using absolute/relative calculations
            const relPath = path.relative(root, file);
            if (isTs && (relPath.startsWith("app") || relPath.startsWith("app" + path.sep))) return;

            // If TS is broken, rebuild() checks will prevent update, keeping server dead
            // If TS is healthy, we proceed
            if (isTs && !isTsHealthy) return;

            try {
                await killServer();
                await rebuild();
                await startRustServer();
            } catch (e) {
                // console.log(red("[Titan] Build failed -- waiting for changes..."));
            }
        }, 300);
    });
}

async function handleExit() {
    stopSpinner();
    console.log(gray("\n[Titan] Stopping server..."));
    await killServer();
    if (tsProcess) {
        if (process.platform === "win32") {
            try { execSync(`taskkill /pid ${tsProcess.pid} /f /t`, { stdio: 'ignore' }); } catch (e) { }
        } else {
            tsProcess.kill();
        }
    }
    process.exit(0);
}

process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);

startDev();
