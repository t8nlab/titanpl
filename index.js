#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

// __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

const args = process.argv.slice(2);
const cmd = args[0];

// COPY TEMPLATES
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });

    for (const file of fs.readdirSync(src)) {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);

        if (fs.lstatSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// HELP
function help() {
    console.log(`
${bold(cyan("Titan CLI"))}

${green("tit init <project>")}   Create new Titan project
${green("tit dev")}              Dev mode (hot reload)
${green("tit build")}            Build production Rust server
${green("tit start")}            Start production binary
`);
}

// INIT PROJECT
function initProject(name) {
    if (!name) return console.log(red("Usage: tit init <project>"));

    const target = path.join(process.cwd(), name);
    const templateDir = path.join(__dirname, "templates");

    if (fs.existsSync(target)) {
        console.log(yellow(`Folder already exists: ${target}`));
        return;
    }

    console.log(cyan(`Creating Titan project → ${target}`));

    copyDir(templateDir, target);
    copyDir(templateDir, target);

    [".gitignore", ".dockerignore", "Dockerfile"].forEach((file) => {
        const src = path.join(templateDir, file);
        const dest = path.join(target, file);
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    });


    console.log(green("✔ Titan project created!"));
    console.log(cyan("Installing dependencies..."));

    execSync(`npm install esbuild --silent`, {
        cwd: target,
        stdio: "inherit"
    });

    console.log(green("✔ Dependencies installed"));
    console.log(`
Next steps:
  cd ${name}
  tit dev
`);
}

// BUNDLE
function runBundler() {
    const bundler = path.join(process.cwd(), "titan", "bundle.js");

    if (fs.existsSync(bundler)) {
        execSync(`node ${bundler}`, { stdio: "inherit" });
    } else {
        console.log(yellow("Warning: titan/bundle.js missing."));
    }
}

// ------------------------------------------
// FULL HOT RELOAD DEV SERVER
// ------------------------------------------

async function devServer() {
    console.log(cyan("Titan Dev Mode — Hot Reload Enabled"));

    let rustProcess = null;

    function startRust() {
        // ---- FIX: Proper kill for Windows ----
        if (rustProcess) {
            console.log(yellow("[Titan] Killing old Rust server..."));

            if (process.platform === "win32") {
                spawn("taskkill", ["/PID", rustProcess.pid, "/T", "/F"], {
                    stdio: "inherit",
                    shell: true
                });
            } else {
                rustProcess.kill();
            }
        }

        // ---- START NEW PROCESS ----
        rustProcess = spawn("cargo", ["run"], {
            cwd: path.join(process.cwd(), "server"),
            stdio: "inherit",
            shell: true,
        });

        rustProcess.on("close", (code) => {
            console.log(red(`[Titan] Rust server exited: ${code}`));
        });
    }

    function rebuild() {
        console.log(cyan("Titan: Regenerating routes..."));
        execSync("node app/app.js", { stdio: "inherit" });

        console.log(cyan("Titan: Bundling actions..."));
        runBundler();
    }

    // First build
    rebuild();
    startRust();

    // WATCHER
    const chokidar = (await import("chokidar")).default;

    const watcher = chokidar.watch("app", { ignoreInitial: true });

    let timer = null;

    watcher.on("all", (event, file) => {
        if (timer) clearTimeout(timer);

        timer = setTimeout(() => {
            console.log(yellow(`Change detected → ${file}`));

            rebuild();
            startRust();

        }, 250);
    });
}


// BUILD RELEASE
function buildProd() {
    console.log(cyan("Titan: generate routes + bundle..."));
    execSync("node app/app.js", { stdio: "inherit" });
    runBundler();

    console.log(cyan("Titan: building release..."));
    execSync("cargo build --release", {
        cwd: path.join(process.cwd(), "server"),
        stdio: "inherit",
    });
}

// START PRODUCTION
function startProd() {
    const isWindows = process.platform === "win32";
    const binaryName = isWindows ? "titan-server.exe" : "titan-server";

    const exe = path.join(
        process.cwd(),
        "server",
        "target",
        "release",
        binaryName
    );

    execSync(`"${exe}"`, { stdio: "inherit" });
}

// ------------------------------------------
// TITAN UPDATE — Upgrade titan/ runtime
// ------------------------------------------
function updateTitan() {
    const projectTitan = path.join(process.cwd(), "titan");
    const cliTitan = path.join(__dirname, "templates", "titan");

    if (!fs.existsSync(projectTitan)) {
        console.log(red("No titan/ folder found in this project."));
        console.log(yellow("Make sure you are inside a Titan project."));
        return;
    }

    console.log(cyan("Titan: Updating runtime files..."));

    // Backup old titan folder
    const backupDir = path.join(process.cwd(), `titan_backup_${Date.now()}`);
    fs.renameSync(projectTitan, backupDir);

    console.log(green(`✔ Backup created → ${backupDir}`));

    copyDir(cliTitan, projectTitan);
    copyDir(templateDir, target);

    [".gitignore", ".dockerignore", "Dockerfile"].forEach((file) => {
        const src = path.join(templateDir, file);
        const dest = path.join(target, file);
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    });


    console.log(green("✔ Titan runtime updated successfully!"));
    console.log(cyan("Your project now has the latest Titan features."));
}


// ROUTER
switch (cmd) {
    case "init":
        initProject(args[1]);
        break;

    case "dev":
        devServer();
        break;

    case "build":
        buildProd();
        break;

    case "start":
        startProd();
        break;

    case "update":
        updateTitan();
        break;

    default:
        help();
}

