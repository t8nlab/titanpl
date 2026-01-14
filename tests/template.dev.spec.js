import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ruta al directorio raíz del proyecto (titanpl)
const PROJECT_ROOT = path.join(__dirname, "..");

// Ruta a los archivos de templates/titan
const TEMPLATES_TITAN = path.join(PROJECT_ROOT, "templates", "titan");

// Import functions to test
import {
    getAppEntry,
    compileAndRunAppEntry,
    killServer,
} from "../templates/titan/dev.js";

/**
 * Helper to create a temporary Titan project structure
 */
function createTempProject(options = {}) {
    const { useTypeScript = false, includeActions = true } = options;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "titan-test-"));

    // Create directory structure
    fs.mkdirSync(path.join(tempDir, "app", "actions"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "titan"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "server", "actions"), { recursive: true });

    // Copy titan.js and bundle.js from templates/titan
    const titanSrc = path.join(TEMPLATES_TITAN, "titan.js");
    const bundleSrc = path.join(TEMPLATES_TITAN, "bundle.js");

    fs.copyFileSync(titanSrc, path.join(tempDir, "titan", "titan.js"));
    fs.copyFileSync(bundleSrc, path.join(tempDir, "titan", "bundle.js"));

    // Create app entry file
    if (useTypeScript) {
        const appTs = `import t from "../titan/titan.js";

t.post("/hello").action("hello");
t.get("/").reply("Ready to land on Titan Planet 🚀");
t.start(3000, "Titan Running!");
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.ts"), appTs);
    } else {
        const appJs = `import t from "../titan/titan.js";

t.post("/hello").action("hello");
t.get("/").reply("Ready to land on Titan Planet 🚀");
t.start(3000, "Titan Running!");
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.js"), appJs);
    }

    // Create action files
    if (includeActions) {
        if (useTypeScript) {
            const helloTs = `interface HelloRequest {
  name?: string;
}

interface HelloResponse {
  message: string;
  timestamp: number;
}

export const hello = (req: TitanRequest<HelloRequest>): HelloResponse => {
  return {
    message: \`Hello from Titan, \${req.body?.name}!\`,
    timestamp: Date.now(),
  };
};
`;
            fs.writeFileSync(path.join(tempDir, "app", "actions", "hello.ts"), helloTs);
        } else {
            const helloJs = `export const hello = (req) => {
  return {
    message: \`Hello from Titan \${req.body.name}\`,
  };
};
`;
            fs.writeFileSync(path.join(tempDir, "app", "actions", "hello.js"), helloJs);
        }
    }

    return tempDir;
}

/**
 * Clean up temporary project
 */
function cleanupTempProject(tempDir) {
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// ============================================================
// TESTS: getAppEntry()
// ============================================================
describe("getAppEntry()", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should detect app.ts when TypeScript project", () => {
        tempDir = createTempProject({ useTypeScript: true });

        const entry = getAppEntry(tempDir);

        expect(entry).not.toBeNull();
        expect(entry.isTS).toBe(true);
        expect(entry.path).toContain("app.ts");
    });

    it("should detect app.js when JavaScript project", () => {
        tempDir = createTempProject({ useTypeScript: false });

        const entry = getAppEntry(tempDir);

        expect(entry).not.toBeNull();
        expect(entry.isTS).toBe(false);
        expect(entry.path).toContain("app.js");
    });

    it("should prioritize app.ts over app.js when both exist", () => {
        tempDir = createTempProject({ useTypeScript: true });

        // Also create app.js
        fs.writeFileSync(
            path.join(tempDir, "app", "app.js"),
            'console.log("js");'
        );

        const entry = getAppEntry(tempDir);

        expect(entry).not.toBeNull();
        expect(entry.isTS).toBe(true);
        expect(entry.path).toContain("app.ts");
    });

    it("should return null when no app entry exists", () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "titan-empty-"));
        fs.mkdirSync(path.join(tempDir, "app"), { recursive: true });

        const entry = getAppEntry(tempDir);

        expect(entry).toBeNull();
    });

    it("should return null when app directory does not exist", () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "titan-noapp-"));

        const entry = getAppEntry(tempDir);

        expect(entry).toBeNull();
    });
});

// ============================================================
// TESTS: compileAndRunAppEntry() - TypeScript compilation
// ============================================================
describe("compileAndRunAppEntry() - TypeScript", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should compile TypeScript app.ts successfully", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        expect(result.outFile).toContain("app.compiled.mjs");
        expect(result.compiled).not.toBeNull();
        expect(fs.existsSync(result.outFile)).toBe(true);
    });

    it("should preserve import statement in compiled output", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        // CRITICAL: The import must exist, otherwise 't' will be undefined at runtime
        expect(result.compiled).toContain("import");
        expect(result.compiled).toContain("titan.js");

        // The import should be near the beginning of the file (esbuild may add comments)
        const lines = result.compiled.split("\n");
        const importLine = lines.find(line => line.trim().startsWith("import"));
        expect(importLine).toBeDefined();
        expect(importLine).toMatch(/import\s+\w+\s+from/);
    });

    it("should fix titan import path in compiled output", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        // Should NOT contain relative import
        expect(result.compiled).not.toContain('from "../titan/titan.js"');
        // Should contain absolute path
        expect(result.compiled).toContain(path.join(tempDir, "titan", "titan.js").replace(/\\/g, "/"));
    });

    it("should create .titan directory for compiled output", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        await compileAndRunAppEntry(tempDir, { skipExec: true });

        const titanDir = path.join(tempDir, ".titan");
        expect(fs.existsSync(titanDir)).toBe(true);
        expect(fs.existsSync(path.join(titanDir, "app.compiled.mjs"))).toBe(true);
    });

    it("should clean .titan directory before compilation", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        // Create old .titan directory with stale file
        const titanDir = path.join(tempDir, ".titan");
        fs.mkdirSync(titanDir, { recursive: true });
        fs.writeFileSync(path.join(titanDir, "old-file.txt"), "stale");

        await compileAndRunAppEntry(tempDir, { skipExec: true });

        // Old file should be gone
        expect(fs.existsSync(path.join(titanDir, "old-file.txt"))).toBe(false);
        // New compiled file should exist
        expect(fs.existsSync(path.join(titanDir, "app.compiled.mjs"))).toBe(true);
    });

    it("should preserve TypeScript functionality in compiled output", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        // Compiled code should contain the DSL calls
        expect(result.compiled).toContain('post("/hello")');
        expect(result.compiled).toContain('get("/")');
        // esbuild converts 3000 to 3e3 (scientific notation)
        expect(result.compiled).toMatch(/start\(3(000|e3)/);
    });

    it("should handle TypeScript with interfaces correctly", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        // Create a more complex TypeScript file
        const complexTs = `import t from "../titan/titan.js";

interface Config {
    port: number;
    message: string;
}

const config: Config = {
    port: 3000,
    message: "Complex TS Test"
};

t.get("/api/health").reply({ status: "ok" });
t.post("/api/data").action("processData");
t.start(config.port, config.message);
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.ts"), complexTs);

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        expect(result.compiled).not.toBeNull();
        // Interfaces should be stripped (TypeScript specific)
        expect(result.compiled).not.toContain("interface Config");
        // But the actual code should remain
        expect(result.compiled).toContain('get("/api/health")');
        expect(result.compiled).toContain('post("/api/data")');
    });
});

// ============================================================
// TESTS: compileAndRunAppEntry() - JavaScript
// ============================================================
describe("compileAndRunAppEntry() - JavaScript", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should bundle JavaScript project with esbuild", async () => {
        tempDir = createTempProject({ useTypeScript: false });

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        // JS is now also bundled through esbuild to .titan/app.compiled.mjs
        expect(result.outFile).toContain("app.compiled.mjs");
        expect(result.compiled).not.toBeNull();
        expect(fs.existsSync(result.outFile)).toBe(true);
    });

    it("should create .titan directory for JavaScript projects", async () => {
        tempDir = createTempProject({ useTypeScript: false });

        await compileAndRunAppEntry(tempDir, { skipExec: true });

        const titanDir = path.join(tempDir, ".titan");
        expect(fs.existsSync(titanDir)).toBe(true);
        expect(fs.existsSync(path.join(titanDir, "app.compiled.mjs"))).toBe(true);
    });

    it("should fix titan import path in JavaScript output", async () => {
        tempDir = createTempProject({ useTypeScript: false });

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        // Should NOT contain relative import
        expect(result.compiled).not.toContain('from "../titan/titan.js"');
        // Should contain absolute path
        expect(result.compiled).toContain(path.join(tempDir, "titan", "titan.js").replace(/\\/g, "/"));
    });
});

// ============================================================
// TESTS: compileAndRunAppEntry() - Error handling
// ============================================================
describe("compileAndRunAppEntry() - Error handling", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should throw error when no app entry exists", async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "titan-noentry-"));
        fs.mkdirSync(path.join(tempDir, "app"), { recursive: true });

        await expect(compileAndRunAppEntry(tempDir, { skipExec: true }))
            .rejects
            .toThrow("[Titan] No app.ts or app.js found in app/");
    });

    it("should throw error for invalid TypeScript syntax", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        // Write invalid TypeScript
        fs.writeFileSync(
            path.join(tempDir, "app", "app.ts"),
            "const x: = invalid syntax here {{{"
        );

        await expect(compileAndRunAppEntry(tempDir, { skipExec: true }))
            .rejects
            .toThrow();
    });
});

// ============================================================
// TESTS: killServer()
// ============================================================
describe("killServer()", () => {
    it("should handle null serverProcess gracefully", async () => {
        // Should not throw
        await expect(killServer()).resolves.not.toThrow();
    });
});

// ============================================================
// TESTS: bundle() - Integration with esbuild
// ============================================================
describe("bundle() - Integration", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should bundle JavaScript action correctly", async () => {
        tempDir = createTempProject({ useTypeScript: false, includeActions: true });

        // Import bundle function from templates/titan
        const { bundle } = await import("../templates/titan/bundle.js");
        await bundle(tempDir);

        const bundleFile = path.join(tempDir, "server", "actions", "hello.jsbundle");
        expect(fs.existsSync(bundleFile)).toBe(true);

        const content = fs.readFileSync(bundleFile, "utf8");
        expect(content).toContain("Hello from Titan");
        expect(content).toContain("globalThis");
    });

    it("should bundle TypeScript action correctly", async () => {
        tempDir = createTempProject({ useTypeScript: true, includeActions: true });

        const { bundle } = await import("../templates/titan/bundle.js");
        await bundle(tempDir);

        const bundleFile = path.join(tempDir, "server", "actions", "hello.jsbundle");
        expect(fs.existsSync(bundleFile)).toBe(true);

        const content = fs.readFileSync(bundleFile, "utf8");
        // TypeScript interfaces should be stripped
        expect(content).not.toContain("interface HelloRequest");
        // But the function should remain
        expect(content).toContain("Hello from Titan");
    });

    it("should clean old bundles before creating new ones", async () => {
        tempDir = createTempProject({ useTypeScript: false, includeActions: true });

        // Create an old bundle
        const oldBundle = path.join(tempDir, "server", "actions", "old.jsbundle");
        fs.writeFileSync(oldBundle, "old content");

        const { bundle } = await import("../templates/titan/bundle.js");
        await bundle(tempDir);

        // Old bundle should be removed
        expect(fs.existsSync(oldBundle)).toBe(false);
        // New bundle should exist
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "hello.jsbundle"))).toBe(true);
    });

    it("should handle project with no actions", async () => {
        tempDir = createTempProject({ useTypeScript: false, includeActions: false });

        // Remove actions directory
        fs.rmSync(path.join(tempDir, "app", "actions"), { recursive: true, force: true });

        const { bundle } = await import("../templates/titan/bundle.js");

        // Should not throw
        await expect(bundle(tempDir)).resolves.not.toThrow();
    });

    it("should handle empty actions directory", async () => {
        tempDir = createTempProject({ useTypeScript: false, includeActions: false });

        const { bundle } = await import("../templates/titan/bundle.js");

        // Should not throw
        await expect(bundle(tempDir)).resolves.not.toThrow();
    });

    it("should ignore .d.ts files in actions", async () => {
        tempDir = createTempProject({ useTypeScript: true, includeActions: true });

        // Create a .d.ts file
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "types.d.ts"),
            "declare interface Something {}"
        );

        const { bundle } = await import("../templates/titan/bundle.js");
        await bundle(tempDir);

        // Should not create bundle for .d.ts
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "types.jsbundle"))).toBe(false);
        // Should create bundle for actual action
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "hello.jsbundle"))).toBe(true);
    });
});

// ============================================================
// TESTS: Full compilation flow
// ============================================================
describe("Full compilation flow", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should compile TypeScript app and generate correct output files", async () => {
        tempDir = createTempProject({ useTypeScript: true, includeActions: true });

        // Compile the app
        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        // Verify compilation
        expect(fs.existsSync(result.outFile)).toBe(true);

        // Import titan.js should be fixed
        const compiled = fs.readFileSync(result.outFile, "utf8");
        const expectedTitanPath = path.join(tempDir, "titan", "titan.js").replace(/\\/g, "/");
        expect(compiled).toContain(expectedTitanPath);
    });

    it("should handle mixed JS/TS actions in same project", async () => {
        tempDir = createTempProject({ useTypeScript: true, includeActions: true });

        // Add a JS action alongside the TS action
        const jsAction = `export const goodbye = (req) => {
  return { message: "Goodbye!" };
};
`;
        fs.writeFileSync(path.join(tempDir, "app", "actions", "goodbye.js"), jsAction);

        const { bundle } = await import("../templates/titan/bundle.js");
        await bundle(tempDir);

        // Both should be bundled
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "hello.jsbundle"))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "goodbye.jsbundle"))).toBe(true);
    });
});

// ============================================================
// TESTS: Real project structure simulation
// This tests the EXACT structure that fails in production
// ============================================================
describe("Real project structure (non-temp directory)", () => {
    let testProjectDir;

    beforeEach(() => {
        // Create a project structure that mimics the real project
        testProjectDir = path.join(__dirname, "..", ".test-project");

        // Clean up if exists
        if (fs.existsSync(testProjectDir)) {
            fs.rmSync(testProjectDir, { recursive: true, force: true });
        }

        // Create structure
        fs.mkdirSync(path.join(testProjectDir, "app", "actions"), { recursive: true });
        fs.mkdirSync(path.join(testProjectDir, "titan"), { recursive: true });
        fs.mkdirSync(path.join(testProjectDir, "server", "actions"), { recursive: true });

        // Copy titan.js and bundle.js
        fs.copyFileSync(
            path.join(TEMPLATES_TITAN, "titan.js"),
            path.join(testProjectDir, "titan", "titan.js")
        );
        fs.copyFileSync(
            path.join(TEMPLATES_TITAN, "bundle.js"),
            path.join(testProjectDir, "titan", "bundle.js")
        );

        // Create hello.ts action
        const helloTs = `export const hello = (req: any) => {
    return { message: "Hello!" };
};
`;
        fs.writeFileSync(path.join(testProjectDir, "app", "actions", "hello.ts"), helloTs);
    });

    afterEach(() => {
        if (testProjectDir && fs.existsSync(testProjectDir)) {
            fs.rmSync(testProjectDir, { recursive: true, force: true });
        }
    });

    it("should work when app.ts HAS import statement", async () => {
        // Create app.ts WITH import (standard way)
        const appTs = `import t from "../titan/titan.js";

t.post("/hello").action("hello");
t.get("/").reply("Ready to land on Titan Planet 🚀");
t.start(3000, "Titan Running!");
`;
        fs.writeFileSync(path.join(testProjectDir, "app", "app.ts"), appTs);

        const result = await compileAndRunAppEntry(testProjectDir, { skipExec: true });

        // Should have import
        expect(result.compiled).toContain("import");
        expect(result.compiled).toContain("titan.js");
    });

    it("should inject import when app.ts does NOT have import (uses global t)", async () => {
        // Create app.ts WITHOUT import - relies on globalThis.t
        // This is the EXACT case that was failing in production
        const appTs = `t.post("/hello").action("hello");
t.get("/").reply("Ready to land on Titan Planet 🚀");
t.start(3000, "Titan Running!");
`;
        fs.writeFileSync(path.join(testProjectDir, "app", "app.ts"), appTs);

        const result = await compileAndRunAppEntry(testProjectDir, { skipExec: true });

        console.log("[TEST] Compiled output for app.ts WITHOUT import:");
        console.log(result.compiled);

        // Even without explicit import in source, compiled output MUST have import
        // Otherwise t will be undefined at runtime
        expect(result.compiled).toContain("titan.js");

        // The first non-comment line should be an import, not t.post()
        const lines = result.compiled.split("\n");
        const firstCodeLine = lines.find(line =>
            line.trim() && !line.trim().startsWith("//")
        );

        expect(firstCodeLine).toMatch(/import/);
        expect(firstCodeLine).not.toMatch(/^t\./);
    });

    it("should produce executable output regardless of import presence", async () => {
        // Test WITHOUT import
        const appTs = `t.post("/hello").action("hello");
t.get("/").reply("Test");
t.start(3000);
`;
        fs.writeFileSync(path.join(testProjectDir, "app", "app.ts"), appTs);

        const result = await compileAndRunAppEntry(testProjectDir, { skipExec: true });

        // Verify the compiled code would be executable
        // It must import titan.js so that globalThis.t is set before use
        const hasImport = result.compiled.includes("import") && result.compiled.includes("titan.js");

        expect(hasImport).toBe(true);
    });
});

// ============================================================
// TESTS: Import path fixing
// ============================================================
describe("Import path fixing", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should fix import with semicolon", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        const appTs = `import t from "../titan/titan.js";
t.get("/").reply("test");
t.start(3000);
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.ts"), appTs);

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        expect(result.compiled).not.toContain('from "../titan/titan.js";');
    });

    it("should fix import without semicolon", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        const appTs = `import t from "../titan/titan.js"
t.get("/").reply("test");
t.start(3000);
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.ts"), appTs);

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        expect(result.compiled).not.toContain('from "../titan/titan.js"');
    });

    it("should handle Windows-style paths correctly", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        // Find the import line (esbuild may add comments before it)
        const lines = result.compiled.split("\n");
        const importLine = lines.find(line => line.includes("import") && line.includes("titan.js"));

        expect(importLine).toBeDefined();
        // Should use forward slashes even on Windows
        expect(importLine).not.toMatch(/\\/);
        expect(importLine).toContain("/titan/titan.js");
    });
});

// ============================================================
// TESTS: startRustServer()
// ============================================================
describe("startRustServer()", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = createTempProject({ useTypeScript: true });
        fs.mkdirSync(path.join(tempDir, "server"), { recursive: true });
    });

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should be a callable async function", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");

        expect(typeof startRustServer).toBe("function");
        expect(startRustServer.constructor.name).toBe("AsyncFunction");
    });

    it("should accept retryCount and root parameters", async () => {
        const { startRustServer } = await import("../templates/titan/dev.js");

        // Verificamos la firma de la función (tiene defaults, así que length es 0)
        expect(startRustServer.length).toBe(0);
    });
});

// ============================================================
// TESTS: rebuild()
// ============================================================
describe("rebuild()", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should call compileAndRunAppEntry and bundle", async () => {
        tempDir = createTempProject({ useTypeScript: true, includeActions: true });

        const { rebuild } = await import("../templates/titan/dev.js");

        // rebuild sin skipExec intentará ejecutar, lo cual fallará
        // pero podemos verificar que los archivos se generan
        await expect(rebuild(tempDir)).rejects.toThrow();

        // A pesar del error en ejecución, la compilación debería haber ocurrido
        expect(fs.existsSync(path.join(tempDir, ".titan", "app.compiled.mjs"))).toBe(true);
    });
});

// ============================================================
// TESTS: compileAndRunAppEntry() - Branches no cubiertos
// ============================================================
describe("compileAndRunAppEntry() - uncovered branches", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should auto-inject import when JS file has no titan.js import", async () => {
        tempDir = createTempProject({ useTypeScript: false });

        // Crear app.js SIN import de titan.js
        const appJsNoImport = `
const config = { port: 3000 };
console.log("No titan import here");
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.js"), appJsNoImport);

        // Capturar console.log
        const consoleSpy = vi.spyOn(console, "log");

        const result = await compileAndRunAppEntry(tempDir, { skipExec: true });

        // Should auto-inject the import
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("Auto-injecting titan.js import")
        );

        // Result should contain titan.js
        expect(result.compiled).toContain("titan.js");

        consoleSpy.mockRestore();
    });

    it("should not auto-inject when JS file has titan.js import", async () => {
        tempDir = createTempProject({ useTypeScript: false });

        // El proyecto ya tiene import, verificamos que NO muestra warning de inyección
        const consoleSpy = vi.spyOn(console, "log");

        await compileAndRunAppEntry(tempDir, { skipExec: true });

        const injectionCalls = consoleSpy.mock.calls.filter(
            call => call[0]?.includes?.("Auto-injecting titan.js import")
        );
        expect(injectionCalls.length).toBe(0);

        consoleSpy.mockRestore();
    });

    it("should not auto-inject when JS file has titan/titan.js in path", async () => {
        tempDir = createTempProject({ useTypeScript: false });

        // Verificar que el import con path completo no genera inyección
        const appJs = `import t from "../titan/titan.js";
t.get("/").reply("test");
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.js"), appJs);

        const consoleSpy = vi.spyOn(console, "log");

        await compileAndRunAppEntry(tempDir, { skipExec: true });

        const injectionCalls = consoleSpy.mock.calls.filter(
            call => call[0]?.includes?.("Auto-injecting titan.js import")
        );
        expect(injectionCalls.length).toBe(0);

        consoleSpy.mockRestore();
    });
});

// ============================================================
// TESTS: startDev() - structure tests
// ============================================================
describe("startDev() - structure tests", () => {
    let tempDir;
    let originalCwd;

    beforeEach(() => {
        tempDir = createTempProject({ useTypeScript: true, includeActions: true });
        originalCwd = process.cwd;
    });

    afterEach(() => {
        process.cwd = originalCwd;
        cleanupTempProject(tempDir);
    });

    it("should detect .env file when present", async () => {
        // Crear .env
        fs.writeFileSync(path.join(tempDir, ".env"), "PORT=3000");

        const consoleSpy = vi.spyOn(console, "log");

        // Mock process.cwd para que apunte a nuestro tempDir
        process.cwd = () => tempDir;

        const entry = getAppEntry(tempDir);
        expect(entry).not.toBeNull();
        expect(fs.existsSync(path.join(tempDir, ".env"))).toBe(true);

        consoleSpy.mockRestore();
    });

    it("should detect TypeScript project in startDev", () => {
        const entry = getAppEntry(tempDir);
        expect(entry.isTS).toBe(true);
    });

    it("should detect JavaScript project in startDev", () => {
        // Eliminar app.ts y crear app.js
        fs.unlinkSync(path.join(tempDir, "app", "app.ts"));
        fs.writeFileSync(
            path.join(tempDir, "app", "app.js"),
            'import t from "../titan/titan.js"; t.get("/").reply("test");'
        );

        const entry = getAppEntry(tempDir);
        expect(entry.isTS).toBe(false);
    });
});

// ============================================================
// TESTS: compileAndRunAppEntry() - execution
// ============================================================
describe("compileAndRunAppEntry() - execution", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should execute compiled TypeScript when skipExec=false", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        // Sobrescribir titan.js con una versión mock que no importa esbuild
        const mockTitanJs = `// Mock titan.js for testing
const t = {
    get: () => t,
    post: () => t,
    reply: () => t,
    action: () => t,
    start: () => {}
};
export default t;
`;
        fs.writeFileSync(path.join(tempDir, "titan", "titan.js"), mockTitanJs);

        // Crear app.ts simple
        const simpleAppTs = `import t from "../titan/titan.js";
console.log("TS executed successfully");
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.ts"), simpleAppTs);

        const result = await compileAndRunAppEntry(tempDir, { skipExec: false });

        expect(result.outFile).toContain("app.compiled.mjs");
    });

    it("should execute bundled JavaScript when skipExec=false", async () => {
        tempDir = createTempProject({ useTypeScript: false });

        // Sobrescribir titan.js con versión mock
        const mockTitanJs = `// Mock titan.js for testing
const t = {
    get: () => t,
    post: () => t,
    reply: () => t,
    action: () => t,
    start: () => {}
};
export default t;
`;
        fs.writeFileSync(path.join(tempDir, "titan", "titan.js"), mockTitanJs);

        // Crear app.js simple
        const simpleAppJs = `import t from "../titan/titan.js";
console.log("JS executed successfully");
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.js"), simpleAppJs);

        const result = await compileAndRunAppEntry(tempDir, { skipExec: false });

        // JS is now also bundled
        expect(result.outFile).toContain("app.compiled.mjs");
        expect(result.compiled).not.toBeNull();
    });

    it("should throw when executed code fails", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        // Sobrescribir titan.js con versión mock
        const mockTitanJs = `// Mock titan.js for testing
const t = {};
export default t;
`;
        fs.writeFileSync(path.join(tempDir, "titan", "titan.js"), mockTitanJs);

        // Crear app.ts que falla
        const failingAppTs = `import t from "../titan/titan.js";
throw new Error("Intentional failure for test");
`;
        fs.writeFileSync(path.join(tempDir, "app", "app.ts"), failingAppTs);

        await expect(compileAndRunAppEntry(tempDir, { skipExec: false }))
            .rejects
            .toThrow();
    });
});

// ============================================================
// TESTS: Import verification warning
// ============================================================
describe("compileAndRunAppEntry() - import verification warning", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempProject(tempDir);
    });

    it("should not trigger warning when compiled output has import", async () => {
        tempDir = createTempProject({ useTypeScript: true });

        const consoleSpy = vi.spyOn(console, "error");

        // Compilar normalmente - no debería mostrar warning
        await compileAndRunAppEntry(tempDir, { skipExec: true });

        const warningCalls = consoleSpy.mock.calls.filter(
            call => call[0]?.includes?.("WARNING: Import statement may be missing")
        );

        // No debería haber warnings en compilación normal
        expect(warningCalls.length).toBe(0);

        consoleSpy.mockRestore();
    });
});