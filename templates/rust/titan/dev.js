import chokidar from "chokidar";
import { spawn, execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

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
        const require = createRequire(import.meta.url);
        const pkgPath = require.resolve("@ezetgalaxy/titan/package.json");
        return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
    } catch (e) {
        try {
            // Check levels up to find the framework root
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

const delay = (ms) => new Promise(res => setTimeout(res, ms));

let spinnerTimer = null;
const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
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
    const waitTime = retryCount > 0 ? 500 : 200;

    await killServer();
    await delay(waitTime);

    const serverPath = path.join(process.cwd(), "server");
    const startTime = Date.now();

    startSpinner("Stabilizing your app on its orbit...");

    let isReady = false;
    let stdoutBuffer = "";
    let buildLogs = "";

    // If it takes more than 15s, update the message
    const slowTimer = setTimeout(() => {
        if (!isReady && !isKilling) {
            startSpinner("Still stabilizing... (the first orbit takes longer)");
        }
    }, 15000);

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

    serverProcess.on("close", async (code) => {
        clearTimeout(slowTimer);
        if (isKilling) return;
        const runTime = Date.now() - startTime;

        if (code !== 0 && code !== null) {
            stopSpinner(false, "Orbit stabilization failed");
            if (!isReady) {
                console.log(gray("\n--- Build Logs ---"));
                console.log(buildLogs);
                console.log(gray("------------------\n"));
            }

            if (runTime < 15000 && retryCount < 5) {
                await delay(2000);
                await startRustServer(retryCount + 1);
            }
        }
    });
}

async function rebuild() {
    try {
        execSync("node app/app.js", { stdio: "ignore" });
        // bundle is called inside app.js (t.start)
    } catch (e) {
        stopSpinner(false, "Failed to prepare runtime");
        console.log(red(`[Titan] Error: ${e.message}`));
    }
}

async function startDev() {
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
    console.log(`  ${bold(cyan("Titan Planet"))}   ${gray("v" + version)}   ${yellow("[ Dev Mode ]")}`);
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
        // console.log(red("[Titan] Initial build failed. Waiting for changes..."));
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
                // console.log(red("[Titan] Build failed -- waiting for changes..."));
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
