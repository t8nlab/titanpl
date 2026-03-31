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

  return dist;
}

/**
 * Release build (Production ready folder)
 */
export async function release(root = process.cwd()) {
  const buildDir = path.join(root, "build");

  // Step 1: Pre-build (Production mode)
  // Run production build to generate 'dist' folder
  const dist = await build(root);

  // Step 2: Clear or ensure build dir
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  fs.mkdirSync(buildDir, { recursive: true });

  // Step 3: Read config and files list
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

  // Default files to copy from root
  const defaultFiles = ["public", "static", "db", "config", "views", "auth"];
  const userFiles = config.build && Array.isArray(config.build.files) ? config.build.files : [];
  const filesToCopy = Array.from(new Set([...defaultFiles, ...userFiles]));

  // Step 4: Copy Files & Folders from root and app folders to build
  for (const item of filesToCopy) {
    // Check root first, then app/ folder
    const src = path.join(root, item);
    const appSrc = path.join(root, "app", item);
    const dest = path.join(buildDir, item);

    if (fs.existsSync(src)) {
      copyDir(src, dest);
    } else if (fs.existsSync(appSrc)) {
      const appDest = path.join(buildDir, "app", item);
      copyDir(appSrc, appDest);
    }
  }

  // Step 5: Copy generated 'dist' (static routes/actions metadata)
  copyDir(dist, path.join(buildDir, "dist"));

  // Step 6: Copy essential config files (mandatory for runtime)
  const essentials = ["package.json", "tanfig.json", "titan.json", "t.env", ".env"];
  for (const f of essentials) {
    const src = path.join(root, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(buildDir, f));
    }
  }

  // Step 7: Create .env for production
  fs.writeFileSync(path.join(buildDir, ".env"), "TITAN_DEV=0\n");

  // Step 8: Extract Extensions
  const extDir = path.join(buildDir, ".ext");
  fs.mkdirSync(extDir, { recursive: true });

  const nodeModules = path.join(root, "node_modules");
  if (fs.existsSync(nodeModules)) {
    const localPkgs = path.resolve(root, "../../packages"); 
    if (fs.existsSync(localPkgs)) {
       const pkgs = fs.readdirSync(localPkgs);
       for (const pkg of pkgs) {
           const pkgPath = path.join(localPkgs, pkg);
           const titanJsonPath = path.join(pkgPath, "titan.json");
           if (fs.existsSync(titanJsonPath)) {
               try {
                   const config = JSON.parse(fs.readFileSync(titanJsonPath, "utf8"));
                   const extName = config.name;
                   const dest = path.join(extDir, extName.includes("/") ? extName : extName);
                   copyDir(pkgPath, dest);
               } catch(e) {}
           }
       }
    }
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
              if (fs.existsSync(destPath)) continue; // Don't overwrite monorepo packages
              
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

    // Also copy engine binaries if they exist in node_modules
    if (fs.existsSync(path.join(nodeModules, "@titanpl"))) {
      const scopeDir = path.join(nodeModules, "@titanpl");
      const folders = fs.readdirSync(scopeDir);
      for (const folder of folders) {
        if (folder.startsWith("engine-") || folder.startsWith("runtime-")) {
          const engineDest = path.join(extDir, "@titanpl", folder);
          copyDir(path.join(scopeDir, folder), engineDest);
        }
      }
    }
  }

  // Step 9: Copy/Extract titan-server binary to build root
  const binName = process.platform === "win32" ? "titan-server.exe" : "titan-server";
  let engineBin = null;

  // Search in .ext
  const searchBin = (dir) => {
     if (!fs.existsSync(dir)) return null;
     const entries = fs.readdirSync(dir);
     for (const e of entries) {
         const full = path.join(dir, e);
         if (fs.statSync(full).isDirectory()) {
             const p1 = path.join(full, "bin", binName);
             if (fs.existsSync(p1)) return p1;
             const p2 = path.join(full, binName);
             if (fs.existsSync(p2)) return p2;
             const found = searchBin(full);
             if (found) return found;
         }
     }
     return null;
  };
  engineBin = searchBin(extDir);

  // Fallback to monorepo binary (if building in repo)
  if (!engineBin) {
    let curr = root;
    for(let i=0; i<3; i++) {
        const potential = path.join(curr, "engine", "target", "release", binName);
        if (fs.existsSync(potential)) {
            engineBin = potential;
            break;
        }
        curr = path.dirname(curr);
    }
  }

  if (engineBin) {
    const destBin = path.join(buildDir, binName);
    fs.copyFileSync(engineBin, destBin);
    if (process.platform !== "win32") fs.chmodSync(destBin, 0o755);
  }

  // Step 10: In production builds, we DON'T use symlinks for node_modules.
  // Instead, the engine knows to look in .ext.

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