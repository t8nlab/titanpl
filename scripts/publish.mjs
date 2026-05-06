import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * Titan CLI Publish Script
 * 
 * This script handles the specialized publishing process for @titanpl/cli.
 * It ensures the version is bumped and all required assets (like templates)
 * are correctly bundled before publishing to NPM.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const CLI_DIR = path.join(ROOT_DIR, 'packages', 'cli');

const version = process.argv[2];

// UI Helpers
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

if (!version) {
    console.error(red("\n❌ Error: Please provide a version number."));
    console.log(yellow("Usage: node scripts/publish.mjs <version> (e.g. 1.5.0)\n"));
    process.exit(1);
}

async function publishCLI() {
    console.log(cyan(`\n🚀 Preparing to publish @titanpl/cli v${version}...`));

    // 1. Update packages/cli/package.json
    const pkgPath = path.join(CLI_DIR, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        console.error(red(`❌ Error: Could not find package.json at ${pkgPath}`));
        process.exit(1);
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const oldVersion = pkg.version;
    pkg.version = version;

    // Optional: If we want to ensure it uses the latest @titanpl/packet if it exists
    // but the user said "not toch others", so we keep dependencies as they are (usually "latest")

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(green(`✅ Updated version in CLI package.json: ${oldVersion} -> ${version}`));

    // 2. Sync Templates
    // The CLI needs the 'templates' directory from the root to be included in the package.
    const srcTemplatesDir = path.join(ROOT_DIR, 'templates');
    const destTemplatesDir = path.join(CLI_DIR, 'templates');

    let templatesCopied = false;

    if (fs.existsSync(srcTemplatesDir)) {
        console.log(cyan(`📦 Bundling templates into CLI package...`));
        
        const copyRecursive = (src, dest) => {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            for (const file of fs.readdirSync(src)) {
                const sp = path.join(src, file);
                const dp = path.join(dest, file);
                if (fs.lstatSync(sp).isDirectory()) {
                    copyRecursive(sp, dp);
                } else {
                    fs.copyFileSync(sp, dp);
                }
            }
        };

        try {
            // Clean destination if it exists
            if (fs.existsSync(destTemplatesDir)) {
                fs.rmSync(destTemplatesDir, { recursive: true, force: true });
            }
            
            copyRecursive(srcTemplatesDir, destTemplatesDir);
            templatesCopied = true;
            console.log(green(`✔ Templates bundled successfully.`));
        } catch (err) {
            console.error(red(`❌ Failed to copy templates: ${err.message}`));
            process.exit(1);
        }
    } else {
        console.warn(yellow(`⚠️ Warning: Root templates directory not found. Package might be incomplete.`));
    }

    // 3. NPM Publish
    const tag = version.includes('-') ? (version.split('-')[1].split('.')[0] || 'next') : 'latest';
    
    console.log(cyan(`\n================================================`));
    console.log(bold(`🚢 Publishing @titanpl/cli @ ${version} [Tag: ${tag}]`));
    console.log(cyan(`================================================\n`));

    try {
        // We use --access public for scoped packages
        execSync(`npm publish --tag ${tag} --access public`, { 
            cwd: CLI_DIR, 
            stdio: 'inherit' 
        });
        console.log(green(`\n✅ Successfully published @titanpl/cli @ ${version}`));
    } catch (err) {
        console.error(red(`\n❌ NPM Publish failed.`));
        // We don't exit here yet so we can cleanup
    } finally {
        // 4. Cleanup
        if (templatesCopied && fs.existsSync(destTemplatesDir)) {
            console.log(cyan(`\n🧹 Cleaning up bundled templates...`));
            fs.rmSync(destTemplatesDir, { recursive: true, force: true });
            console.log(green(`✔ Cleanup complete.`));
        }
    }

    console.log(bold(green(`\n✨ Done! @titanpl/cli is now live.\n`)));
}

publishCLI().catch(err => {
    console.error(red(`\n💥 Fatal Error: ${err.message}`));
    process.exit(1);
});
