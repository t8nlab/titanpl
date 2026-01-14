```
████████╗██╗████████╗ █████╗ ███╗   ██╗   ██████╗  ██████╗ ██████╗  ██████╗
╚══██╔══╝██║╚══██╔══╝██╔══██╗████╗  ██║   ╚════██╗██╔═████╗╚════██╗██╔════╝
   ██║   ██║   ██║   ███████║██╔██╗ ██║    █████╔╝██║██╔██║ █████╔╝███████╗
   ██║   ██║   ██║   ██╔══██║██║╚██╗██║   ██╔═══╝ ████╔╝██║██╔═══╝ ██═══██║
   ██║   ██║   ██║   ██║  ██║██║ ╚████║   ███████╗╚██████╔╝███████╗███████║
   ╚═╝   ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚══════╝ ╚═════╝ ╚══════╝╚══════╝
```

# Notice

💙 **Enjoy development mode `titan dev`**
💟 **Titan Planet docs:** https://titan-docs-ez.vercel.app/docs
🚀 **CLI: `titan` is now the canonical command. `tit` remains supported as a legacy alias.**

---

# TITAN PLANET 🚀

[![npm version](https://img.shields.io/npm/v/@ezetgalaxy/titan.svg?style=flat-square)](https://www.npmjs.com/package/@ezetgalaxy/titan)

**JavaScript Simplicity. TypeScript Ready. Native Rust Power. Zero Configuration.**

Titan Planet is a **JavaScript/TypeScript-first Backend Framework** that compiles your application into a single, high-performance native binary. It embeds a V8 JavaScript runtime directly into a specialized Rust + Axum server.

**Start with pure JavaScript or TypeScript.**
**Need raw power? Add Rust actions seamlessly.**
Titan handles the compilation, bundling, and routing automatically for all.

Titan = **JavaScript/TypeScript productivity × Rust performance × Zero DevOps**

---

# 🌌 Why Titan?

| Feature                              | Titan | Express/Nest | FastAPI | Bun       |
| ------------------------------------ | ----- | ------------ | ------- | --------- |
| Native binary output                 | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Hybrid Rust + JS/TS Actions          | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| TypeScript support (zero-config)     | ✅ Yes | ❌ Manual     | ❌ No    | ✅ Yes     |
| Pure JS/TS developer experience      | ✅ Yes | ✅ Yes        | ❌ No    | ❌ Partial |
| Zero-config Docker deploy            | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Action-based architecture            | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Hot reload dev server                | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |

---

# 🚀 Quick Start

### 1. Prerequisites
* **Rust** (latest stable): [Install Rust](https://rust-lang.org/tools/install/)
* **Node.js** (v18+): Required for CLI and JS/TS tooling.

### 2. Install CLI
```bash
npm install -g @ezetgalaxy/titan
```

### 3. Initialize & Run
```bash
titan init my-app
```

Follow the interactive prompt to choose your template:
- **JavaScript** — Standard JS project
- **TypeScript** — Full TypeScript support with zero configuration
- **Rust + JavaScript (Beta)** — Hybrid Rust + JS actions

Or specify the template directly:
```bash
titan init my-app -t js      # JavaScript project
titan init my-app -t ts      # TypeScript project
titan init my-app -t rust    # Rust + JS project (Beta)
```

Inside your project:
```bash
cd my-app
titan dev
```

You'll see the Titan Dev Server spin up:
```
  Titan Planet   v26.8.0   [ Dev Mode ]

  Type:        TypeScript Actions
  Hot Reload:  Enabled
  Env:         Loaded

  ✔ Your app is now orbiting Titan Planet
```

---

# 📋 CLI Commands

```bash
titan init <project>              # Create new Titan project (interactive)
titan init <project> -t js        # Create JavaScript project
titan init <project> -t ts        # Create TypeScript project
titan init <project> -t rust      # Create Rust + JS project (Beta)
titan dev                         # Dev mode with hot reload
titan build                       # Build production Rust server
titan start                       # Start production binary
titan update                      # Update Titan engine
titan create ext <name>           # Create new Titan extension
titan --version                   # Show CLI version
```

---

# ⚡ Hybrid Action System

Titan is unique because it allows you to write endpoints in **JavaScript**, **TypeScript**, and **Rust** within the same project.

### 🟡 JavaScript Actions (`app/actions/hello.js`)
Perfect for business logic, rapid prototyping, and IO-bound tasks.
```javascript
export function run(req) {
    t.log("Handling user request...");
    return { 
        message: "Hello from JavaScript!",
        user_id: req.params.id 
    };
}
```

### 🔵 TypeScript Actions (`app/actions/hello.ts`)
Full type safety with zero configuration.
```typescript
export function run(req: TitanRequest): TitanResponse {
    t.log("Handling typed request...");
    return { 
        message: "Hello from TypeScript!",
        user_id: req.params.id 
    };
}
```

### 🔴 Rust Actions (Beta)
Perfect for heavy computation, encryption, image processing, or low-level system access.
> **Note:** The Native Rust Action API is currently in **Beta**.
```rust
use axum::{response::{IntoResponse, Json}, http::Request, body::Body};
use serde_json::json;

pub async fn run(req: Request<Body>) -> impl IntoResponse {
    let result = heavy_computation();
    t.log("Processed 1M records in Rust");
    Json(json!({ "result": result }))
}
```

**Titan automatically detects, compiles, and routes all action types.**
* `.js` and `.ts` files are bundled with esbuild.
* `.rs` files are compiled into the native binary.
* All share the same `routes.json` configuration.

---

# 🏗️ Project Structure

```
my-app/
├── app/
│   ├── app.js          # or app.ts for TypeScript projects
│   ├── actions/
│   │   ├── hello.js    # JavaScript action
│   │   ├── users.ts    # TypeScript action
│   │   └── compute.rs  # Rust action (Beta)
│   └── titan.d.ts      # Type definitions
├── titan/
│   ├── titan.js        # Titan runtime
│   ├── bundle.js       # Action bundler
│   └── dev.js          # Dev server
├── server/
│   ├── Cargo.toml
│   ├── src/
│   ├── routes.json     # Auto-generated routes
│   └── action_map.json # Auto-generated action map
├── types/
│   └── titan.d.ts      # Global type definitions
├── package.json
├── tsconfig.json       # TypeScript projects only
└── .env                # Environment variables (optional)
```

---

# ✨ Core Capabilities

### 🔌 Unified Runtime API (`t`)
Both JS/TS and Rust actions have access to the powerful `t` namespace:

* `t.fetch(url, options)` — High-performance HTTP client
* `t.log(msg)` — Sandboxed, structured logging
* `t.jwt.sign / verify` — Fast JWT operations
* `t.password.hash / verify` — Secure password handling
* `t.db` — Database access

### 🔥 Hot Reload Development
The `titan dev` command provides:
* Automatic file watching for `app/` directory
* Environment variable reloading (`.env`)
* Instant rebuilds with visual feedback
* Crash recovery with automatic retries

---

### 🧩 Extensions System
Extend the runtime with custom Rust engines using **Titan Extensions**.
* `titan create ext <name>`: Scaffold a new extension.
* `titan run ext`: Test your extension in a lightweight harness.

---

# 📦 Deployment

Titan compiles your entire app—JS/TS code, Rust code, and server logic—into a **single executable**.

```bash
titan build    # Build production binary
titan start    # Run the compiled server
```

* **Tiny Docker Images**: Alpine-based, ~20MB compressed.
* **Instant Startup**: No node_modules overhead.
* **Secure**: No access to system APIs from JS unless explicitly bridged.

---

# 🧱 Architecture Note
Titan is **not** a Node.js framework. It is a Rust server that speaks JavaScript/TypeScript.
* **No Event Loop** for JS (Request/Response model).
* **No `require`** (Use ES imports or bundled dependencies).
* **True Isolation** per request.
* **esbuild-powered** compilation for both entry points and actions.

---

# 🔄 Updating Titan

Keep your project up to date with the latest Titan runtime:

```bash
titan update
```

This command:
* Detects your project template type automatically
* Updates `titan/` runtime files
* Updates `server/src/` Rust code
* Updates configuration files (`.gitignore`, `Dockerfile`, etc.)
* Preserves your application code in `app/`

---

**Titan v26 — Stable**
* Production-ready Hybrid Runtime
* Full TypeScript Support
* Native Rust Performance
* Zero-Config Cloud Deployment