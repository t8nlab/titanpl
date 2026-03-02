
<div align="center">
  <img src="./assets/titanpl-sdk.png" alt="Titan SDK Logo" width="120" />
  <h1>Titan SDK</h1>
  <p>
    <b>The Developer Toolkit for Titan Planet. Type safety, IntelliSense, and Extension Testing.</b>
  </p>
</div>

<div align="center">

[![npm version](https://img.shields.io/npm/v/titanpl-sdk.svg?style=flat-square)](https://www.npmjs.com/package/titanpl-sdk)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg?style=flat-square)](https://opensource.org/licenses/ISC)

</div>

---

## 🌌 Overview

**Titan SDK** is NOT the runtime engine itself. It is a **development-only toolkit** designed to bridge the gap between your local coding environment and the native Titan Planet binary. 

It provides the necessary **Type Definitions** to make your IDE understand the global `t` object and a **Lite Test Harness** to verify your extensions before they ever touch a production binary.

> **Note:** The actual implementation of `t.log`, `t.fetch`, and other APIs are embedded directly into the [Titan Planet Binary](https://github.com/ezet-galaxy/titanpl). This SDK simply provides the "blueprints" (types) and a "sandbox" (test runner).

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.

---

## ✨ Features

- **💎 Blueprint Types (IntelliSense)**: Provides the full TypeScript `index.d.ts` for the global `t` object so you get autocomplete in VS Code and other editors.
- **🛡️ Static Validation**: Catch parameter mismatches and typos in `t.log`, `t.fetch`, `t.db`, etc., during development.
- **🔌 Extension Test Harness**: A "lite" version of the Titan runtime that simulates the native environment to test extensions in isolation.
- **🚀 Zero Production Trace**: This is a `devDependencies` package. It never ships with your binary, keeping your production footprint at literal zero.

---

## 🚀 The Test Harness (Lite Runtime)

The SDK includes a specialized **Test Runner** (`titan-sdk`). This is a "lite" version of the Titan ecosystem that acts as a bridge for developers.

### How it works:
When you run the SDK in an extension folder, it:
1.  **Scaffolds a Virtual Project**: Creates a temporary, minimal Titan environment in `.titan_test_run`.
2.  **Native Compilation**: Automatically builds your native Rust code (`native/`) if it exists.
3.  **Hot-Linking**: Junctions your local extension into the virtual project's `node_modules`.
4.  **Verification**: Generates a test suite that attempts to call your extension's methods via the real `t` object inside the sandbox.

### Usage:

```bash
# Inside your extension directory
npx titan-sdk
```

---

## ⌨️ Enabling IntelliSense

Since the `t` object is injected globally by the Titan engine at runtime, your IDE won't recognize it by default. The SDK fixes this.

1.  **Install the SDK**:
    ```bash
    npm install --save-dev titan-sdk
    ```

2.  **Configure Types**:
    Create or update `jsconfig.json` (or `tsconfig.json`) in your project root:
    ```json
    {
      "compilerOptions": {
        "types": ["titan-sdk"]
      }
    }
    ```

Now your editor will treat `t` as a first-class citizen:
```ts
export const myAction = defineAction((req) => {
  t.log("Request received", req.path); // Autocomplete works!
  return { status: "ok" };
});
```

---

## 🧱 What's Included? (Types Only)

The SDK provides types for the native APIs provided by the Titan Planet engine:

- **`t.log`**: Standardized logging that appears in the Titan binary console.
- **`t.fetch`**: Types for the high-performance Rust-native network stack.
- **`t.db`**: Interface for the native PostgreSQL driver.
- **`t.read`**: Definitions for optimized filesystem reads.
- **`t.jwt` / `t.password`**: Security helper types.

---

## 🌍 Community & Documentation

- **Core Framework**: [Titan Planet](https://github.com/ezet-galaxy/titanpl)
- **Official Docs**: [Titan Planet Docs](https://titan-docs-ez.vercel.app/docs)
- **Author**: [ezetgalaxy](https://github.com/ezet-galaxy)

---

<p align="center">
  Built with ❤️ for the <a href="https://titan-docs-ez.vercel.app/">Titan Planet</a> ecosystem.
</p>
