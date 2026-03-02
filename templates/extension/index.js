// Define your extension Key
if (typeof Titan === "undefined") globalThis.Titan = t;
const EXT_KEY = "{{name}}";

// Preserve any native functions already attached to this key
t[EXT_KEY] = Object.assign(t[EXT_KEY] || {}, {
    // Example pure JavaScript function
    hello: function (name) {
        return `Hello ${name} from ${EXT_KEY}!`;
    },

    // Example Wrapper for Native function
    calc: function (a, b) {
        // Assumes the native function 'add' is mapped in titan.json
        return t[EXT_KEY].add(a, b);
    }
});
