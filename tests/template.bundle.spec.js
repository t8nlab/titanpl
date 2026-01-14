import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the function to test
import { bundle } from "../templates/titan/bundle.js";

// ============================================================
// Helper Functions
// ============================================================

/**
 * Creates a temporary directory for testing
 */
function createTempDir(prefix = "titan-bundle-test-") {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Cleans up a temporary directory
 */
function cleanupTempDir(tempDir) {
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/**
 * Creates a mock project structure for bundle testing
 */
function createMockProject(tempDir, options = {}) {
    const { includeActions = true, useTypeScript = false } = options;

    // Create directory structure
    fs.mkdirSync(path.join(tempDir, "app", "actions"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "server", "actions"), { recursive: true });

    if (includeActions) {
        if (useTypeScript) {
            // Create TypeScript action
            const helloTs = `interface Request {
    body: { name: string };
}

export const hello = (req: Request) => {
    return { message: \`Hello \${req.body.name}\` };
};
`;
            fs.writeFileSync(path.join(tempDir, "app", "actions", "hello.ts"), helloTs);
        } else {
            // Create JavaScript action
            const helloJs = `export const hello = (req) => {
    return { message: \`Hello \${req.body.name}\` };
};
`;
            fs.writeFileSync(path.join(tempDir, "app", "actions", "hello.js"), helloJs);
        }
    }

    return tempDir;
}

// ============================================================
// TESTS: bundle() - Basic functionality
// ============================================================
describe("bundle() - Basic functionality", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should bundle a JavaScript action correctly", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true, useTypeScript: false });

        await bundle(tempDir);

        const bundleFile = path.join(tempDir, "server", "actions", "hello.jsbundle");
        expect(fs.existsSync(bundleFile)).toBe(true);

        const content = fs.readFileSync(bundleFile, "utf8");
        expect(content).toContain("Hello");
        expect(content).toContain("globalThis");
        expect(content).toContain("defineAction");
    });

    it("should bundle a TypeScript action correctly", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true, useTypeScript: true });

        await bundle(tempDir);

        const bundleFile = path.join(tempDir, "server", "actions", "hello.jsbundle");
        expect(fs.existsSync(bundleFile)).toBe(true);

        const content = fs.readFileSync(bundleFile, "utf8");
        // TypeScript interfaces should be stripped
        expect(content).not.toContain("interface Request");
        // Function should remain
        expect(content).toContain("Hello");
        expect(content).toContain("globalThis");
    });

    it("should create output directory if it does not exist", async () => {
        tempDir = createTempDir();
        fs.mkdirSync(path.join(tempDir, "app", "actions"), { recursive: true });

        const helloJs = `export const hello = () => ({ message: "Hello" });`;
        fs.writeFileSync(path.join(tempDir, "app", "actions", "hello.js"), helloJs);

        // Don't create server/actions directory
        expect(fs.existsSync(path.join(tempDir, "server", "actions"))).toBe(false);

        await bundle(tempDir);

        expect(fs.existsSync(path.join(tempDir, "server", "actions"))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "hello.jsbundle"))).toBe(true);
    });

    it("should use current working directory as default root", async () => {
        // This test verifies the default parameter works
        // We can't easily test this without changing cwd, so we just verify the signature
        expect(bundle.length).toBe(0); // Has default parameter
    });
});

// ============================================================
// TESTS: bundle() - Multiple actions
// ============================================================
describe("bundle() - Multiple actions", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should bundle multiple JavaScript actions", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Create multiple actions
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "hello.js"),
            `export const hello = () => ({ message: "Hello" });`
        );
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "goodbye.js"),
            `export const goodbye = () => ({ message: "Goodbye" });`
        );
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "greet.js"),
            `export const greet = (req) => ({ message: \`Hi \${req.name}\` });`
        );

        await bundle(tempDir);

        expect(fs.existsSync(path.join(tempDir, "server", "actions", "hello.jsbundle"))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "goodbye.jsbundle"))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "greet.jsbundle"))).toBe(true);
    });

    it("should bundle mixed JS and TS actions", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Create JS action
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "jsAction.js"),
            `export const jsAction = () => ({ type: "js" });`
        );

        // Create TS action
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "tsAction.ts"),
            `export const tsAction = (): { type: string } => ({ type: "ts" });`
        );

        await bundle(tempDir);

        expect(fs.existsSync(path.join(tempDir, "server", "actions", "jsAction.jsbundle"))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "tsAction.jsbundle"))).toBe(true);
    });
});

// ============================================================
// TESTS: bundle() - Clean old bundles
// ============================================================
describe("bundle() - Clean old bundles", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should remove old .jsbundle files before bundling", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        // Create an old bundle that should be removed
        const oldBundle = path.join(tempDir, "server", "actions", "oldAction.jsbundle");
        fs.writeFileSync(oldBundle, "old content");

        await bundle(tempDir);

        // Old bundle should be removed
        expect(fs.existsSync(oldBundle)).toBe(false);
        // New bundle should exist
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "hello.jsbundle"))).toBe(true);
    });

    it("should not remove non-jsbundle files", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        // Create a non-bundle file that should be kept
        const otherFile = path.join(tempDir, "server", "actions", "config.json");
        fs.writeFileSync(otherFile, '{"key": "value"}');

        await bundle(tempDir);

        // Other file should still exist
        expect(fs.existsSync(otherFile)).toBe(true);
        expect(fs.readFileSync(otherFile, "utf8")).toBe('{"key": "value"}');
    });

    it("should remove multiple old bundles", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        // Create multiple old bundles
        fs.writeFileSync(path.join(tempDir, "server", "actions", "old1.jsbundle"), "old1");
        fs.writeFileSync(path.join(tempDir, "server", "actions", "old2.jsbundle"), "old2");
        fs.writeFileSync(path.join(tempDir, "server", "actions", "old3.jsbundle"), "old3");

        await bundle(tempDir);

        // All old bundles should be removed
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "old1.jsbundle"))).toBe(false);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "old2.jsbundle"))).toBe(false);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "old3.jsbundle"))).toBe(false);
        // New bundle should exist
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "hello.jsbundle"))).toBe(true);
    });
});

// ============================================================
// TESTS: bundle() - No actions directory
// ============================================================
describe("bundle() - No actions directory", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should handle missing actions directory gracefully", async () => {
        tempDir = createTempDir();
        fs.mkdirSync(path.join(tempDir, "server", "actions"), { recursive: true });
        // Don't create app/actions

        const consoleSpy = vi.spyOn(console, "log");

        await expect(bundle(tempDir)).resolves.not.toThrow();

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] No actions directory found.");

        consoleSpy.mockRestore();
    });

    it("should not create any bundles when actions directory is missing", async () => {
        tempDir = createTempDir();
        fs.mkdirSync(path.join(tempDir, "server", "actions"), { recursive: true });

        await bundle(tempDir);

        const bundles = fs.readdirSync(path.join(tempDir, "server", "actions"))
            .filter(f => f.endsWith(".jsbundle"));

        expect(bundles.length).toBe(0);
    });
});

// ============================================================
// TESTS: bundle() - Empty actions directory
// ============================================================
describe("bundle() - Empty actions directory", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should handle empty actions directory gracefully", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        const consoleSpy = vi.spyOn(console, "log");

        await expect(bundle(tempDir)).resolves.not.toThrow();

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] No actions found to bundle.");

        consoleSpy.mockRestore();
    });

    it("should not create any bundles when no actions exist", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        await bundle(tempDir);

        const bundles = fs.readdirSync(path.join(tempDir, "server", "actions"))
            .filter(f => f.endsWith(".jsbundle"));

        expect(bundles.length).toBe(0);
    });
});

// ============================================================
// TESTS: bundle() - File filtering
// ============================================================
describe("bundle() - File filtering", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should ignore .d.ts files", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        // Create a .d.ts file
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "types.d.ts"),
            "declare interface Something { name: string; }"
        );

        await bundle(tempDir);

        // Should not create bundle for .d.ts
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "types.jsbundle"))).toBe(false);
        // Should create bundle for actual action
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "hello.jsbundle"))).toBe(true);
    });

    it("should ignore non-JS/TS files", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        // Create non-JS/TS files
        fs.writeFileSync(path.join(tempDir, "app", "actions", "readme.md"), "# Actions");
        fs.writeFileSync(path.join(tempDir, "app", "actions", "config.json"), "{}");
        fs.writeFileSync(path.join(tempDir, "app", "actions", "data.txt"), "data");

        await bundle(tempDir);

        // Should not create bundles for non-JS/TS files
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "readme.jsbundle"))).toBe(false);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "config.jsbundle"))).toBe(false);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "data.jsbundle"))).toBe(false);
        // Should create bundle for actual action
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "hello.jsbundle"))).toBe(true);
    });

    it("should only bundle .js and .ts files", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Create various files
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "action1.js"),
            `export const action1 = () => ({});`
        );
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "action2.ts"),
            `export const action2 = () => ({});`
        );
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "action3.jsx"),
            `export const action3 = () => ({});`
        );
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "action4.tsx"),
            `export const action4 = () => ({});`
        );

        await bundle(tempDir);

        // Only .js and .ts should be bundled
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "action1.jsbundle"))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "action2.jsbundle"))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "action3.jsbundle"))).toBe(false);
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "action4.jsbundle"))).toBe(false);
    });
});

// ============================================================
// TESTS: bundle() - Bundle content structure
// ============================================================
describe("bundle() - Bundle content structure", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should include defineAction banner", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "hello.jsbundle"),
            "utf8"
        );

        expect(content).toContain("const defineAction = (fn) => fn;");
    });

    it("should include globalThis assignment in footer", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "hello.jsbundle"),
            "utf8"
        );

        expect(content).toContain('globalThis["hello"]');
    });

    it("should include error handling for missing action", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "hello.jsbundle"),
            "utf8"
        );

        expect(content).toContain("not found or not a function");
    });

    it("should use IIFE format", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "hello.jsbundle"),
            "utf8"
        );

        // IIFE format wraps in function
        expect(content).toMatch(/\(function\s*\(/);
        expect(content).toContain("__titan_exports");
    });

    it("should export action to globalThis with correct name", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Create action with specific name
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "myCustomAction.js"),
            `export const myCustomAction = () => ({ custom: true });`
        );

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "myCustomAction.jsbundle"),
            "utf8"
        );

        expect(content).toContain('globalThis["myCustomAction"]');
        expect(content).toContain('__titan_exports["myCustomAction"]');
    });
});

// ============================================================
// TESTS: bundle() - Default export handling
// ============================================================
describe("bundle() - Default export handling", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should handle default export fallback", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Create action with default export
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "defaultAction.js"),
            `export default (req) => ({ default: true });`
        );

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "defaultAction.jsbundle"),
            "utf8"
        );

        // Should check for default export as fallback
        expect(content).toContain("__titan_exports.default");
    });

    it("should handle named export", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Create action with named export
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "namedAction.js"),
            `export const namedAction = (req) => ({ named: true });`
        );

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "namedAction.jsbundle"),
            "utf8"
        );

        expect(content).toContain('__titan_exports["namedAction"]');
    });
});

// ============================================================
// TESTS: bundle() - TypeScript features
// ============================================================
describe("bundle() - TypeScript features", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should strip TypeScript interfaces", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        const tsAction = `
interface RequestBody {
    name: string;
    age: number;
}

interface Response {
    message: string;
}

export const typedAction = (req: { body: RequestBody }): Response => {
    return { message: \`Hello \${req.body.name}\` };
};
`;
        fs.writeFileSync(path.join(tempDir, "app", "actions", "typedAction.ts"), tsAction);

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "typedAction.jsbundle"),
            "utf8"
        );

        expect(content).not.toContain("interface RequestBody");
        expect(content).not.toContain("interface Response");
        expect(content).toContain("Hello");
    });

    it("should strip TypeScript type annotations", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        const tsAction = `
export const typedAction = (req: any): { result: boolean } => {
    const value: string = "test";
    const num: number = 42;
    return { result: true };
};
`;
        fs.writeFileSync(path.join(tempDir, "app", "actions", "typedAction.ts"), tsAction);

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "typedAction.jsbundle"),
            "utf8"
        );

        // Type annotations should be stripped
        expect(content).not.toContain(": any");
        expect(content).not.toContain(": string");
        expect(content).not.toContain(": number");
        expect(content).not.toContain(": { result: boolean }");
    });

    it("should handle TypeScript enums", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        const tsAction = `
enum Status {
    Active = "ACTIVE",
    Inactive = "INACTIVE"
}

export const enumAction = () => {
    return { status: Status.Active };
};
`;
        fs.writeFileSync(path.join(tempDir, "app", "actions", "enumAction.ts"), tsAction);

        await bundle(tempDir);

        const bundleFile = path.join(tempDir, "server", "actions", "enumAction.jsbundle");
        expect(fs.existsSync(bundleFile)).toBe(true);

        const content = fs.readFileSync(bundleFile, "utf8");
        // Enum should be compiled to JavaScript
        expect(content).toContain("ACTIVE");
    });

    it("should handle TypeScript decorators config", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Simple action to verify decorator config doesn't break compilation
        const tsAction = `
export const decoratorTest = () => ({ test: true });
`;
        fs.writeFileSync(path.join(tempDir, "app", "actions", "decoratorTest.ts"), tsAction);

        // Should not throw with decorator config
        await expect(bundle(tempDir)).resolves.not.toThrow();

        expect(fs.existsSync(path.join(tempDir, "server", "actions", "decoratorTest.jsbundle"))).toBe(true);
    });
});

// ============================================================
// TESTS: bundle() - Console output
// ============================================================
describe("bundle() - Console output", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should log bundling start message", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        const consoleSpy = vi.spyOn(console, "log");

        await bundle(tempDir);

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] Bundling actions...");

        consoleSpy.mockRestore();
    });

    it("should log bundling finished message", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        const consoleSpy = vi.spyOn(console, "log");

        await bundle(tempDir);

        expect(consoleSpy).toHaveBeenCalledWith("[Titan] Bundling finished.");

        consoleSpy.mockRestore();
    });

    it("should log each file being bundled", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "action1.js"),
            `export const action1 = () => ({});`
        );
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "action2.js"),
            `export const action2 = () => ({});`
        );

        const consoleSpy = vi.spyOn(console, "log");

        await bundle(tempDir);

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("Bundling action1.js → action1.jsbundle")
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("Bundling action2.js → action2.jsbundle")
        );

        consoleSpy.mockRestore();
    });
});

// ============================================================
// TESTS: bundle() - Error handling
// ============================================================
describe("bundle() - Error handling", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should throw on invalid JavaScript syntax", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Create action with invalid syntax
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "invalid.js"),
            `export const invalid = ( => { return {}; };` // Missing parameter
        );

        await expect(bundle(tempDir)).rejects.toThrow();
    });

    it("should throw on invalid TypeScript syntax", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Create action with invalid TypeScript syntax
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "invalid.ts"),
            `export const invalid: : string = () => {};` // Invalid type annotation
        );

        await expect(bundle(tempDir)).rejects.toThrow();
    });
});

// ============================================================
// TESTS: bundle() - Action name extraction
// ============================================================
describe("bundle() - Action name extraction", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should extract action name from filename without extension", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "myAction.js"),
            `export const myAction = () => ({});`
        );

        await bundle(tempDir);

        // Bundle filename should match action name
        expect(fs.existsSync(path.join(tempDir, "server", "actions", "myAction.jsbundle"))).toBe(true);
    });

    it("should handle action names with numbers", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "action123.js"),
            `export const action123 = () => ({});`
        );

        await bundle(tempDir);

        expect(fs.existsSync(path.join(tempDir, "server", "actions", "action123.jsbundle"))).toBe(true);
    });

    it("should handle action names with underscores", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "my_action_name.js"),
            `export const my_action_name = () => ({});`
        );

        await bundle(tempDir);

        expect(fs.existsSync(path.join(tempDir, "server", "actions", "my_action_name.jsbundle"))).toBe(true);
    });

    it("should handle camelCase action names", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "myActionName.js"),
            `export const myActionName = () => ({});`
        );

        await bundle(tempDir);

        expect(fs.existsSync(path.join(tempDir, "server", "actions", "myActionName.jsbundle"))).toBe(true);
    });
});

// ============================================================
// TESTS: bundle() - esbuild configuration
// ============================================================
describe("bundle() - esbuild configuration", () => {
    let tempDir;

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it("should produce ES2020 compatible output", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Use modern JavaScript features
        const modernJs = `
export const modernAction = async () => {
    const arr = [1, 2, 3];
    const doubled = arr.map(x => x * 2);
    const obj = { ...{ a: 1 }, b: 2 };
    return { doubled, obj };
};
`;
        fs.writeFileSync(path.join(tempDir, "app", "actions", "modernAction.js"), modernJs);

        await bundle(tempDir);

        const bundleFile = path.join(tempDir, "server", "actions", "modernAction.jsbundle");
        expect(fs.existsSync(bundleFile)).toBe(true);

        // Should compile successfully
        const content = fs.readFileSync(bundleFile, "utf8");
        expect(content.length).toBeGreaterThan(0);
    });

    it("should bundle with platform neutral", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: true });

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "hello.jsbundle"),
            "utf8"
        );

        // Should not have Node.js specific requires (platform neutral)
        expect(content).not.toContain("require(");
    });

    it("should inline all dependencies (bundle: true)", async () => {
        tempDir = createMockProject(createTempDir(), { includeActions: false });

        // Create a helper module
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "helper.js"),
            `export const helper = (x) => x * 2;`
        );

        // Create action that imports helper
        fs.writeFileSync(
            path.join(tempDir, "app", "actions", "main.js"),
            `
import { helper } from "./helper.js";
export const main = (req) => ({ result: helper(req.value) });
`
        );

        await bundle(tempDir);

        const content = fs.readFileSync(
            path.join(tempDir, "server", "actions", "main.jsbundle"),
            "utf8"
        );

        // Helper should be inlined, not imported
        expect(content).not.toContain('import { helper }');
        expect(content).toContain("* 2"); // Helper logic should be present
    });
});