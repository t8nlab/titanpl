# Titan Planet 🪐: Global Gravity Architecture

Welcome to the architectural overview of **Titan Planet**. 

As of version `26.16.0`, Titan Planet has fundamentally evolved. We have transitioned from the **Legacy Architecture** (which required a localized Cargo project for every server) to the high-performance **Global Gravity Engine Architecture**.

This document outlines the core concepts, components, and workflows that make this architecture powerful, fast, and easy to use.

---

## 🏗️ 1. The Global Gravity Engine Architecture

The most significant shift in Titan's architecture is the elimination of the local `server/` directory and its associated Rust project. Instead, Titan now relies on a pre-compiled, embedded binary engine distributed via npm.

### Key Benefits
* **Instant Boot Times:** Because the engine is pre-compiled, cold starts are almost instantaneous.
* **Zero Rust Required:** Developers no longer need to install Rust or understand Cargo to use Titan's core features.
* **Simplified Project Structure:** Your workspace contains only your application code (`app.js`/`app.ts`, `actions/`), reducing clutter.
* **Cross-Platform Compatibility:** The appropriate engine binary (`@titanpl/engine-<os>-<arch>`) is automatically installed for your system.

### How it Works
1. **The CLI:** When you run commands like `titan dev` or `titan build`, the `@titanpl/cli` takes over.
2. **Bundling:** Your JavaScript/TypeScript code is bundled and optimized by `@titanpl/packet` (our high-speed esbuild wrapper).
3. **Execution:** The CLI locates the appropriate pre-compiled Rust engine binary and passes your bundled application securely into its embedded V8 environment (the Gravity Runtime).

---

## 🧩 2. Core Components

The Titan architecture is built from independent, specialized packages that work together seamlessly:

### `@titanpl/engine-*` (The Native Backend)
The beating heart of Titan. It is a highly optimized Rust binary utilizing [Axum](https://github.com/tokio-rs/axum) for high-performance networking and an embedded V8 engine (via `v8` crate bindings) to execute your JavaScript/TypeScript.
* Handles HTTP routing natively.
* Manages the lifecycle of the V8 isolate.
* Exposes the `t` namespace APIs securely into the JS environment.

### `@titanpl/packet` (The Bundler)
Our custom esbuild-based bundler.
* Transpiles TypeScript into JavaScript natively.
* Resolves imports instantly.
* Prepares the final `.js` artifacts that the Engine will consume.

### `@titanpl/cli` (The Developer Interface)
The entry point for all development workflows (`init`, `dev`, `build`, `start`, `migrate`, `create ext`).
* Orchestrates the bundler and the engine natively.
* Removes the need for PM2 or JS-based watchers.
* Maps terminal commands cleanly to the underlying Rust binary.

### `@titanpl/route` & `@titanpl/native`
The DSL libraries. 
* `@titanpl/route`: Provides the intuitive `t.get()`, `t.post()` syntax you use in your `app.ts`.
* `@titanpl/native`: Type definitions and bridging logic for interacting with the native `t.*` APIs (like `t.fetch` or `t.log`).

---

## ⚡ 3. The Execution Workflow

Understanding the lifecycle of a Titan application:

### Development Mode (`titan dev`)
1. The CLI starts watching your `app` folder for changes.
2. `app.ts/js` is read and parsed. The routing DSL builds an internal routing table.
3. Your actions (`actions/*.js` or `actions/*.ts`) are bundled rapidly by `@titanpl/packet`.
4. The CLI spawns the pre-compiled Engine binary in `--watch` mode, feeding it the newly created bundles.
5. Upon any file change, the CLI signals the Engine to hot-swap the V8 isolates without dropping the HTTP listener, resulting in sub-second hot reloads.

### Production Build (`titan build` -> `titan start`)
1. `@titanpl/packet` heavily optimizes and tree-shakes your JavaScript.
2. The routing table is finalized.
3. Assets and bundles are emitted to the `dist/` directory.
4. `titan start` boots the Engine pointing to the `dist/` folder, primed for maximum throughput and minimal memory overhead.

---

## 🔌 4. The Extension System (Native Plugins)

While you no longer need Rust to build standard Titan applications, the new architecture still supports extreme performance via **Native Extensions**.

Instead of writing Rust directly in the `server/` folder, you now write standalone Dynamic Libraries (`.dylib` / `.so` / `.dll`).

### The Extension Workflow:
1. **Scaffold:** Run `titan create ext my_extension`. This creates a streamlined Rust project.
2. **Develop:** Write your high-performance logic using standard Rust.
3. **Compile:** Rust compiles this into a Dynamic Library.
4. **Link:** In your `mkctx.config.json` or `titan.json`, specify the path to your compiled extension.
5. **Execute:** At runtime, the Gravity Engine dynamically loads your `.dylib`/`.so`, making your native Rust functions instantly available in JavaScript via `t.ext.my_extension.my_function()`.

Because these are dynamically linked, they do not require recompiling the core Engine, keeping iteration speeds incredibly fast.

---

## 🚀 5. Why We Moved to This Architecture

1. **Accessibility:** Many developers loved Titan's API but were deterred by Rust compilation errors or installation headaches. Now, it just works.
2. **Speed:** Rust compilation is notoriously slow. By shipping a pre-compiled engine, `init` to `dev` takes seconds instead of minutes.
3. **Stability:** Decoupling the user's logic from the core networking stack prevents user code from causing compiler panics or memory leaks in the HTTP layer.

---

---

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.

*Welcome to the future of high-performance backend development.*
