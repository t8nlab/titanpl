#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

/* Resolve __dirname for ES modules */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------------------------------------------
 * Colors
 * ----------------------------------------------------- */
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

/* -------------------------------------------------------
 * Invocation detection (tit vs titan)
 * ----------------------------------------------------- */
function wasInvokedAsTit() {
    const script = process.argv[1];
    if (script) {
        const base = path.basename(script, path.extname(script)).toLowerCase();
        if (base === "tit") return true;
    }

    try {
        const raw = process.env.npm_config_argv;
        if (raw) {
            const cfg = JSON.parse(raw);
            if (cfg.original && Array.isArray(cfg.original)) {
                // e.g. ["tit", "dev"]
                const first = cfg.original[0];
                if (first && first.includes("tit") && !first.includes("titan")) {
                    return true;
                }
            }
        }
    } catch { }

    const lastCmd = process.env["_"];
    if (lastCmd) {
        const base = path.basename(lastCmd, path.extname(lastCmd)).toLowerCase();
        if (base === "tit") return true;
    }

    return false;
}

const isTitAlias = wasInvokedAsTit();

if (isTitAlias) {
    console.log(
        yellow(
            "[Notice] `tit` is deprecated. Please use `titan` instead.\n" +
            "        `tit` will continue to work for now."
        )
    );
}

/* -------------------------------------------------------
 * Args
 * ----------------------------------------------------- */
const args = process.argv.slice(2);
const cmd = args[0];

/* -------------------------------------------------------
 * Titan version
 * ----------------------------------------------------- */
const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
);
const TITAN_VERSION = pkg.version;

/* -------------------------------------------------------
 * Utils
 * ----------------------------------------------------- */
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

/* -------------------------------------------------------
 * HELP
 * ----------------------------------------------------- */
function help() {
    console.log(`
${bold(cyan("Titan Planet"))}  v${TITAN_VERSION}

${green("titan init <project>")}   Create new Titan project
${green("titan dev")}              Dev mode (hot reload)
${green("titan build")}            Build production Rust server
${green("titan start")}            Start production binary
${green("titan update")}           Update Titan engine
${green("titan --version")}        Show Titan CLI version

${yellow("Note: `tit` is supported as a legacy alias.")}
`);
}

/* -------------------------------------------------------
 * INIT
 * ----------------------------------------------------- */
function initProject(name) {
    if (!name) {
        console.log(red("Usage: titan init <project>"));
        return;
    }

    const target = path.join(process.cwd(), name);
    const templateDir = path.join(__dirname, "templates");

    if (fs.existsSync(target)) {
        console.log(yellow(`Folder already exists: ${target}`));
        return;
    }

    console.log(cyan(`Creating Titan project → ${target}`));

    // ----------------------------------------------------------
    // 1. Copy full template directory
    // ----------------------------------------------------------
    copyDir(templateDir, target);

    // ----------------------------------------------------------
    // 2. Explicitly install dotfiles
    // ----------------------------------------------------------
    const dotfiles = {
        "_gitignore": ".gitignore",
        "_dockerignore": ".dockerignore",
    };

    for (const [srcName, destName] of Object.entries(dotfiles)) {
        const src = path.join(templateDir, srcName);
        const dest = path.join(target, destName);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(green(`✔ Added ${destName}`));
        }
    }

    // Dockerfile is safe as-is
    const dockerfileSrc = path.join(templateDir, "Dockerfile");
    if (fs.existsSync(dockerfileSrc)) {
        fs.copyFileSync(dockerfileSrc, path.join(target, "Dockerfile"));
    }

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
  titan dev
`);
}


/* -------------------------------------------------------
 * BUNDLER
 * ----------------------------------------------------- */
function runBundler(root) {
    const bundler = path.join(root, "titan", "bundle.js");

    if (!fs.existsSync(bundler)) {
        console.log(red("ERROR: titan/bundle.js missing."));
        process.exit(1);
    }

    execSync(`node "${bundler}"`, { stdio: "inherit" });
}

/* -------------------------------------------------------
 * DEV SERVER
 * ----------------------------------------------------- */
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

    try {
        rebuild();
        startRust();
    } catch (e) {
        console.log(red("Initial build failed:"));
        console.log(e.message);
        // Do not die even on initial fail, user might fix it.
    }

    const chokidar = (await import("chokidar")).default;
    const watcher = chokidar.watch("app", { ignoreInitial: true });

    let timer = null;

    watcher.on("all", (event, file) => {
        if (timer) clearTimeout(timer);

        timer = setTimeout(() => {
            console.log(yellow(`Change → ${file}`));
            try {
                rebuild();
                startRust();
            } catch (err) {
                console.log(red("Build failed — waiting for changes..."));
            }
        }, 250);
    });
}

/* -------------------------------------------------------
 * BUILD
 * ----------------------------------------------------- */
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

/* -------------------------------------------------------
 * START
 * ----------------------------------------------------- */
function startProd() {
    const isWin = process.platform === "win32";
    const bin = isWin ? "titan-server.exe" : "titan-server";

    const exe = path.join(process.cwd(), "server", "target", "release", bin);
    execSync(`"${exe}"`, { stdio: "inherit" });
}

/* -------------------------------------------------------
 * UPDATE
 * ----------------------------------------------------- */

function updateTitan() {
    const root = process.cwd();

    const projectTitan = path.join(root, "titan");
    const projectServer = path.join(root, "server");

    const templatesRoot = path.join(__dirname, "templates");
    const templateTitan = path.join(templatesRoot, "titan");
    const templateServer = path.join(templatesRoot, "server");

    if (!fs.existsSync(projectTitan)) {
        console.log(red("Not a Titan project — titan/ folder missing."));
        return;
    }

    if (!fs.existsSync(templateServer)) {
        console.log(red("CLI is corrupted — server template missing."));
        return;
    }

    console.log(cyan("Updating Titan runtime and server..."));

    // ----------------------------------------------------------
    // 1. Update titan/ runtime (authoritative, safe to replace)
    // ----------------------------------------------------------
    fs.rmSync(projectTitan, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 500,
    });

    copyDir(templateTitan, projectTitan);
    console.log(green("✔ Updated titan/ runtime"));

    // ----------------------------------------------------------
    // 2. Update server/ WITHOUT deleting the folder
    // ----------------------------------------------------------
    if (!fs.existsSync(projectServer)) {
        fs.mkdirSync(projectServer);
    }

    // 2a. Overwrite Cargo.toml
    const srcCargo = path.join(templateServer, "Cargo.toml");
    const destCargo = path.join(projectServer, "Cargo.toml");

    if (fs.existsSync(srcCargo)) {
        fs.copyFileSync(srcCargo, destCargo);
        console.log(green("✔ Updated server/Cargo.toml"));
    }

    // 2b. Replace server/src only
    const projectSrc = path.join(projectServer, "src");
    const templateSrc = path.join(templateServer, "src");

    if (fs.existsSync(projectSrc)) {
        fs.rmSync(projectSrc, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 500,
        });
    }

    copyDir(templateSrc, projectSrc);
    console.log(green("✔ Updated server/src/"));

    // Root-level config files
    [".gitignore", ".dockerignore", "Dockerfile"].forEach((file) => {
        const src = path.join(templatesRoot, file);
        const dest = path.join(root, file);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(green(`✔ Updated ${file}`));
        }
    });

    // app/titan.d.ts (JS typing contract)
    const appDir = path.join(root, "app");
    const srcDts = path.join(templatesRoot, "titan.d.ts");
    const destDts = path.join(appDir, "titan.d.ts");

    if (fs.existsSync(srcDts)) {
        if (!fs.existsSync(appDir)) {
            fs.mkdirSync(appDir);
        }

        fs.copyFileSync(srcDts, destDts);
        console.log(green("✔ Updated app/titan.d.ts"));
    }


    console.log(bold(green("✔ Titan update complete")));
}



/* -------------------------------------------------------
 * ROUTER
 * ----------------------------------------------------- */
switch (cmd) {
    case "init": initProject(args[1]); break;
    case "dev": devServer(); break;
    case "build": buildProd(); break;
    case "start": startProd(); break;
    case "update": updateTitan(); break;
    case "--version":
    case "-v":
    case "version":
        console.log(cyan(`Titan v${TITAN_VERSION}`));
        break;
    default:
        help();
}
