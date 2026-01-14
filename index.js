#!/usr/bin/env node
import prompts from "prompts";
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
const gray = (t) => `\x1b[90m${t}\x1b[0m`;

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
function copyDir(src, dest, excludes = []) {
    fs.mkdirSync(dest, { recursive: true });

    for (const file of fs.readdirSync(src)) {
        // Skip excluded files/folders
        if (excludes.includes(file)) {
            continue;
        }

        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);

        if (fs.lstatSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath, excludes);
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
${green("titan create ext <name>")} Create new Titan extension
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
async function initProject(name, templateName) {
    if (!name) {
        console.log(red("Usage: titan init <project> [--template <js|rust>]"));
        return;
    }

    let selectedTemplate = templateName;

    if (!selectedTemplate) {
        const response = await prompts({
            type: 'select',
            name: 'value',
            message: 'Select a template:',
            choices: [
                { title: 'JavaScript', description: 'Standard Titan app with JS actions', value: 'js' },
                { title: `Rust + JavaScript  ${yellow('(Beta)')}`, description: 'High-performance Rust actions + JS flexibility', value: 'rust' }
            ],
            initial: 0
        });

        if (!response.value) {
            console.log(red("✖ Operation cancelled"));
            return;
        }
        selectedTemplate = response.value;
    }

    const target = path.join(process.cwd(), name);
    const templateDir = path.join(__dirname, "templates", selectedTemplate);

    if (!fs.existsSync(templateDir)) {
        console.log(red(`Template '${selectedTemplate}' not found. Available: js, rust`));
        return;
    }

    if (fs.existsSync(target)) {
        console.log(yellow(`Folder already exists: ${target}`));
        return;
    }

    console.log("\n" + bold(cyan("🚀 Initializing Titan Project...")));
    console.log(gray(`   Target:   ${target}`));
    console.log(gray(`   Template: ${selectedTemplate === 'rust' ? 'Rust + JS (Native Perf)' : 'JavaScript (Standard)'}`));

    // ----------------------------------------------------------
    // 1. Copy full template directory
    // ----------------------------------------------------------
    copyDir(templateDir, target, ["_gitignore", "_dockerignore"]);

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
        }
    }

    // Dockerfile is safe as-is
    const dockerfileSrc = path.join(templateDir, "Dockerfile");
    if (fs.existsSync(dockerfileSrc)) {
        fs.copyFileSync(dockerfileSrc, path.join(target, "Dockerfile"));
    }

    console.log(green("✔ Project structure created"));
    console.log(cyan("📦 Installing dependencies..."));

    try {
        execSync(`npm install esbuild chokidar --silent`, {
            cwd: target,
            stdio: "inherit",
        });
        console.log(green("✔ Dependencies installed"));
    } catch (e) {
        console.log(yellow("⚠ Failed to auto-install dependencies. Please run 'npm install' manually."));
    }

    console.log("\n" + bold(green("🎉 You're all set!")));
    console.log(`
  ${gray("Next steps:")}
    ${cyan(`cd ${name}`)}
    ${cyan("titan dev")}
`);
}

/* -------------------------------------------------------
 * DEV SERVER
 * ----------------------------------------------------- */
async function devServer() {
    const root = process.cwd();
    const devScript = path.join(root, "titan", "dev.js");

    if (!fs.existsSync(devScript)) {
        console.log(red("Error: titan/dev.js not found."));
        console.log("Try running `titan update` to fix missing files.");
        return;
    }

    const child = spawn("node", [devScript], {
        stdio: "inherit",
        cwd: root
    });

    child.on("close", (code) => {
        // Exit strictly if the dev script failed
        if (code !== 0) {
            process.exit(code);
        }
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
    const projectPkg = path.join(root, "package.json");

    let templateType = "js"; // Default
    if (fs.existsSync(projectPkg)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(projectPkg, "utf-8"));
            if (pkg.titan && pkg.titan.template) {
                templateType = pkg.titan.template;
            }
        } catch (e) { }
    }

    const templatesRoot = path.join(__dirname, "templates", templateType);
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
    const rootFiles = {
        "_gitignore": ".gitignore",
        "_dockerignore": ".dockerignore",
        "Dockerfile": "Dockerfile",
        "jsconfig.json": "jsconfig.json"
    };

    for (const [srcName, destName] of Object.entries(rootFiles)) {
        const src = path.join(templatesRoot, srcName);
        const dest = path.join(root, destName);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(green(`✔ Updated ${destName}`));
        }
    }

    // app/titan.d.ts (JS typing contract)
    const appDir = path.join(root, "app");
    const srcDts = path.join(templateServer, "../app/titan.d.ts"); // templates/app/titan.d.ts
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
 * CREATE EXTENSION
 * ----------------------------------------------------- */
function createExtension(name) {
    if (!name) {
        console.log(red("Usage: titan create ext <name>"));
        return;
    }


    const folderName = name;

    const target = path.join(process.cwd(), folderName);
    const templateDir = path.join(__dirname, "templates", "extension");

    if (fs.existsSync(target)) {
        console.log(yellow(`Folder already exists: ${target}`));
        return;
    }

    if (!fs.existsSync(templateDir)) {
        console.log(red(`Extension template not found at ${templateDir}`));
        return;
    }

    console.log(cyan(`Creating Titan extension → ${target}`));

    // 1. Copy template
    copyDir(templateDir, target);

    // 2. Process templates (replace {{name}})
    const title = name;
    const nativeName = title.replace(/-/g, "_");

    const replaceAll = (filePath) => {
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, "utf8");
            content = content.replace(/{{name}}/g, title);
            content = content.replace(/{{native_name}}/g, nativeName);
            fs.writeFileSync(filePath, content);
        }
    };

    const idxPath = path.join(target, "index.js");
    const readmePath = path.join(target, "README.md");
    const pkgPath = path.join(target, "package.json");
    const cargoPath = path.join(target, "native", "Cargo.toml");

    replaceAll(path.join(target, "titan.json"));
    replaceAll(idxPath);
    replaceAll(readmePath);
    replaceAll(pkgPath);
    replaceAll(cargoPath);

    console.log(cyan("Installing dependencies..."));
    try {
        execSync("npm install", { cwd: target, stdio: "inherit" });
    } catch (e) {
        console.log(yellow("Warning: Failed to install dependencies. You may need to run `npm install` manually."));
    }

    console.log(green("✔ Extension created!"));
    console.log(`
Next steps:
  cd ${name}
  # If you have native code:
  cd native && cargo build --release
  # To test your extension
  titan run ext
`);
}

function runExtension() {
    const localSdk = path.join(__dirname, "titanpl-sdk", "bin", "run.js");

    if (fs.existsSync(localSdk)) {
        console.log(cyan("[Titan] Using local SDK runner..."));
        try {
            execSync(`node "${localSdk}"`, { stdio: "inherit" });
        } catch (e) {
            // SDK runner handles its own errors
        }
    } else {
        console.log(cyan("[Titan] SDK not found locally, falling back to npx..."));
        try {
            execSync("npx -y titan-sdk", { stdio: "inherit" });
        } catch (e) {
            // SDK runner handles its own errors
        }
    }
}

/* -------------------------------------------------------
 * ROUTER
 * ----------------------------------------------------- */
// "titan create ext <name>" -> args = ["create", "ext", "calc_ext"]
if (cmd === "create" && args[1] === "ext") {
    createExtension(args[2]);
} else if (cmd === "run" && args[1] === "ext") {
    runExtension();
} else {
    switch (cmd) {
        case "init": {
            const projName = args[1];
            let tpl = null;

            const tIndex = args.indexOf("--template") > -1 ? args.indexOf("--template") : args.indexOf("-t");
            if (tIndex > -1 && args[tIndex + 1]) {
                tpl = args[tIndex + 1];
            }

            initProject(projName, tpl);
            break;
        }
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
}
