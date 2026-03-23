import { registerExtension } from './utils/registerExtension.js';

const myExt = {
    /**
     * A sample function that can be called from any Titan Action.
     */
    hello: () => {
        t.log("{{name}}", "Hello from extension!");
        return "hello";
    }
};

// If this is a Wasm or Native extension, bindings will be injected here during build.
// Use 'titan build ext' to generate them.

registerExtension("{{name}}", myExt);
export default myExt;
