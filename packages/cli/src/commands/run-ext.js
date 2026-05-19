import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import prompts from 'prompts';
import { execSync, spawn } from 'child_process';

/**
 * Runs the extension sandbox environment.
 */
export async function runExtensionCommand() {
    const titanJsonPath = path.join(process.cwd(), 'titan.json');
    if (!fs.existsSync(titanJsonPath)) {
        console.log(chalk.red("✖ No titan.json found in current directory."));
        return;
    }

    const titanJson = JSON.parse(fs.readFileSync(titanJsonPath, 'utf8'));
    const response = await prompts({
        type: 'select',
        name: 'env',
        message: 'How would you like to run and test this extension?',
        choices: [
            { title: 'titan  — Boot a minimal, real TitanPL test server (npm install + titan dev)', value: 'titan' },
            { title: 'tgrv   — Execute in a standalone Gravity (TGRV) test script', value: 'tgrv' },
        ],
        initial: 0
    });

    const env = response.env;
    if (!env) return;

    if (env === 'titan') {
        await runTitanSandbox(titanJson);
    } else if (env === 'tgrv') {
        await runTgrvSandbox(titanJson);
    }
}

async function runTitanSandbox(titanJson) {
    const sandboxDir = path.join(process.cwd(), 'sandbox');

    // ---------------------------------------------------
    // Existing sandbox
    // ---------------------------------------------------
    if (fs.existsSync(sandboxDir)) {
        console.log(
            chalk.cyan(`\n🪐 Reusing existing Titan sandbox...\n`)
        );

        execSync(`npm run dev`, {
            cwd: sandboxDir,
            stdio: 'inherit'
        });

        return;
    }

    console.log(
        chalk.cyan(`\n→ Initializing TitanPL sandbox...\n`)
    );

    // ---------------------------------------------------
    // Create sandbox
    // ---------------------------------------------------
    execSync(`titan init sandbox -t js`, {
        cwd: process.cwd(),
        stdio: 'inherit'
    });

    const rootDir = sandboxDir;
    const appDir = path.join(rootDir, 'app');

    // ---------------------------------------------------
    // Cleanup
    // ---------------------------------------------------
    const removeFiles = [
        'Dockerfile',
        '.dockerignore',
        path.join('app', 'actions', 'getuser.js')
    ];

    for (const file of removeFiles) {
        const target = path.join(rootDir, file);

        if (fs.existsSync(target)) {
            fs.rmSync(target, {
                recursive: true,
                force: true
            });
        }
    }

    // ---------------------------------------------------
    // Install extension
    // ---------------------------------------------------
    console.log(
        chalk.gray(`  Installing local extension...`)
    );

    execSync(`npm install ../`, {
        cwd: rootDir,
        stdio: 'inherit'
    });

    // ---------------------------------------------------
    // Patch tanfig
    // ---------------------------------------------------
    const tanfigPath = path.join(rootDir, 'tanfig.json');

    const tanfig = JSON.parse(
        fs.readFileSync(tanfigPath, 'utf8')
    );

    tanfig.extensions ||= {};
    tanfig.extensions.allowNative ||= [];

    if (
        !tanfig.extensions.allowNative.includes(
            titanJson.name
        )
    ) {
        tanfig.extensions.allowNative.push(
            titanJson.name
        );
    }

    fs.writeFileSync(
        tanfigPath,
        JSON.stringify(tanfig, null, 2)
    );

    // ---------------------------------------------------
    // test.js
    // ---------------------------------------------------
    fs.writeFileSync(
        path.join(appDir, 'actions', 'test.js'),
        `import Extension from '${titanJson.name}';
 import { defineAction } from '@titanpl/native';

export default defineAction () {
    const ext = new Extension();


    const methods = Object
        .getOwnPropertyNames(
            Object.getPrototypeOf(ext)
        )
        .filter(
            (m) => m !== 'constructor'
        );

    return {
        extension: 'my-ext',
        methods
    };
}
`
    );

    // ---------------------------------------------------
    // app.js
    // ---------------------------------------------------
    fs.writeFileSync(
        path.join(appDir, 'app.js'),
        `import t from "@titanpl/route";

t.get("/test").action("test");

t.get("/").reply("Titan Extension Sandbox 🚀");

t.start(5100, "Titan Sandbox Running!");
`
    );

    // ---------------------------------------------------
    // Boot
    // ---------------------------------------------------
    console.log(
        chalk.cyan(`\n🪐 Booting TitanPL sandbox...\n`)
    );

    execSync(`npm run dev`, {
        cwd: rootDir,
        stdio: 'inherit'
    });
}

async function runTgrvSandbox(titanJson) {
    const sandboxDir = path.join(process.cwd(), 'sandbox');

    // ---------------------------------------------------
    // Existing sandbox
    // ---------------------------------------------------
    if (fs.existsSync(path.join(sandboxDir, 'app.js'))) {
        console.log(
            chalk.cyan(`\n🪐 Reusing existing TGRV sandbox...\n`)
        );

        execSync(`npx tgrv app.js`, {
            cwd: sandboxDir,
            stdio: 'inherit'
        });

        return;
    }

    console.log(
        chalk.cyan(`\n→ Initializing TGRV sandbox...\n`)
    );

    if (!fs.existsSync(sandboxDir)) {
        fs.mkdirSync(sandboxDir, {
            recursive: true
        });
    }

    execSync(`npm install @tgrv/cli`, {
        cwd: sandboxDir,
        stdio: 'inherit'
    });

    execSync(`npx tgrv init`, {
        cwd: sandboxDir,
        stdio: 'inherit'
    });

    // ---------------------------------------------------
    // Install extension
    // ---------------------------------------------------
    console.log(
        chalk.gray(`  Installing local extension...`)
    );

    execSync(`npm install ../`, {
        cwd: sandboxDir,
        stdio: 'inherit'
    });

    // ---------------------------------------------------
    // Patch tanfig
    // ---------------------------------------------------
    const tanfigPath = path.join(
        sandboxDir,
        'tanfig.json'
    );

    let tanfig = {};

    if (fs.existsSync(tanfigPath)) {
        tanfig = JSON.parse(
            fs.readFileSync(tanfigPath, 'utf8')
        );
    }

    tanfig.extensions ||= {};
    tanfig.extensions.allowNative ||= [];

    if (
        !tanfig.extensions.allowNative.includes(
            titanJson.name
        )
    ) {
        tanfig.extensions.allowNative.push(
            titanJson.name
        );
    }

    fs.writeFileSync(
        tanfigPath,
        JSON.stringify(tanfig, null, 2)
    );

    // ---------------------------------------------------
    // app.js
    // ---------------------------------------------------
    fs.writeFileSync(
        path.join(sandboxDir, 'app.js'),
        `import Extension from '../index.js';
 import { log } from '@titanpl/native';

log("→ Booting TGRV extension sandbox...");

const ext = new Extension();


const methods = Object
.getOwnPropertyNames(
    Object.getPrototypeOf(ext)
)
.filter(
    (m) => m !== 'constructor'
);

log({
    extension: '${titanJson.name}',
    methods
});
`
    );

    console.log(
        chalk.cyan(`\n🪐 Launching TGRV sandbox...\n`)
    );

    execSync(`npx tgrv app.js`, {
        cwd: sandboxDir,
        stdio: 'inherit'
    });
}