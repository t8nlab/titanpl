import fs from 'fs';
import path from 'path';
import vm from 'node:vm';
import { fileURLToPath } from 'url';

/**
 * Creates a lightweight production-grade test environment for Titan extensions.
 * Provides isolation via node:vm and a full t-object emulation.
 */
export async function createTestEnv(options) {
    const { extPath, allowWasm = false, allowNative = false } = options;
    const absolutePath = path.resolve(extPath);
    const titanJsonPath = path.join(absolutePath, 'titan.json');

    if (!fs.existsSync(titanJsonPath)) {
        throw new Error(`[@titanpl/sdk/test] titan.json not found at ${absolutePath}`);
    }

    const titanJson = JSON.parse(fs.readFileSync(titanJsonPath, 'utf8'));
    
    // Create the global 't' mock
    const tMock = {
        _logs: [],
        _calls: [],
        log: (name, ...args) => {
            const entry = `[${name}] ${args.join(' ')}`;
            tMock._logs.push(entry);
            console.log('\x1b[36m%s\x1b[0m', entry);
        },
        __native: {
            call: async (ext, fn, args) => {
                if (!allowNative) throw new Error(`[@titanpl/sdk/test] Native call blocked (allowNative: false)`);
                tMock._calls.push({ type: 'native', ext, fn, args });
                return `[MOCK_NATIVE_RESULT]`;
            }
        }
    };

    // Create a VM context
    const context = {
        t: tMock,
        global: {},
        globalThis: {},
        console: console,
        setTimeout,
        clearTimeout,
        process: { env: { ...process.env } }
    };
    context.global = context;
    context.globalThis = context;

    vm.createContext(context);

    // Load extension entry
    const entryPath = path.join(absolutePath, titanJson.entry);
    const code = fs.readFileSync(entryPath, 'utf8');

    // Resolve relative imports within the extension
    // Simple loader: replace relative imports with absolute ones or mock them
    // For a real production-ready test env, we'd use a custom loader or compile with ESBuild.
    // For now, we'll use a functional script wrapper.
    
    const script = new vm.Script(`
        (async () => {
            ${code.replace(/import\s+{([^}]+)}\s+from\s+'\.\/utils\/registerExtension\.js'/g, 'const {$1} = t._registerHelper;')}
        })()
    `);

    // Add registration helper to 't'
    tMock._registerHelper = {
        registerExtension: (name, module) => {
            tMock[name] = module;
            console.log(`[@titanpl/sdk/test] Registered extension: ${name}`);
        }
    };

    try {
        await script.runInContext(context);
    } catch (err) {
        console.error(`[@titanpl/sdk/test] Runtime error in extension '${titanJson.name}':`, err);
        throw err;
    }

    return {
        /**
         * Call an extension method
         */
        call: async (path, args = []) => {
            const [extName, methodName] = path.split('.');
            if (!tMock[extName]) throw new Error(`Extension '${extName}' not registered`);
            if (!tMock[extName][methodName]) throw new Error(`Method '${methodName}' not found on extension '${extName}'`);
            
            return await tMock[extName][methodName](...args);
        },

        /**
         * Assert a method result
         */
        assert: async (path, args, expected) => {
            const result = await tMock.call(path, args);
            if (JSON.stringify(result) !== JSON.stringify(expected)) {
                throw new Error(`Assertion Failed for ${path}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(result)}`);
            }
            console.log(`\x1b[32m✔ Assertion Passed: ${path}\x1b[0m`);
        },

        /**
         * Get all logs captured during execution
         */
        getLogs: () => tMock._logs,

        /**
         * Teardown the environment
         */
        teardown: async () => {
            // Cleanup context and references
            for (const key in tMock) delete tMock[key];
        }
    };
}
