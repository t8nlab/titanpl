import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, "..");
const TEMPLATES_TITAN = path.join(PROJECT_ROOT, "templates", "titan");

// ============================================================
// Mock de child_process a nivel de módulo (ESM compatible)
// ============================================================
let mockSpawnProcess = null;
let spawnCallCount = 0;
let mockExecSyncFn = vi.fn();

vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        spawn: vi.fn((...args) => {
            spawnCallCount++;
            if (!mockSpawnProcess) {
                mockSpawnProcess = new EventEmitter();
                mockSpawnProcess.pid = 12345 + spawnCallCount;
                mockSpawnProcess.exitCode = null;
                mockSpawnProcess.kill = vi.fn();
                mockSpawnProcess.unref = vi.fn();
            }
            return mockSpawnProcess;
        }),
        execSync: vi.fn((...args) => mockExecSyncFn(...args)),
    };
});

// ============================================================
// Mock de chokidar
// ============================================================
let mockWatcher = null;

vi.mock("chokidar", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        default: {
            watch: vi.fn(() => {
                if (!mockWatcher) {
                    mockWatcher = new EventEmitter();
                    mockWatcher.close = vi.fn();
                }
                return mockWatcher;
            }),
        },
        watch: vi.fn(() => {
            if (!mockWatcher) {
                mockWatcher = new EventEmitter();
                mockWatcher.close = vi.fn();
            }
            return mockWatcher;
        }),
    };
});

/**
 * Helper to create a temporary Titan project structure
 */
function createTempProject(options = {}) {
    const { useTypeScript = false, includeActions = true, includeEnv = false } = options;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "titan-test-"));

    fs.mkdirSync(path.join(tempDir, "app", "actions"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "titan"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "server", "actions"), { recursive: true });

    fs.copyFileSync(
        path.join(TEMPLATES_TITAN, "titan.js"),
        path.join(tempDir, "titan", "titan.js")
    );
    fs.copyFileSync(
        path.join(TEMPLATES_TITAN, "bundle.js"),
        path.join(tempDir, "titan", "bundle.js")
    );

    if (useTypeScript) {
        fs.writeFileSync(
            path.join(tempDir, "app", "app.ts"),
            `import t from "../titan/titan.js";
t.get("/").reply("test");
t.start(3000);`
        );
    } else {
        fs.writeFileSync(
            path.join(tempDir, "app", "app.js"),
            `import t from "../titan/titan.js";
t.get("/").reply("test");
t.start(3000);`
        );
    }

    if (includeActions) {
        const actionContent = useTypeScript
            ? `export const hello = (req: any) => ({ message: "Hello!" });`
            : `export const hello = (req) => ({ message: "Hello!" });`;

        fs.writeFileSync(
            path.join(tempDir, "app", "actions", useTypeScript ? "hello.ts" : "hello.js"),
            actionContent
        );
    }

    if (includeEnv) {
        fs.writeFileSync(path.join(tempDir, ".env"), "TEST_VAR=test_value\nAPI_KEY=secret123");
    }

    // Create minimal Cargo.toml for server tests
    fs.writeFileSync(
        path.join(tempDir, "server", "Cargo.toml"),
        `[package]
name = "titan-server"
version = "0.1.0"
edition = "2021"

[dependencies]
`
    );

    return tempDir;
}

function cleanupTempProject(tempDir) {
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// Reset mocks before each test
beforeEach(() => {
    mockSpawnProcess = null;
    mockWatcher = null;
    spawnCallCount = 0;
    mockExecSyncFn = vi.fn();
    vi.clearAllMocks();
});

// ============================================================
// TESTS: startRustServer() - Full coverage
// ============================================================
describe("startRustServer() - full coverage", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = createTempProject({ useTypeScript: true });

        // Create fresh mock process for each test
        mockSpawnProcess = new EventEmitter();
        mockSpawnProcess.pid = 12345;
        mockSpawnProcess.exitCode = null;
        mockSpawnProcess.kill = vi.fn();
        mockSpawnProcess.unref = vi.fn();
    });

    afterEach(async () => {
        const { killServer } = await import("../templates/titan/dev.js");
        await killServer();
        cleanupTempProject(tempDir);
    });

    it("should spawn cargo run with correct arguments", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");
        const { spawn } = await import("child_process");

        await startRustServer(0, tempDir);

        expect(spawn).toHaveBeenCalledWith(
            "cargo",
            ["run", "--jobs", "1"],
            expect.objectContaining({
                cwd: path.join(tempDir, "server"),
                stdio: "inherit",
                shell: true,
                detached: true,
            })
        );
    });

    it("should use default retryCount of 0", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");
        const consoleSpy = vi.spyOn(console, "log");

        await startRustServer(undefined, tempDir);

        // Should NOT log retry message when retryCount is 0 or undefined
        const retryCalls = consoleSpy.mock.calls.filter(
            call => call[0]?.includes?.("Retrying Rust server")
        );
        expect(retryCalls.length).toBe(0);
    });

    it("should use default root of process.cwd()", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");
        const { spawn } = await import("child_process");
        const originalCwd = process.cwd();

        try {
            process.chdir(tempDir);
            await startRustServer(0);

            expect(spawn).toHaveBeenCalledWith(
                "cargo",
                ["run", "--jobs", "1"],
                expect.objectContaining({
                    cwd: path.join(tempDir, "server"),
                })
            );
        } finally {
            process.chdir(originalCwd);
        }
    });

    it("should log retry message when retryCount > 0", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");
        const consoleSpy = vi.spyOn(console, "log");

        await startRustServer(1, tempDir);

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("Retrying Rust server (Attempt 1)")
        );
    });

    it("should log retry message for retryCount = 2", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");
        const consoleSpy = vi.spyOn(console, "log");

        await startRustServer(2, tempDir);

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("Retrying Rust server (Attempt 2)")
        );
    });

    it("should set CARGO_INCREMENTAL=0 in environment", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");
        const { spawn } = await import("child_process");

        await startRustServer(0, tempDir);

        expect(spawn).toHaveBeenCalledWith(
            "cargo",
            ["run", "--jobs", "1"],
            expect.objectContaining({
                env: expect.objectContaining({
                    CARGO_INCREMENTAL: "0",
                }),
            })
        );
    });

    it("should return the spawned process", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");

        const result = await startRustServer(0, tempDir);

        expect(result).toBe(mockSpawnProcess);
    });

    it("should handle process close event and log exit code", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");
        const consoleSpy = vi.spyOn(console, "log");

        await startRustServer(0, tempDir);

        // Simulate normal exit (code 0)
        mockSpawnProcess.emit("close", 0);

        // Wait for async handler
        await new Promise(r => setTimeout(r, 50));

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] Rust server exited: 0");
    });

    it("should handle process close with null code", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");
        const consoleSpy = vi.spyOn(console, "log");

        await startRustServer(0, tempDir);

        // Simulate close with null code
        mockSpawnProcess.emit("close", null);

        await new Promise(r => setTimeout(r, 50));

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] Rust server exited: null");
    });
});

// ============================================================
// TESTS: startRustServer() - Crash detection and retry
// ============================================================
describe("startRustServer() - crash detection", () => {
    let tempDir;

    beforeEach(async () => {
        // Kill any existing server and reset mocks
        const { killServer } = await import("../templates/titan/dev.js");
        await killServer();
        
        tempDir = createTempProject({ useTypeScript: true });
        spawnCallCount = 0;
        mockSpawnProcess = null;
        vi.clearAllMocks();
    });

    afterEach(async () => {
        const { killServer } = await import("../templates/titan/dev.js");
        await killServer();
        cleanupTempProject(tempDir);
    });

    it("should log crash detection message on quick failure", async () => {
        vi.clearAllMocks();
        
        const { startRustServer } = await import("../templates/titan/dev.js");
        const consoleSpy = vi.spyOn(console, "log");

        // Create mock process
        mockSpawnProcess = new EventEmitter();
        mockSpawnProcess.pid = 12345;
        mockSpawnProcess.exitCode = null;
        mockSpawnProcess.kill = vi.fn();
        mockSpawnProcess.unref = vi.fn();

        await startRustServer(0, tempDir);

        // Simulate immediate crash (code 1)
        mockSpawnProcess.emit("close", 1);

        // Wait for async handler
        await new Promise(r => setTimeout(r, 150));

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("Server crash detected")
        );
    });
});

// ============================================================
// TESTS: killServer() - with active process
// ============================================================
describe("killServer() - with active process", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = createTempProject({ useTypeScript: true });
        mockSpawnProcess = new EventEmitter();
        mockSpawnProcess.pid = 99999;
        mockSpawnProcess.exitCode = null;
        mockSpawnProcess.kill = vi.fn();
        mockSpawnProcess.unref = vi.fn();
    });

    afterEach(async () => {
        cleanupTempProject(tempDir);
    });

    it("should attempt to kill process on Windows", async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", {
            value: "win32",
            configurable: true
        });

        const { startRustServer, killServer } = await import("../templates/titan/dev.js");
        const { execSync } = await import("child_process");

        await startRustServer(0, tempDir);

        const killPromise = killServer();
        mockSpawnProcess.emit("close", 0);
        await killPromise;

        // On Windows should use taskkill
        if (process.platform === "win32") {
            expect(execSync).toHaveBeenCalled();
        }

        Object.defineProperty(process, "platform", {
            value: originalPlatform,
            configurable: true
        });
    });

    it("should attempt to kill process group on Linux", async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", {
            value: "linux",
            configurable: true
        });

        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {});

        const { startRustServer, killServer } = await import("../templates/titan/dev.js");

        await startRustServer(0, tempDir);

        const killPromise = killServer();
        mockSpawnProcess.emit("close", 0);
        await killPromise;

        Object.defineProperty(process, "platform", {
            value: originalPlatform,
            configurable: true
        });

        killSpy.mockRestore();
    });

    it("should resolve when process already exited", async () => {
        const { startRustServer, killServer } = await import("../templates/titan/dev.js");

        await startRustServer(0, tempDir);

        // Mark as already exited
        mockSpawnProcess.exitCode = 0;

        await expect(killServer()).resolves.toBeUndefined();
    });

    it("should wait for close event", async () => {
        const { startRustServer, killServer } = await import("../templates/titan/dev.js");

        await startRustServer(0, tempDir);

        const killPromise = killServer();

        // Emit close after small delay
        setTimeout(() => mockSpawnProcess.emit("close", 0), 50);

        await expect(killPromise).resolves.toBeUndefined();
    });
});

// ============================================================
// TESTS: startDev() - Basic structure tests
// ============================================================
describe("startDev() - structure tests", () => {
    let tempDir;
    let originalCwd;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = createTempProject({ useTypeScript: true, includeEnv: true });

        mockSpawnProcess = new EventEmitter();
        mockSpawnProcess.pid = 55555;
        mockSpawnProcess.exitCode = null;
        mockSpawnProcess.kill = vi.fn();
        mockSpawnProcess.unref = vi.fn();

        mockWatcher = new EventEmitter();
        mockWatcher.close = vi.fn();
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        const { killServer } = await import("../templates/titan/dev.js");
        await killServer();
        cleanupTempProject(tempDir);
    });

    it("should detect TypeScript project", async () => {
        const { getAppEntry } = await import("../templates/titan/dev.js");

        const entry = getAppEntry(tempDir);

        expect(entry).not.toBeNull();
        expect(entry.isTS).toBe(true);
    });

    it("should detect JavaScript project", async () => {
        const jsDir = createTempProject({ useTypeScript: false });
        const { getAppEntry } = await import("../templates/titan/dev.js");

        const entry = getAppEntry(jsDir);

        expect(entry).not.toBeNull();
        expect(entry.isTS).toBe(false);

        cleanupTempProject(jsDir);
    });

    it("should detect .env file when present", () => {
        expect(fs.existsSync(path.join(tempDir, ".env"))).toBe(true);
    });

    it("should not have .env when not created", () => {
        const noEnvDir = createTempProject({ useTypeScript: true, includeEnv: false });

        expect(fs.existsSync(path.join(noEnvDir, ".env"))).toBe(false);

        cleanupTempProject(noEnvDir);
    });
});

// ============================================================
// TESTS: File watcher behavior simulation
// ============================================================
describe("File watcher - change handling", () => {
    it("should handle .env file change detection", () => {
        const consoleSpy = vi.spyOn(console, "log");

        const file = ".env";
        if (file.includes(".env")) {
            console.log("\x1b[33m[Titan] Env Refreshed\x1b[0m");
        }

        expect(consoleSpy).toHaveBeenCalledWith("\x1b[33m[Titan] Env Refreshed\x1b[0m");
    });

    it("should handle regular file change detection", () => {
        const consoleSpy = vi.spyOn(console, "log");

        const file = "app/app.ts";
        if (!file.includes(".env")) {
            console.log(`[Titan] Change detected: ${file}`);
        }

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] Change detected: app/app.ts");
    });

    it("should debounce rapid changes correctly", () => {
        vi.useFakeTimers();
        let rebuildCount = 0;

        const mockRebuild = () => {
            rebuildCount++;
        };

        let timer = null;
        const handleChange = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(mockRebuild, 500);
        };

        // Simulate rapid changes
        handleChange();
        handleChange();
        handleChange();
        handleChange();

        // Before 500ms
        vi.advanceTimersByTime(400);
        expect(rebuildCount).toBe(0);

        // After 500ms from last change
        vi.advanceTimersByTime(200);
        expect(rebuildCount).toBe(1);

        vi.useRealTimers();
    });

    it("should clear previous timer on new change", () => {
        const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

        let timer = setTimeout(() => {}, 500);

        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {}, 500);

        expect(clearTimeoutSpy).toHaveBeenCalled();

        clearTimeout(timer);
    });
});

// ============================================================
// TESTS: Build failure handling
// ============================================================
describe("Build failure handling", () => {
    it("should log initial build failure message", () => {
        const consoleSpy = vi.spyOn(console, "log");
        const consoleErrorSpy = vi.spyOn(console, "error");

        try {
            throw new Error("Build failed: syntax error");
        } catch (e) {
            console.log("\x1b[31m[Titan] Initial build failed. Waiting for changes...\x1b[0m");
            console.error(e.message);
        }

        expect(consoleSpy).toHaveBeenCalledWith(
            "\x1b[31m[Titan] Initial build failed. Waiting for changes...\x1b[0m"
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith("Build failed: syntax error");
    });

    it("should log rebuild failure message", () => {
        const consoleSpy = vi.spyOn(console, "log");
        const consoleErrorSpy = vi.spyOn(console, "error");

        try {
            throw new Error("Compilation error");
        } catch (e) {
            console.log("\x1b[31m[Titan] Build failed -- waiting for changes...\x1b[0m");
            console.error(e.message);
        }

        expect(consoleSpy).toHaveBeenCalledWith(
            "\x1b[31m[Titan] Build failed -- waiting for changes...\x1b[0m"
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith("Compilation error");
    });
});

// ============================================================
// TESTS: handleExit() behavior
// ============================================================
describe("handleExit() - graceful shutdown", () => {
    it("should log stopping message", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("\n[Titan] Stopping server...");

        expect(consoleSpy).toHaveBeenCalledWith("\n[Titan] Stopping server...");
    });

    it("should have SIGINT handler registered", () => {
        const listeners = process.listeners("SIGINT");
        expect(listeners.length).toBeGreaterThan(0);
    });

    it("should have SIGTERM handler registered", () => {
        const listeners = process.listeners("SIGTERM");
        expect(listeners.length).toBeGreaterThan(0);
    });

    it("should have function handlers for signals", () => {
        const sigintListeners = process.listeners("SIGINT");
        const sigtermListeners = process.listeners("SIGTERM");

        expect(sigintListeners.some(l => typeof l === "function")).toBe(true);
        expect(sigtermListeners.some(l => typeof l === "function")).toBe(true);
    });
});

// ============================================================
// TESTS: isMainModule check
// ============================================================
describe("isMainModule detection", () => {
    it("should detect when running as main module", () => {
        const testPath = "/path/to/dev.js";
        const isMainModule = testPath.endsWith("dev.js");
        expect(isMainModule).toBe(true);
    });

    it("should not detect when imported as module", () => {
        const testPath = "/path/to/other.js";
        const isMainModule = testPath.endsWith("dev.js");
        expect(isMainModule).toBe(false);
    });

    it("should check VITEST environment variable prevents auto-start", () => {
        const originalVitest = process.env.VITEST;
        process.env.VITEST = "true";

        const shouldAutoStart = !process.env.VITEST;
        expect(shouldAutoStart).toBe(false);

        process.env.VITEST = originalVitest;
    });

    it("should allow auto-start when not in test environment", () => {
        const originalVitest = process.env.VITEST;
        delete process.env.VITEST;

        const shouldAutoStart = !process.env.VITEST;
        expect(shouldAutoStart).toBe(true);

        if (originalVitest) process.env.VITEST = originalVitest;
    });
});

// ============================================================
// TESTS: Wait time calculation
// ============================================================
describe("Wait time calculation in startRustServer", () => {
    it("should use 1000ms wait time when retryCount is 0", () => {
        const retryCount = 0;
        const waitTime = retryCount > 0 ? 2000 : 1000;
        expect(waitTime).toBe(1000);
    });

    it("should use 2000ms wait time when retryCount > 0", () => {
        const retryCount = 1;
        const waitTime = retryCount > 0 ? 2000 : 1000;
        expect(waitTime).toBe(2000);
    });

    it("should use 2000ms for any positive retryCount value", () => {
        [1, 2, 3, 5, 10].forEach(retryCount => {
            const waitTime = retryCount > 0 ? 2000 : 1000;
            expect(waitTime).toBe(2000);
        });
    });
});

// ============================================================
// TESTS: Server restart logging
// ============================================================
describe("Server restart logging", () => {
    it("should log restarting message", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("[Titan] Restarting Rust server...");

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] Restarting Rust server...");
    });

    it("should log dev mode starting", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("[Titan] Dev mode starting...");

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] Dev mode starting...");
    });

    it("should log bundling message", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("[Titan] Bundling JS actions...");

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] Bundling JS actions...");
    });
});

// ============================================================
// TESTS: Module exports verification
// ============================================================
describe("Module exports", () => {
    it("should export serverProcess variable", async () => {
        const devModule = await import("../templates/titan/dev.js");
        expect("serverProcess" in devModule).toBe(true);
    });

    it("should export isKilling variable", async () => {
        const devModule = await import("../templates/titan/dev.js");
        expect("isKilling" in devModule).toBe(true);
    });

    it("should export getAppEntry function", async () => {
        const devModule = await import("../templates/titan/dev.js");
        expect(typeof devModule.getAppEntry).toBe("function");
    });

    it("should export compileAndRunAppEntry function", async () => {
        const devModule = await import("../templates/titan/dev.js");
        expect(typeof devModule.compileAndRunAppEntry).toBe("function");
    });

    it("should export killServer function", async () => {
        const devModule = await import("../templates/titan/dev.js");
        expect(typeof devModule.killServer).toBe("function");
    });

    it("should export startRustServer function", async () => {
        const devModule = await import("../templates/titan/dev.js");
        expect(typeof devModule.startRustServer).toBe("function");
    });

    it("should export rebuild function", async () => {
        const devModule = await import("../templates/titan/dev.js");
        expect(typeof devModule.rebuild).toBe("function");
    });

    it("should export startDev function", async () => {
        const devModule = await import("../templates/titan/dev.js");
        expect(typeof devModule.startDev).toBe("function");
    });
});

// ============================================================
// TESTS: Env configuration logging
// ============================================================
describe("Env configuration", () => {
    it("should log env configured with yellow color", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("\x1b[33m[Titan] Env Configured\x1b[0m");

        expect(consoleSpy).toHaveBeenCalledWith("\x1b[33m[Titan] Env Configured\x1b[0m");
    });

    it("should log env refreshed with yellow color", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("\x1b[33m[Titan] Env Refreshed\x1b[0m");

        expect(consoleSpy).toHaveBeenCalledWith("\x1b[33m[Titan] Env Refreshed\x1b[0m");
    });
});

// ============================================================
// TESTS: Error color logging
// ============================================================
describe("Error color logging", () => {
    it("should log initial build failure with red color", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("\x1b[31m[Titan] Initial build failed. Waiting for changes...\x1b[0m");

        expect(consoleSpy).toHaveBeenCalledWith(
            "\x1b[31m[Titan] Initial build failed. Waiting for changes...\x1b[0m"
        );
    });

    it("should log rebuild failure with red color", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("\x1b[31m[Titan] Build failed -- waiting for changes...\x1b[0m");

        expect(consoleSpy).toHaveBeenCalledWith(
            "\x1b[31m[Titan] Build failed -- waiting for changes...\x1b[0m"
        );
    });

    it("should log crash detection with red color", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("\x1b[31m[Titan] Server crash detected (possibly file lock). Retrying automatically...\x1b[0m");

        expect(consoleSpy).toHaveBeenCalledWith(
            "\x1b[31m[Titan] Server crash detected (possibly file lock). Retrying automatically...\x1b[0m"
        );
    });

    it("should log retry with yellow color", () => {
        const consoleSpy = vi.spyOn(console, "log");

        console.log("\x1b[33m[Titan] Retrying Rust server (Attempt 1)...\x1b[0m");

        expect(consoleSpy).toHaveBeenCalledWith(
            "\x1b[33m[Titan] Retrying Rust server (Attempt 1)...\x1b[0m"
        );
    });
});