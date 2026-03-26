# TitanPL Native & WebAssembly Extensions

One of the definitive features of TitanPL v7+ is its dynamic, zero-configuration native extension bridge. You no longer have to manually define function signatures or types within `titan.json`.

## The Hybrid IPC Native Bridge

The `NativeHost` bridge natively detects argument types over IPC at runtime. Whether you pass floating-point numbers (`f64`), complex strings, or JSON-stringified objects:

1. **Dynamic C-ABI Interop:** The host inspects the payload dynamically and generates the correct C-struct register combinations on-the-fly (`f64`, `*const c_char`, combinations).
2. **Safe Void execution:** Memory protections natively peek at returned pointer segments, preventing SEGFAULT crashes. `void` returns are safely handled transparently.
   
### Writing WebAssembly (WASM) 

Because Titan CLI utilizes `wasm-pack` without unnecessary logs, compiling WebAssembly plugins from Rust is completely silent and incredibly robust.

To build a fresh, silent WASM extension:
```bash
titan build ext
```
The CLI suppresses stdout output (`stdio: 'ignore'`) allowing clean build processes unless a fatal compiler failure occurs.

### Best Practices: The `@titanpl/native` Namespace

Never use the globally injected `t.*` prefixes in Modern TitanPL scripts (unless deploying backward-compatible code). Instead, simply use the modular native imports:

```js
// BEFORE (Not Recommended)
const data = t.fs.readFile("example.txt");
const hash = t.crypto.hash("sha256", "test");

// AFTER (Recommended)
import { fs, crypto, drift } from "@titanpl/native";

const data = fs.readFile("example.txt");
const hash = crypto.hash("sha256", "test");
```

By transitioning to `@titanpl/native`, you gain absolute Type Completion (via the newly restructured `d.ts` declaration maps) explicitly tailored to ESM semantics.
