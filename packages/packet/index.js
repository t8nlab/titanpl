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
 * Recursive copy
 */
function copyDir(src, dest, filter) {
  if (filter && !filter(src)) return;

  const stats = fs.lstatSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const file of fs.readdirSync(src)) {
      copyDir(path.join(src, file), path.join(dest, file), filter);
    }
  } else {
    fs.copyFileSync(src, dest);
  }
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

  const tanfigPath = path.join(root, "tanfig.json");
  if (fs.existsSync(tanfigPath)) {
    fs.copyFileSync(tanfigPath, path.join(dist, "tanfig.json"));
  }
  const titanExtPath = path.join(root, "titan.json");
  if (fs.existsSync(titanExtPath)) {
    fs.copyFileSync(titanExtPath, path.join(dist, "titan.json"));
  }

  return dist;
}

/**
 * Release build (Production ready folder)
 */
export async function release(root = process.cwd()) {
  const dist = await build(root);
  const buildDir = path.join(root, "build");

  // Read config
  let config = {};
  const configPath = fs.existsSync(path.join(root, "tanfig.json"))
    ? path.join(root, "tanfig.json")
    : fs.existsSync(path.join(root, "titan.json"))
      ? path.join(root, "titan.json")
      : null;

  if (configPath) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) { }
  }

  const filesToCopy = config.build && config.build.files ? config.build.files : ["public", "static", "db", "config", "tanfig.json", "titan.json"];

  // Clear or ensure build dir
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  fs.mkdirSync(buildDir, { recursive: true });

  // 1. Copy dist
  copyDir(dist, path.join(buildDir, "dist"));

  // 2. Extra files/folders from root based on config
  for (const item of filesToCopy) {
    const src = path.join(root, item);
    if (fs.existsSync(src)) {
      const dest = path.join(buildDir, item);
      copyDir(src, dest);
    }
  }

  // 3. Copy package.json & tanfig.json
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    fs.copyFileSync(pkgPath, path.join(buildDir, "package.json"));
  }
  const tanfigPath = path.join(root, "tanfig.json");
  if (fs.existsSync(tanfigPath)) {
    fs.copyFileSync(tanfigPath, path.join(buildDir, "tanfig.json"));
  }
  const titanConfigPath = path.join(root, "titan.json");
  if (fs.existsSync(titanConfigPath)) {
    fs.copyFileSync(titanConfigPath, path.join(buildDir, "titan.json"));
  }

  // 4. Create .env
  fs.writeFileSync(path.join(buildDir, ".env"), "TITAN_DEV=0\n");

  // 5. Extract extensions
  const extDir = path.join(buildDir, ".ext");
  fs.mkdirSync(extDir, { recursive: true });

  const nodeModules = path.join(root, "node_modules");
  if (fs.existsSync(nodeModules)) {
    const findExtensions = (dir, depth = 0) => {
      if (depth > 2) return;
      if (!fs.existsSync(dir)) return;

      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const stats = fs.lstatSync(fullPath);
          if (stats.isDirectory()) {
            if (file === "node_modules" && depth > 0) continue;

            const titanJson = path.join(fullPath, "titan.json");
            if (fs.existsSync(titanJson)) {
              let targetPkgName = file;
              const parentDirName = path.basename(dir);
              if (parentDirName.startsWith("@")) {
                targetPkgName = path.join(parentDirName, file);
              }

              const destPath = path.join(extDir, targetPkgName);
              fs.mkdirSync(path.dirname(destPath), { recursive: true });

              copyDir(fullPath, destPath, (src) => {
                const rel = path.relative(fullPath, src);
                return !rel.startsWith("node_modules");
              });
            } else {
              findExtensions(fullPath, depth + 1);
            }
          }
        } catch (e) { }
      }
    };
    findExtensions(nodeModules);
  }

  // 6. Copy Engine binaries
  if (fs.existsSync(path.join(nodeModules, "@titanpl"))) {
    const scopeDir = path.join(nodeModules, "@titanpl");
    const folders = fs.readdirSync(scopeDir);
    for (const folder of folders) {
      if (folder.startsWith("engine-")) {
        const engineDest = path.join(extDir, "@titanpl", folder);
        copyDir(path.join(scopeDir, folder), engineDest);
      }
    }
  }

  // 7. Create node_modules junction to .ext for engine resolution
  // If env is 'deploy' or 'production', we might want to skip this for a cleaner build
  const buildEnv = config.build && (config.build.env || config.build.purpose) ? (config.build.env || config.build.purpose) : "test";

  if (buildEnv !== "deploy" && buildEnv !== "production") {
    const nmSymlink = path.join(buildDir, "node_modules");
    if (!fs.existsSync(nmSymlink)) {
      try {
        // Junctions don't require admin on Windows
        fs.symlinkSync(".ext", nmSymlink, "junction");
      } catch (e) {
        try {
          fs.symlinkSync(".ext", nmSymlink, "dir");
        } catch (e2) {
          // Fallback or ignore if symlink creation is totally restricted
        }
      }
    }
  }

  // 8. Create 'titan' executable link in the build root for easy starting
  const binName = process.platform === "win32" ? "titan-server.exe" : "titan-server";
  let engineBin = null;

  // Strategy A: Search in the .ext we just populated
  const findInExt = (dir) => {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        // Check both pkgRoot/bin/titan-server and pkgRoot/titan-server (some layouts differ)
        const p1 = path.join(full, "bin", binName);
        if (fs.existsSync(p1)) return p1;
        const p2 = path.join(full, binName);
        if (fs.existsSync(p2)) return p2;

        const found = findInExt(full);
        if (found) return found;
      }
    }
    return null;
  };

  engineBin = findInExt(extDir);

  // Strategy B: Monorepo fallback (if building inside the titanpl repo)
  if (!engineBin) {
    let current = root;
    for (let i = 0; i < 5; i++) {
      const potential = path.join(current, "engine", "target", "release", binName);
      if (fs.existsSync(potential)) {
        engineBin = potential;
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  if (engineBin) {
    const linkName = binName; // Keep the original name 'titan-server'
    const linkPath = path.join(buildDir, linkName);

    if (!fs.existsSync(linkPath)) {
      try {
        // Always copy the binary to the root for maximum portability in the 'build' folder
        fs.copyFileSync(engineBin, linkPath);
        if (process.platform !== "win32") {
          fs.chmodSync(linkPath, 0o755);
        }
      } catch (e) {
        console.error(`[Titan] Failed to create titan binary: ${e.message}`);
      }
    }
  }

  return buildDir;
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