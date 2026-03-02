import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function migrateCommand() {
    const root = process.cwd();
    console.log(`\n🔍 Checking project for legacy Titan architecture...`);

    const serverDir = path.join(root, 'server');
    const titanDir = path.join(root, 'titan');
    const pkgPath = path.join(root, 'package.json');

    if (!fs.existsSync(serverDir) && !fs.existsSync(titanDir)) {
        console.log(`✅ This project is already using the modern Titan runtime architecture.`);
        return;
    }

    console.log(`\n⚠️ Legacy server architecture detected. Migrating to runtime-first model...`);

    // 1. Delete server/
    if (fs.existsSync(serverDir)) {
        console.log(`   Deleting legacy server/ folder...`);
        fs.rmSync(serverDir, { recursive: true, force: true });
    }

    // 2. Delete titan/ folder
    if (fs.existsSync(titanDir)) {
        console.log(`   Deleting legacy titan/ runtime folder...`);
        fs.rmSync(titanDir, { recursive: true, force: true });
    }

    // 3. Update package.json
    if (fs.existsSync(pkgPath)) {
        console.log(`   Updating package.json...`);
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            let modified = false;

            // Update scripts
            if (pkg.scripts) {
                if (pkg.scripts.build && pkg.scripts.build.includes('cd server')) {
                    pkg.scripts.build = "titan build";
                    modified = true;
                }
                if (pkg.scripts.start && pkg.scripts.start.includes('cd server')) {
                    pkg.scripts.start = "titan start";
                    modified = true;
                }
                if (pkg.scripts.dev && pkg.scripts.dev.includes('titan/dev.js')) {
                    pkg.scripts.dev = "titan dev";
                    modified = true;
                }
            }

            // Add / fix dependencies — ensure correct @titanpl/ scope
            pkg.dependencies = pkg.dependencies || {};

            // Remove any stale old-scope packages (@titan/ typo) that may exist
            const stalePackages = ['@titanp/native', '@titan/route', '@titan/cli', '@titan/packet'];
            for (const stale of stalePackages) {
                if (pkg.dependencies[stale]) {
                    delete pkg.dependencies[stale];
                    modified = true;
                }
            }

            const requiredDeps = {
                '@titanpl/cli': 'latest',
                '@titanpl/route': 'latest',
                '@titanpl/native': 'latest',
                '@titanpl/packet': 'latest',
            };
            for (const [dep, version] of Object.entries(requiredDeps)) {
                if (!pkg.dependencies[dep]) {
                    pkg.dependencies[dep] = version;
                    modified = true;
                }
            }

            if (modified) {
                fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
            }
        } catch (e) {
            console.log(`   ⚠️ Failed to update package.json automatically. Please do it manually.`);
        }
    }

    // 4. Synchronize Dockerfile and other common files
    try {
        const commonDir = path.resolve(__dirname, '..', '..', '..', '..', 'templates', 'common');
        if (fs.existsSync(commonDir)) {
            const filesToSync = [
                ['Dockerfile', 'Dockerfile'],
                ['_dockerignore', '.dockerignore'],
                ['_gitignore', '.gitignore'],
                ['app/t.native.d.ts', 'app/t.native.d.ts'],
                ['app/t.native.js', 'app/t.native.js']
            ];

            for (const [srcRel, destRel] of filesToSync) {
                const src = path.join(commonDir, srcRel);
                const dest = path.join(root, destRel);
                if (fs.existsSync(src)) {
                    // Create parent dir if needed
                    const parent = path.dirname(dest);
                    if (!fs.existsSync(parent)) {
                        fs.mkdirSync(parent, { recursive: true });
                    }
                    fs.copyFileSync(src, dest);
                }
            }
            console.log(`   Synchronized Dockerfiles and native definitions.`);
        }
    } catch (e) {
        console.log(`   ⚠️ Failed to synchronize common template files.`);
    }

    console.log(`\n🎉 Migration complete!`);
    console.log(`   Please run 'npm install' to fetch the new dependencies.`);
    console.log(`   Then run 'titan dev' to start your application.\n`);
}
