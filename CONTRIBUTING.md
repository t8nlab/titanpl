# Contributing to Titan Planet 🪐

We love contributions! Titan is a unique hybrid framework, so there are opportunities for both **JavaScript** and **Rust** developers to make an impact.

## 🛠 Prerequisites

Before you start, ensure you have:
- **Node.js** (v18+)
- **Rust** (Latest stable)
- **Titan CLI** installed globally (for testing consumption) or linked locally.

---

## 🟡 For JavaScript Developers

You can contribute to the **CLI**, **Templates**, and **Runtime Polyfills**.

### 1. The CLI (`index.js`)
The Titan CLI is written in pure Node.js. It handles project scaffolding, dev server orchestration, and bundling coordination.
- **Location**: `index.js`, `scripts/`
- **Tasks**:
  - Improving the `titan init` generator.
  - Enhancing the `titan dev` watcher logic (chokidar).
  - Improving log formatting and DX.
  - Adding new CLI commands (e.g., `titan dockerfile`).

### 2. Templates (`templates/`)
Titan ships with starter templates.
- **Location**: `templates/app`, `templates/js`
- **Tasks**:
  - Adding more example actions.
  - Improving the default `routes.json` or `app.js`.
  - Enhancing typings in `titan.d.ts`.

### 3. Extensions
You don't need to touch the core to add features! You can build **Titan Extensions**.
- Create a new extension: `titan create ext my-feature`
- Implement robust JS wrappers for native features.

---

## 🔴 For Rust Developers

You can contribute to the **Core Server**, **Performance**, and **Native Runtime**.

### 1. The Core Server (`templates/server/`)
This is the heart of Titan. It's an Axum server that embeds the V8 engine.
- **Location**: `templates/server/src/`
- **Tasks**:
  - **`main.rs`**: optimizing the Axum startup and routing.
  - **`action_management.rs`**: Improving how hybrid actions are routed.
  - **`extensions.rs`**: This is where V8 meets Rust. Adding new native APIs (like `t.db` or `t.redis`) happens here.

### 2. Stability & Windows/Linux Compat
Titan compiles to a native binary. We need help ensuring:
- File locking issues are handled (Windows).
- Cross-compilation targets work (Musl, headers).
- Docker builds are optimized.

### 3. Native Action Integration
Help improve the Beta "Rust Actions" feature.
- Improve the macro/codegen that links `app/actions/*.rs` to the server.
- Expose more Axum/Tower features to the Rust action context.

---

## 🚀 Development Workflow

1. **Clone the repo**
   ```bash
   git clone https://github.com/ezet-galaxy/titanpl.git
   cd titanpl
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Link CLI locally**
   ```bash
   npm link
   ```
   Now running `titan` uses your local version.

4. **Test your changes**
   Create a test folder and run your local Titan against it:
   ```bash
   mkdir test-app
   cd test-app
   titan init
   titan dev
   ```

## 🤝 Code Style
- **JS**: Use standard ES6+. No semicolons (unless required).
- **Rust**: Run `cargo fmt` before submitting.

## 📝 Pull Requests
- Open an issue discussing the change first if it's a major feature.
- Ensure `titan dev` runs cleanly on both JS and Rust templates.
- Update `CHANGELOG.md` if applicable.

Thank you for helping us build the future of Hybrid Backend Development! 🚀
