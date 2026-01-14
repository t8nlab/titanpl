#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

/* -------------------------------------------------------
 * ES Module Directory Resolution
 * ----------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------------------------------------------
 * Console Colors
 * ----------------------------------------------------- */

/** @param {string} t */
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;

/** @param {string} t */
const green = (t) => `\x1b[32m${t}\x1b[0m`;

/** @param {string} t */
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;

/** @param {string} t */
const red = (t) => `\x1b[31m${t}\x1b[0m`;

/** @param {string} t */
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

/* -------------------------------------------------------
 * CLI Metadata
 * ----------------------------------------------------- */
const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
);
const TITAN_VERSION = pkg.version;

const args = process.argv.slice(2);
const cmd = args[0];

/* -------------------------------------------------------
 * Invocation Detection (tit vs titan)
 * ----------------------------------------------------- */

/**
 * Checks if the CLI was invoked using the deprecated 'tit' alias.
 * Examines process.argv, npm_config_argv, and the last command environment variable.
 * @returns {boolean} True if invoked as 'tit', false otherwise.
 */
function wasInvokedAsTit() {
    if (checkScriptName()) return true;
    if (checkNpmConfigArgv()) return true;
    if (checkLastCommand()) return true;
    return false;
}

/**
 * Checks if the script name in process.argv indicates 'tit' invocation.
 * @returns {boolean}
 */
function checkScriptName() {
    const script = process.argv[1];
    if (!script) return false;

    const base = path.basename(script, path.extname(script)).toLowerCase();
    return base === "tit";
}

/**
 * Checks npm_config_argv for 'tit' invocation pattern.
 * @returns {boolean}
 */
function checkNpmConfigArgv() {
    try {
        const raw = process.env.npm_config_argv;
        if (!raw) return false;

        const cfg = JSON.parse(raw);
        if (!cfg.original || !Array.isArray(cfg.original)) return false;

        const first = cfg.original[0];
        return first && first.includes("tit") && !first.includes("titan");
    } catch {
        return false;
    }
}

/**
 * Checks the last command environment variable for 'tit' invocation.
 * @returns {boolean}
 */
function checkLastCommand() {
    const lastCmd = process.env["_"];
    if (!lastCmd) return false;

    const base = path.basename(lastCmd, path.extname(lastCmd)).toLowerCase();
    return base === "tit";
}

/**
 * Displays deprecation warning if invoked using the 'tit' alias.
 */
function showDeprecationWarningIfNeeded() {
    if (wasInvokedAsTit()) {
        console.log(
            yellow(
                "[Notice] `tit` is deprecated. Please use `titan` instead.\n" +
                "        `tit` will continue to work for now."
            )
        );
    }
}

/* -------------------------------------------------------
 * File System Utilities
 * ----------------------------------------------------- */

/**
 * Recursively copies a directory from source to destination.
 * @param {string} src - Source directory path.
 * @param {string} dest - Destination directory path.
 * @param {string[]} [excludes=[]] - Array of filenames to exclude from copying.
 */
function copyDir(src, dest, excludes = []) {
    fs.mkdirSync(dest, { recursive: true });

    const files = fs.readdirSync(src);

    for (const file of files) {
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

/**
 * Safely removes a directory with retry logic for Windows compatibility.
 * @param {string} dirPath - Path to the directory to remove.
 */
function removeDirectorySafe(dirPath) {
    if (!fs.existsSync(dirPath)) return;

    fs.rmSync(dirPath, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 500,
    });
}

/**
 * Copies a file if the source exists.
 * @param {string} src - Source file path.
 * @param {string} dest - Destination file path.
 * @returns {boolean} True if file was copied, false otherwise.
 */
function copyFileIfExists(src, dest) {
    if (!fs.existsSync(src)) return false;

    fs.copyFileSync(src, dest);
    return true;
}

/**
 * Removes a file if it exists.
 * @param {string} filePath - Path to the file to remove.
 */
function removeFileIfExists(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

/* -------------------------------------------------------
 * Path Builders
 * ----------------------------------------------------- */

/**
 * Builds common project paths based on the root directory.
 * @param {string} root - Project root directory.
 * @returns {{ appDir: string, serverDir: string, titanDir: string, actionsOut: string }}
 */
function buildProjectPaths(root) {
    return {
        appDir: path.join(root, "app"),
        serverDir: path.join(root, "server"),
        titanDir: path.join(root, ".titan"),
        actionsOut: path.join(root, "server", "actions"),
    };
}

/**
 * Builds template directory paths.
 * @returns {{ templatesRoot: string, templateTitan: string, templateServer: string, templateExtension: string }}
 */
function buildTemplatePaths() {
    const templatesRoot = path.join(__dirname, "templates");

    return {
        templatesRoot,
        templateTitan: path.join(templatesRoot, "titan"),
        templateServer: path.join(templatesRoot, "server"),
        templateExtension: path.join(templatesRoot, "extension"),
    };
}

/* -------------------------------------------------------
 * App Entry Detection
 * ----------------------------------------------------- */

/**
 * Detects whether the project uses TypeScript or JavaScript as its entry point.
 * @param {string} root - Project root directory.
 * @returns {{ path: string, isTS: boolean } | null} Entry file info or null if not found.
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
 * Checks if the project uses TypeScript based on entry file existence.
 * @param {string} root - Project root directory.
 * @returns {boolean}
 */
function isTypeScriptProject(root) {
    return fs.existsSync(path.join(root, "app", "app.ts"));
}

/* -------------------------------------------------------
 * HELP Command
 * ----------------------------------------------------- */

/**
 * Displays the CLI help message with available commands.
 */
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
 * INIT Command - Helper Functions
 * ----------------------------------------------------- */

/**
 * Removes language-specific files based on project type selection.
 * @param {string} appDir - Application directory path.
 * @param {boolean} useTypeScript - Whether TypeScript is being used.
 */
function removeAlternateLanguageFiles(appDir, useTypeScript) {
    if (useTypeScript) {
        removeFileIfExists(path.join(appDir, "app.js"));
        removeFileIfExists(path.join(appDir, "actions", "hello.js"));
    } else {
        removeFileIfExists(path.join(appDir, "app.ts"));
        removeFileIfExists(path.join(appDir, "actions", "hello.ts"));
    }
}

/**
 * Sets up TypeScript or JavaScript configuration files.
 * Now copies both tsconfig and jsconfig regardless of project type.
 * @param {string} target - Target project directory.
 * @param {string} templateDir - Template directory path.
 */
function setupLanguageConfig(target, templateDir) {
    const tsconfigSrc = path.join(templateDir, "tsconfig.json");
    const tsconfigDest = path.join(target, "tsconfig.json");
    const jsconfigSrc = path.join(templateDir, "jsconfig.json");
    const jsconfigDest = path.join(target, "jsconfig.json");

    if (copyFileIfExists(tsconfigSrc, tsconfigDest)) {
        console.log(green("✔ Added tsconfig.json"));
    }

    if (copyFileIfExists(jsconfigSrc, jsconfigDest)) {
        console.log(green("✔ Added jsconfig.json"));
    }
}

/**
 * Copies dotfiles from template to project directory.
 * @param {string} templateDir - Template directory path.
 * @param {string} target - Target project directory.
 */
function copyDotfiles(templateDir, target) {
    const dotfiles = {
        "_gitignore": ".gitignore",
        "_dockerignore": ".dockerignore",
    };

    for (const [srcName, destName] of Object.entries(dotfiles)) {
        const src = path.join(templateDir, srcName);
        const dest = path.join(target, destName);

        if (copyFileIfExists(src, dest)) {
            console.log(green(`✔ Added ${destName}`));
        }
    }

    const dockerfileSrc = path.join(templateDir, "Dockerfile");
    copyFileIfExists(dockerfileSrc, path.join(target, "Dockerfile"));
}

/**
 * Installs project dependencies using npm.
 * @param {string} target - Target project directory.
 * @param {boolean} useTypeScript - Whether to install TypeScript dependencies.
 */
function installDependencies(target, useTypeScript) {
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
}

/* -------------------------------------------------------
 * INIT Command
 * ----------------------------------------------------- */

/**
 * Initializes a new Titan project with the specified name.
 * Supports both JavaScript and TypeScript templates.
 * @param {string} name - Project name/directory.
 */
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

    copyDir(templateDir, target, ["extension"]);

    const appDir = path.join(target, "app");
    removeAlternateLanguageFiles(appDir, useTypeScript);
    setupLanguageConfig(target, templateDir);
    copyDotfiles(templateDir, target);

    console.log(green("✔ Titan project created!"));
    console.log(cyan("Installing dependencies..."));

    installDependencies(target, useTypeScript);

    console.log(`
Next steps:
  cd ${name}
  titan dev
`);
}

/* -------------------------------------------------------
 * DEV Command
 * ----------------------------------------------------- */

/**
 * Starts the development server with hot reload support.
 * Spawns the dev.js script from the titan directory.
 */
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
 * BUILD Command - Compilation Utilities
 * ----------------------------------------------------- */

/**
 * Finds the index of the first non-comment, non-empty line in the code.
 * @param {string[]} lines - Array of code lines.
 * @returns {number} Index of the first code line.
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
 * @param {string} compiled - Compiled JavaScript code.
 * @param {string} titanJsAbsolutePath - Absolute path to titan.js.
 * @param {string} outFile - Output file path.
 * @returns {string} Modified code with titan.js import.
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
 * Prepares the .titan directory for compilation output.
 * @param {string} titanDir - Path to the .titan directory.
 */
function prepareTitanDirectory(titanDir) {
    if (fs.existsSync(titanDir)) {
        fs.rmSync(titanDir, { recursive: true, force: true });
    }
    fs.mkdirSync(titanDir, { recursive: true });
}

/**
 * Calculates the absolute path to titan.js with forward slashes.
 * @param {string} root - Project root directory.
 * @returns {string} Absolute path to titan.js.
 */
function getTitanJsAbsolutePath(root) {
    return path.join(root, "titan", "titan.js").replace(/\\/g, "/");
}

/**
 * Creates an esbuild plugin to mark titan.js as external.
 * @param {string} titanJsAbsolutePath - Absolute path to titan.js.
 * @returns {import('esbuild').Plugin} The esbuild plugin.
 */
function createTitanExternalPlugin(titanJsAbsolutePath) {
    return {
        name: "titan-external",
        setup(build) {
            build.onResolve({ filter: /titan\/titan\.js$/ }, () => ({
                path: titanJsAbsolutePath,
                external: true,
            }));
        },
    };
}

/**
 * Builds the base esbuild configuration for compilation.
 * @param {string} entryPath - Entry file path.
 * @param {string} outFile - Output file path.
 * @param {import('esbuild').Plugin} titanPlugin - The titan external plugin.
 * @returns {import('esbuild').BuildOptions} Base esbuild configuration.
 */
function buildBaseEsbuildConfig(entryPath, outFile, titanPlugin) {
    return {
        entryPoints: [entryPath],
        outfile: outFile,
        format: "esm",
        platform: "node",
        target: "node18",
        bundle: true,
        plugins: [titanPlugin],
    };
}

/**
 * Compiles TypeScript entry file using esbuild.
 * @param {string} root - Project root directory.
 * @param {string} entryPath - Path to the TypeScript entry file.
 * @returns {Promise<{ outFile: string, compiled: string }>} Compilation result.
 */
async function compileTypeScript(root, entryPath) {
    console.log(cyan("[Titan] Compiling app.ts with esbuild..."));

    const esbuild = await import("esbuild");
    const titanDir = path.join(root, ".titan");
    const outFile = path.join(titanDir, "app.compiled.mjs");

    prepareTitanDirectory(titanDir);

    const titanJsAbsolutePath = getTitanJsAbsolutePath(root);
    const titanPlugin = createTitanExternalPlugin(titanJsAbsolutePath);

    const baseConfig = buildBaseEsbuildConfig(entryPath, outFile, titanPlugin);

    await esbuild.build({
        ...baseConfig,
        loader: { ".ts": "ts" },
        tsconfigRaw: {
            compilerOptions: {
                experimentalDecorators: true,
                useDefineForClassFields: true,
            },
        },
    });

    let compiled = fs.readFileSync(outFile, "utf8");
    compiled = injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile);

    return { outFile, compiled };
}

/**
 * Bundles JavaScript entry file using esbuild.
 * @param {string} root - Project root directory.
 * @param {string} entryPath - Path to the JavaScript entry file.
 * @returns {Promise<{ outFile: string, compiled: string }>} Compilation result.
 */
async function compileJavaScript(root, entryPath) {
    console.log(cyan("[Titan] Bundling app.js with esbuild..."));

    const esbuild = await import("esbuild");
    const titanDir = path.join(root, ".titan");
    const outFile = path.join(titanDir, "app.compiled.mjs");

    prepareTitanDirectory(titanDir);

    const titanJsAbsolutePath = getTitanJsAbsolutePath(root);
    const titanPlugin = createTitanExternalPlugin(titanJsAbsolutePath);

    const config = buildBaseEsbuildConfig(entryPath, outFile, titanPlugin);

    await esbuild.build(config);

    let compiled = fs.readFileSync(outFile, "utf8");
    compiled = injectTitanImportIfMissing(compiled, titanJsAbsolutePath, outFile);

    return { outFile, compiled };
}

/**
 * Compiles and executes the application entry point.
 * @param {string} root - Project root directory.
 * @returns {Promise<{ outFile: string, compiled: string }>} Compilation result.
 * @throws {Error} If no entry file is found.
 */
async function compileAndRunAppEntry(root) {
    const entry = getAppEntry(root);

    if (!entry) {
        throw new Error("[Titan] No app.ts or app.js found in app/");
    }

    const result = entry.isTS
        ? await compileTypeScript(root, entry.path)
        : await compileJavaScript(root, entry.path);

    execSync(`node "${result.outFile}"`, { stdio: "inherit", cwd: root });

    return result;
}

/* -------------------------------------------------------
 * BUILD Command - Production Build Utilities
 * ----------------------------------------------------- */

/**
 * Verifies that action bundles exist in the output directory.
 * @param {string} actionsOut - Actions output directory path.
 * @returns {string[]} Array of bundle filenames.
 */
function verifyActionBundles(actionsOut) {
    const bundles = fs.readdirSync(actionsOut).filter(f => f.endsWith(".jsbundle"));

    if (bundles.length === 0) {
        console.log(red("ERROR: No actions bundled."));
        console.log(red("Make sure your DSL outputs to server/actions."));
        process.exit(1);
    }

    bundles.forEach(file => {
        console.log(cyan(`→ Found action bundle: ${file}`));
    });

    return bundles;
}

/**
 * Copies runtime files to the release directory.
 * @param {string} serverDir - Server directory path.
 * @param {string} releaseDir - Release directory path.
 * @param {string} actionsOut - Actions output directory path.
 */
function copyRuntimeFilesToRelease(serverDir, releaseDir, actionsOut) {
    fs.copyFileSync(
        path.join(serverDir, "routes.json"),
        path.join(releaseDir, "routes.json")
    );
    console.log(green("✔ Copied routes.json to release"));

    fs.copyFileSync(
        path.join(serverDir, "action_map.json"),
        path.join(releaseDir, "action_map.json")
    );
    console.log(green("✔ Copied action_map.json to release"));

    const actionsRelease = path.join(releaseDir, "actions");
    if (fs.existsSync(actionsRelease)) {
        fs.rmSync(actionsRelease, { recursive: true, force: true });
    }
    copyDir(actionsOut, actionsRelease);
    console.log(green("✔ Copied actions to release"));
}

/* -------------------------------------------------------
 * BUILD Command
 * ----------------------------------------------------- */

/**
 * Builds the production-ready Titan application.
 * Compiles TypeScript/JavaScript, bundles actions, and builds the Rust binary.
 */
async function buildProd() {
    console.log(cyan("Titan: Building production output..."));

    const root = process.cwd();
    const { serverDir, actionsOut } = buildProjectPaths(root);

    const entry = getAppEntry(root);

    if (!entry) {
        console.log(red("ERROR: app/app.ts or app/app.js not found."));
        process.exit(1);
    }

    const entryType = entry.isTS ? "TypeScript" : "JavaScript";
    console.log(cyan(`→ Detected ${entryType} project`));

    console.log(cyan(`→ Building Titan metadata from ${entryType}...`));

    try {
        await compileAndRunAppEntry(root);
    } catch (e) {
        console.log(red(`ERROR: Failed to compile ${entryType} entry point.`));
        console.log(red(e.message));
        process.exit(1);
    }

    console.log(cyan("→ Bundling JS actions..."));
    const { bundle } = await import(path.join(root, "titan", "bundle.js"));
    await bundle(root);

    fs.mkdirSync(actionsOut, { recursive: true });
    verifyActionBundles(actionsOut);

    console.log(green("✔ Actions ready in server/actions"));

    console.log(cyan("→ Building Rust release binary..."));
    execSync("cargo build --release", {
        cwd: serverDir,
        stdio: "inherit"
    });

    const releaseDir = path.join(serverDir, "target", "release");
    copyRuntimeFilesToRelease(serverDir, releaseDir, actionsOut);

    console.log(green("✔ Titan production build complete!"));
}

/* -------------------------------------------------------
 * START Command
 * ----------------------------------------------------- */

/**
 * Starts the production Titan server binary.
 */
function startProd() {
    const isWin = process.platform === "win32";
    const bin = isWin ? "titan-server.exe" : "titan-server";
    const releaseDir = path.join(process.cwd(), "server", "target", "release");
    const exe = path.join(releaseDir, bin);

    execSync(`"${exe}"`, {
        stdio: "inherit",
        cwd: releaseDir
    });
}

/* -------------------------------------------------------
 * UPDATE Command - Helper Functions
 * ----------------------------------------------------- */

/**
 * Validates that the current directory is a Titan project.
 * @param {string} projectTitan - Path to the titan directory.
 * @returns {boolean} True if valid, false otherwise.
 */
function validateTitanProject(projectTitan) {
    if (!fs.existsSync(projectTitan)) {
        console.log(red("Not a Titan project — titan/ folder missing."));
        return false;
    }
    return true;
}

/**
 * Validates that the CLI templates are intact.
 * @param {string} templateServer - Path to the server template.
 * @returns {boolean} True if valid, false otherwise.
 */
function validateCliTemplates(templateServer) {
    if (!fs.existsSync(templateServer)) {
        console.log(red("CLI is corrupted — server template missing."));
        return false;
    }
    return true;
}

/**
 * Updates the titan runtime directory.
 * @param {string} projectTitan - Project's titan directory.
 * @param {string} templateTitan - Template titan directory.
 */
function updateTitanRuntime(projectTitan, templateTitan) {
    removeDirectorySafe(projectTitan);
    copyDir(templateTitan, projectTitan);
    console.log(green("✔ Updated titan/ runtime"));
}

/**
 * Updates the server directory with latest templates.
 * @param {string} projectServer - Project's server directory.
 * @param {string} templateServer - Template server directory.
 */
function updateServerDirectory(projectServer, templateServer) {
    if (!fs.existsSync(projectServer)) {
        fs.mkdirSync(projectServer);
    }

    const srcCargo = path.join(templateServer, "Cargo.toml");
    const destCargo = path.join(projectServer, "Cargo.toml");

    if (copyFileIfExists(srcCargo, destCargo)) {
        console.log(green("✔ Updated server/Cargo.toml"));
    }

    const projectSrc = path.join(projectServer, "src");
    const templateSrc = path.join(templateServer, "src");

    removeDirectorySafe(projectSrc);
    copyDir(templateSrc, projectSrc);
    console.log(green("✔ Updated server/src/"));
}

/**
 * Updates root-level configuration files.
 * @param {string} templatesRoot - Templates root directory.
 * @param {string} root - Project root directory.
 */
function updateRootConfigFiles(templatesRoot, root) {
    const configFiles = [".gitignore", ".dockerignore", "Dockerfile"];

    for (const file of configFiles) {
        const src = path.join(templatesRoot, file);
        const dest = path.join(root, file);

        if (copyFileIfExists(src, dest)) {
            console.log(green(`✔ Updated ${file}`));
        }
    }
}

/**
 * Updates language-specific configuration based on project type.
 * Now updates both tsconfig and jsconfig.
 * @param {string} templatesRoot - Templates root directory.
 * @param {string} root - Project root directory.
 */
function updateLanguageConfig(templatesRoot, root) {
    const tsconfigSrc = path.join(templatesRoot, "tsconfig.json");
    const tsconfigDest = path.join(root, "tsconfig.json");

    if (copyFileIfExists(tsconfigSrc, tsconfigDest)) {
        console.log(green("✔ Updated tsconfig.json"));
    }

    const jsconfigSrc = path.join(templatesRoot, "jsconfig.json");
    const jsconfigDest = path.join(root, "jsconfig.json");

    if (copyFileIfExists(jsconfigSrc, jsconfigDest)) {
        console.log(green("✔ Updated jsconfig.json"));
    }
}

/**
 * Updates the TypeScript declaration file.
 * @param {string} templatesRoot - Templates root directory.
 * @param {string} appDir - Application directory.
 */
function updateTypeDeclarations(templatesRoot, appDir) {
    const srcDts = path.join(templatesRoot, "app", "titan.d.ts");
    const destDts = path.join(appDir, "titan.d.ts");

    if (!fs.existsSync(srcDts)) return;

    if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir);
    }

    fs.copyFileSync(srcDts, destDts);
    console.log(green("✔ Updated app/titan.d.ts"));
}

/**
 * Updates the global types file (types/titan.d.ts).
 * @param {string} templatesRoot - Templates root directory.
 * @param {string} root - Project root directory.
 */
function updateGlobalTypes(templatesRoot, root) {
    const srcDts = path.join(templatesRoot, "types", "titan.d.ts");
    const destDir = path.join(root, "types");
    const destDts = path.join(destDir, "titan.d.ts");

    if (!fs.existsSync(srcDts)) return;

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir);
    }

    if (copyFileIfExists(srcDts, destDts)) {
        console.log(green("✔ Updated types/titan.d.ts"));
    }
}

/* -------------------------------------------------------
 * UPDATE Command
 * ----------------------------------------------------- */

/**
 * Updates the Titan runtime and server to the latest version.
 * Replaces titan/, server/src/, and configuration files.
 */
function updateTitan() {
    const root = process.cwd();

    const projectTitan = path.join(root, "titan");
    const projectServer = path.join(root, "server");

    const { templatesRoot, templateTitan, templateServer } = buildTemplatePaths();

    if (!validateTitanProject(projectTitan)) return;
    if (!validateCliTemplates(templateServer)) return;

    console.log(cyan("Updating Titan runtime and server..."));

    updateTitanRuntime(projectTitan, templateTitan);
    updateServerDirectory(projectServer, templateServer);
    updateRootConfigFiles(templatesRoot, root);
    updateLanguageConfig(templatesRoot, root);
    updateTypeDeclarations(templatesRoot, path.join(root, "app"));
    updateGlobalTypes(templatesRoot, root);

    console.log(bold(green("✔ Titan update complete")));
}

/* -------------------------------------------------------
 * CREATE EXTENSION Command - Helper Functions
 * ----------------------------------------------------- */

/**
 * Replaces template placeholders in a file with actual values.
 * @param {string} filePath - Path to the file to process.
 * @param {string} title - Extension title/name.
 * @param {string} nativeName - Native-compatible name (underscores instead of hyphens).
 */
function replaceTemplatePlaceholders(filePath, title, nativeName) {
    if (!fs.existsSync(filePath)) return;

    let content = fs.readFileSync(filePath, "utf8");
    content = content.replace(/{{name}}/g, title);
    content = content.replace(/{{native_name}}/g, nativeName);
    fs.writeFileSync(filePath, content);
}

/**
 * Processes all template files in the extension directory.
 * @param {string} target - Target extension directory.
 * @param {string} name - Extension name.
 */
function processExtensionTemplates(target, name) {
    const title = name;
    const nativeName = title.replace(/-/g, "_");

    const templateFiles = [
        path.join(target, "titan.json"),
        path.join(target, "index.js"),
        path.join(target, "README.md"),
        path.join(target, "package.json"),
        path.join(target, "native", "Cargo.toml"),
    ];

    for (const filePath of templateFiles) {
        replaceTemplatePlaceholders(filePath, title, nativeName);
    }
}

/**
 * Installs extension dependencies.
 * @param {string} target - Target extension directory.
 */
function installExtensionDependencies(target) {
    try {
        execSync("npm install", { cwd: target, stdio: "inherit" });
    } catch (e) {
        console.log(yellow("Warning: Failed to install dependencies. You may need to run `npm install` manually."));
    }
}

/* -------------------------------------------------------
 * CREATE EXTENSION Command
 * ----------------------------------------------------- */

/**
 * Creates a new Titan extension with the specified name.
 * @param {string} name - Extension name.
 */
function createExtension(name) {
    if (!name) {
        console.log(red("Usage: titan create ext <n>"));
        return;
    }

    const target = path.join(process.cwd(), name);
    const { templateExtension } = buildTemplatePaths();

    if (fs.existsSync(target)) {
        console.log(yellow(`Folder already exists: ${target}`));
        return;
    }

    if (!fs.existsSync(templateExtension)) {
        console.log(red(`Extension template not found at ${templateExtension}`));
        return;
    }

    console.log(cyan(`Creating Titan extension → ${target}`));

    copyDir(templateExtension, target);
    processExtensionTemplates(target, name);

    console.log(cyan("Installing dependencies..."));
    installExtensionDependencies(target);

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

/* -------------------------------------------------------
 * RUN EXTENSION Command
 * ----------------------------------------------------- */

/**
 * Runs the extension using the SDK runner.
 * Prefers local SDK if available, falls back to npx.
 */
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
 * Command Router
 * ----------------------------------------------------- */

/**
 * Routes the CLI command to the appropriate handler.
 * @param {string} command - The command to execute.
 */
function routeCommand(command) {
    if (command === "create" && args[1] === "ext") {
        createExtension(args[2]);
        return;
    }

    if (command === "run" && args[1] === "ext") {
        runExtension();
        return;
    }

    switch (command) {
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
            console.log(cyan(`Titan v${TITAN_VERSION}`));
            break;
        default:
            help();
    }
}

/* -------------------------------------------------------
 * Main Entry Point
 * ----------------------------------------------------- */

/**
 * Determines if this module is being run as the main entry point.
 * @returns {boolean}
 */
function isMainModule() {
    const scriptPath = process.argv[1];

    return scriptPath?.endsWith('index.js') ||
        scriptPath?.includes('titan') ||
        scriptPath?.includes('tit');
}

if (isMainModule() && !process.env.VITEST) {
    showDeprecationWarningIfNeeded();
    routeCommand(cmd);
}

/* -------------------------------------------------------
 * Exports
 * ----------------------------------------------------- */
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