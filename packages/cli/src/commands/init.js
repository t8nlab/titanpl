import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import prompts from 'prompts';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function copyDir(src, dest, excludes = []) {
    fs.mkdirSync(dest, { recursive: true });

    for (const file of fs.readdirSync(src)) {
        if (excludes.includes(file)) continue;

        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);

        if (fs.lstatSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath, excludes);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

export async function initCommand(projectName, templateName) {
    let projName = projectName;

    if (!projName) {
        const res = await prompts({
            type: 'text',
            name: 'name',
            message: 'Project name:',
            initial: 'my-titan-app'
        });
        projName = res.name;
    }

    if (!projName) {
        console.log(chalk.red("✖ Initialization cancelled."));
        process.exit(1);
    }

    let selectedTemplate = templateName;

    if (!selectedTemplate) {
        const langRes = await prompts({
            type: 'select',
            name: 'value',
            message: 'Select language:',
            choices: [
                { title: 'JavaScript', value: 'js' },
                { title: 'TypeScript', value: 'ts' },
            ],
            initial: 0
        });

        if (!langRes.value) {
            console.log(chalk.red("✖ Operation cancelled."));
            process.exit(1);
        }
        const lang = langRes.value;

        const archRes = await prompts({
            type: 'select',
            name: 'value',
            message: 'Select template:',
            choices: [
                {
                    title: `Standard (${lang.toUpperCase()})`,
                    description: `Standard Titan app with ${lang.toUpperCase()} actions`,
                    value: 'standard'
                },
                {
                    title: `Rust + ${lang.toUpperCase()} (Hybrid)`,
                    description: `High-performance Rust actions + ${lang.toUpperCase()} flexibility`,
                    value: 'hybrid'
                }
            ],
            initial: 0
        });

        if (!archRes.value) {
            console.log(chalk.red("✖ Operation cancelled."));
            process.exit(1);
        }
        const arch = archRes.value;

        if (lang === 'js') {
            selectedTemplate = arch === 'standard' ? 'js' : 'rust-js';
        } else {
            selectedTemplate = arch === 'standard' ? 'ts' : 'rust-ts';
        }
    }

    const target = path.resolve(process.cwd(), projName);
    const templateDir = path.resolve(__dirname, '..', '..', '..', '..', 'templates', selectedTemplate);
    const commonDir = path.resolve(__dirname, '..', '..', '..', '..', 'templates', 'common');

    if (!fs.existsSync(templateDir) || !fs.existsSync(commonDir)) {
        console.log(chalk.red(`✖ Error finding template paths.Are you in a valid Titan monorepo ? `));
        process.exit(1);
    }

    if (fs.existsSync(target)) {
        console.log(chalk.red(`✖ Directory '${projName}' already exists.`));
        process.exit(1);
    }

    console.log(chalk.cyan(`\n→ Creating new Titan project in '${projName}'...\n`));

    // 1. Copy common
    copyDir(commonDir, target);

    // 2. Copy specific template
    copyDir(templateDir, target);

    // 3. Dotfiles and Template Remapping
    const remapping = {
        "_gitignore": ".gitignore",
        "_dockerignore": ".dockerignore",
        "_titan.json": "titan.json",
        ".env": ".env"
    };
    for (const [srcName, destName] of Object.entries(remapping)) {
        const src = path.join(target, srcName);
        const dest = path.join(target, destName);
        if (fs.existsSync(src)) {
            fs.renameSync(src, dest);
        }
    }

    // Recursive template substitution
    const substitute = (dir) => {
        for (const file of fs.readdirSync(dir)) {
            const fullPath = path.join(dir, file);
            if (fs.lstatSync(fullPath).isDirectory()) {
                if (file !== "node_modules" && file !== ".git" && file !== "target") {
                    substitute(fullPath);
                }
            } else {
                // Only process text files
                const ext = path.extname(file).toLowerCase();
                const textExts = ['.js', '.ts', '.json', '.md', '.txt', '.rs', '.toml', '.html', '.css', '.d.ts'];
                if (textExts.includes(ext) || file === ".env" || file === "Dockerfile") {
                    let content = fs.readFileSync(fullPath, 'utf8');
                    let changed = false;
                    if (content.includes("{{name}}")) {
                        content = content.replace(/{{name}}/g, projName);
                        changed = true;
                    }
                    if (content.includes("{{native_name}}")) {
                        content = content.replace(/{{native_name}}/g, projName.replace(/-/g, '_'));
                        changed = true;
                    }
                    if (changed) {
                        fs.writeFileSync(fullPath, content);
                    }
                }
            }
        }
    };
    substitute(target);

    console.log(chalk.gray(`  Installing dependencies...`));

    execSync('npm install', { cwd: target, stdio: 'inherit' });

    console.log(chalk.green(`\n✔ Project '${projName}' created successfully!\n`));
    console.log(chalk.yellow(`  cd ${projName}`));
    console.log(chalk.yellow(`  npm run dev\n`));
}
