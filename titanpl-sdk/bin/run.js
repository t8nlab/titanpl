#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for colors
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;

function copyDir(src, dest, excludes = []) {
    // console.log(`DEBUG: copyDir ${src} -> ${dest}`);
    if (!fs.existsSync(src)) {
        console.log(red(`Source does not exist: ${src}`));
        return;
    }

    fs.mkdirSync(dest, { recursive: true });

    const files = fs.readdirSync(src);
    // console.log(`DEBUG: Found ${files.length} files in ${src}`);

    for (const file of files) {
        if (excludes.includes(file)) {
            // console.log(`DEBUG: Skipping excluded ${file}`);
            continue;
        }

        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);

        if (fs.lstatSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath, excludes);
        } else {
            // console.log(`DEBUG: Copying file ${file}`);
            try {
                fs.copyFileSync(srcPath, destPath);
            } catch (err) {
                console.log(red(`ERROR: Failed to copy ${file}: ${err.message}`));
            }
        }
    }
}

function run() {
    console.log(cyan("TitanPl SDK: Test Runner"));

    // 1. Validate we are in an extension directory
    const cwd = process.cwd();
    console.log(cyan(`Current Working Directory: ${cwd}`));

    const manifestPath = path.join(cwd, "titan.json");
    if (!fs.existsSync(manifestPath)) {
        console.log(red("Error: titan.json not found. Run this command inside your extension folder."));
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const name = manifest.name;
    console.log(green(`Extension: ${name}`));

    // 2. Build Native Logic (if properly set up)
    const nativeDir = path.join(cwd, "native");
    if (fs.existsSync(nativeDir) && fs.existsSync(path.join(nativeDir, "Cargo.toml"))) {
        console.log(cyan("Building native Rust module..."));
        try {
            execSync("cargo build --release", { cwd: nativeDir, stdio: "inherit" });
        } catch (e) {
            console.log(red("Failed to build native module."));
            process.exit(1);
        }
    }

    // 3. Setup Test Harness (Mini Titan Project)
    // 3. Setup Test Harness (Mini Titan Project)
    const runDir = path.join(cwd, ".titan_test_run");
    const appDir = path.join(runDir, "app");
    const actionsDir = path.join(appDir, "actions");
    const nmDir = path.join(runDir, "node_modules");

    const isFirstRun = !fs.existsSync(runDir);

    if (isFirstRun) {
        console.log(cyan("Initializing test environment..."));
        fs.mkdirSync(runDir, { recursive: true });

        // Create app structure
        fs.mkdirSync(appDir);

        // Create actions folder (required by Titan build)
        fs.mkdirSync(actionsDir);

        // Copy titan/ and server/ from templates
        const templatesDir = path.join(__dirname, "..", "templates");
        console.log(cyan(`Templates Source: ${templatesDir}`));

        const titanSrc = path.join(templatesDir, "titan");
        const titanDest = path.join(runDir, "titan");

        if (fs.existsSync(titanSrc)) {
            copyDir(titanSrc, titanDest);
            if (!fs.existsSync(path.join(titanDest, "titan.js"))) {
                throw new Error("Failed to copy titan.js template");
            }
        } else {
            console.log(red(`Error: Titan templates not found at ${titanSrc}`));
            process.exit(1);
        }

        const serverSrc = path.join(templatesDir, "server");
        const serverDest = path.join(runDir, "server");
        if (fs.existsSync(serverSrc)) {
            copyDir(serverSrc, serverDest);
        } else {
            console.log(red(`Error: Server templates not found at ${serverSrc}`));
            process.exit(1);
        }

        // Create package.json for the test harness
        const pkgJson = {
            "type": "module",
            "dependencies": {
                // We can add dependencies here if needed
            }
        };
        fs.writeFileSync(path.join(runDir, "package.json"), JSON.stringify(pkgJson, null, 2));

        // Create 'node_modules'
        // const nmDir = path.join(runDir, "node_modules"); // Already defined
        fs.mkdirSync(nmDir);
    } else {
        console.log(cyan("Using existing test environment..."));
    }

    // const nmDir = path.join(runDir, "node_modules"); // Already defined
    if (!fs.existsSync(nmDir)) fs.mkdirSync(nmDir, { recursive: true });

    // COPY Extension to node_modules/NAME (Force Copy to avoid Symlink Loops)
    const extDest = path.join(nmDir, name);
    console.log(cyan(`Copying extension to ${extDest}...`));

    // Always exclude the test run folder itself + standard ignores
    const excludes = ['.titan_test_run', 'node_modules', '.git', 'target', 'dist'];
    copyDir(cwd, extDest, excludes);

    // Create default test files ONLY if they don't exist
    // const actionsDir = path.join(runDir, "app", "actions"); // Already defined
    const testActionPath = path.join(actionsDir, "test.js");

    if (!fs.existsSync(testActionPath)) {
        const testAction = `export const test = (req) => {
    const ext = t["${name}"];
    
    const results = {
        extension: "${name}",
        loaded: !!ext,
        methods: ext ? Object.keys(ext) : [],
        timestamp: new Date().toISOString()
    };
    
    if (ext && ext.hello) {
        try {
            results.hello_test = ext.hello("World");
        } catch(e) {
            results.hello_error = String(e);
        }
    }
    
    if (ext && ext.calc) {
        try {
            results.calc_test = ext.calc(15, 25);
        } catch(e) {
            results.calc_error = String(e);
        }
    }
    
    return results;
};
`;
        fs.writeFileSync(testActionPath, testAction);
    }

    const appJsPath = path.join(runDir, "app", "app.js");
    if (!fs.existsSync(appJsPath)) {
        const testScript = `import t from "../titan/titan.js";

// 1. Expose 't' globally because extensions expect it (like in the real runtime)
globalThis.t = t;

// 2. Dynamic import ensures 't' is set BEFORE the extension loads
await import("${name}");

// Extension test harness for: ${name}
const ext = t["${name}"];

console.log("---------------------------------------------------");
console.log("Testing Extension: ${name}");
console.log("---------------------------------------------------");

if (!ext) {
    console.log("ERROR: Extension '${name}' not found in global 't'.");
} else {
    console.log("✓ Extension loaded successfully!");
    console.log("✓ Available methods:", Object.keys(ext).join(", "));
    
    // Try 'hello' if it exists
    if (typeof ext.hello === 'function') {
        console.log("\\nTesting ext.hello('Titan')...");
        try {
           const res = ext.hello("Titan");
           console.log("✓ Result:", res);
        } catch(e) {
           console.log("✗ Error:", e.message);
        }
    }

    // Try 'calc' if it exists
    if (typeof ext.calc === 'function') {
        console.log("\\nTesting ext.calc(10, 20)...");
        try {
            const res = ext.calc(10, 20);
            console.log("✓ Result:", res);
        } catch(e) {
            console.log("✗ Error:", e.message);
        }
    }
}

console.log("---------------------------------------------------");
console.log("✓ Test complete!");
console.log("\\n📍 Routes:");
console.log("  GET  http://localhost:3000/      → Test harness info");
console.log("  GET  http://localhost:3000/test  → Extension test results (JSON)");
console.log("---------------------------------------------------\\n");

// Create routes
t.get("/test").action("test");
t.get("/").reply("🚀 Extension Test Harness for ${name}\\n\\nVisit /test to see extension test results");

await t.start(3000, "Titan Extension Test Running!");
`;
        fs.writeFileSync(appJsPath, testScript);
    }

    // Build the app (bundle actions)
    console.log(cyan("Building test app..."));
    try {
        execSync("node app/app.js --build", {
            cwd: runDir,
            stdio: "inherit",
            env: { ...process.env, NODE_OPTIONS: "--no-warnings" }
        });
    } catch (e) {
        console.log(red("Failed to build test app. checking for runtime errors..."));
    }

    // 4. Run Titan Server using cargo run
    console.log(green("\\x1b[1m\\n>>> STARTING EXTENSION TEST >>>\\n\\x1b[0m"));

    const serverDir = path.join(runDir, "server");

    try {
        execSync("cargo run", { cwd: serverDir, stdio: "inherit" });
    } catch (e) {
        // console.log(red("Runtime exited."));
    }
}

run();
