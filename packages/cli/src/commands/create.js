import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prompts from 'prompts';
import chalk from 'chalk';
import { copyDir } from './init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createCommand(type, name) {
    if (type === 'ext' || type === 'extension') {
        await createExtension(name);
    } else {
        console.log(chalk.red(`\n✖ Unknown creation type: ${type}`));
        console.log(chalk.gray(`  Available types: ext\n`));
    }
}

async function createExtension(extensionName) {
    let name = extensionName;
    if (!name) {
        const res = await prompts({
            type: 'text',
            name: 'name',
            message: 'Extension name:',
            initial: 'my-ext'
        });
        name = res.name;
    }

    if (!name) {
        console.log(chalk.red("✖ Extension name is required."));
        return;
    }

    const res = await prompts({
        type: 'select',
        name: 'type',
        message: 'What type of extension do you want to create?',
        choices: [
            { title: 'js      — JavaScript only, zero build step, always safe', value: 'js' },
            { title: 'wasm    — Rust compiled to WebAssembly, sandboxed, auto-bound', value: 'wasm' },
            { title: 'native  — Rust compiled to .so/.dll, out-of-process, requires allowNative', value: 'native' },
        ],
        initial: 0
    });

    const extType = res.type;
    if (!extType) return;

    const targetDir = path.resolve(process.cwd(), name);
    if (fs.existsSync(targetDir)) {
        console.log(chalk.red(`\n✖ Directory '${name}' already exists.\n`));
        return;
    }

    // Find template path (similar to init.js)
    let templateDir = path.resolve(__dirname, '..', '..', '..', '..', 'templates', 'extension');
    if (!fs.existsSync(templateDir)) {
        templateDir = path.resolve(__dirname, '..', '..', 'templates', 'extension');
    }

    console.log(chalk.cyan(`\n→ Creating ${extType.toUpperCase()} extension '${name}'...\n`));

    if (extType === 'js') {
        try {
            console.log(chalk.gray(`  Cloning JS template from https://github.com/t8nlab/extTemplate.git...`));
            const { execSync } = await import('child_process');
            execSync(`git clone https://github.com/t8nlab/extTemplate.git "${targetDir}"`, { stdio: 'pipe' });
            // Remove git history
            fs.rmSync(path.join(targetDir, '.git'), { recursive: true, force: true });
        } catch (err) {
            console.log(chalk.yellow(`  Git clone failed, falling back to local template...`));
            copyDir(templateDir, targetDir);
        }
    } else {
        // 1. Copy the source template
        copyDir(templateDir, targetDir);
    }

    // 2. Perform transformations
    transformExtension(targetDir, name, extType);

    console.log(chalk.green(`\n✔ Extension '${name}' created successfully!`));
    console.log(chalk.yellow(`  cd ${name}`));
    if (extType !== 'js') {
        console.log(chalk.yellow(`  titan build ext`));
    }
    console.log(chalk.yellow(`  titan run ext\n`));
}

function transformExtension(target, name, type) {
    // 1. Remove optional native folder if it's a JS extension
    if (type === 'js') {
        const nativeDir = path.join(target, 'native');
        if (fs.existsSync(nativeDir)) {
            fs.rmSync(nativeDir, { recursive: true, force: true });
        }
    }

    // 2. Patch package.json
    const pkgPath = path.join(target, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        pkg.name = name;
        pkg.version = "1.0.0";
        // Ensure dependencies
        pkg.dependencies = pkg.dependencies || {};
        pkg.dependencies["@titanpl/sdk"] = "2.0.0";
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    }

    // 3. Patch titan.json
    const titanPath = path.join(target, 'titan.json');
    if (fs.existsSync(titanPath)) {
        const titan = JSON.parse(fs.readFileSync(titanPath, 'utf8'));
        titan.name = name;
        titan.type = type;
        titan.version = "1.0.0";
        fs.writeFileSync(titanPath, JSON.stringify(titan, null, 2));
    }

    // 4. Cleanup git if it exists accidentally
    const gitDir = path.join(target, '.git');
    if (fs.existsSync(gitDir)) {
        fs.rmSync(gitDir, { recursive: true, force: true });
    }

    // 5. Recursive template substitution for any {{name}} in files
    substituteTemplates(target, name);
}

function substituteTemplates(dir, name) {
    for (const file of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
            substituteTemplates(fullPath, name);
        } else {
            const ext = path.extname(file).toLowerCase();
            const textExts = ['.js', '.ts', '.json', '.md', '.txt', '.rs', '.toml', '.html', '.css', '.d.ts'];
            if (textExts.includes(ext)) {
                let content = fs.readFileSync(fullPath, 'utf8');
                let changed = false;
                if (content.includes("{{name}}")) {
                    content = content.replace(/{{name}}/g, name);
                    changed = true;
                }
                if (content.includes("workspace:*")) {
                    content = content.replace(/"@titanpl\/sdk": "workspace:\*"/g, '"@titanpl/sdk": "2.0.0"');
                    content = content.replace(/workspace:\*/g, "6.0.0");
                    changed = true;
                }
                if (changed) {
                    fs.writeFileSync(fullPath, content);
                }
            }
        }
    }
}
