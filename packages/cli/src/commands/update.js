import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function updateCommand() {
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
            'titanpl-sdk',
            '@titanpl/cli',
            '@titanpl/route',
            '@titanpl/native',
            '@titanpl/packet',
            '@titanpl/core',
            '@titanpl/node'
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
            console.log(chalk.green(`  ✔ Updated Titan dependencies in package.json`));
        }
    } catch (e) {
        console.log(chalk.yellow(`  ⚠️ Failed to update package.json: ${e.message}`));
    }

    // 2. Refresh Dockerfile and dotfiles from templates
    const commonDir = path.resolve(__dirname, '..', '..', '..', '..', 'templates', 'common');
    if (fs.existsSync(commonDir)) {
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
