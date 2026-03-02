import path from "path";
import fs from "fs";

/**
 * Get project type (js or ts)
 */
function getProjectType(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg.titan && pkg.titan.template && pkg.titan.template.includes("ts")) return "ts";
  } catch (e) { }

  if (fs.existsSync(path.join(root, "tsconfig.json"))) return "ts";
  return "js";
}

/**
 * Ensure dist directory exists
 */
function ensureDist(root) {
  const dist = path.join(root, "dist");
  const actions = path.join(dist, "actions");

  if (!fs.existsSync(dist)) {
    fs.mkdirSync(dist, { recursive: true });
  }

  if (!fs.existsSync(actions)) {
    fs.mkdirSync(actions, { recursive: true });
  }

  return dist;
}

/**
 * Production build
 */
export async function build(root = process.cwd()) {
  const type = getProjectType(root);
  const { bundle: bundleActions } = await import(`./${type}/titan/bundle.js`);
  const { buildMetadata } = await import(`./${type}/titan/builder.js`);

  const dist = ensureDist(root);

  await buildMetadata(root, dist);
  await bundleActions({
    root,
    outDir: dist,
  });

  return dist;
}

/**
 * Dev mode build
 */
export async function dev(options = {}) {
  const root = typeof options === 'string' ? options : (options.root || process.cwd());
  const type = getProjectType(root);
  const { dev: devServer } = await import(`./${type}/titan/dev.js`);

  const dist = ensureDist(root);

  await devServer({
    root,
    outDir: dist,
    onRebuild: options.onRebuild
  });

  return dist;
}

/**
 * Direct export of current project tools
 */
export async function getTools(root = process.cwd()) {
  const type = getProjectType(root);
  const bundleModule = await import(`./${type}/titan/bundle.js`);
  const builderModule = await import(`./${type}/titan/builder.js`);
  return {
    bundleActions: bundleModule.bundle,
    buildMetadata: builderModule.buildMetadata
  };
}