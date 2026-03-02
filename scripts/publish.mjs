import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

const version = process.argv[2];

if (!version) {
    console.error("Please provide a version number (e.g., npm run publish 1.5.0)");
    process.exit(1);
}

const getPackageJsons = (baseDir) => {
    const results = [];
    const absoluteBase = path.resolve(baseDir);

    // Add root
    results.push(path.join(absoluteBase, 'package.json'));

    // Check packages/
    const packagesDir = path.join(absoluteBase, 'packages');
    if (fs.existsSync(packagesDir)) {
        fs.readdirSync(packagesDir).forEach(p => {
            const pkgPath = path.join(packagesDir, p, 'package.json');
            if (fs.existsSync(pkgPath)) results.push(pkgPath);
        });
    }

    // Check templates/
    const templatesDir = path.join(absoluteBase, 'templates');
    if (fs.existsSync(templatesDir)) {
        fs.readdirSync(templatesDir).forEach(p => {
            const pkgPath = path.join(templatesDir, p, 'package.json');
            if (fs.existsSync(pkgPath)) results.push(pkgPath);
        });
    }

    // Check titanpl-sdk
    const sdkDir = path.join(absoluteBase, 'titanpl-sdk');
    if (fs.existsSync(sdkDir)) {
        const pkgPath = path.join(sdkDir, 'package.json');
        if (fs.existsSync(pkgPath)) results.push(pkgPath);
    }

    return results;
};

const packageJsonPaths = getPackageJsons(ROOT_DIR);

console.log(`Bumping to version ${version}...`);

const packageJsons = packageJsonPaths.map(pkgPath => {
    try {
        return {
            dir: path.dirname(pkgPath),
            pkgPath,
            content: JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        };
    } catch (e) {
        return null;
    }
}).filter(Boolean);

// Find names of all internal packages to bump their dependencies too
const packageNames = packageJsons.map(p => p.content.name);

packageJsons.forEach(({ pkgPath, content }) => {
    content.version = version;

    if (content.dependencies) {
        for (const dep of Object.keys(content.dependencies)) {
            if (packageNames.includes(dep)) {
                content.dependencies[dep] = version;
            }
        }
    }

    if (content.optionalDependencies) {
        for (const dep of Object.keys(content.optionalDependencies)) {
            if (packageNames.includes(dep)) {
                content.optionalDependencies[dep] = version;
            }
        }
    }

    if (content.devDependencies) {
        for (const dep of Object.keys(content.devDependencies)) {
            if (packageNames.includes(dep)) {
                content.devDependencies[dep] = version;
            }
        }
    }

    fs.writeFileSync(pkgPath, JSON.stringify(content, null, 2) + '\n');
    console.log(`Updated version in ${content.name}`);
});

console.log("\nVersions bumped successfully!");
console.log("Publishing packages...");

for (const { dir, content } of packageJsons) {
    if (dir.includes('templates')) continue; // Don't publish templates

    // Special case: Copy engine binary if it's an engine package
    if (content.name.startsWith('@titanpl/engine-')) {
        const platform = content.name.split('-')[1]; // win32, linux, darwin
        const arch = content.name.split('-')[2];
        const isWin = platform === 'win32';
        const binName = isWin ? 'titan-server.exe' : 'titan-server';
        const srcPath = path.join(ROOT_DIR, 'engine', 'target', 'release', 'gravity' + (isWin ? '.exe' : ''));
        const destBinDir = path.join(dir, 'bin');
        const destPath = path.join(destBinDir, binName);

        if (fs.existsSync(srcPath)) {
            console.log(`📦 Copying ${binName} to ${content.name}...`);
            if (!fs.existsSync(destBinDir)) fs.mkdirSync(destBinDir, { recursive: true });
            fs.copyFileSync(srcPath, destPath);
        } else {
            console.warn(`⚠️ Warning: Engine binary not found at ${srcPath}. Skipping copy, this package might be BROKEN.`);
        }
    }

    console.log(`\n======================================`);
    console.log(`🚀 Publishing ${content.name}...`);
    console.log(`======================================`);
    try {
        execSync('npm publish --access public --tag latest', { cwd: dir, stdio: 'inherit' });
        console.log(`✅ successfully published ${content.name} @ ${version}`);
    } catch (err) {
        console.error(`❌ Failed to publish ${content.name}`);
    }
}
console.log("\nAll done!");
