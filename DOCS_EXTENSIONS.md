# 🧩 TitanPL Extension System — End-to-End Guide

TitanPL supports three distinct types of extensions to suit different performance and security needs. All extensions are registered on the global `t` object for seamless use in your JavaScript actions.

---

## 🚀 Extension Types

### 1. JavaScript (JS-Only)
- **Best for**: Standard utilities, helper functions, and non-blocking logic.
- **Complexity**: Zero build step.
- **Security**: Always safe, runs inside the V8 sandbox.
- **How to Create**:
  ```bash
  titan create ext <name>
  # Select 'js'
  ```
- **Structure**:
  - `index.js`: Main logic.
  - `titan.json`: Metadata.
- **Registration**: Uses `utils/registerExtension.js` to safely attach to the global `t`.

### 2. WebAssembly (WASM)
- **Best for**: Performance-critical algorithms, parsers, or portable Rust logic.
- **Complexity**: Requires `titan build ext` (compiles Rust to `.wasm`).
- **Security**: Sandboxed, requires `allowWasm: true` in `tanfig.json`.
- **How to Create**:
  ```bash
  titan create ext <name>
  # Select 'wasm'
  ```
- **Build**: `titan build ext` (requires Rust toolchain).

### 3. Native (Rust/C++)
- **Best for**: Direct OS access, high-performance database drivers, or hardware acceleration.
- **Complexity**: Out-of-process execution for stability. Requires `titan build ext`.
- **Security**: Hard-Blocked by default. Requires explicit listing in `tanfig.json`.
- **How to Create**:
  ```bash
  titan create ext <name>
  # Select 'native'
  ```
- **Build**: `titan build ext` (compiles to `.dll` or `.so`).

---

## 🛡️ Security Configuration (`tanfig.json`)

To prevent unvetted code from running, TitanPL requires explicit permissions for non-JS extensions.

```json
{
  "name": "my-secure-app",
  "extensions": {
    "allowWasm": true,
    "allowNative": [
      "@titanpl/core",
      "my-custom-native-ext"
    ]
  }
}
```

> [!IMPORTANT]
> **Gravity Policy**: The engine will trigger a **HARD ERROR** and refuse to start if any native extension is detected in `node_modules` or `.ext` that is not explicitly allowed.

---

## 🛠️ Usage in Actions

Once an extension is loaded, it is available globally. You can also import specific components for better IDE support.

```javascript
// app/actions/my-action.js
import { log, crypto } from "@titanpl/native"; // Typed access

export function myAction(req) {
    // Both syntax works:
    t.log("Extension is ready!");
    log("Direct access also works!");
    
    return { status: "success" };
}
```
