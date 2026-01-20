import fs from "fs";
import path from "path";
import esbuild from "esbuild";

const root = process.cwd();
const actionsDir = path.join(root, "app", "actions");
const outDir = path.join(root, "server", "actions");

export async function bundle() {
  const start = Date.now();
  await bundleJs();
  // console.log(`[Titan] Bundle finished in ${((Date.now() - start) / 1000).toFixed(2)}s`);
}

async function bundleJs() {
  // console.log("[Titan] Bundling JS actions...");

  fs.mkdirSync(outDir, { recursive: true });

  // Clean old bundles
  if (fs.existsSync(outDir)) {
    const oldFiles = fs.readdirSync(outDir);
    for (const file of oldFiles) {
      fs.unlinkSync(path.join(outDir, file));
    }
  }

  const files = fs.readdirSync(actionsDir).filter(f => f.endsWith(".js") || f.endsWith(".ts"));
  if (files.length === 0) return;

  // console.log(`[Titan] Bundling ${files.length} JS actions...`);

  for (const file of files) {
    const actionName = path.basename(file, path.extname(file));

    const entry = path.join(actionsDir, file);

    // Rust runtime expects `.jsbundle` extension — consistent with previous design
    const outfile = path.join(outDir, actionName + ".jsbundle");

    // console.log(`[Titan] Bundling ${entry} → ${outfile}`);

    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "iife",
      globalName: "__titan_exports",
      platform: "neutral",
      target: "es2020",
      logLevel: "silent",
      banner: {
        js: "const defineAction = (fn) => fn; const Titan = t;"
      },

      footer: {
        js: `
    (function () {
      const fn =
        __titan_exports["${actionName}"] ||
        __titan_exports.default;
    
      if (typeof fn !== "function") {
        throw new Error("[Titan] Action '${actionName}' not found or not a function");
      }
    
      globalThis["${actionName}"] = function(request_arg) {
         globalThis.req = request_arg;
         return fn(request_arg);
      };
    })();
    `
      }
    });
  }

  // console.log("[Titan] JS Bundling finished.");
}
