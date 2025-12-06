import chokidar from "chokidar";
import { spawn, execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "./bundle.js";

// Required for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serverProcess = null;

function startRustServer() {
    if (serverProcess) {
        serverProcess.kill();
    }

    const serverPath = path.join(process.cwd(), "server");

    serverProcess = spawn("cargo", ["run"], {
        cwd: serverPath,
        stdio: "inherit",
        shell: true
    });

    serverProcess.on("close", (code) => {
        console.log(`[Titan] Rust server exited: ${code}`);
    });
}

async function rebuild() {
    console.log("[Titan] Regenerating routes.json & action_map.json...");
    execSync("node app/app.js", { stdio: "inherit" });

    console.log("[Titan] Bundling JS actions...");
    await bundle();
}

async function startDev() {
    console.log("[Titan] Dev mode starting...");

    // FIRST BUILD
    await rebuild();
    startRustServer();

    const watcher = chokidar.watch("app", {
        ignoreInitial: true
    });

    let timer = null;

    watcher.on("all", async (event, file) => {
        if (timer) clearTimeout(timer);

        timer = setTimeout(async () => {
            console.log(`[Titan] Change detected: ${file}`);

            await rebuild();

            console.log("[Titan] Restarting Rust server...");
            startRustServer();

        }, 200);
    });
}

startDev();
