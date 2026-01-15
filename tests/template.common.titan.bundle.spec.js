import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";

// Mocks
vi.mock("fs", () => ({
    default: {
        mkdirSync: vi.fn(),
        readdirSync: vi.fn(),
        unlinkSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        existsSync: vi.fn(),
    },
}));

vi.mock("esbuild", () => ({
    default: {
        build: vi.fn().mockResolvedValue({}),
    },
}));

// Import after mocks
import fs from "fs";
import esbuild from "esbuild";

// Importamos las funciones exportadas
// NOTA: Debes exportar bundleJs desde tu archivo original
import { bundle, bundleRust, bundleJs } from "../templates/common/titan/bundle.js";

describe("bundle.js", () => {
    // Usamos el cwd real ya que el módulo se evalúa al momento de importación
    const root = process.cwd();
    const actionsDir = path.join(root, "app", "actions");
    const outDir = path.join(root, "server", "actions");
    const rustOutDir = path.join(root, "server", "src", "actions_rust");

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("bundle()", () => {
        it("should call bundleJs and bundleRust", async () => {
            // Setup mocks para que no fallen
            vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.existsSync).mockReturnValue(true);

            await bundle();

            // Verificar que se crearon los directorios
            expect(fs.mkdirSync).toHaveBeenCalled();
        });

        it("should complete without errors when no action files exist", async () => {
            vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.existsSync).mockReturnValue(true);

            await expect(bundle()).resolves.not.toThrow();
        });
    });

    describe("bundleRust()", () => {
        it("should create output directory if it doesn't exist", async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(fs.readdirSync).mockReturnValue([]);

            await bundleRust();

            // Verificar que se llamó a mkdirSync con una ruta que contiene actions_rust
            expect(fs.mkdirSync).toHaveBeenCalled();
            const mkdirCall = vi.mocked(fs.mkdirSync).mock.calls[0];
            expect(mkdirCall[0].toString()).toContain("actions_rust");
            expect(mkdirCall[1]).toEqual({ recursive: true });
        });

        it("should clean old rust action files", async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce(["old_action.rs"]) // First call: rust out dir
                .mockReturnValueOnce([]); // Second call: actions dir

            await bundleRust();

            // Verificar que se eliminó el archivo viejo
            expect(fs.unlinkSync).toHaveBeenCalled();
            const unlinkCall = vi.mocked(fs.unlinkSync).mock.calls[0];
            expect(unlinkCall[0].toString()).toContain("old_action.rs");
        });

        it("should copy rust action files with implicit imports", async () => {
            const rustContent = `
async fn run(req: Request<Body>) -> impl IntoResponse {
    "Hello"
}`;

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce([]) // rust out dir (clean)
                .mockReturnValueOnce(["test_action.rs"]); // actions dir
            vi.mocked(fs.readFileSync).mockReturnValue(rustContent);

            await bundleRust();

            // Should prepend the import - verificamos que alguna llamada contenga el import
            const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
            const actionFileCall = writeFileCalls.find(call =>
                call[0].toString().includes("test_action.rs")
            );

            expect(actionFileCall).toBeDefined();
            expect(actionFileCall[1]).toContain("use crate::extensions::t;");
        });

        it("should not duplicate imports if already present", async () => {
            const rustContentWithImport = `use crate::extensions::t;
async fn run(req: Request<Body>) -> impl IntoResponse {
    "Hello"
}`;

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce([])
                .mockReturnValueOnce(["test_action.rs"]);
            vi.mocked(fs.readFileSync).mockReturnValue(rustContentWithImport);

            await bundleRust();

            const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
                call => call[0].toString().includes("test_action.rs")
            );

            // Should not have duplicate imports
            const content = writeCall?.[1];
            const importCount = (content.match(/use crate::extensions::t;/g) || []).length;
            expect(importCount).toBe(1);
        });

        it("should warn if rust file doesn't have async fn run", async () => {
            const rustContentNoRun = `fn other_function() {}`;
            const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => { });

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce([])
                .mockReturnValueOnce(["bad_action.rs"]);
            vi.mocked(fs.readFileSync).mockReturnValue(rustContentNoRun);

            await bundleRust();

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Warning: bad_action.rs does not appear to have an 'async fn run'")
            );
        });

        it("should generate mod.rs with correct module declarations", async () => {
            const rustContent = `async fn run(req: Request<Body>) -> impl IntoResponse { "ok" }`;

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce([])
                .mockReturnValueOnce(["action_one.rs", "action_two.rs"]);
            vi.mocked(fs.readFileSync).mockReturnValue(rustContent);

            await bundleRust();

            const modRsCall = vi.mocked(fs.writeFileSync).mock.calls.find(
                call => call[0].toString().includes("mod.rs")
            );

            expect(modRsCall).toBeDefined();
            const modContent = modRsCall?.[1];

            expect(modContent).toContain("pub mod action_one;");
            expect(modContent).toContain("pub mod action_two;");
            expect(modContent).toContain('"action_one" => Some');
            expect(modContent).toContain('"action_two" => Some');
        });

        it("should handle empty actions directory", async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync).mockReturnValue([]);

            await bundleRust();

            // Should still generate mod.rs but with empty match
            const modRsCall = vi.mocked(fs.writeFileSync).mock.calls.find(
                call => call[0].toString().includes("mod.rs")
            );
            expect(modRsCall).toBeDefined();
        });

        it("should filter only .rs files from actions directory", async () => {
            const rustContent = `async fn run(req: Request<Body>) -> impl IntoResponse { "ok" }`;

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce([])
                .mockReturnValueOnce(["action.rs", "action.js", "action.ts", "readme.md"]);
            vi.mocked(fs.readFileSync).mockReturnValue(rustContent);

            await bundleRust();

            // Should only process action.rs
            expect(fs.readFileSync).toHaveBeenCalledTimes(1);
            const readCall = vi.mocked(fs.readFileSync).mock.calls[0];
            expect(readCall[0].toString()).toContain("action.rs");
            expect(readCall[1]).toBe("utf-8");
        });
    });

    describe("bundleJs()", () => {
        it("should create output directory", async () => {
            vi.mocked(fs.readdirSync).mockReturnValue([]);

            await bundleJs();

            expect(fs.mkdirSync).toHaveBeenCalled();
            const mkdirCall = vi.mocked(fs.mkdirSync).mock.calls[0];
            expect(mkdirCall[0].toString()).toContain("server");
            expect(mkdirCall[0].toString()).toContain("actions");
            expect(mkdirCall[1]).toEqual({ recursive: true });
        });

        it("should clean old bundle files", async () => {
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce(["old.jsbundle"])
                .mockReturnValueOnce([]);

            await bundleJs();

            expect(fs.unlinkSync).toHaveBeenCalled();
            const unlinkCall = vi.mocked(fs.unlinkSync).mock.calls[0];
            expect(unlinkCall[0].toString()).toContain("old.jsbundle");
        });

        it("should bundle .js and .ts files with esbuild", async () => {
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce([])
                .mockReturnValueOnce(["myAction.ts"]);

            await bundleJs();

            expect(esbuild.build).toHaveBeenCalledWith(
                expect.objectContaining({
                    bundle: true,
                    format: "iife",
                    globalName: "__titan_exports",
                    platform: "neutral",
                    target: "es2020",
                })
            );

            const buildCall = vi.mocked(esbuild.build).mock.calls[0][0];
            expect(buildCall.entryPoints[0]).toContain("myAction.ts");
            expect(buildCall.outfile).toContain("myAction.jsbundle");
        });

        it("should include correct banner and footer", async () => {
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce([])
                .mockReturnValueOnce(["testAction.js"]);

            await bundleJs();

            const buildCall = vi.mocked(esbuild.build).mock.calls[0][0];

            expect(buildCall.banner?.js).toContain("const defineAction = (fn) => fn;");
            expect(buildCall.footer?.js).toContain('globalThis["testAction"]');
            expect(buildCall.footer?.js).toContain("__titan_exports");
        });

        it("should handle multiple action files", async () => {
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce([])
                .mockReturnValueOnce(["action1.js", "action2.ts", "action3.js"]);

            await bundleJs();

            expect(esbuild.build).toHaveBeenCalledTimes(3);
        });

        it("should skip non-js/ts files", async () => {
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce([])
                .mockReturnValueOnce(["action.js", "action.rs", "readme.md"]);

            await bundleJs();

            expect(esbuild.build).toHaveBeenCalledTimes(1);
        });

        it("should not call esbuild when no action files exist", async () => {
            vi.mocked(fs.readdirSync).mockReturnValue([]);

            await bundleJs();

            expect(esbuild.build).not.toHaveBeenCalled();
        });
    });
});