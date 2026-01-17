# Changelog

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
