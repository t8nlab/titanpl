#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

/* Resolve __dirname for ES modules */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* Colors */
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

const args = process.argv.slice(2);
const cmd = args[0];

/* Titan version (read from package.json) */
const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
);
const TITAN_VERSION = pkg.version;

/* Safe copy directory */
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

/* HELP */
function help() {
    console.log(`
${bold(cyan("Titan Planet"))}  v${TITAN_VERSION}

${green("tit init <project>")}   Create new Titan project
${green("tit dev")}              Dev mode (hot reload)
${green("tit build")}            Build production Rust server
${green("tit start")}            Start production binary
${green("tit update")}           Update Titan engine
${green("tit --version")}        Show Titan CLI version
`);
}

/* INIT PROJECT */
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

    [".gitignore", ".dockerignore", "Dockerfile"].forEach((file) => {
        const src = path.join(templateDir, file);
        const dest = path.join(target, file);
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    });

    console.log(green("✔ Titan project created!"));
    console.log(cyan("Installing dependencies..."));

    execSync(`npm install esbuild --silent`, {
        cwd: target,
        stdio: "inherit",
    });

    console.log(green("✔ Dependencies installed"));
    console.log(`
Next steps:
  cd ${name}
  tit dev
`);
}

/* BUNDLER (absolute path, Railway-safe) */
function runBundler(root) {
    const bundler = path.join(root, "titan", "bundle.js");

    if (!fs.existsSync(bundler)) {
        console.log(red("ERROR: titan/bundle.js missing."));
        process.exit(1);
    }

    execSync(`node "${bundler}"`, { stdio: "inherit" });
}

/* DEV SERVER — HOT RELOAD */
async function devServer() {
    const root = process.cwd();
    console.log(cyan("Titan Dev Mode — Hot Reload Enabled"));

    let rustProcess = null;

    function launchRust(done) {
        const processHandle = spawn("cargo", ["run"], {
            cwd: path.join(root, "server"),
            stdio: "inherit",
            shell: true,
        });

        processHandle.on("spawn", () => setTimeout(done, 200));
        processHandle.on("close", (code) =>
            console.log(`[Titan] Rust server exited: ${code}`)
        );

        return processHandle;
    }

    function startRust() {
        return new Promise((resolve) => {
            if (rustProcess) {
                console.log("[Titan] Restarting Rust server...");

                if (process.platform === "win32") {
                    const killer = spawn("taskkill", ["/PID", rustProcess.pid, "/T", "/F"], {
                        stdio: "ignore",
                        shell: true,
                    });

                    killer.on("exit", () => {
                        rustProcess = launchRust(resolve);
                    });
                } else {
                    rustProcess.kill();
                    rustProcess.on("close", () => {
                        rustProcess = launchRust(resolve);
                    });
                }
            } else {
                rustProcess = launchRust(resolve);
            }
        });
    }

    /* Build logic */
    function rebuild() {
        execSync(`node "${path.join(root, "app", "app.js")}"`, {
            stdio: "inherit",
        });

        runBundler(root);
    }

    rebuild();
    startRust();

    const chokidar = (await import("chokidar")).default;
    const watcher = chokidar.watch("app", { ignoreInitial: true });

    let timer = null;

    watcher.on("all", (event, file) => {
        if (timer) clearTimeout(timer);

        timer = setTimeout(() => {
            console.log(yellow(`Change → ${file}`));
            rebuild();
            startRust();
        }, 250);
    });
}

/* PRODUCTION BUILD */
// BUILD RELEASE — PRODUCTION READY
function buildProd() {
    console.log(cyan("Titan: Building production output..."));

    const root = process.cwd();
    const appJs = path.join(root, "app", "app.js");
    const serverDir = path.join(root, "server");
    const actionsOut = path.join(serverDir, "actions");

    // BASIC CHECKS
    if (!fs.existsSync(appJs)) {
        console.log(red("ERROR: app/app.js not found."));
        process.exit(1);
    }

    // ----------------------------------------------------
    // 1) BUILD METADATA + BUNDLE ACTIONS (ONE TIME ONLY)
    // ----------------------------------------------------
    console.log(cyan("→ Building Titan metadata + bundling actions..."));
    execSync("node app/app.js --build", { stdio: "inherit" });

    // ensure actions directory exists
    fs.mkdirSync(actionsOut, { recursive: true });

    // verify bundled actions exist
    const bundles = fs.readdirSync(actionsOut).filter(f => f.endsWith(".jsbundle"));
    if (bundles.length === 0) {
        console.log(red("ERROR: No actions bundled."));
        console.log(red("Make sure your DSL outputs to server/actions."));
        process.exit(1);
    }

    bundles.forEach(file => {
        console.log(cyan(`→ Found action bundle: ${file}`));
    });

    console.log(green("✔ Actions ready in server/actions"));

    // ----------------------------------------------------
    // 2) BUILD RUST BINARY
    // ----------------------------------------------------
    console.log(cyan("→ Building Rust release binary..."));
    execSync("cargo build --release", {
        cwd: serverDir,
        stdio: "inherit"
    });

    console.log(green("✔ Titan production build complete!"));
}



/* START PRODUCTION BINARY */
function startProd() {
    const isWin = process.platform === "win32";
    const bin = isWin ? "titan-server.exe" : "titan-server";

    const exe = path.join(process.cwd(), "server", "target", "release", bin);
    execSync(`"${exe}"`, { stdio: "inherit" });
}

/* UPDATE TITAN */
function updateTitan() {
    const root = process.cwd();
    const projectTitan = path.join(root, "titan");

    const templatesRoot = path.join(__dirname, "templates");
    const templateTitan = path.join(templatesRoot, "titan");

    const templateServer = path.join(templatesRoot, "server");
    const templateCargo = path.join(templateServer, "Cargo.toml");
    const templateMain = path.join(templateServer, "src", "main.rs");

    if (!fs.existsSync(projectTitan)) {
        console.log(red("Not a Titan project — titan/ folder missing."));
        return;
    }

    console.log(cyan("Updating Titan runtime..."));

    // ----------------------------------------------------------
    // 1. Update titan/ runtime folder
    // ----------------------------------------------------------
    fs.rmSync(projectTitan, { recursive: true, force: true });
    copyDir(templateTitan, projectTitan);
    console.log(green("✔ Updated titan/ runtime"));

    // ----------------------------------------------------------
    // 2. Update server/Cargo.toml
    // ----------------------------------------------------------
    const destCargo = path.join(root, "server", "Cargo.toml");
    if (fs.existsSync(templateCargo)) {
        fs.copyFileSync(templateCargo, destCargo);
        console.log(green("✔ Updated server/Cargo.toml"));
    } else {
        console.log(yellow("⚠ Missing Cargo.toml template in CLI."));
    }

    // ----------------------------------------------------------
    // 3. Update server/src/main.rs
    // ----------------------------------------------------------
    const destMain = path.join(root, "server", "src", "main.rs");
    if (fs.existsSync(templateMain)) {
        fs.copyFileSync(templateMain, destMain);
        console.log(green("✔ Updated server/src/main.rs"));
    } else {
        console.log(yellow("⚠ Missing server/src/main.rs in CLI."));
    }

    // ----------------------------------------------------------
    // 4. Update project-level config files
    // ----------------------------------------------------------
    [".gitignore", ".dockerignore", "Dockerfile"].forEach((file) => {
        const src = path.join(templatesRoot, file);
        const dest = path.join(root, file);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(green(`✔ Updated ${file}`));
        }
    });

    console.log(bold(green("✔ Titan update complete")));
}


/* ROUTER */
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

    case "--version":
    case "-v":
    case "version":
        console.log(green(`Titan v${TITAN_VERSION}`));
        break;

    default:
        help();
}
