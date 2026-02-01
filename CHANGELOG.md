# Changelog

## [26.13.6] – 2026-02-01

### Summary
Full TypeScript support across templates, `@titan/route` and `@titan/native` path aliases, critical `t.fetch` async typing fix, and restructured type definitions to eliminate declaration conflicts.

### Breaking Changes
- `eslint-plugin-titanpl` → `^2.0.0`
- `"../titan/titan.js"` → `"@titan/route"`
- `"../../titan/runtime"` → `"@titan/native"`
- `eslint.config.js` moved to individual templates

## 🐛 Fixes

### **Critical `t.fetch` Typing Bug**
`titan/titan.d.ts` overwrote correct async `Promise<{ok: boolean}>` return type from `app/titan.d.ts`. Removed duplicate `declare global` block entirely.

### **Type Definition Conflicts**
Split declarations cleanly:
- `app/t.native.d.ts` (`@titan/native`): Runtime types, `TitanRequest`, `defineAction`, named exports (`fetch`, `log`, `db`)
- `titan/titan.d.ts` (`@titan/route`): Builder types only (`RouteHandler`, `TitanBuilder`)

## 🔧 Improvements

### **Path Aliases**
Added `@titan/route` → `./titan/titan` and `@titan/native` → `./app/t` across **all templates** (`js/`, `ts/`, `rust-js/`, `rust-ts/`).

### **Named Exports**
`app/t.native.js` now exports `fetch`, `db`, `defineAction` for explicit imports alongside global `t`.

### **TypeScript Templates**
- Individual `eslint.config.js` with `@typescript-eslint/parser ^8.54.0`
- Removed `titan/runtime.js`, `titan/runtime.d.ts`
- Removed `ignores: ['**/*.d.ts']`

### **Other**
- vitest as peer dependency
- Version → `26.13.6`

### Affected Templates
| Template | Changes |
|----------|---------|
| `templates/common/` | `app/t.native.d.ts` fixed, `app/t.native.js` added |
| `templates/js/` | **Aliases**, `eslint.config.js` |
| `templates/ts/` | **Aliases**, TS ESLint, runtime files removed |
| `templates/rust-js/` | **Aliases**, `eslint.config.js` |
| `templates/rust-ts/` | **Aliases**, TS ESLint, runtime files removed

## [26.13.3] – 2026-01-30

## 🛠 Fixes

### **Action Discovery & Registration**

Resolved **“Action hello not found”** errors in Dev Mode.

* Enforced usage of the global `defineAction` wrapper in the bundler to correctly manage the request lifecycle.
* Synchronized the bundler’s source directory with the project structure (`app/src/actions`).

### **Dev Mode Stability**

* Fixed a race condition where `titan dev` could leave **ghost server processes**, leading to port binding failures.

### **Template Fallback**

* Improved action template loading to support both:

  * Local paths → `./static/...`
  * Docker paths → `./app/static/...`

---

## [26.13.2] – 2026-01-30

## 🐛 Fixes

### **Native Extension Segfault**

Resolved a critical crash (**Exit 139**) during asynchronous `drift()` calls.

* Correctly bound the `TitanRuntime` pointer to **V8 isolate data slot 0**.
* Enabled safe runtime access for native extensions.

### **HTTPS Support in Docker**

* Added `ca-certificates` to the production Docker image.
* Fixed `t.fetch` failures caused by missing root certificates in minimal Debian images.

### **Port Mapping**

* Corrected `Dockerfile` to expose **port `5100`** instead of the incorrect `3000`.

---

## ✨ Added

### **Production-Ready Docker Environment**

* Switched to `debian:stable-slim` for smaller and faster images.
* Optimized multi-stage builds to reduce final image size.

### **V8 Isolate Data Binding**

* Introduced `TitanRuntime::bind_to_isolate()` for safe Rust ↔ V8 extension communication.

---

## ⚡ Optimized

### **Dockerfile Build Performance**

* Merged redundant `RUN` instructions.
* Removed excessive debug logs during extension extraction for cleaner deploy output.

### **Debug Artifact Cleanup**

* Removed `println!` debug traces.
* Deleted temporary action test files such as `dtest.js`.

---



## [26.13.1] – 2026-01-28

### Critical Bundling Fix & Action Wrapping

## ✨ Highlights

### **New: Deep Clean Command**
Added a new `-c` flag to `titan dev` (e.g., `tit dev -c`).
*   **Deep Clean**: Recursively deletes `.titan`, `server/actions`, and `server/target`.
*   **Fresh Start**: Forces a full rebuild of both the JS bundler and the Rust project, useful for resolving stubborn build caching issues.

## 🐛 Fixes

*   **Fixed Hanging Actions**: Resolved a critical issue where the bundler was generating incorrect wrapper code (`return fn(req)` instead of `globalThis.defineAction(fn)`), causing the Rust runtime to never receive the completion signal.
*   **Restored Request Completion**: Ensure all actions (sync and async) correctly trigger `t._finish_request`, preventing browser and curl requests from timing out.
*   **Updated Bundler Logic**: Modified `builtin/bundle.js` to enforce the use of the `defineAction` helper for all compiled actions.

---

## [26.13.0] – 2026-01-25

### Minor Stability Release & Drift Syntax Evolution

## ✨ Highlights

### **↪️ The New Drift System**
This release introduces our revolutionary **Drift** system, a high-performance orchestration engine for asynchronous operations using a **Deterministic Replay-based Suspension** model.

*   **Mechanism**: Drift utilizes a suspension model similar to **Algebraic Effects**. When a `drift()` operation is encountered, the runtime suspends the isolate, offloads the task to the background Tokio executor, and frees the isolate to handle other requests. Upon completion, the code is efficiently **re-played** with the result injected.
*   **Syntax Evolution**: Migrated from the keyword-style `drift t.fetch(...)` to a standardized functional wrapper `drift(t.fetch(...))`. Our transformer pipeline ensures backward compatibility and optimized native handovers.
*   **Performance**: Improved concurrency by ensuring isolates are never blocked during I/O operations, leading to significantly higher throughput under heavy load.
*   **Predictability**: Standardized deterministic execution paths, ensuring that dynamic imports and module caches remain consistent during replay cycles.

### **Internal Polishing & Reliability Fixes**
Tightened the Gravity worker pipeline and improved developer-facing clarity for actions, extensions, and internal APIs.

## 🚀 Improvements

*   **Standardized Drift**: unified `drift()` function for all async offloading operations.
*   **Warm-up Optimization**: More consistent isolate warm-up across multi-core systems.
*   **Log Filtering**: Reduced noisy logs during cold boot and the very first request.
*   **Manifest Validation**: Improved detection for missing extension manifests during startup.
*   **Handover Speed**: Slightly faster worker-handover when running large action bundles.

## 🐛 Fixes

*   Resolved a rare issue where `t.db.connect()` would emit a stale connection reference under heavy parallel load.
*   Fixed misformatted error traces when an action throws during JSON serialization.
*   Corrected edge-case bug where dynamic imports inside actions were not invalidating the module cache in watch mode.
*   Addressed occasional double-logging of worker crashes in debug builds.
*   Fixed minor memory leak involving per-request metadata inside long-lived isolates.

---

## [26.12.9] – 2026-01-27

### 🔩 Stability & JS Ecosystem Fixes

This release addresses critical interoperability issues within the JS Action Runtime, specifically targeting module resolution and bundling in strict ESM environments.

## ✨ Highlights

### **Fixed ESM Export Mismatch**

A module export mismatch between the bundling system and the core runtime was causing `TypeError: bundle is not a function` during production builds.

*   Changed `bundle.js` from **default export** to **named export** to align with internal tooling expectations.
*   Updated `titan.js` to use named imports (`import { bundle } from ...`).

### **Strict ESM Compatibility**

Resolved issues with `type: module` enforcement in newer Node.js versions.

*   Added explicit `.js` extensions to all internal relative imports in `titan` core files.
*   Ensured consistent behavior across both `test-apps` and newly generated projects from templates.

---

## [26.12.6] – 2026-01-26

### Stability, Core Runtime Enhancements & Developer-Facing Improvements

This release strengthens the Gravity execution model, improves extension-level safety, and introduces several refinements in route handling, request bridging, and worker consistency.

## ✨ Highlights

### **Gravity Runtime Refinements**

Gravity receives an incremental stability upgrade aimed at increasing predictability under load and ensuring consistent performance across multi-threaded isolates.

### **Improved Request/Response Bridge**

Core request/response transfer paths have been polished, resulting in more reliable serialization, safer edge-case handling, and better compatibility with custom action frameworks.

---

## 🚀 Improvements

* More reliable propagation of `t.response.*` changes from actions back into Rust, reducing null/undefined edge-cases during serialization.
* Further optimized isolate reuse — lower cold-start latency and smoother thread scheduling across high-core environments.
* Faster initialization of action bundles, especially when combining large JS bundles with V8 snapshot warm-ups.
* Improved validation and structure checking for extension-provided methods injected into `t.*`.
* More consistent generation of `routes.json` and `action_map.json` during the `tit` build/run pipeline.
* Tighter internal enforcement of synchronous execution boundaries inside Gravity, ensuring safer deterministic behavior.

---

## 🐛 Fixes

* Fixed an issue where returned values from actions could resolve to `null` if JSON stringification occurred inside a nested TryCatch context.
* Patched an intermittent race condition where thread workers reported incomplete request metadata under heavy concurrent load.
* Fixed improper merging of dynamic routes when multiple colon-parameters were used in chained definitions.
* Eliminated a memory retention bug tied to per-request global shadow copies of `req` inside long-lived isolates.

---

## [26.12.5] – 2026-01-25

### Minor Stability Release

## ✨ Highlights

### **Internal Polishing & Reliability Fixes**

This update focuses on tightening small inconsistencies inside the Gravity worker pipeline and improving developer-facing clarity when working with actions, extensions, and internal APIs.

## 🚀 Improvements

* More consistent isolate warm-up across multi-core systems.
* Reduced noisy logs during cold boot and first request.
* Improved detection for missing extension manifests during startup.
* Slightly faster worker-handover when running large action bundles.

## 🐛 Fixes

* Resolved a rare issue where `t.db.connect()` would emit a stale connection reference under heavy parallel load.
* Fixed misformatted error traces when an action throws during JSON serialization.
* Corrected edge-case bug where dynamic imports inside actions were not invalidating the module cache in watch mode.
* Addressed occasional double-logging of worker crashes in debug builds.
* Fixed minor memory leak involving per-request metadata inside long-lived isolates.

---

## [26.12.3] – 2026-01-24

### Titan Gravity Runtime — Stable

## ✨ Highlights

### **Gravity Runtime Stabilized**

The multi-isolate V8 reactor engine is now fully stable.
Each worker runs its own long-lived isolate with precompiled actions, enabling predictable multi-core performance.

### **t.db Fixed & Optimized**

`t.db` now uses a proper connection pool:

* no reconnect per request
* lower DB latency
* more stable and consistent queries

This removes the 300–600 ms overhead seen in earlier builds.

## 🚀 Improvements

* Isolate boot, shutdown, and scheduling are now deterministic.
* JSON parsing moved inside worker threads for lower network-thread load.
* Better logs for action errors and extension load failures.
* CLI startup banner and environment resolution improved.

## ⚡ Performance

* 10k–12k req/sec on 8-core hardware
* Sub-1 ms compute routes
* 2–5 ms DB reads (local + pooled)

## 🐛 Fixes

* Route resolver bugs corrected
* Rare isolate freeze resolved
* Node modules extension lookup fixed

---

## [26.12.0] – 2026-01-24

### 🔥 Major Architecture Overhaul: Strictly Synchronous V8 Runtime

TitanPL has undergone a **fundamental architectural transformation** to enforce a strictly synchronous, request-driven execution model. This eliminates all Node.js-style event loop mechanics, background task processing, and asynchronous primitives from the V8 runtime.

### 🎯 Core Philosophy Shift

* **No Event Loop in V8 Workers**: TitanPL is now a **"Synchronous Multi-Threaded V8 Runner"** — not a Node.js alternative.
* **Request-Driven Execution**: Workers process one request at a time, block until completion, then await the next request.
* **Deterministic Execution**: All code runs synchronously from request entry to response exit, making debugging linear and predictable.
* **True Isolation**: Each worker owns an independent V8 isolate with zero shared state or cross-worker communication.

### ✨ What Changed

#### **1. Event Loop & Async Primitives Removed**
* ❌ **Removed `setTimeout`**: No timer scheduling within V8. All timing logic must be handled externally or via blocking Rust operations.
* ❌ **Removed Event Subscriptions**: Eliminated the `shareContext.subscribe()` API and all background event bridging between Rust broadcast channels and V8.
* ❌ **Removed Timer Tasks**: The `WorkerCommand::Timer` variant and `TimerTask` struct have been deleted.
* ❌ **Removed Event Tasks**: The `WorkerCommand::Event` variant and all event dispatch logic have been removed.
* ❌ **Simplified Worker Loop**: Changed from `crossbeam::select!` multi-event handling to a simple blocking `rx.recv()` for requests only.

#### **2. Extensions Module Refactored**
* **Modular Structure**: Split the monolithic `extensions.rs` into three focused modules:
  * `extensions/mod.rs` - Core V8 orchestration, isolate initialization, and runtime management
  * `extensions/builtin.rs` - First-party Titan APIs (`t.log`, `t.fetch`, `t.jwt`, `t.password`, `t.read`, `t.decodeUtf8`)
  * `extensions/external.rs` - Dynamic loading of extensions from `node_modules` with WebAssembly-like ABI
* **Embedded Runtime**: The `titan_core.js` runtime script is now compiled directly into the binary using `include_str!()`, eliminating disk I/O during worker initialization.
* **Borrow Checker Fixes**: Resolved dozens of Rust borrow checker conflicts by introducing intermediate variables for V8 handles and reordering mutable borrow operations.

#### **3. Synchronous APIs Only**
* **Blocking I/O**: `t.fetch()` now uses a blocking HTTP client (`reqwest::blocking`). Each HTTP request blocks the worker thread until completion.
* **No Promises**: JavaScript actions cannot return Promises or use `async/await`. All functions must be synchronous.
* **Direct Execution**: Actions execute directly on the worker thread without any deferred task scheduling.

### ⚡ Performance Optimizations

#### **Cold Start Cost - Reduced**
* **Embedded JS Runtime**: Core Titan runtime (`titan_core.js`) is embedded in the binary, eliminating file I/O during initialization.
* **Pre-compiled Extensions**: All built-in APIs are registered once during V8 initialization.
* **Snapshot Strategy Documented**: While V8 `SnapshotCreator` exists in the API, full implementation requires build-time tooling. Strategy is documented in `PERFORMANCE.md`.

**Impact**: Cold start reduced from ~8-12ms to **~3-5ms** per worker initialization.

#### **Memory Usage Per Worker**
* **Heap Limit Strategy**: Since the `v8` Rust crate (v0.106.0) doesn't fully expose `ResourceConstraints`, memory limits can be set via:
  * V8 CLI flags: `--max-old-space-size=128`
  * Environment variables: `V8_FLAGS="--max-old-space-size=128"`
* **Code Sharing**: Embedded runtime reduces redundant memory allocation across workers.
* **Trade-offs**: Higher per-worker memory footprint (~40-80MB) is accepted in exchange for crash isolation and true parallelism.

#### **I/O Performance - Explicitly Not a Goal**
* **Design Decision**: TitanPL **intentionally does not optimize for I/O concurrency**.
* **Synchronous Blocking**: All I/O operations block the worker thread. Scaling is achieved by increasing worker threads, not through internal async I/O.
* **Use Case Alignment**: Ideal for CPU-bound workloads, deterministic execution, and linear debugging. For I/O-heavy services, use async runtimes like Node.js or Deno.

### 📊 Benchmark Results

Under load testing with `autocannon -c 200 -d 30`:

```
Latency:  14-17ms (p50), 30ms (p97.5), 34ms (p99)
Throughput: 10,684 req/sec average (6.5k-11.9k range)
Data Transfer: 321k requests in 30.31s, 43.9 MB read
```

**Performance Profile:**
* Cold Start: ~3-5ms (embedded runtime)
* Action Execute: ~100-500µs
* Memory/Worker: ~40-80MB (configurable via V8 flags)

### 🛡️ Code Quality Improvements

* **Test Application Cleanup**: Removed all routes and actions dependent on `setTimeout` or event subscriptions from the test application (`app/app.js`, `app/actions/test.js`).
* **Dead Code Elimination**: Removed unused imports, TOKIO handle registration, and background event-bridging logic from `main.rs` and `runtime.rs`.
* **Type Safety**: Fixed all Rust compiler warnings and borrow checker errors across the extension system.

### 📚 Documentation

* **NEW: `PERFORMANCE.md`**: Comprehensive documentation covering:
  * Cold start optimization strategies (embedded runtime, snapshot approach)
  * Memory usage optimization techniques (V8 flags, heap limits)
  * I/O performance trade-offs and design philosophy
  * Benchmark results and measurement methodology
* **Updated Architecture Documentation**: README now reflects the synchronous execution model.

### ⚠️ Breaking Changes

#### **Removed APIs**
* `setTimeout(callback, ms)` - No longer available in V8 context
* `t.shareContext.subscribe(channel, callback)` - Event subscriptions removed
* All Promise-based or async APIs in user actions will no longer work

#### **Behavioral Changes**
* Workers no longer process background events or timers
* All I/O is blocking (HTTP, DB, etc.)
* Code execution is strictly synchronous from request entry to response exit

### 🔄 Migration Guide

**If your actions used `setTimeout`:**
```javascript
// ❌ Before (no longer works)
setTimeout(() => { t.log("delayed"); }, 1000);

// ✅ After (handle timing externally or use Rust)
// Move timer logic to client-side or use external job queues
```

**If your actions used `shareContext.subscribe`:**
```javascript
// ❌ Before (no longer works)
t.shareContext.subscribe("channel", (data) => { ... });

// ✅ After (use polling pattern)
export const pollUpdates = defineAction((req) => {
  const data = t.shareContext.get("channel");
  return { data };
});
```

**If your actions used `async/await`:**
```javascript
// ❌ Before (no longer works)
export const fetchUser = defineAction(async (req) => {
  const response = await t.fetch("https://api.example.com/user");
  return response;
});

// ✅ After (synchronous only)
export const fetchUser = defineAction((req) => {
  const response = t.fetch("https://api.example.com/user"); // Blocks until complete
  return response;
});
```

### 🎯 Who Should Upgrade?

**Upgrade immediately if:**
* You need deterministic, linear execution for debugging
* You're building CPU-bound or compute-heavy services
* You want predictable memory usage per worker
* You value crash isolation over I/O concurrency

### 🙏 Acknowledgments

This release represents a complete rethinking of TitanPL's execution model, prioritizing **simplicity, determinism, and debuggability** over async I/O performance.

---

## [26.11.0] – 2026-01-23

### Notice 
* **Rust + JS/TS are under development still in (BETA)**

### ✨ Features

* **Multi-Isolate V8 Runtime (Reactor Model)**
  TitanPL now runs each request inside an independent V8 isolate, managed through a dedicated worker-pool.
  This fully removes the previous global-mutex bottleneck and enables true multi-core JavaScript execution.

* **Runtime Worker Pool**
  Introduced a high-performance `RuntimeManager` that dispatches incoming requests to a pool of long-lived V8 workers using lock-free channels.
  Each worker keeps its own isolate, context, and compiled actions.

* **Starter Banner (CLI Logo)**
  Added a new TitanPL CLI startup banner with a clean planet-style logo for improved developer experience and branding consistency.

* **New README: TitanPL Runtime Architecture Explained**
  The documentation has been fully rewritten to explain the new architecture:

  * How requests flow through Axum → RuntimeManager → Worker Threads → V8
  * How isolates are created and reused
  * How actions are precompiled
  * How extensions and native modules load
  * How memory and concurrency work internally

### ⚡ Performance Improvements

* **10× Reduction in Contention**
  Removed the single global `Mutex<TitanRuntime>`. All worker threads run independently with no shared lock.

* **True Multi-Core Scaling**
  TitanPL now scales linearly with CPU cores.
  On 8-core machines, throughput increases from ~6k req/sec to **10k–12k+ req/sec**.

* **Lower Latency Under Load**
  With the reactor-pool architecture, TitanPL sustains:

  * **500 connections:** ~10.7k req/sec
  * **800 connections:** ~8.3k–10k req/sec
    Even under saturation, TitanPL remains stable with predictable latency.

* **JSON Serialization Overhead Reduced**
  Moved JSON → V8 parsing to worker threads, isolating cost away from async network threads.

### 🐛 Fixes

* **Action Initialization Stability**
  Improved V8 error reporting for miscompiled or invalid action files.
  Added structured logging for action load failures during startup.

* **Extension Loader Reliability**
  Fixed an issue where native extensions inside `node_modules` were skipped if the runtime was started from a nested working directory.

* **Request Path Resolution**
  Adjusted route resolution to correctly handle nested routes and dynamic patterns across fallback handlers.

* **CLI Startup Logic**
  The CLI now correctly displays the new logo, resolves working directories consistently, and prevents missing-module errors on fresh installs. Before starting now TitanPl runtime check if your actions have any error then it's log that correctly (Available only in JS apps, TS already have this.)

## [26.10.3] - 2026-01-21

### ✨ Features
- **CLI Helper**: Added a new CLI helper for better handling of multiple instances (beta phase).
- **E2E Testing**: Added End-to-End (E2E) testing support. You can now create e2e tests using the cli-helper to simplify the process.

### 🐛 Fixes
- **CLI Symlink Resolution**: Fixed an issue where the CLI produced no output when invoked via a symlink (e.g., global nvm/npm install). The CLI now correctly resolves the real path of the script before checking if it is the main module.
- **Start Command**: Fixed `npm run start` command which was previously causing an error.

## [26.10.2] - 2026-01-20

### 🧩 Extension Development Experience
- **Extension Type Support**: Added `index.d.ts` to the extension template.
  - Enables extension authors to define type definitions that automatically merge with the global `Titan.Runtime` interface.
  - Ensures consumers of the extension get full IntelliSense and type safety on `t.ext.my_extension`.
- **Documentation**: Added a comprehensive `README.md` to the extension template, guiding developers on how to structure extensions and providing clear examples for TypeScript declaration merging.

### 🐛 Fixes
- **Global Type Conflicts**: Resolved `Cannot redeclare block-scoped variable 't'` errors in local development environments where multiple template definitions coexist. adjusted `titan.d.ts` across templates to use `var` for global declarations, ensuring safe merging.
- **TitanPL SDK**: Bumped `titanpl-sdk` to `0.2.1` to reflect updated type definitions.

## [26.10.1] - 2026-01-20

### ✨ Features
- **TitanPL ESLint Plugin Integration**:
  - **Streamlined Linting**: Replaced custom ESLint configurations with `eslint-plugin-titanpl` in all project templates.
  - **Reduced Boilerplate**: Removed the `globals` dependency and simplified `eslint.config.js` by leveraging the new plugin's preset, ensuring better integration with TitanPL specific rules.

## [26.10.0] - 2026-01-19

### 🧬 New Titan Native ABI Engine
- **Dynamic Signature Support**: Replaced the legacy fixed-signature system with a fully dynamic ABI engine. `titan.json` now drives the function signatures, allowing native extensions to define precise inputs and outputs.
- **Enhanced Type System**:
  - Added native support for **String**, **F64**, **Bool**, **JSON**, and **Buffer** (`Vec<u8>`).
  - **Zero-Copy Memory Model**: Implemented efficient, owned-value transfer between V8 and Rust, ensuring memory safety without manual pointer management.
- **Universal Dispatcher**:
  - **Variadic Arguments**: JS wrappers now use rest parameters (`...args`), enabling native functions to accept any number of arguments defined in their signature.
  - **Smart Dispatch**: The engine automatically marshals V8 values to Rust types and dispatches to the correct native symbol based on the signature index.

### 🛡️ Core Reliability
- **Safety Fixes**:
  - Resolved **borrow checker conflicts** in the extension loader and V8 scope management.
  - Fixed **Cell casting** issues in Buffer handling (`Cell<u8>` -> `u64`), ensuring correct binary data transfer.
  - Removed duplicate logic in argument parsing loops for cleaner execution paths.
- **Extension Stability**:
  - Fixed `ReferenceError: module is not defined` by ensuring extensions don't rely on Node.js-specific globals in the Titan IIFE wrapper.
  - Verified full ABI compatibility with the `test-js` app suite.


## [26.9.4] - 2026-01-17

### 🧩 Extension System Enhancement
- **Complex Extension Support**: Added `@titanpl/core` (v1.0.1) dependency to provide core functionality for building and managing complex extensions.
  - Enables advanced extension features across all template types (JS, TS, Rust-JS, Rust-TS).
  - Provides foundational APIs for extension development and runtime integration.
  - Integrated into all project templates for consistent extension support.

## [26.9.2] - 2026-01-17

### 🏗️ Template Modularity & Architecture
- **Modular Template System**: Refactored `index.js` to implement a two-phase copy logic (Common + Specific) for templates, allowing for deterministic project creation.
- **Smart Mapping**: `initProject` now correctly maps user selections (Language + Architecture) to the distinct template folders (`js`, `ts`, `rust-js`, `rust-ts`).
- **Metadata Injection**: New projects now include a `titan.template` key in `package.json` (e.g., `"template": "rust-ts"`), ensuring the CLI always knows exactly which template to use for updates.

### 🔄 Deterministic Updates
- **Safe `titan update`**: The update command now reads the injected metadata to determine the correct source template, preventing accidental overrides (e.g., replacing a Rust binary with a JS-only runtime).

### 🧪 Testing & Stability
- **Robust Mocking**: Added comprehensive mocks for `path` and `url` native modules in the test suite.
- **State Isolation**: Fixed test state leakage in `prompts`, ensuring reliable test execution.
- **Integrated Coverage**: Added tests for template mapping and metadata verification.

### 📚 Documentation
- Updated `README.md` to reflect the new modular architecture and provided clearer Quick Start options.

## [26.9.1] - 2026-01-16

### 🛡️ Type Safety & SDK
- **Stable Titan SDK (v0.1.7)**: The `titanpl-sdk` has been promoted to a stable release.
  - **Persistent Test Harness**: The extension test runner (`titan run ext`) now intelligently preserves your test code (`app/app.js`, `app/actions`) between runs, so you can build complex test suites without them being wiped.
  - **Smart Linking**: Safely re-links your extension to `node_modules` on every run to ensure the latest code is always active.
- **Enhanced TypeScript Definitions**:
  - Unified `titan.d.ts` structure for both Standard and Hybrid templates.
  - Improved type inference for `defineAction` and `TitanRequest`.

## [26.9.0] - 2026-01-15

### 🛡️ Reliability & Safety
- **Strict TypeScript Enforcement**: The dev server (`titan dev`) now enforces a "Zero Tolerance" policy for type errors. If `tsc` reports any issues, the server is immediately killed to prevent running invalid or outdated code.
- **Zombie Process Elimination**: Fixed race conditions where the server would restart prematurely while TypeScript was still checking files.

### 🐛 Debugging Experience
- **Native-Like Runtime Errors**: JavaScript runtime errors (e.g. `TypeError`, `ReferenceError`) now appear in the terminal with full **TypeScript-style styling**, including:
  - Precise file paths (e.g., `app/actions/hello.ts:12:4`) instead of `undefined`.
  - Line and column numbers.
  - Code snippet previews with error pointers (`^`).

### ⚡ Fixes
- **Windows Port Conflicts**: Implemented robust retry logic for `os error 10048` to handle aggressive port reuse on Windows.
- **CLI Update Fix**: Resolved issues with `npx tit update` failing due to missing template paths in certain npm installation environments.



## [26.8.3] - 2026-01-14

### ✨ Developer Experience (DX)
- **Minimalist Hot Reloads**: The Titan branding banner and server address are now only displayed on the initial start. Subsequent hot reloads are significantly cleaner, showing only the "Stabilizing" spinner and new logs.
- **Smart Startup Logic**: Optimized how the dev server captures and flushes logs during the "orbit stabilization" phase to ensure no data is lost while keeping the UI remains tidy.
- **Improved Windows Stability**: Refined port handling and process cleanup to prevent "address in use" errors during rapid file changes.

## [26.8.2] - 2026-01-14

### 🏎️ Performance Optimizations
- **10x Faster Rust Reloads**:
  - Enabled **Incremental Compilation** (`CARGO_INCREMENTAL: "1"`) for development builds.
  - Enabled **Multi-core Compilation**: Removed restrictive CPU thread limits to fully utilize system resources.
  - **Optimized Dev Profile**: Added a custom `[profile.dev]` to `Cargo.toml` with `opt-level = 0` and `debug = 1` for significantly faster linking times.
- **Snappier Dev Loop**: 
  - Reduced hot-reload stability threshold from 1000ms to **300ms**.
  - Optimized the ready-signal detection to launch the server immediately after a successful build.

### ✨ Developer Experience (DX) Overhaul
- **Premium "Orbiting" Experience**:
  - Replaced messy build logs with a sleek, custom animated **"Stabilizing" spinner**.
  - Implemented **Silent Builds**: Cargo compilation noise is hidden by default and only automatically revealed if an error occurs.
  - **Smart Log Forwarding**: ASCII art and runtime logs are now flawlessly flushed to the terminal as soon as the server is ready.
- **Clean CLI**: Removed the Node.js `[DEP0190]` security warning by switching to direct process execution instead of shell-wrapping.

### 🐛 Fixes
- Fixed "Premature Orbiting": The dev server now waits for the server to be fully responsive before showing the success checkmark.
- Improved version detection to correctly reflect the Titan CLI version across all project structures.
- Fixed stuck spinner when `cargo` was not found in the path.

## [26.8.0] - 2026-01-14

### 🚀 New Features
- **Hybrid Rust + JS Actions (Beta)**: You can now mix `.js` and `.rs` actions in the same project. Titan automatically compiles and routes them.
  - Added "Rust + JavaScript (Beta)" option to `titan init`.
  - Added support for compiling `app/actions/*.rs` files into the native binary.
  - Unified `t` runtime API usage across both JS and Rust actions.
- **Enhanced Dev Mode UI**:
  - `titan dev` now features a cleaner, more informative startup screen.
  - Added "Orbit Ready" success messages with build time tracking: *"A new orbit is ready for your app in 0.3s"*.
  - Dynamic detection of project type (JS-only vs. Hybrid).
- **Interactive Init**: `titan init` now prompts for template selection if not specified via flags.

### 🛠 Improvements
- **Reduced Verbosity**:
  - Silenced excessive logging during extension scanning.
  - Simplified bundling logs ("Bundling 1 JS actions..." instead of listing every file).
- **Performance**:
  - Validated incremental compilation settings for Windows stability.
  - Optimized file watching for hybrid projects.

### 🐛 Fixes
- Fixed file locking issues (`os error 32`) on Windows during rapid reloads.
- Fixed `getTitanVersion` to correctly resolve the installed CLI version.
- Unified logging logic between JS and Rust templates for consistency.

---

## [26.7.x] - Previous Releases
- Initial stable release of the JavaScript Action Runtime.
- Added `t.fetch`, `t.jwt`, and `t.password` APIs.
- Integrated `titan dev` hot reload server.
