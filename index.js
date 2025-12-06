#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

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

// ------------------------------------------
// COPY TEMPLATES
// ------------------------------------------
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

// ------------------------------------------
// HELP
// ------------------------------------------
function help() {
    console.log(`
${bold(cyan("Titan CLI"))}

${green("tit init <project>")}   Create new Titan project
${green("tit dev")}              Run dev server (routes + bundle + cargo)
${green("tit build")}            Build Rust release
${green("tit start")}            Start production binary
`);
}

// ------------------------------------------
// INIT PROJECT
// ------------------------------------------
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

    console.log(green("✔ Titan project created!"));
    console.log(cyan("Installing Titan dependencies..."));

    const deps = [
        "esbuild",
    ];

    execSync(`npm install ${deps.join(" ")} --silent`, {
        cwd: target,
        stdio: "inherit"
    });

    console.log(green("✔ Dependencies installed successfully"));


    console.log(green("✔ Titan project created"));
    console.log(`
Next steps:
  cd ${name}
  tit dev
`);
}

// ------------------------------------------
// RUN BUNDLER
// ------------------------------------------
function runBundler() {
    const bundler = path.join(process.cwd(), "titan", "bundle.js");

    if (fs.existsSync(bundler)) {
        console.log(cyan("Titan: bundling actions..."));
        execSync(`node ${bundler}`, { stdio: "inherit" });
    } else {
        console.log(yellow("Warning: titan/bundle.js missing."));
    }
}

// ------------------------------------------
// DEV SERVER
// ------------------------------------------
function devServer() {
    console.log(cyan("Titan: generating routes.json & action_map.json..."));
    execSync("node app/app.js", { stdio: "inherit" });

    // RUN BUNDLER HERE
    runBundler();

    console.log(cyan("Titan: starting Rust server..."));

    spawn("cargo", ["run"], {
        cwd: path.join(process.cwd(), "server"),
        stdio: "inherit",
        shell: true,
    });
}

// ------------------------------------------
// BUILD RELEASE
// ------------------------------------------
function buildProd() {
    console.log(cyan("Titan: generating routes + bundling..."));
    execSync("node app/app.js", { stdio: "inherit" });
    runBundler();

    console.log(cyan("Titan: building release..."));
    execSync("cargo build --release", {
        cwd: path.join(process.cwd(), "server"),
        stdio: "inherit",
    });
}

// ------------------------------------------
// START PRODUCTION
// ------------------------------------------
function startProd() {
    const isWindows = process.platform === "win32";

    const binaryName = isWindows ? "titan-server.exe" : "titan-server";    // Linux / macOS

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
// ROUTER
// ------------------------------------------
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

    default:
        help();
}
