# Changelog

All notable changes to the **Titan Planet** project will be documented in this file.

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
