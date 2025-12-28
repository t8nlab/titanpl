import fs from "fs";
import path from "path";
import esbuild from "esbuild";

const root = process.cwd();
const actionsDir = path.join(root, "app", "actions");
const outDir = path.join(root, "server", "actions");

export async function bundle() {
  console.log("[Titan] Bundling actions...");

  fs.mkdirSync(outDir, { recursive: true });

  // Clean old bundles
  for (const file of fs.readdirSync(outDir)) {
    fs.unlinkSync(path.join(outDir, file));
  }

  const files = fs.readdirSync(actionsDir).filter(f => f.endsWith(".js"));

  for (const file of files) {
    const actionName = path.basename(file, ".js");

    const entry = path.join(actionsDir, file);

    // Rust runtime expects `.jsbundle` extension — consistent with previous design
    const outfile = path.join(outDir, file.replace(".js", ".jsbundle"));

    console.log(`[Titan] Bundling ${entry} → ${outfile}`);

    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "iife",
      globalName: "__titan_exports",
      platform: "neutral",
      target: "es2020",

      footer: {
        js: `
    (function () {
      const fn =
        __titan_exports["${actionName}"] ||
        __titan_exports.default;
    
      if (typeof fn !== "function") {
        throw new Error("[Titan] Action '${actionName}' not found or not a function");
      }
    
      globalThis["${actionName}"] = fn;
    })();
    `
      }
    });



  }

  console.log("[Titan] Bundling finished.");
}
