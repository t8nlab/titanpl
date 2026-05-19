import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function updateCommand(option, value) {
    if (option === '--status' || option === '-s') {
        await checkStatus();
        return;
    }

    if (option === '-t' || option === '--template') {
        if (!value) {
            console.log(chalk.red("✖ Please specify a template name (js or ts)."));
            return;
        }
        await convertTemplate(value);
        return;
    }

    // Default update/migration logic
    const root = process.cwd();
    console.log(chalk.cyan(`\n→ Updating Titan project to latest...`));

    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        console.log(chalk.red(`✖ No package.json found. Are you in a project root ? `));
        return;
    }

    // 1. Update package.json versions
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        let modified = false;

        const titanDeps = [
            'titanpl',
            '@titanpl/cli',
            '@titanpl/route',
            '@titanpl/native',
            '@titanpl/packet',
            '@titanpl/core',
            '@titanpl/node',
            '@titanpl/engine-darwin-arm64',
            '@titanpl/engine-linux-x64',
            '@titanpl/engine-win32-x64',
        ];

        if (pkg.dependencies) {
            for (const dep of titanDeps) {
                if (pkg.dependencies[dep]) {
                    pkg.dependencies[dep] = "latest";
                    modified = true;
                }
            }
        }

        if (pkg.devDependencies) {
            for (const dep of titanDeps) {
                if (pkg.devDependencies[dep]) {
                    pkg.devDependencies[dep] = "latest";
                    modified = true;
                }
            }
        }

        if (modified) {
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
            console.log(chalk.green(`  ✔ Updated TitanPl dependencies in package.json`));
        }
    } catch (e) {
        console.log(chalk.yellow(`  ⚠️ Failed to update package.json: ${e.message}`));
    }

    // 2. Migration: rename titan.json to tanfig.json if needed
    const oldConfigPath = path.join(root, 'titan.json');
    const newConfigPath = path.join(root, 'tanfig.json');
    if (fs.existsSync(oldConfigPath) && !fs.existsSync(newConfigPath)) {
        fs.renameSync(oldConfigPath, newConfigPath);
        console.log(chalk.green(`  ✔ Migrated titan.json to tanfig.json`));
    }

    // 3. Refresh Dockerfile and dotfiles from templates
    let commonDir = null;
    const tryCommonPaths = [
        path.resolve(__dirname, '..', '..', '..', '..', 'templates', 'common'), // Monorepo
        path.resolve(__dirname, '..', '..', 'templates', 'common'), // NPM cli package
        path.resolve(__dirname, '..', '..', '..', 'templates', 'common') // Fallback
    ];

    for (const p of tryCommonPaths) {
        if (fs.existsSync(p)) {
            commonDir = p;
            break;
        }
    }

    if (commonDir) {
        const filesToSync = [
            ['Dockerfile', 'Dockerfile'],
            ['_dockerignore', '.dockerignore'],
            ['_gitignore', '.gitignore'],
        ];

        for (const [srcName, destName] of filesToSync) {
            const src = path.join(commonDir, srcName);
            const dest = path.join(root, destName);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, dest);
                console.log(chalk.green(`  ✔ Synchronized ${destName}`));
            }
        }

        // Also update app/t.native.d.ts if it exists
        const nativeTypesSrc = path.join(commonDir, 'app', 't.native.d.ts');
        const nativeTypesDest = path.join(root, 'app', 't.native.d.ts');
        if (fs.existsSync(nativeTypesSrc) && fs.existsSync(path.join(root, 'app'))) {
            fs.copyFileSync(nativeTypesSrc, nativeTypesDest);
            console.log(chalk.green(`  ✔ Updated app/t.native.d.ts`));
        }
    }

    console.log(chalk.green(`\n✔ Update complete!\n`));
    console.log(chalk.yellow(`  Please run 'npm install' to apply changes.\n`));
}

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'node.js' } }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

function findExtensions(nodeModulesPath) {
    const extensions = [];
    if (!fs.existsSync(nodeModulesPath)) return extensions;

    const dirs = fs.readdirSync(nodeModulesPath);
    for (const dir of dirs) {
        if (dir.startsWith('.')) continue;
        const dirPath = path.join(nodeModulesPath, dir);
        try {
            if (dir.startsWith('@')) {
                const subDirs = fs.readdirSync(dirPath);
                for (const subDir of subDirs) {
                    const subDirPath = path.join(dirPath, subDir);
                    const titanJsonPath = path.join(subDirPath, 'titan.json');
                    if (fs.existsSync(titanJsonPath)) {
                        extensions.push({
                            name: `${dir}/${subDir}`,
                            dir: subDirPath,
                            titanJsonPath
                        });
                    }
                }
            } else {
                const titanJsonPath = path.join(dirPath, 'titan.json');
                if (fs.existsSync(titanJsonPath)) {
                    extensions.push({
                        name: dir,
                        dir: dirPath,
                        titanJsonPath
                    });
                }
            }
        } catch (e) {
            // Ignore read errors
        }
    }
    return extensions;
}

async function checkStatus() {
    const root = process.cwd();
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        console.log(chalk.red("✖ No package.json found. Are you in a project root?"));
        return;
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(chalk.cyan(`\n🔍 Checking Titan project status and updates...\n`));

    // 1. Check NPM packages updates
    const localDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const titanDeps = Object.keys(localDeps).filter(dep => dep.startsWith('@titanpl/') || dep.startsWith('titanpl') || dep.startsWith('@tgrv/'));

    if (titanDeps.length > 0) {
        console.log(chalk.bold("📦 TitanPl Packages Update Status:"));
        const updateSuggestions = [];
        for (const dep of titanDeps) {
            try {
                let localVer = localDeps[dep];
                // Check if installed in node_modules first for actual version
                const nodeModulesPkgPath = path.join(root, 'node_modules', dep, 'package.json');
                if (fs.existsSync(nodeModulesPkgPath)) {
                    const nodeModulesPkg = JSON.parse(fs.readFileSync(nodeModulesPkgPath, 'utf8'));
                    localVer = nodeModulesPkg.version;
                } else {
                    localVer = localVer.replace(/[\^~]/g, '');
                }

                const npmData = await fetchJSON(`https://registry.npmjs.org/${dep}/latest`);
                const latestVer = npmData.version;
                if (localVer !== latestVer) {
                    console.log(`  - ${dep}: ${chalk.yellow(localVer)} → ${chalk.green(latestVer)} (Update available)`);
                    updateSuggestions.push(`${dep}@latest`);
                } else {
                    console.log(`  - ${dep}: ${chalk.green(localVer)} (Up to date)`);
                }
            } catch (err) {
                console.log(`  - ${dep}: ${localDeps[dep]} (Could not fetch latest version from NPM)`);
            }
        }
        if (updateSuggestions.length > 0) {
            console.log(chalk.yellow(`\n💡 To update packages, run:`));
            console.log(chalk.bold(`  npm install ${updateSuggestions.join(' ')}\n`));
        } else {
            console.log(chalk.green(`\n✔ All Titan packages are up to date.\n`));
        }
    }

    // 2. Scan and check extensions
    const extensions = [];
    if (fs.existsSync(path.join(root, 'titan.json'))) {
        extensions.push({
            name: pkg.name || path.basename(root),
            dir: root,
            titanJsonPath: path.join(root, 'titan.json')
        });
    }
    const nodeModulesPath = path.join(root, 'node_modules');
    extensions.push(...findExtensions(nodeModulesPath));

    // Deduplicate
    const seen = new Set();
    const uniqueExtensions = [];
    for (const ext of extensions) {
        if (!seen.has(ext.name)) {
            seen.add(ext.name);
            uniqueExtensions.push(ext);
        }
    }

    let jsCount = 0;
    let nativeCount = 0;

    console.log(chalk.bold("🔌 Installed Extensions Status:"));
    if (uniqueExtensions.length === 0) {
        console.log(chalk.gray("  No extensions found."));
    }

    for (const ext of uniqueExtensions) {
        try {
            const titanJson = JSON.parse(fs.readFileSync(ext.titanJsonPath, 'utf8'));
            const extType = titanJson.type || 'js';

            // Get version from package.json or titan.json fallback
            let version = 'unknown';
            try {
                const extPkgPath = path.join(ext.dir, 'package.json');
                if (fs.existsSync(extPkgPath)) {
                    const extPkg = JSON.parse(fs.readFileSync(extPkgPath, 'utf8'));
                    version = extPkg.version || titanJson.version || '1.0.0';
                } else {
                    version = titanJson.version || '1.0.0';
                }
            } catch (e) {
                version = titanJson.version || '1.0.0';
            }

            const errors = [];
            const warnings = [];

            if (extType === 'js') {
                jsCount++;
            } else {
                nativeCount++;

                // Check binaries
                const nativeConfig = titanJson.native || {};
                const winFile = nativeConfig.windows;
                const linuxFile = nativeConfig.linux;

                if (winFile) {
                    const winPath = path.join(ext.dir, winFile);
                    if (!fs.existsSync(winPath)) {
                        errors.push(`Missing Windows binary file: ${winFile}. This extension will not work on Windows.`);
                    }
                } else {
                    warnings.push(`No Windows binary configured in titan.json.`);
                }

                if (linuxFile) {
                    const linuxPath = path.join(ext.dir, linuxFile);
                    if (!fs.existsSync(linuxPath)) {
                        errors.push(`Missing Linux binary file: ${linuxFile}. This extension will not work on Linux.`);
                    }
                } else {
                    warnings.push(`No Linux binary configured in titan.json.`);
                }
            }

            // Check registration and verification on marketplace
            const normalName = ext.name.replace(/^@/, '');
            const marketUrl = `https://titanpl.vercel.app/api/extensions/${normalName}`;
            try {
                const marketData = await fetchJSON(marketUrl);
                const isVerified = marketData.isOfficial === true || marketData.isVerified === true;
                if (!isVerified) {
                    warnings.push(`Extension is NOT verified on marketplace.`);
                }
            } catch (err) {
                errors.push(`Not registered on TitanPl marketplace (API returned: ${err.message || 'Not Found'}).`);
            }

            // Display results
            if (errors.length === 0 && warnings.length === 0) {
                console.log(chalk.green(`  ✔ ${ext.name} (v${version}) [${extType.toUpperCase()}]`));
            } else {
                console.log(`\n  • ${chalk.bold(ext.name)} [Type: ${extType.toUpperCase()}] (v${version})`);
                for (const err of errors) {
                    console.log(chalk.red(`    ✖ ${err}`));
                }
                for (const warn of warnings) {
                    console.log(chalk.yellow(`    ⚠️ Warning: ${warn}`));
                }
            }
        } catch (e) {
            console.log(chalk.red(`    ✖ Failed to check extension ${ext.name}: ${e.message}`));
        }
    }

    console.log(chalk.bold(`\n📊 Extension Summary:`));
    console.log(`  Total: ${uniqueExtensions.length} (JS: ${jsCount}, Native: ${nativeCount})\n`);
}

async function convertTemplate(targetTemplate) {
    if (targetTemplate !== 'js' && targetTemplate !== 'ts') {
        console.log(chalk.red("✖ Invalid template. Choose 'js' or 'ts'."));
        return;
    }

    const root = process.cwd();
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        console.log(chalk.red("✖ No package.json found. Are you in a project root?"));
        return;
    }

    console.log(chalk.cyan(`\n→ Converting project template to '${targetTemplate}'...`));

    // 1. Update package.json
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        pkg.titan = pkg.titan || {};
        pkg.titan.template = targetTemplate;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        console.log(chalk.green("  ✔ Updated titan.template in package.json"));
    } catch (e) {
        console.log(chalk.red(`  ✖ Failed to update package.json: ${e.message}`));
        return;
    }

    // 2. Rename tsconfig.json <-> jsconfig.json
    const tsconfig = path.join(root, 'tsconfig.json');
    const jsconfig = path.join(root, 'jsconfig.json');

    if (targetTemplate === 'js') {
        if (fs.existsSync(tsconfig) && !fs.existsSync(jsconfig)) {
            fs.renameSync(tsconfig, jsconfig);
            console.log(chalk.green("  ✔ Renamed tsconfig.json to jsconfig.json"));
        }
    } else {
        if (fs.existsSync(jsconfig) && !fs.existsSync(tsconfig)) {
            fs.renameSync(jsconfig, tsconfig);
            console.log(chalk.green("  ✔ Renamed jsconfig.json to tsconfig.json"));
        }
    }

    // 3. Recursively rename all .js <-> .ts files
    const fromExt = targetTemplate === 'js' ? '.ts' : '.js';
    const toExt = targetTemplate === 'js' ? '.js' : '.ts';

    let count = 0;
    const renameFiles = (dir) => {
        for (const file of fs.readdirSync(dir)) {
            const fullPath = path.join(dir, file);
            if (fs.lstatSync(fullPath).isDirectory()) {
                const dirName = file.toLowerCase();
                // Exclude common build/dep directories
                if (dirName !== 'node_modules' && dirName !== 'dist' && dirName !== 'target' && dirName !== '.git' && dirName !== 'sandbox') {
                    renameFiles(fullPath);
                }
            } else {
                const ext = path.extname(file).toLowerCase();
                if (ext === fromExt && !file.toLowerCase().endsWith('.d.ts')) {
                    const newPath = fullPath.substring(0, fullPath.length - fromExt.length) + toExt;
                    fs.renameSync(fullPath, newPath);
                    console.log(chalk.gray(`    Renamed: ${path.relative(root, fullPath)} → ${path.relative(root, newPath)}`));
                    count++;
                }
            }
        }
    };

    renameFiles(path.join(root, 'app'));
    console.log(chalk.green(`\n✔ Conversion complete! Renamed ${count} files to ${toExt}.\n`));
}
