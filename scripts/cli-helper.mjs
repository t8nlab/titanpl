#!/usr/bin/env node

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                     TITANPL CLI HELPER v2.1.0                            ║
 * ║        Interactive Assistant for Building Titan Planet Templates          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * Flow:
 * 1. Select COMMAND (init, dev, build, start, update)
 * 2. Select TEMPLATES to apply (js, ts, rust-js, rust-ts) - multi-select
 * 3. Execute in parallel with real-time progress dashboard
 * 
 * Extensions are handled separately (create ext, run ext)
 * 
 * Error logging: build/log.txt with detailed error info
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import readline from "readline";

// ═══════════════════════════════════════════════════════════════════════════
// COLORS & STYLING
// ═══════════════════════════════════════════════════════════════════════════

const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
};

const c = {
    reset: (t) => `${colors.reset}${t}${colors.reset}`,
    bold: (t) => `${colors.bold}${t}${colors.reset}`,
    dim: (t) => `${colors.dim}${t}${colors.reset}`,
    red: (t) => `${colors.red}${t}${colors.reset}`,
    green: (t) => `${colors.green}${t}${colors.reset}`,
    yellow: (t) => `${colors.yellow}${t}${colors.reset}`,
    blue: (t) => `${colors.blue}${t}${colors.reset}`,
    magenta: (t) => `${colors.magenta}${t}${colors.reset}`,
    cyan: (t) => `${colors.cyan}${t}${colors.reset}`,
    white: (t) => `${colors.white}${t}${colors.reset}`,
    gray: (t) => `${colors.gray}${t}${colors.reset}`,
    success: (t) => `${colors.bold}${colors.green}✔ ${t}${colors.reset}`,
    error: (t) => `${colors.bold}${colors.red}✖ ${t}${colors.reset}`,
    warning: (t) => `${colors.bold}${colors.yellow}⚠ ${t}${colors.reset}`,
    info: (t) => `${colors.bold}${colors.blue}ℹ ${t}${colors.reset}`,
};

// ═══════════════════════════════════════════════════════════════════════════
// LOGGER - Writes detailed errors to log.txt
// ═══════════════════════════════════════════════════════════════════════════

class Logger {
    constructor(logDir) {
        this.logDir = logDir;
        this.logFile = path.join(logDir, "log.txt");
        this.sessionStart = new Date();
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        const header = this._createSessionHeader();
        fs.appendFileSync(this.logFile, header);
        this.initialized = true;
    }

    _createSessionHeader() {
        const now = this.sessionStart;
        const sep = "═".repeat(80);
        
        return `
${sep}
 TITANPL CLI HELPER - ERROR LOG
 Session: ${now.toISOString()}
 Platform: ${process.platform} (${process.arch}) | Node.js: ${process.version}
${sep}

`;
    }

    logError({ template, command, step, error, stderr, stdout, exitCode, workingDir, duration }) {
        if (!this.initialized) this.init();

        const timestamp = new Date().toISOString();
        const sep = "─".repeat(80);

        let entry = `
${sep}
[ERROR] ${timestamp}
${sep}

📋 ERROR SOURCE
${sep}
  Template:      ${template || "N/A"}
  Command:       ${command || "N/A"}
  Step:          ${step || "N/A"}
  Directory:     ${workingDir || "N/A"}
  Exit Code:     ${exitCode !== undefined ? exitCode : "N/A"}
  Duration:      ${duration ? `${duration}ms` : "N/A"}

❌ ERROR MESSAGE
${sep}
${error || "No error message"}

`;

        if (stderr && stderr.trim()) {
            entry += `📛 STDERR
${sep}
${stderr.trim()}

`;
        }

        if (stdout && stdout.trim()) {
            entry += `📄 STDOUT
${sep}
${stdout.trim()}

`;
        }

        entry += `
${sep}

`;

        fs.appendFileSync(this.logFile, entry);
        return this.logFile;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SPINNER FRAMES
// ═══════════════════════════════════════════════════════════════════════════

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ═══════════════════════════════════════════════════════════════════════════
// SIMPLE SPINNER (for single operations)
// ═══════════════════════════════════════════════════════════════════════════

class Spinner {
    constructor(text = "") {
        this.text = text;
        this.frameIndex = 0;
        this.interval = null;
    }

    start() {
        this.interval = setInterval(() => {
            const frame = spinnerFrames[this.frameIndex];
            process.stdout.clearLine?.(0);
            process.stdout.cursorTo?.(0);
            process.stdout.write(`  ${c.cyan(frame)} ${this.text}`);
            this.frameIndex = (this.frameIndex + 1) % spinnerFrames.length;
        }, 80);
        return this;
    }

    update(text) { this.text = text; }

    succeed(text) {
        this.stop();
        console.log(`  ${c.success(text || this.text)}`);
    }

    fail(text) {
        this.stop();
        console.log(`  ${c.error(text || this.text)}`);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            process.stdout.clearLine?.(0);
            process.stdout.cursorTo?.(0);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS DASHBOARD - Multi-template progress tracking
// ═══════════════════════════════════════════════════════════════════════════

class ProgressDashboard {
    constructor(templateKeys, templatesConfig) {
        this.templateKeys = templateKeys;
        this.templatesConfig = templatesConfig;
        this.states = new Map();
        this.frameIndex = 0;
        this.interval = null;
        this.startTimes = new Map();
        this.globalStartTime = Date.now();
        
        // Initialize states for each template
        templateKeys.forEach(tpl => {
            this.states.set(tpl, {
                status: "waiting",  // waiting, running, success, error
                step: "Waiting...",
                startTime: null,
                endTime: null,
            });
        });
    }

    start() {
        // Hide cursor
        process.stdout.write("\x1b[?25l");
        
        // Start animation interval
        this.interval = setInterval(() => {
            this.frameIndex = (this.frameIndex + 1) % spinnerFrames.length;
            this._render();
        }, 80);
        
        return this;
    }

    update(templateKey, status, step) {
        const state = this.states.get(templateKey);
        if (state) {
            // Track timing
            if (status === "running" && state.status !== "running") {
                state.startTime = Date.now();
            }
            if ((status === "success" || status === "error") && !state.endTime) {
                state.endTime = Date.now();
            }
            
            state.status = status;
            state.step = step;
        }
    }

    _formatDuration(ms) {
        if (ms < 1000) return `${ms}ms`;
        const seconds = (ms / 1000).toFixed(1);
        return `${seconds}s`;
    }

    _render() {
        // Move cursor up to redraw all lines
        const totalLines = this.templateKeys.length + 2; // templates + header + separator
        process.stdout.write(`\x1b[${totalLines}A`);
        
        // Header with elapsed time
        const elapsed = this._formatDuration(Date.now() - this.globalStartTime);
        process.stdout.write("\x1b[2K"); // Clear line
        console.log(c.dim(`  ⏱ Elapsed: ${elapsed}`));
        
        // Separator
        process.stdout.write("\x1b[2K");
        console.log(c.gray("  " + "─".repeat(56)));
        
        // Render each template row
        this.templateKeys.forEach((tplKey) => {
            const tpl = this.templatesConfig[tplKey];
            const state = this.states.get(tplKey);
            
            // Clear line
            process.stdout.write("\x1b[2K");
            
            // Build status indicator and step text
            let statusIcon;
            let stepText;
            let duration = "";
            
            switch (state.status) {
                case "waiting":
                    statusIcon = c.gray("⏳");
                    stepText = c.gray(state.step);
                    break;
                case "running":
                    statusIcon = c.cyan(spinnerFrames[this.frameIndex]);
                    stepText = c.white(state.step);
                    if (state.startTime) {
                        duration = c.dim(` (${this._formatDuration(Date.now() - state.startTime)})`);
                    }
                    break;
                case "success":
                    statusIcon = c.green("✔");
                    stepText = c.green(state.step);
                    if (state.startTime && state.endTime) {
                        duration = c.dim(` (${this._formatDuration(state.endTime - state.startTime)})`);
                    }
                    break;
                case "error":
                    statusIcon = c.red("✖");
                    stepText = c.red(state.step);
                    if (state.startTime && state.endTime) {
                        duration = c.dim(` (${this._formatDuration(state.endTime - state.startTime)})`);
                    }
                    break;
            }
            
            // Format: emoji + name (padded) + status icon + step + duration
            const templateLabel = `${tpl.emoji} ${c[tpl.color](tpl.name.padEnd(18))}`;
            console.log(`  ${templateLabel} ${statusIcon} ${stepText}${duration}`);
        });
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        // Final render to show completed state
        this._render();
        // Show cursor
        process.stdout.write("\x1b[?25h");
    }

    // Check if all templates are done
    isComplete() {
        return [...this.states.values()].every(
            s => s.status === "success" || s.status === "error"
        );
    }

    // Get results summary
    getSummary() {
        const successful = this.templateKeys.filter(k => this.states.get(k).status === "success");
        const failed = this.templateKeys.filter(k => this.states.get(k).status === "error");
        const totalDuration = Date.now() - this.globalStartTime;
        
        return {
            successful: successful.length,
            failed: failed.length,
            total: this.templateKeys.length,
            duration: totalDuration,
            failedTemplates: failed,
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const TEMPLATES = {
    js: {
        name: "JavaScript",
        description: "Standard JavaScript template",
        port: 3001,
        emoji: "📜",
        color: "yellow",
    },
    ts: {
        name: "TypeScript", 
        description: "Standard TypeScript template",
        port: 3002,
        emoji: "📘",
        color: "blue",
    },
    "rust-js": {
        name: "Rust + JavaScript",
        description: "Hybrid Rust + JS template",
        port: 3003,
        emoji: "🦀",
        color: "red",
    },
    "rust-ts": {
        name: "Rust + TypeScript",
        description: "Hybrid Rust + TS template",
        port: 3004,
        emoji: "🦀",
        color: "magenta",
    },
};

const COMMANDS = {
    init: {
        name: "init",
        description: "Create new Titan project",
        emoji: "🚀",
        needsExistingProject: false,
    },
    dev: {
        name: "dev",
        description: "Start development server (hot reload)",
        emoji: "🔥",
        needsExistingProject: true,
    },
    build: {
        name: "build",
        description: "Build for production",
        emoji: "📦",
        needsExistingProject: true,
    },
    start: {
        name: "start",
        description: "Start production server",
        emoji: "▶️",
        needsExistingProject: true,
    },
    update: {
        name: "update",
        description: "Update Titan engine",
        emoji: "🔄",
        needsExistingProject: true,
    },
};

const EXTENSION_COMMANDS = {
    "create-ext": {
        name: "create ext",
        description: "Create new Titan extension",
        emoji: "🧩",
    },
    "run-ext": {
        name: "run ext", 
        description: "Test extension with titanpl-sdk",
        emoji: "🧪",
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTIVE MENUS
// ═══════════════════════════════════════════════════════════════════════════

function printBanner() {
    console.log(`
${c.cyan("╔═══════════════════════════════════════════════════════════════════════════╗")}
${c.cyan("║")}  ${c.bold(c.yellow("🪐"))} ${c.bold(c.white("TITANPL CLI HELPER"))} ${c.dim("v2.1.0")}                                         ${c.cyan("║")}
${c.cyan("║")}  ${c.dim("Interactive Assistant for Titan Planet")}                                   ${c.cyan("║")}
${c.cyan("╚═══════════════════════════════════════════════════════════════════════════╝")}`);
}

async function singleSelect(title, options, includeBack = false) {
    return new Promise((resolve) => {
        let cursor = 0;
        const items = Object.keys(options).filter(k => !k.startsWith("__sep"));
        if (includeBack) items.push("__back__");

        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) process.stdin.setRawMode(true);

        const render = () => {
            console.clear();
            printBanner();
            console.log();
            console.log(c.bold(c.cyan(`  ${title}`)));
            console.log(c.dim("  (↑↓ navigate, Enter select, Ctrl+C exit)"));
            console.log();

            items.forEach((key, index) => {
                const isCursor = cursor === index;
                const pointer = isCursor ? c.cyan("❯") : " ";

                if (key === "__back__") {
                    const label = isCursor ? c.bold(c.gray("← Back")) : c.gray("← Back");
                    console.log(`  ${pointer} ${label}`);
                } else {
                    const opt = options[key];
                    const emoji = opt.emoji || "";
                    const name = isCursor ? c.bold(c.white(opt.name)) : c.white(opt.name);
                    const desc = c.dim(`- ${opt.description}`);
                    console.log(`  ${pointer} ${emoji} ${name} ${desc}`);
                }
            });
        };

        const handleKey = (str, key) => {
            if (key.ctrl && key.name === "c") {
                process.stdin.setRawMode(false);
                console.log("\n" + c.warning("Operation cancelled"));
                process.exit(0);
            }

            if (key.name === "up") cursor = (cursor - 1 + items.length) % items.length;
            else if (key.name === "down") cursor = (cursor + 1) % items.length;
            else if (key.name === "return") {
                process.stdin.setRawMode(false);
                process.stdin.removeListener("keypress", handleKey);
                const selected = items[cursor];
                resolve(selected === "__back__" ? null : selected);
                return;
            }
            render();
        };

        process.stdin.on("keypress", handleKey);
        render();
    });
}

async function multiSelect(title, options) {
    return new Promise((resolve) => {
        const selected = new Set();
        let cursor = 0;
        const items = [...Object.keys(options), "__all__"];

        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) process.stdin.setRawMode(true);

        const render = () => {
            console.clear();
            printBanner();
            console.log();
            console.log(c.bold(c.cyan(`  ${title}`)));
            console.log(c.dim("  (↑↓ navigate, Space select, Enter confirm)"));
            console.log();

            items.forEach((key, index) => {
                const isCursor = cursor === index;
                const pointer = isCursor ? c.cyan("❯") : " ";

                if (key === "__all__") {
                    const allSelected = Object.keys(options).every(k => selected.has(k));
                    const checkbox = allSelected ? c.green("◉") : c.dim("○");
                    const label = isCursor ? c.bold(c.cyan("✨ SELECT ALL")) : c.white("✨ Select All");
                    console.log(`  ${pointer} ${checkbox} ${label}`);
                } else {
                    const opt = options[key];
                    const isSelected = selected.has(key);
                    const checkbox = isSelected ? c.green("◉") : c.dim("○");
                    const emoji = opt.emoji || "";
                    const name = isCursor ? c.bold(c[opt.color || "white"](opt.name)) : c[opt.color || "white"](opt.name);
                    const port = c.gray(`(port: ${opt.port})`);
                    console.log(`  ${pointer} ${checkbox} ${emoji} ${name} ${port}`);
                }
            });

            console.log();
            const count = selected.size;
            console.log(c.dim(`  ${count} template(s) selected`));
        };

        const handleKey = (str, key) => {
            if (key.ctrl && key.name === "c") {
                process.stdin.setRawMode(false);
                console.log("\n" + c.warning("Operation cancelled"));
                process.exit(0);
            }

            if (key.name === "up") cursor = (cursor - 1 + items.length) % items.length;
            else if (key.name === "down") cursor = (cursor + 1) % items.length;
            else if (key.name === "space") {
                const currentItem = items[cursor];
                if (currentItem === "__all__") {
                    const allKeys = Object.keys(options);
                    const allSelected = allKeys.every(k => selected.has(k));
                    if (allSelected) allKeys.forEach(k => selected.delete(k));
                    else allKeys.forEach(k => selected.add(k));
                } else {
                    if (selected.has(currentItem)) selected.delete(currentItem);
                    else selected.add(currentItem);
                }
            } else if (key.name === "return") {
                process.stdin.setRawMode(false);
                process.stdin.removeListener("keypress", handleKey);
                resolve([...selected]);
                return;
            }
            render();
        };

        process.stdin.on("keypress", handleKey);
        render();
    });
}

async function promptText(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(`  ${c.cyan("?")} ${question}: `, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function copyDir(src, dest, excludes = []) {
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
        if (excludes.includes(file)) continue;
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);
        if (fs.lstatSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath, excludes);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function updateAppPort(appFile, newPort) {
    if (!fs.existsSync(appFile)) return false;
    let content = fs.readFileSync(appFile, "utf8");
    content = content.replace(/t\.start\s*\(\s*3000\s*,/g, `t.start(${newPort},`);
    fs.writeFileSync(appFile, content);
    return true;
}

function runCommand(cmd, cwd, env = {}) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "cmd.exe" : "/bin/sh";
        const shellArgs = isWindows ? ["/c", cmd] : ["-c", cmd];

        const child = spawn(shell, shellArgs, {
            cwd,
            env: { ...process.env, ...env },
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (data) => { stdout += data.toString(); });
        child.stderr?.on("data", (data) => { stderr += data.toString(); });

        child.on("close", (code) => {
            const duration = Date.now() - startTime;
            if (code === 0) {
                resolve({ success: true, stdout, stderr, duration });
            } else {
                reject({ success: false, exitCode: code, stdout, stderr, duration });
            }
        });

        child.on("error", (error) => {
            const duration = Date.now() - startTime;
            reject({ success: false, error: error.message, stdout, stderr, duration });
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND EXECUTION WITH DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

async function executeForTemplateWithDashboard(commandKey, templateKey, buildDir, templatesDir, commonDir, logger, dashboard) {
    const command = COMMANDS[commandKey];
    const template = TEMPLATES[templateKey];
    const targetDir = path.join(buildDir, templateKey);

    const result = {
        template: templateKey,
        command: commandKey,
        success: true,
        port: template.port,
        steps: [],
    };

    // Update dashboard: starting
    dashboard.update(templateKey, "running", `Starting ${command.name}...`);

    try {
        // ─────────────────────────────────────────────────────────────────────
        // INIT: Create project structure
        // ─────────────────────────────────────────────────────────────────────
        if (commandKey === "init") {
            dashboard.update(templateKey, "running", "Creating structure...");

            // Clean if exists
            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
            fs.mkdirSync(targetDir, { recursive: true });

            // Copy common
            if (fs.existsSync(commonDir)) {
                copyDir(commonDir, targetDir, ["_gitignore", "_dockerignore"]);
                const dotfiles = { "_gitignore": ".gitignore", "_dockerignore": ".dockerignore" };
                for (const [src, dest] of Object.entries(dotfiles)) {
                    const srcPath = path.join(commonDir, src);
                    if (fs.existsSync(srcPath)) {
                        fs.copyFileSync(srcPath, path.join(targetDir, dest));
                    }
                }
            }

            // Copy specific template
            dashboard.update(templateKey, "running", "Copying template files...");
            const specificDir = path.join(templatesDir, templateKey);
            if (fs.existsSync(specificDir)) {
                copyDir(specificDir, targetDir);
            }

            // Update port
            dashboard.update(templateKey, "running", "Configuring port...");
            const appJs = path.join(targetDir, "app", "app.js");
            const appTs = path.join(targetDir, "app", "app.ts");
            if (fs.existsSync(appTs)) updateAppPort(appTs, template.port);
            else if (fs.existsSync(appJs)) updateAppPort(appJs, template.port);

            // Update package.json with metadata
            const pkgPath = path.join(targetDir, "package.json");
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                if (!pkg.titan) pkg.titan = {};
                pkg.titan.template = templateKey;
                fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
            }

            result.steps.push({ name: "create", success: true });

            // npm install
            dashboard.update(templateKey, "running", "npm install...");

            try {
                await runCommand("npm install", targetDir);
                result.steps.push({ name: "npm install", success: true });
                dashboard.update(templateKey, "success", `Done → Port ${template.port}`);
            } catch (err) {
                result.success = false;
                result.steps.push({ name: "npm install", success: false, error: err });
                dashboard.update(templateKey, "error", "npm install failed");
                
                logger.logError({
                    template: templateKey,
                    command: "npm install",
                    step: "install",
                    error: err.error || "npm install failed",
                    stderr: err.stderr,
                    stdout: err.stdout,
                    exitCode: err.exitCode,
                    workingDir: targetDir,
                    duration: err.duration,
                });
            }
        }
        // ─────────────────────────────────────────────────────────────────────
        // DEV / BUILD / START / UPDATE: Execute on existing project
        // ─────────────────────────────────────────────────────────────────────
        else {
            if (!fs.existsSync(targetDir)) {
                dashboard.update(templateKey, "error", "Project not found");
                result.success = false;
                result.steps.push({ name: commandKey, success: false, error: "Project not found" });
                return result;
            }

            const titanCmd = `titan ${commandKey}`;
            dashboard.update(templateKey, "running", `${titanCmd}...`);

            try {
                await runCommand(titanCmd, targetDir);
                result.steps.push({ name: commandKey, success: true });
                dashboard.update(templateKey, "success", `${command.name} completed`);
            } catch (err) {
                result.success = false;
                result.steps.push({ name: commandKey, success: false, error: err });
                dashboard.update(templateKey, "error", `${command.name} failed`);

                logger.logError({
                    template: templateKey,
                    command: titanCmd,
                    step: commandKey,
                    error: err.error || `${command.name} failed`,
                    stderr: err.stderr,
                    stdout: err.stdout,
                    exitCode: err.exitCode,
                    workingDir: targetDir,
                    duration: err.duration,
                });
            }
        }

    } catch (error) {
        result.success = false;
        result.error = error.message;
        dashboard.update(templateKey, "error", `Error: ${error.message.slice(0, 25)}...`);
        
        logger.logError({
            template: templateKey,
            command: commandKey,
            step: "unexpected",
            error: error.message,
            workingDir: targetDir,
        });
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

async function executeExtensionCommand(commandKey, buildDir, logger) {
    const command = EXTENSION_COMMANDS[commandKey];

    console.log();
    console.log(`${command.emoji} ${c.bold(c.cyan(`[Extension]`))} ${c.white(command.description)}...`);

    if (commandKey === "create-ext") {
        const name = await promptText("Extension name");
        if (!name) {
            console.log(`  ${c.warning("Name required")}`);
            return { success: false };
        }

        const extTargetDir = path.join(buildDir, "extension");
        const spinner = new Spinner(`Creating extension '${name}'...`);
        spinner.start();

        try {
            // Create using titan create ext from buildDir
            await runCommand(`titan create ext ${name}`, buildDir);
            
            // Move to build/extension if created with another name
            const createdDir = path.join(buildDir, name);
            if (fs.existsSync(createdDir)) {
                if (fs.existsSync(extTargetDir)) {
                    fs.rmSync(extTargetDir, { recursive: true, force: true });
                }
                fs.renameSync(createdDir, extTargetDir);
            }

            spinner.succeed(`Extension '${name}' created in build/extension`);

            // npm install
            const installSpinner = new Spinner("Installing dependencies...");
            installSpinner.start();

            try {
                await runCommand("npm install", extTargetDir);
                installSpinner.succeed("Dependencies installed");
            } catch (err) {
                installSpinner.fail("Error in npm install");
                logger.logError({
                    template: "extension",
                    command: "npm install",
                    step: "install",
                    error: err.error || "npm install failed",
                    stderr: err.stderr,
                    stdout: err.stdout,
                    exitCode: err.exitCode,
                    workingDir: extTargetDir,
                    duration: err.duration,
                });
            }

            // Build native if exists
            const nativeDir = path.join(extTargetDir, "native");
            if (fs.existsSync(path.join(nativeDir, "Cargo.toml"))) {
                const nativeSpinner = new Spinner("Compiling native module (cargo build --release)...");
                nativeSpinner.start();

                try {
                    await runCommand("cargo build --release", nativeDir);
                    nativeSpinner.succeed("Native module compiled");
                } catch (err) {
                    nativeSpinner.fail("Error compiling native module");
                    logger.logError({
                        template: "extension",
                        command: "cargo build --release",
                        step: "native-build",
                        error: err.error || "Cargo build failed",
                        stderr: err.stderr,
                        stdout: err.stdout,
                        exitCode: err.exitCode,
                        workingDir: nativeDir,
                        duration: err.duration,
                    });
                }
            }

            return { success: true, path: extTargetDir };
        } catch (err) {
            spinner.fail("Error creating extension");
            logger.logError({
                template: "extension",
                command: `titan create ext ${name}`,
                step: "create-ext",
                error: err.error || "Create extension failed",
                stderr: err.stderr,
                stdout: err.stdout,
                exitCode: err.exitCode,
                workingDir: buildDir,
                duration: err.duration,
            });
            return { success: false };
        }
    } 
    else if (commandKey === "run-ext") {
        const extDir = path.join(buildDir, "extension");
        
        if (!fs.existsSync(extDir) || !fs.existsSync(path.join(extDir, "titan.json"))) {
            console.log(`  ${c.warning("No extension found in build/extension. Create one first with 'create ext'.")}`);
            return { success: false };
        }

        const spinner = new Spinner(`Running: titan run ext...`);
        spinner.start();

        try {
            await runCommand("titan run ext", extDir);
            spinner.succeed("Extension test completed");
            return { success: true };
        } catch (err) {
            spinner.fail("Error running extension");
            logger.logError({
                template: "extension",
                command: "titan run ext",
                step: "run-ext",
                error: err.error || "Run extension failed",
                stderr: err.stderr,
                stdout: err.stdout,
                exitCode: err.exitCode,
                workingDir: extDir,
                duration: err.duration,
            });
            return { success: false };
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN MENU
// ═══════════════════════════════════════════════════════════════════════════

async function mainMenu(rootDir, buildDir, logger) {
    const templatesDir = path.join(rootDir, "templates");
    const commonDir = path.join(templatesDir, "common");

    while (true) {
        // Main menu: Templates or Extensions?
        const mainOptions = {
            templates: {
                name: "📦 Template Commands",
                description: "init, dev, build, start, update",
                emoji: "",
            },
            extensions: {
                name: "🧩 Extension Commands",
                description: "create ext, run ext (titanpl-sdk)",
                emoji: "",
            },
            exit: {
                name: "👋 Exit",
                description: "Close the assistant",
                emoji: "",
            },
        };

        const mainChoice = await singleSelect("What would you like to do?", mainOptions);

        if (!mainChoice || mainChoice === "exit") {
            console.clear();
            console.log(c.cyan("\n  👋 Goodbye!\n"));
            break;
        }

        // ─────────────────────────────────────────────────────────────────────
        // EXTENSIONS
        // ─────────────────────────────────────────────────────────────────────
        if (mainChoice === "extensions") {
            const extCommandKey = await singleSelect("Which extension command?", EXTENSION_COMMANDS, true);
            
            if (!extCommandKey) continue;

            console.clear();
            printBanner();
            await executeExtensionCommand(extCommandKey, buildDir, logger);
            
            console.log();
            await promptText("Press Enter to continue");
            continue;
        }

        // ─────────────────────────────────────────────────────────────────────
        // TEMPLATES: First command, then templates
        // ─────────────────────────────────────────────────────────────────────
        const commandKey = await singleSelect("Which command do you want to run?", COMMANDS, true);
        
        if (!commandKey) continue;

        // Select templates
        const selectedTemplates = await multiSelect(
            `Select templates for '${COMMANDS[commandKey].name}'`,
            TEMPLATES
        );

        if (selectedTemplates.length === 0) {
            console.log(`  ${c.warning("You didn't select any templates")}`);
            await promptText("Press Enter to continue");
            continue;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Execute in parallel with dashboard
        // ─────────────────────────────────────────────────────────────────────
        console.clear();
        printBanner();
        
        console.log();
        console.log(c.cyan("═".repeat(60)));
        console.log(`${COMMANDS[commandKey].emoji} ${c.bold(c.white(`Running '${COMMANDS[commandKey].name}' on ${selectedTemplates.length} template(s)`))}`)
        console.log(c.cyan("═".repeat(60)));
        console.log();

        // Create dashboard
        const dashboard = new ProgressDashboard(selectedTemplates, TEMPLATES);
        
        // Print empty lines for dashboard (header + separator + templates)
        console.log(); // Elapsed time header
        console.log(); // Separator
        selectedTemplates.forEach(() => console.log()); // Template rows
        
        dashboard.start();

        // Execute all in parallel
        const promises = selectedTemplates.map(tpl => 
            executeForTemplateWithDashboard(commandKey, tpl, buildDir, templatesDir, commonDir, logger, dashboard)
        );

        const results = await Promise.all(promises);
        
        dashboard.stop();

        // ─────────────────────────────────────────────────────────────────────
        // Summary
        // ─────────────────────────────────────────────────────────────────────
        const summary = dashboard.getSummary();
        const durationSec = (summary.duration / 1000).toFixed(2);

        console.log();
        console.log(c.cyan("═".repeat(60)));
        console.log(c.bold("📊 SUMMARY"));
        console.log(c.cyan("─".repeat(60)));

        results.forEach(r => {
            const tpl = TEMPLATES[r.template];
            const status = r.success ? c.green("✔ OK") : c.red("✖ FAIL");
            const port = r.success && commandKey === "init" ? c.gray(`→ Port ${r.port}`) : "";
            console.log(`  ${tpl.emoji} ${c[tpl.color](tpl.name.padEnd(20))} ${status} ${port}`);
        });

        console.log(c.cyan("─".repeat(60)));
        console.log(`  ${c.green(`✔ Successful: ${summary.successful}`)}  ${c.red(`✖ Failed: ${summary.failed}`)}  ${c.gray(`⏱ Total: ${durationSec}s`)}`);

        if (summary.failed > 0) {
            console.log();
            console.log(c.yellow(`  📄 See error details at: ${logger.logFile}`));
        }

        console.log(c.cyan("═".repeat(60)));
        console.log();
        await promptText("Press Enter to continue");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    // Find project root directory
    let rootDir = process.cwd();
    const templatesPath = path.join(rootDir, "templates");
    
    if (!fs.existsSync(templatesPath)) {
        rootDir = path.dirname(rootDir);
        if (!fs.existsSync(path.join(rootDir, "templates"))) {
            console.log(c.error("templates/ directory not found"));
            console.log(c.dim("Run this script from the titanpl root directory"));
            process.exit(1);
        }
    }

    const buildDir = path.join(rootDir, "build");
    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
    }

    const logger = new Logger(buildDir);

    await mainMenu(rootDir, buildDir, logger);
}

main().catch(error => {
    console.error(c.error(`Fatal error: ${error.message}`));
    process.exit(1);
});
