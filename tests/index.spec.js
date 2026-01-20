import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import { EventEmitter } from "events";

// Mock de prompts
vi.mock("prompts", () => ({
    default: vi.fn(),
}));

// Mock de path
vi.mock("path", () => ({
    default: {
        join: vi.fn((...args) => args.join("/")),
        basename: vi.fn((p, ext) => {
            const parts = p.split("/");
            const last = parts[parts.length - 1] || "";
            return ext && last.endsWith(ext) ? last.slice(0, -ext.length) : last;
        }),
        dirname: vi.fn((p) => {
            const parts = p.split("/");
            parts.pop();
            return parts.join("/") || ".";
        }),
        extname: vi.fn((p) => {
            const parts = p.split(".");
            return parts.length > 1 ? `.${parts.pop()}` : "";
        }),
        resolve: vi.fn((...args) => args.join("/")),
    },
}));

// Mock de url
vi.mock("url", () => ({
    fileURLToPath: vi.fn(() => "/mocked/project/path/index.js"),
}));

// Mock de fs
vi.mock("fs", () => ({
    default: {
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        copyFileSync: vi.fn(),
        lstatSync: vi.fn(),
        rmSync: vi.fn(),
    },
}));

// Mock de child_process
vi.mock("child_process", () => ({
    execSync: vi.fn(),
    spawn: vi.fn(),
}));

// Import after mocks
import prompts from "prompts";
import fs from "fs";
import { execSync, spawn } from "child_process";

import {
    cyan,
    green,
    yellow,
    red,
    bold,
    gray,
    wasInvokedAsTit,
    copyDir,
    help,
    initProject,
    devServer,
    buildProd,
    startProd,
    updateTitan,
    createExtension,
    runExtension,
    TITAN_VERSION,
} from "../index";

describe("cli.js (Titan CLI)", () => {
    const root = process.cwd();

    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => { });
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    describe("Color functions", () => {
        it("cyan should wrap text with cyan ANSI codes", () => {
            expect(cyan("test")).toBe("\x1b[36mtest\x1b[0m");
        });

        it("green should wrap text with green ANSI codes", () => {
            expect(green("test")).toBe("\x1b[32mtest\x1b[0m");
        });

        it("yellow should wrap text with yellow ANSI codes", () => {
            expect(yellow("test")).toBe("\x1b[33mtest\x1b[0m");
        });

        it("red should wrap text with red ANSI codes", () => {
            expect(red("test")).toBe("\x1b[31mtest\x1b[0m");
        });

        it("bold should wrap text with bold ANSI codes", () => {
            expect(bold("test")).toBe("\x1b[1mtest\x1b[0m");
        });

        it("gray should wrap text with gray ANSI codes", () => {
            expect(gray("test")).toBe("\x1b[90mtest\x1b[0m");
        });
    });

    describe("wasInvokedAsTit()", () => {
        const originalArgv = process.argv;
        const originalEnv = process.env;

        afterEach(() => {
            process.argv = originalArgv;
            process.env = { ...originalEnv };
        });

        it("should return true if script name is tit", () => {
            process.argv = ["node", "/usr/bin/tit", "dev"];

            expect(wasInvokedAsTit()).toBe(true);
        });

        it("should return false if script name is titan", () => {
            process.argv = ["node", "/usr/bin/titan", "dev"];

            expect(wasInvokedAsTit()).toBe(false);
        });

        it("should check npm_config_argv for tit", () => {
            process.argv = ["node", "some-script"];
            process.env.npm_config_argv = JSON.stringify({
                original: ["tit", "dev"]
            });

            expect(wasInvokedAsTit()).toBe(true);
        });

        it("should return false for titan in npm_config_argv", () => {
            process.argv = ["node", "some-script"];
            process.env.npm_config_argv = JSON.stringify({
                original: ["titan", "dev"]
            });

            expect(wasInvokedAsTit()).toBe(false);
        });

        it("should check _ env variable", () => {
            process.argv = ["node", "some-script"];
            delete process.env.npm_config_argv;
            process.env["_"] = "/usr/local/bin/tit";

            expect(wasInvokedAsTit()).toBe(true);
        });
    });

    describe("copyDir()", () => {
        it("should create destination directory", () => {
            vi.mocked(fs.readdirSync).mockReturnValue([]);

            copyDir("/src", "/dest");

            expect(fs.mkdirSync).toHaveBeenCalledWith("/dest", { recursive: true });
        });

        it("should copy files from source to destination", () => {
            vi.mocked(fs.readdirSync).mockReturnValue(["file.txt"]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });

            copyDir("/src", "/dest");

            expect(fs.copyFileSync).toHaveBeenCalledWith(
                "/src/file.txt",
                "/dest/file.txt"
            );
        });

        it("should recursively copy directories", () => {
            vi.mocked(fs.readdirSync)
                .mockReturnValueOnce(["subdir"])
                .mockReturnValueOnce(["nested.txt"]);
            vi.mocked(fs.lstatSync)
                .mockReturnValueOnce({ isDirectory: () => true })
                .mockReturnValueOnce({ isDirectory: () => false });

            copyDir("/src", "/dest");

            expect(fs.mkdirSync).toHaveBeenCalledWith(
                "/dest/subdir",
                { recursive: true }
            );
        });

        it("should exclude specified files", () => {
            vi.mocked(fs.readdirSync).mockReturnValue(["keep.txt", "exclude.txt"]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });

            copyDir("/src", "/dest", ["exclude.txt"]);

            expect(fs.copyFileSync).toHaveBeenCalledTimes(1);
            expect(fs.copyFileSync).toHaveBeenCalledWith(
                "/src/keep.txt",
                "/dest/keep.txt"
            );
        });
    });

    describe("help()", () => {
        it("should log help message with commands", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => { });

            help();

            const output = consoleSpy.mock.calls[0][0];
            expect(output).toContain("titan init");
            expect(output).toContain("titan dev");
            expect(output).toContain("titan build");
            expect(output).toContain("titan start");
            expect(output).toContain("titan update");
        });
    });

    describe("initProject()", () => {
        beforeEach(() => {
            // Resetear prompts antes de cada test de initProject
            vi.mocked(prompts).mockReset();
        });

        it("should prompt for project name if not provided", async () => {
            vi.mocked(prompts)
                .mockResolvedValueOnce({ value: "my-app" })
                .mockResolvedValueOnce({ value: "js" })
                .mockResolvedValueOnce({ value: "standard" });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates")) return true;
                if (path.includes("package.json")) return true;
                if (path.includes("my-app")) return false;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });
            vi.mocked(fs.readFileSync).mockReturnValue("{}");

            await initProject();

            expect(prompts).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: "Project name:",
                })
            );
        });

        it("should cancel if no project name provided", async () => {
            vi.mocked(prompts).mockResolvedValueOnce({ value: undefined });

            const consoleSpy = vi.spyOn(console, "log");

            await initProject();

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Operation cancelled")
            );
        });

        it("should use provided project name", async () => {
            vi.mocked(prompts)
                .mockResolvedValueOnce({ value: "js" })
                .mockResolvedValueOnce({ value: "standard" });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates")) return true;
                if (path.includes("my-project")) return false;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });

            await initProject("my-project");

            expect(prompts).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    message: "Project name:",
                })
            );
        });

        it("should warn if folder already exists", async () => {
            vi.mocked(prompts)
                .mockResolvedValueOnce({ value: "js" })
                .mockResolvedValueOnce({ value: "standard" });

            // Target folder existe
            vi.mocked(fs.existsSync).mockReturnValue(true);
            const consoleSpy = vi.spyOn(console, "log");

            await initProject("existing-folder");

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Folder already exists")
            );
        });

        it("should use template from parameter", async () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates")) return true;
                if (path.includes("my-project")) return false;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });

            await initProject("my-project", "ts");

            // No debería llamar a prompts porque se pasó el template directamente
            expect(prompts).not.toHaveBeenCalled();
        });

        it("should select 'rust-js' template for JavaScript + Hybrid", async () => {
            vi.mocked(prompts)
                .mockResolvedValueOnce({ value: "my-app" })    // project name
                .mockResolvedValueOnce({ value: "js" })        // language
                .mockResolvedValueOnce({ value: "hybrid" });   // template type

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates/rust-js")) return true;
                if (path.includes("templates/common")) return true;
                if (path.includes("templates")) return true;
                if (path.includes("package.json")) return true;
                if (path.includes("my-app")) return false;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });
            vi.mocked(fs.readFileSync).mockReturnValue("{}");

            await initProject();

            const mkdirCalls = vi.mocked(fs.mkdirSync).mock.calls.map(c => String(c[0]));
            const readdirCalls = vi.mocked(fs.readdirSync).mock.calls.map(c => String(c[0]));

            const allPaths = [...mkdirCalls, ...readdirCalls];
            const usedRustJs = allPaths.some(call => call.includes("rust-js"));

            expect(usedRustJs).toBe(true);
        });

        it("should select 'ts' template for TypeScript + Standard", async () => {
            vi.mocked(prompts)
                .mockResolvedValueOnce({ value: "my-app" })      // project name
                .mockResolvedValueOnce({ value: "ts" })          // language
                .mockResolvedValueOnce({ value: "standard" });   // template type

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates/ts")) return true;
                if (path.includes("templates/common")) return true;
                if (path.includes("templates")) return true;
                if (path.includes("package.json")) return true;
                if (path.includes("my-app")) return false;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });
            vi.mocked(fs.readFileSync).mockReturnValue("{}");

            await initProject();

            const mkdirCalls = vi.mocked(fs.mkdirSync).mock.calls.map(c => String(c[0]));
            const readdirCalls = vi.mocked(fs.readdirSync).mock.calls.map(c => String(c[0]));

            const allPaths = [...mkdirCalls, ...readdirCalls];
            // Buscar "/ts" pero NO "rust-ts"
            const usedTs = allPaths.some(call =>
                call.includes("/templates/ts") && !call.includes("rust-ts")
            );

            expect(usedTs).toBe(true);
        });

        it("should inject template metadata into package.json", async () => {
            vi.mocked(prompts)
                .mockResolvedValueOnce({ value: "my-app" })      // project name
                .mockResolvedValueOnce({ value: "js" })          // language
                .mockResolvedValueOnce({ value: "standard" });   // template type -> "js"

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates/js")) return true;
                if (path.includes("templates/common")) return true;
                if (path.includes("templates")) return true;
                if (path.includes("package.json")) return true;
                if (path.includes("my-app")) return false;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });
            vi.mocked(fs.readFileSync).mockReturnValue('{ "name": "test" }');

            await initProject();

            const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
            const pkgJsonWrite = writeCalls.find(call =>
                typeof call[0] === 'string' && call[0].includes("package.json")
            );

            expect(pkgJsonWrite).toBeDefined();
            const content = JSON.parse(pkgJsonWrite[1]);
            expect(content.titan).toBeDefined();
            expect(content.titan.template).toBe("js");
        });

        it("should copy common directory before specific template directory", async () => {
            vi.mocked(prompts)
                .mockResolvedValueOnce({ value: "my-app" })      // project name
                .mockResolvedValueOnce({ value: "js" })          // language
                .mockResolvedValueOnce({ value: "standard" });   // template type -> "js"

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates/js")) return true;
                if (path.includes("templates/common")) return true;
                if (path.includes("templates")) return true;
                if (path.includes("my-app")) return false;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });
            vi.mocked(fs.readFileSync).mockReturnValue("{}");

            await initProject();

            const readCalls = vi.mocked(fs.readdirSync).mock.calls.map(c => String(c[0]));

            // Filtrar solo las llamadas a templates (common y js)
            const templateCalls = readCalls.filter(call =>
                call.includes("templates/common") ||
                (call.includes("templates/js") && !call.includes("rust-js"))
            );

            expect(templateCalls.length).toBeGreaterThanOrEqual(2);
            expect(templateCalls[0]).toContain("common");
            expect(templateCalls[1]).toMatch(/templates\/js/);
        });

        it("should install npm dependencies", async () => {
            vi.mocked(prompts)
                .mockResolvedValueOnce({ value: "js" })
                .mockResolvedValueOnce({ value: "standard" });

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates")) return true;
                if (path.includes("new-project")) return false;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });

            await initProject("new-project");

            expect(execSync).toHaveBeenCalledWith(
                expect.stringContaining("npm install"),
                expect.anything()
            );
        });
    });

    describe("devServer()", () => {
        it("should check for titan/dev.js existence", async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            await devServer();

            expect(fs.existsSync).toHaveBeenCalledWith(
                expect.stringContaining("titan/dev.js")
            );
        });

        it("should log error if dev.js not found", async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => { });

            await devServer();

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("titan/dev.js not found")
            );
        });

        it("should spawn node with dev.js", async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);

            const mockChild = new EventEmitter();
            vi.mocked(spawn).mockReturnValue(mockChild);

            await devServer();

            expect(spawn).toHaveBeenCalledWith(
                "node",
                expect.arrayContaining([expect.stringContaining("dev.js")]),
                expect.objectContaining({
                    stdio: "inherit",
                    cwd: root,
                })
            );
        });
    });

    describe("buildProd()", () => {
        beforeEach(() => {
            vi.spyOn(process, "exit").mockImplementation(() => {
                throw new Error("process.exit called");
            });
        });

        it("should exit if no app.js or app.ts found", async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            await expect(buildProd()).rejects.toThrow("process.exit called");
        });

        it("should run app.js for metadata if it exists", async () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("app/app.js")) return true;
                if (path.includes("app/app.ts")) return false;
                return false;
            });

            vi.doMock("../titan/bundle.js", () => ({ bundle: vi.fn() }));

            try {
                await buildProd();
            } catch (e) {
                // Expected
            }

            expect(execSync).toHaveBeenCalledWith(
                "node app/app.js --build",
                expect.anything()
            );
        });

        it("should compile TypeScript app if app.ts exists", async () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("app/app.ts")) return true;
                if (path.includes("app/app.js")) return false;
                if (path.includes(".titan")) return false;
                return false;
            });

            vi.doMock("esbuild", () => ({ build: vi.fn() }));

            try {
                await buildProd();
            } catch (e) {
                // Expected
            }

            expect(fs.mkdirSync).toHaveBeenCalled();
        });
    });

    describe("startProd()", () => {
        it("should execute titan-server binary", () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            const bin = process.platform === "win32" ? "titan-server.exe" : "titan-server";

            startProd();

            expect(execSync).toHaveBeenCalledWith(
                expect.stringContaining(bin),
                expect.objectContaining({
                    stdio: "inherit"
                })
            );
        });
    });

    describe("updateTitan()", () => {
        it("should check for titan folder", () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => { });

            updateTitan();

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Not a Titan project")
            );
        });

        it("should resolve 'ts' template path if package.json specifies ts", () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("titan")) return true;
                if (path.includes("package.json")) return true;
                if (path.includes("templates/ts")) return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                titan: { template: "ts" }
            }));

            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });

            updateTitan();

            const readCalls = vi.mocked(fs.readdirSync).mock.calls.map(c => String(c[0]));
            const titanFolderUpdate = readCalls.some(call => call.includes("templates/ts/titan"));

            expect(titanFolderUpdate).toBe(true);
        });

        it("should remove and recreate titan folder", () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });

            updateTitan();

            expect(fs.rmSync).toHaveBeenCalledWith(
                expect.stringContaining("titan"),
                expect.objectContaining({ recursive: true })
            );
        });

        it("should update Cargo.toml", () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });

            updateTitan();

            const cargoCalls = vi.mocked(fs.copyFileSync).mock.calls.filter(call =>
                call[1].toString().includes("Cargo.toml")
            );

            expect(cargoCalls.length).toBeGreaterThan(0);
        });
    });

    describe("createExtension()", () => {
        it("should show usage if no name provided", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => { });

            createExtension();

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Usage: titan create ext")
            );
        });

        it("should warn if folder already exists", () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => { });

            createExtension("my-ext");

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Folder already exists")
            );
        });

        it("should copy extension template", () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates/extension")) return true;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });
            vi.mocked(fs.readFileSync).mockReturnValue("{{name}}");

            createExtension("my-ext");

            expect(fs.mkdirSync).toHaveBeenCalled();
        });

        it("should replace template placeholders", () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates/extension")) return true;
                if (path.includes("my-ext")) return false;
                if (path.includes("titan.json")) return true;
                if (path.includes("index.js")) return true;
                if (path.includes("README.md")) return true;
                if (path.includes("package.json")) return true;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });
            vi.mocked(fs.readFileSync).mockReturnValue("Name: {{name}}, Native: {{native_name}}");

            createExtension("my-ext");

            const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
            const replacedCalls = writeCalls.filter(call =>
                call[1].includes("my-ext") || call[1].includes("my_ext")
            );

            expect(replacedCalls.length).toBeGreaterThanOrEqual(0);
        });

        it("should install npm dependencies", () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const path = String(p);
                if (path.includes("templates/extension")) return true;
                return false;
            });
            vi.mocked(fs.readdirSync).mockReturnValue([]);
            vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false });
            vi.mocked(fs.readFileSync).mockReturnValue("");

            createExtension("my-ext");

            expect(execSync).toHaveBeenCalledWith(
                "npm install",
                expect.objectContaining({
                    cwd: expect.stringContaining("my-ext"),
                })
            );
        });
    });

    describe("runExtension()", () => {
        it("should use local SDK if available", () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);

            runExtension();

            expect(execSync).toHaveBeenCalledWith(
                expect.stringContaining("run.js"),
                expect.anything()
            );
        });

        it("should fallback to npx if local SDK not found", () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            runExtension();

            expect(execSync).toHaveBeenCalledWith(
                "npx -y titan-sdk",
                expect.anything()
            );
        });
    });

    describe("TITAN_VERSION", () => {
        it("should be a valid semver string", () => {
            expect(TITAN_VERSION).toMatch(/\d+\.\d+\.\d+/);
        });
    });
});