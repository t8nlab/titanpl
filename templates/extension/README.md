# Titan Extension Template

This template provides a starting point for building native extensions for Titan.

## Directory Structure

- `index.js`: The JavaScript entry point for your extension. It runs within the Titan runtime.
- `index.d.ts`: TypeScript definitions for your extension. This ensures users get autocompletion when using your extension.
- `native/`: (Optional) Rust source code for native high-performance logic.
- `titan.json`: Configuration file defining your extension's native ABI (if using Rust).

## Type Definitions (`index.d.ts`)

The `index.d.ts` file is crucial for Developer Experience (DX). It allows Titan projects to "see" your extension's API on the global `t` object.

### How it works

Titan uses **Declaration Merging** to extend the global `Titan.Runtime` interface. When a user installs your extension, this file acts as a plugin to their TypeScript environment.

### Customizing Types

Edit `index.d.ts` to match the API you expose in `index.js`.

**Example:**

If your `index.js` looks like this:

```javascript
// index.js
t.ext.my_cool_ext = {
    greet: (name) => `Hello, ${name}!`,
    compute: (x) => x * 2
};
```

Your `index.d.ts` should look like this:

```typescript
// index.d.ts
declare global {
    namespace Titan {
        interface Runtime {
            "my-cool-ext": {
                /**
                 * Sends a greeting.
                 */
                greet(name: string): string;

                /**
                 * Computes a value.
                 */
                compute(x: number): number;
            }
        }
    }
}
export { };
```

## Native Bindings (Rust)

If your extension requires native performance or system access, use the `native/` directory.
1. Define functions in `native/src/lib.rs`.
2. Map them in `titan.json`.
3. Call them from `index.js` using `Titan.native.invoke(...)` (or the helper provided in the template).

---

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.
