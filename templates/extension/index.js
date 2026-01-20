/**
 * Titan Extension Entry Point
 * You can attach methods to the global `t` object here.
 */

// Define your extension Key
if (typeof Titan === "undefined") globalThis.Titan = t;
const EXT_KEY = "{{name}}";

t.log(EXT_KEY, "Extension loading...");

// Preserve any native functions already attached to this key
t[EXT_KEY] = Object.assign(t[EXT_KEY] || {}, {
    // Example pure JavaScript function
    hello: function (name) {
        t.log(EXT_KEY, `Hello ${name} from ${EXT_KEY}!`);
        return `Hello ${name}!`;
    },

    // Example Wrapper for Native function
    calc: function (a, b) {
        t.log(EXT_KEY, `Calculating ${a} + ${b} natively...`);
        // Assumes the native function 'add' is mapped in titan.json
        return t[EXT_KEY].add(a, b);
    }
});

t.log(EXT_KEY, "Extension loaded!");
