#!/usr/bin/env node

import os from 'os';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const platform = os.platform();
const arch = os.arch();
const pkgName = `@tgrv/tgrv-${platform}-${arch}`;
const binName = platform === 'win32' ? 'tgrv.exe' : 'tgrv';

function resolveBinary() {
    // 1. Resolve via optionalDependencies
    try {
        const pkgPath = require.resolve(`${pkgName}/package.json`);
        const binaryPath = path.join(path.dirname(pkgPath), 'bin', binName);
        if (fs.existsSync(binaryPath)) return binaryPath;
    } catch (e) {}

    // 2. Monorepo fallback (local dev)
    const monorepoPath = path.join(__dirname, '..', `tgrv-${platform}-${arch}`, 'bin', binName);
    if (fs.existsSync(monorepoPath)) return monorepoPath;
    
    // 3. Fallback to sibling bin
    const siblingBin = path.join(__dirname, 'bin', binName);
    if (fs.existsSync(siblingBin)) return siblingBin;

    return null;
}

const binaryPath = resolveBinary();

if (!binaryPath) {
    console.error(`\n[TGRV FATAL] Binary not found for platform: ${platform}-${arch}`);
    console.error(`Optional dependency '${pkgName}' might have failed to install.\n`);
    process.exit(1);
}

const args = process.argv.slice(2);
const tgrv = spawn(binaryPath, args, { stdio: 'inherit' });

tgrv.on('exit', (code) => {
    process.exit(code || 0);
});
