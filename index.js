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

${green("titan init <project>")}        Create new Titan project (JavaScript)
${green("titan init <project> --ts")}   Create new Titan project (TypeScript)
${green("titan create ext <name>")}        Create new Titan extension
${green("titan dev")}                   Dev mode (hot reload)
${green("titan build")}                 Build production Rust server
${green("titan start")}                 Start production binary
${green("titan update")}                Update Titan engine
${green("titan --version")}             Show Titan CLI version

${yellow("Note: `tit` is supported as a legacy alias.")}
`);
}

/* -------------------------------------------------------
 * INIT
 * ----------------------------------------------------- */
function initProject(name) {
    if (!name) {
        console.log(red("Usage: titan init <project> [--ts]"));
        return;
    }

    const useTypeScript = args.includes("--ts");
    const target = path.join(process.cwd(), name);
    const templateDir = path.join(__dirname, "templates");

    if (fs.existsSync(target)) {
        console.log(yellow(`Folder already exists: ${target}`));
        return;
    }

    console.log(cyan(`Creating Titan project → ${target}`));
    if (useTypeScript) {
        console.log(cyan("Using TypeScript template"));
    }

    // 1. Copy full template directory (excluding extension folder)
    copyDir(templateDir, target, ["extension"]);

    // 2. Handle TypeScript vs JavaScript
    const appDir = path.join(target, "app");

    if (useTypeScript) {
        const appJs = path.join(appDir, "app.js");
        const helloJs = path.join(appDir, "actions", "hello.js");

        if (fs.existsSync(appJs)) fs.unlinkSync(appJs);
        if (fs.existsSync(helloJs)) fs.unlinkSync(helloJs);

        const tsconfigSrc = path.join(templateDir, "tsconfig.json");
        const tsconfigDest = path.join(target, "tsconfig.json");
        if (fs.existsSync(tsconfigSrc)) {
            fs.copyFileSync(tsconfigSrc, tsconfigDest);
            console.log(green("✔ Added tsconfig.json"));
        }

        const jsconfigDest = path.join(target, "jsconfig.json");
        if (fs.existsSync(jsconfigDest)) fs.unlinkSync(jsconfigDest);
    } else {
        const appTs = path.join(appDir, "app.ts");
        const helloTs = path.join(appDir, "actions", "hello.ts");

        if (fs.existsSync(appTs)) fs.unlinkSync(appTs);
        if (fs.existsSync(helloTs)) fs.unlinkSync(helloTs);

        const tsconfigDest = path.join(target, "tsconfig.json");
        if (fs.existsSync(tsconfigDest)) fs.unlinkSync(tsconfigDest);
    }

    // 3. Explicitly install dotfiles
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

    const dockerfileSrc = path.join(templateDir, "Dockerfile");
    if (fs.existsSync(dockerfileSrc)) {
        fs.copyFileSync(dockerfileSrc, path.join(target, "Dockerfile"));
    }

    console.log(green("✔ Titan project created!"));
    console.log(cyan("Installing dependencies..."));

    execSync(`npm install esbuild chokidar --silent`, {
        cwd: target,
        stdio: "inherit",
    });

    if (useTypeScript) {
        execSync(`npm install -D typescript @types/node --silent`, {
            cwd: target,
            stdio: "inherit",
        });
        console.log(green("✔ TypeScript dependencies installed"));
    }

    console.log(green("✔ Dependencies installed"));
    console.log(`
Next steps:
  cd ${name}
  titan dev
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
        if (code !== 0) {
            process.exit(code);
        }
    });
}

/* -------------------------------------------------------
 * BUILD - Helper Functions
 * ----------------------------------------------------- */

/**
 * Detects whether the project uses TypeScript or JavaScript as its entry point.
 * @param {string} root - Project root directory
 * @returns {{path: string, isTS: boolean} | null}
 */
function getAppEntry(root) {
    const tsEntry = path.join(root, "app", "app.ts");
    const jsEntry = path.join(root, "app", "app.js");

    if (fs.existsSync(tsEntry)) {
        return { path: tsEntry, isTS: true };
    }

    if (fs.existsSync(jsEntry)) {
        return { path: jsEntry, isTS: false };
    }

    return null;
}

/**
 * Finds the index of the first non-comment, non-empty line in the code.
 * @param {string[]} lines - Array of code lines
 * @returns {number}
 */
function findFirstCodeLineIndex(lines) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith("//")) {
            return i;
        }
    }
    return 0;
}

/**
 * Injects the titan.js import statement into compiled code if missing.
 * @param {string} compiled - Compiled JavaScript code
 * @param {string} titanJsAbsolutePath - Absolute path to titan.js
 * @param {string} outFile - Output file path
 * @returns {string}
 */
function injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile) {
    if (compiled.includes("titan.js")) {
        return compiled;
    }

    console.log(cyan("[Titan] Auto-injecting titan.js import (global t usage detected)..."));

    const lines = compiled.split("\n");
    const insertIndex = findFirstCodeLineIndex(lines);
    const importStatement = `import t from "${titanJsAbsolutePath}";`;

    lines.splice(insertIndex, 0, importStatement);
    const modifiedCode = lines.join("\n");

    fs.writeFileSync(outFile, modifiedCode);

    return modifiedCode;
}

/**
 * Compiles TypeScript entry file using esbuild.
 * @param {string} root - Project root directory
 * @param {string} entryPath - Path to the TypeScript entry file
 * @returns {Promise<{outFile: string, compiled: string}>}
 */
async function compileTypeScript(root, entryPath) {
    console.log(cyan("[Titan] Compiling app.ts with esbuild..."));

    const esbuild = await import("esbuild");
    const titanDir = path.join(root, ".titan");
    const outFile = path.join(titanDir, "app.compiled.mjs");

    // Clean and recreate .titan directory
    if (fs.existsSync(titanDir)) {
        fs.rmSync(titanDir, { recursive: true, force: true });
    }
    fs.mkdirSync(titanDir, { recursive: true });

    // Calculate the absolute path to titan.js
    const titanJsAbsolutePath = path.join(root, "titan", "titan.js").replace(/\\/g, "/");

    // Create plugin to mark titan.js as external
    const titanPlugin = {
        name: "titan-external",
        setup(build) {
            build.onResolve({ filter: /titan\/titan\.js$/ }, () => ({
                path: titanJsAbsolutePath,
                external: true,
            }));
        },
    };

    // Compile TS to JS
    await esbuild.build({
        entryPoints: [entryPath],
        outfile: outFile,
        format: "esm",
        platform: "node",
        target: "node18",
        bundle: true,
        plugins: [titanPlugin],
        loader: { ".ts": "ts" },
        tsconfigRaw: {
            compilerOptions: {
                experimentalDecorators: true,
                useDefineForClassFields: true,
            },
        },
    });

    // Read and process compiled output
    let compiled = fs.readFileSync(outFile, "utf8");
    compiled = injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile);

    return { outFile, compiled };
}

/**
 * Bundles JavaScript entry file using esbuild.
 * @param {string} root - Project root directory
 * @param {string} entryPath - Path to the JavaScript entry file
 * @returns {Promise<{outFile: string, compiled: string}>}
 */
async function compileJavaScript(root, entryPath) {
    console.log(cyan("[Titan] Bundling app.js with esbuild..."));

    const esbuild = await import("esbuild");
    const titanDir = path.join(root, ".titan");
    const outFile = path.join(titanDir, "app.compiled.mjs");

    // Clean and recreate .titan directory
    if (fs.existsSync(titanDir)) {
        fs.rmSync(titanDir, { recursive: true, force: true });
    }
    fs.mkdirSync(titanDir, { recursive: true });

    // Calculate the absolute path to titan.js
    const titanJsAbsolutePath = path.join(root, "titan", "titan.js").replace(/\\/g, "/");

    // Create plugin to mark titan.js as external
    const titanPlugin = {
        name: "titan-external",
        setup(build) {
            build.onResolve({ filter: /titan\/titan\.js$/ }, () => ({
                path: titanJsAbsolutePath,
                external: true,
            }));
        },
    };

    // Bundle JS with esbuild
    await esbuild.build({
        entryPoints: [entryPath],
        outfile: outFile,
        format: "esm",
        platform: "node",
        target: "node18",
        bundle: true,
        plugins: [titanPlugin],
    });

    // Read and process compiled output
    let compiled = fs.readFileSync(outFile, "utf8");
    compiled = injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile);

    return { outFile, compiled };
}

/**
 * Compiles and executes the application entry point.
 * @param {string} root - Project root directory
 * @returns {Promise<{outFile: string, compiled: string}>}
 */
async function compileAndRunAppEntry(root) {
    const entry = getAppEntry(root);

    if (!entry) {
        throw new Error("[Titan] No app.ts or app.js found in app/");
    }

    let result;

    if (entry.isTS) {
        result = await compileTypeScript(root, entry.path);
    } else {
        result = await compileJavaScript(root, entry.path);
    }

    // Execute the compiled file
    execSync(`node "${result.outFile}"`, { stdio: "inherit", cwd: root });

    return result;
}

/* -------------------------------------------------------
 * BUILD
 * ----------------------------------------------------- */
async function buildProd() {
    console.log(cyan("Titan: Building production output..."));

    const root = process.cwd();
    const serverDir = path.join(root, "server");
    const actionsOut = path.join(serverDir, "actions");

    // 1) Detect entry file and compile/bundle
    const entry = getAppEntry(root);

    if (!entry) {
        console.log(red("ERROR: app/app.ts or app/app.js not found."));
        process.exit(1);
    }

    const entryType = entry.isTS ? "TypeScript" : "JavaScript";
    console.log(cyan(`→ Detected ${entryType} project`));

    // 2) BUILD METADATA + BUNDLE ACTIONS
    console.log(cyan(`→ Building Titan metadata from ${entryType}...`));

    try {
        await compileAndRunAppEntry(root);
    } catch (e) {
        console.log(red(`ERROR: Failed to compile ${entryType} entry point.`));
        console.log(red(e.message));
        process.exit(1);
    }

    // Ensure actions directory exists
    fs.mkdirSync(actionsOut, { recursive: true });

    // Verify bundled actions exist
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

    // 3) BUILD RUST BINARY
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

    // 1. Update titan/ runtime
    fs.rmSync(projectTitan, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 500,
    });

    copyDir(templateTitan, projectTitan);
    console.log(green("✔ Updated titan/ runtime"));

    // 2. Update server/
    if (!fs.existsSync(projectServer)) {
        fs.mkdirSync(projectServer);
    }

    const srcCargo = path.join(templateServer, "Cargo.toml");
    const destCargo = path.join(projectServer, "Cargo.toml");

    if (fs.existsSync(srcCargo)) {
        fs.copyFileSync(srcCargo, destCargo);
        console.log(green("✔ Updated server/Cargo.toml"));
    }

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

    // 3. Root-level config files
    const isTypeScriptProject = fs.existsSync(path.join(root, "app", "app.ts"));

    [".gitignore", ".dockerignore", "Dockerfile"].forEach((file) => {
        const src = path.join(templatesRoot, file);
        const dest = path.join(root, file);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(green(`✔ Updated ${file}`));
        }
    });

    if (isTypeScriptProject) {
        const tsconfigSrc = path.join(templatesRoot, "tsconfig.json");
        const tsconfigDest = path.join(root, "tsconfig.json");
        if (fs.existsSync(tsconfigSrc)) {
            fs.copyFileSync(tsconfigSrc, tsconfigDest);
            console.log(green("✔ Updated tsconfig.json"));
        }
    } else {
        const jsconfigSrc = path.join(templatesRoot, "jsconfig.json");
        const jsconfigDest = path.join(root, "jsconfig.json");
        if (fs.existsSync(jsconfigSrc)) {
            fs.copyFileSync(jsconfigSrc, jsconfigDest);
            console.log(green("✔ Updated jsconfig.json"));
        }
    }

    // app/titan.d.ts
    const appDir = path.join(root, "app");
    const srcDts = path.join(templatesRoot, "app", "titan.d.ts");
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
        console.log(red("Usage: titan create ext <n>"));
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

    copyDir(templateDir, target);

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
const isMainModule = process.argv[1]?.endsWith('index.js') ||
    process.argv[1]?.includes('titan') ||
    process.argv[1]?.includes('tit');

if (isMainModule && !process.env.VITEST) {
    if (cmd === "create" && args[1] === "ext") {
        createExtension(args[2]);
    } else if (cmd === "run" && args[1] === "ext") {
        runExtension();
    } else {
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
    }
}

export {
    cyan,
    green,
    yellow,
    red,
    bold,
    wasInvokedAsTit,
    copyDir,
    getAppEntry,
    findFirstCodeLineIndex,
    injectTitanImportIfMissing,
    compileTypeScript,
    compileJavaScript,
    compileAndRunAppEntry,
    initProject,
    devServer,
    buildProd,
    startProd,
    updateTitan,
    createExtension,
    help
};