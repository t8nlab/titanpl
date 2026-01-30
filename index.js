#!/usr/bin/env node
import prompts from "prompts";
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

/* Resolve __dirname for ES modules */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------------------------------------------
 * Colors
 * ----------------------------------------------------- */
export const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
export const green = (t) => `\x1b[32m${t}\x1b[0m`;
export const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
export const red = (t) => `\x1b[31m${t}\x1b[0m`;
export const bold = (t) => `\x1b[1m${t}\x1b[0m`;
export const gray = (t) => `\x1b[90m${t}\x1b[0m`;

/* -------------------------------------------------------
 * Invocation detection (tit vs titan)
 * ----------------------------------------------------- */
export function wasInvokedAsTit() {
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
 * Titan version
 * ----------------------------------------------------- */
let TITAN_VERSION = "0.1.0";
try {
    const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
    );
    TITAN_VERSION = pkg.version;
} catch (e) {
    // Use default version
}

export { TITAN_VERSION };

/* -------------------------------------------------------
 * Utils
 * ----------------------------------------------------- */
export function copyDir(src, dest, excludes = []) {
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
export function help() {
    console.log(`
 ${bold(cyan("Titan Planet"))}  v${TITAN_VERSION}

 ${green("titan init <project> [-t <template>]")}   Create new TitanPl project
 ${green("titan create ext <name>")} Create new TitanPl extension
 ${green("titan dev [-c]")}        Dev mode (hot reload) [-c to backward clean]
 ${green("titan build")}            Build production Rust server
 ${green("titan start")}            Start production binary
 ${green("titan update")}           Update TitanPl Framework
 ${green("titan --version")}        Show TitanPl CLI version

 ${yellow("Note: `tit` is supported as a legacy alias.")}
`);
}

/* -------------------------------------------------------
 * INIT
 * ----------------------------------------------------- */
export async function initProject(name, templateName) {
    // console.log(`DEBUG: initProject name=${name}, templateName=${templateName}`);
    let projName = name;

    if (!projName) {
        const response = await prompts({
            type: 'text',
            name: 'value',
            message: 'Project name:',
            initial: 'my-titan-app'
        });

        if (!response.value) {
            console.log(red("✖ Operation cancelled"));
            return;
        }
        projName = response.value;
    }

    let selectedTemplate = templateName;

    if (!selectedTemplate) {
        // 1. Language Selection
        const langRes = await prompts({
            type: 'select',
            name: 'value',
            message: 'Select language:',
            choices: [
                { title: 'JavaScript', value: 'js' },
                { title: 'TypeScript', value: 'ts' },
            ],
            initial: 0
        });

        if (!langRes.value) {
            console.log(red("✖ Operation cancelled"));
            return;
        }
        const lang = langRes.value;

        // 2. Template Selection
        const archRes = await prompts({
            type: 'select',
            name: 'value',
            message: 'Select template:',
            choices: [
                {
                    title: `Standard (${lang.toUpperCase()})`,
                    description: `Standard Titan app with ${lang.toUpperCase()} actions`,
                    value: 'standard'
                },
                {
                    title: `Rust + ${lang.toUpperCase()} (Hybrid)`,
                    description: `High-performance Rust actions + ${lang.toUpperCase()} flexibility`,
                    value: 'hybrid'
                }
            ],
            initial: 0
        });

        if (!archRes.value) {
            console.log(red("✖ Operation cancelled"));
            return;
        }
        const arch = archRes.value;

        if (lang === 'js') {
            selectedTemplate = arch === 'standard' ? 'js' : 'rust-js';
        } else {
            selectedTemplate = arch === 'standard' ? 'ts' : 'rust-ts';
        }
    }

    const target = path.join(process.cwd(), projName);
    const templateDir = path.join(__dirname, "templates", selectedTemplate);
    const commonDir = path.join(__dirname, "templates", "common");

    if (!fs.existsSync(templateDir)) {
        console.log(red(`Template '${selectedTemplate}' not found.`));
        return;
    }
    if (!fs.existsSync(commonDir)) {
        console.log(red(`Common template folder not found.`));
        return;
    }

    if (fs.existsSync(target)) {
        console.log(yellow(`Folder already exists: ${target}`));
        return;
    }

    console.log("\n" + bold(cyan("🚀 Initializing Titan Project...")));
    console.log(gray(`   Target:   ${target}`));
    console.log(gray(`   Template: ${selectedTemplate}`));

    // ----------------------------------------------------------
    // 1. Copy full COMMON directory
    // ----------------------------------------------------------
    copyDir(commonDir, target, ["_gitignore", "_dockerignore"]);

    // ----------------------------------------------------------
    // 2. Copy full SELECTED template directory
    // ----------------------------------------------------------
    copyDir(templateDir, target, ["_gitignore", "_dockerignore"]);

    // ----------------------------------------------------------
    // 3. Explicitly install dotfiles from COMMON directory
    // ----------------------------------------------------------
    const dotfiles = {
        "_gitignore": ".gitignore",
        "_dockerignore": ".dockerignore",
    };

    for (const [srcName, destName] of Object.entries(dotfiles)) {
        const src = path.join(commonDir, srcName);
        const dest = path.join(target, destName);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
        }
    }

    const pkgPath = path.join(target, "package.json");

    if (fs.existsSync(pkgPath)) {
        try {
            const pkgContent = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            if (!pkgContent.titan) pkgContent.titan = {};
            pkgContent.titan.template = selectedTemplate;
            fs.writeFileSync(pkgPath, JSON.stringify(pkgContent, null, 2));
            console.log(gray(`   Metadata set: ${selectedTemplate}`));
        } catch (e) {
            console.log(yellow("⚠ Could not write template metadata to package.json"));
        }
    }

    console.log(green("✔ Project structure created"));
    console.log(cyan("📦 Installing dependencies..."));

    try {
        execSync(`npm install --silent`, {
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
    ${cyan(`cd ${projName}`)}
    ${cyan("titan dev")}
`);
}

/* -------------------------------------------------------
 * DEV SERVER
 * ----------------------------------------------------- */
export async function devServer(args = []) {
    const root = process.cwd();

    // Check for clean cache flag
    if (args.includes("-c") || args.includes("--clean") || args.includes("--clean-cache")) {
        console.log(cyan("TitanPl: Clearing cache..."));

        const pathsToClean = [
            path.join(root, ".titan"),
            path.join(root, "server", "actions"),
            path.join(root, "server", "target")
        ];

        for (const p of pathsToClean) {
            if (fs.existsSync(p)) {
                try {
                    fs.rmSync(p, { recursive: true, force: true });
                    console.log(gray(`  ✔ Deleted ${path.relative(root, p)}`));
                } catch (e) {
                    console.log(yellow(`  ⚠ Could not delete ${path.relative(root, p)}: ${e.message}`));
                }
            }
        }
        console.log(green("✔ Cache cleared."));
    }
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
export async function buildProd() {
    console.log(cyan("Titan: Building production output..."));

    const root = process.cwd();
    const appJs = path.join(root, "app", "app.js");
    const appTs = path.join(root, "app", "app.ts");
    const serverDir = path.join(root, "server");
    const actionsOut = path.join(serverDir, "actions");

    // BASIC CHECKS
    if (!fs.existsSync(appJs) && !fs.existsSync(appTs)) {
        console.log(red("ERROR: app/app.js or app/app.ts not found."));
        process.exit(1);
    }

    // COMPILE TYPESCRIPT IF NEEDED
    if (fs.existsSync(path.join(root, "tsconfig.json"))) {
        console.log(cyan("→ Compiling TypeScript..."));
        try {
            // We use esbuild for speed and consistency with dev mode
            const { buildSync } = await import("esbuild");
            buildSync({
                entryPoints: [path.join(root, "app", "app.ts")],
                outfile: appJs,
                bundle: true,
                platform: "node",
                format: "esm",
                external: ["fs", "path", "esbuild", "chokidar", "typescript"],
                packages: "external",
            });
            console.log(green("✔ TypeScript compiled"));
        } catch (e) {
            console.log(red("ERROR: Failed to compile TypeScript."));
            console.error(e);
            process.exit(1);
        }
    }

    // ----------------------------------------------------
    // 1) BUILD METADATA + BUNDLE ACTIONS
    // ----------------------------------------------------
    console.log(cyan("→ Building Titan metadata..."));

    // Si es TypeScript, compilar primero
    if (fs.existsSync(appTs)) {
        const dotTitan = path.join(root, ".titan");
        const compiledApp = path.join(dotTitan, "app.js");

        if (!fs.existsSync(dotTitan)) fs.mkdirSync(dotTitan, { recursive: true });

        // Importar esbuild dinámicamente
        const esbuild = await import("esbuild");
        await esbuild.build({
            entryPoints: [appTs],
            outfile: compiledApp,
            bundle: true,
            platform: "node",
            format: "esm",
            packages: "external",
            logLevel: "silent"
        });

        execSync(`node "${compiledApp}" --build`, { stdio: "inherit" });
    } else {
        execSync("node app/app.js --build", { stdio: "inherit" });
    }

    console.log(cyan("→ Bundling actions..."));
    const bundlePath = path.join(root, "titan", "bundle.js");
    // Convert Windows path to file:// URL for ESM import
    const bundleUrl = pathToFileURL(bundlePath).href;
    const { bundle } = await import(bundleUrl);
    await bundle();

    // ensure actions directory exists
    fs.mkdirSync(actionsOut, { recursive: true });

    // verify bundled actions exist
    const bundles = fs.readdirSync(actionsOut).filter(f => f.endsWith(".jsbundle"));
    if (bundles.length === 0) {
        const rustActionsDir = path.join(serverDir, "src", "actions_rust");
        const hasRustActions = fs.existsSync(rustActionsDir) &&
            fs.readdirSync(rustActionsDir).some(f => f.endsWith(".rs") && f !== "mod.rs");

        if (!hasRustActions) {
            console.log(yellow("⚠ Warning: No JS or Rust actions found."));
        }
    }

    bundles.forEach(file => {
        console.log(cyan(`→ Found action bundle: ${file}`));
    });

    console.log(green("✔ Actions ready in server/actions"));

    // ----------------------------------------------------
    // 2) BUILD RUST BINARY
    // ----------------------------------------------------
    console.log(cyan("→ Building Rust release binary..."));

    // Only build rust if it's a rust project (check Cargo.toml)
    if (fs.existsSync(path.join(serverDir, "Cargo.toml"))) {
        execSync("cargo build --release", {
            cwd: serverDir,
            stdio: "inherit"
        });
        console.log(green("✔ Titan production build complete!"));
    } else {
        console.log(green("✔ Titan production build complete (pure JS/TS)!"));
    }
}

/* -------------------------------------------------------
 * START
 * ----------------------------------------------------- */
export function startProd() {
    const isWin = process.platform === "win32";
    const bin = isWin ? "titan-server.exe" : "titan-server";
    const root = process.cwd();
    const serverDir = path.join(root, "server");

    const exe = path.join(serverDir, "target", "release", bin);

    if (fs.existsSync(exe)) {
        execSync(`"${exe}"`, { stdio: "inherit", cwd: serverDir });
    } else {
        // Fallback to pure node start if no rust binary
        const appJs = path.join(root, "app", "app.js");
        execSync(`node "${appJs}"`, { stdio: "inherit" });
    }
}

/* -------------------------------------------------------
 * UPDATE
 * ----------------------------------------------------- */
export function updateTitan() {
    const root = process.cwd();

    const projectTitan = path.join(root, "titan");
    const projectServer = path.join(root, "server");
    const projectPkg = path.join(root, "package.json");

    let templateType = "js";
    if (fs.existsSync(projectPkg)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(projectPkg, "utf-8"));
            if (pkg.titan && pkg.titan.template) {
                templateType = pkg.titan.template;
            }
        } catch (e) { }
    }

    const templatesRoot = path.join(__dirname, "templates", templateType);
    const commonRoot = path.join(__dirname, "templates", "common");

    const templateTitan = path.join(templatesRoot, "titan");
    const templateServer = path.join(templatesRoot, "server");

    if (!fs.existsSync(projectTitan)) {
        console.log(red("Not a Titan project — titan/ folder missing."));
        return;
    }

    if (!fs.existsSync(templatesRoot)) {
        console.log(red(`Template type '${templateType}' not found in CLI templates.`));
        return;
    }

    console.log(cyan("Updating Titan runtime and server..."));

    // ----------------------------------------------------------
    // 1. Update titan/ runtime (authoritative, safe to replace)
    // ----------------------------------------------------------
    if (fs.existsSync(templateTitan)) {
        fs.rmSync(projectTitan, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 500,
        });
        copyDir(templateTitan, projectTitan);
        console.log(green("✔ Updated titan/ runtime"));
    } else {
        console.log(yellow(`⚠ No titan/ folder found in template '${templateType}', skipping.`));
    }

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

    if (fs.existsSync(templateSrc)) {
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
    }

    // Root-level config files
    const rootFiles = {
        "_gitignore": ".gitignore",
        "_dockerignore": ".dockerignore",
        "Dockerfile": "Dockerfile",
        "jsconfig.json": "jsconfig.json",
        "tsconfig.json": "tsconfig.json",
        "eslint.config.js": "eslint.config.js"
    };

    for (const [srcName, destName] of Object.entries(rootFiles)) {
        let src = path.join(templatesRoot, srcName);
        if (!fs.existsSync(src)) {
            src = path.join(commonRoot, srcName);
        }

        const dest = path.join(root, destName);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(green(`✔ Updated ${destName}`));
        }
    }

    // app/titan.d.ts (JS typing contract)
    const appDir = path.join(root, "app");
    const templatesDts = path.join(templatesRoot, "app", "titan.d.ts");
    const commonDts = path.join(commonRoot, "app", "titan.d.ts");

    const finalDtsSrc = fs.existsSync(templatesDts) ? templatesDts : (fs.existsSync(commonDts) ? commonDts : null);
    const destDts = path.join(appDir, "titan.d.ts");

    if (finalDtsSrc) {
        if (!fs.existsSync(appDir)) {
            fs.mkdirSync(appDir);
        }
        fs.copyFileSync(finalDtsSrc, destDts);
        console.log(green("✔ Updated app/titan.d.ts"));
    }


    console.log(bold(green("✔ Titan update complete")));
}



/* -------------------------------------------------------
 * CREATE EXTENSION
 * ----------------------------------------------------- */
export function createExtension(name) {
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

export function runExtension() {
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
const isMainModule = fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
    const args = process.argv.slice(2);
    // console.log("DEBUG: args", args);
    const cmd = args[0];

    (async () => {
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

                    await initProject(projName, tpl);
                    break;
                }
                case "dev": devServer(process.argv.slice(3)); break;
                case "build": await buildProd(); break;
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
    })();
}