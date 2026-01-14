
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
🚀 **CLI: `titan` is now the canonical command. `tit` remains supported as an alias.**

---

# TITAN PLANET 🚀

[![npm version](https://img.shields.io/npm/v/@ezetgalaxy/titan.svg?style=flat-square)](https://www.npmjs.com/package/@ezetgalaxy/titan)


**JavaScript Simplicity. Native Rust Power. Zero Configuration.**

Titan Planet is a **JavaScript-first Backend Framework** that compiles your application into a single, high-performance native binary. It embeds a V8 JavaScript runtime directly into a specialized Rust + Axum server.

**Start with pure JavaScript.**
**Need raw power? Add Rust actions seamlessly.**
Titan handles the compilation, bundling, and routing automatically for both.

Titan = **JavaScript productivity × Rust performance × Zero DevOps**

---

# 🌌 Why Titan?

| Feature                              | Titan | Express/Nest | FastAPI | Bun       |
| ------------------------------------ | ----- | ------------ | ------- | --------- |
| Native binary output                 | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Hybrid Rust + JS Actions             | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Pure JavaScript developer experience | ✅ Yes | ✅ Yes        | ❌ No    | ❌ Partial |
| Zero-config Docker deploy            | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Action-based architecture            | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Hot reload dev server                | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |

---

# 🚀 Quick Start

### 1. Prerequisites
* **Rust** (latest stable): [Install Rust](https://rust-lang.org/tools/install/)
* **Node.js** (v18+): Required for CLI and JS tooling.

### 2. Install CLI
```bash
npm install -g @ezetgalaxy/titan
```

### 3. Initialize & Run
```bash
titan init my-app
# Follow the interactive prompt to choose:
# - JavaScript (Standard)
# - Rust + JavaScript (Beta)
```

Inside your project:
```bash
cd my-app
titan dev
```

You'll see the Titan Dev Server spin up:
```
  Titan Planet   v26.8.0   [ Dev Mode ]

  Type:        Rust + JS Actions
  Hot Reload:  Enabled

  • Preparing runtime... Done
  • A new orbit is ready for your app in 0.9s
  • Your app is now orbiting Titan Planet
```

---

# ⚡ Hybrid Action System

Titan is unique because it allows you to write endpoints in **both** JavaScript and Rust within the same project.

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

**Titan automatically detects, compiles, and routes both types.**
* `.js` files are bundled with esbuild.
* `.rs` files are compiled into the native binary.
* Both share the same `routes.json` configuration.

---

# ✨ Core Capabilities

### 🔌 Unified Runtime API (`t`)
Both JS and Rust actions have access to the powerful `t` namespace:

* `t.fetch(url, options)` — High-performance HTTP client
* `t.log(msg)` — Sandboxed, structured logging
* `t.jwt.sign / verify` — Fast JWT operations
* `t.password.hash / verify` — Secure password handling
* `t.db` — Database access (coming soon)

### 🛣 Intelligent Routing
Define your routes in `routes.json`. Titan maps them to the correct action, regardless of language.

```json
{
  "/hello": "hello",         // variable name matches filename (hello.js)
  "/compute": "compute"      // variable name matches filename (compute.rs)
}
```

### 🧩 Extensions System
Extend the runtime with custom Rust engines using **Titan Extensions**.
* `titan create ext <name>`: Scaffold a new extension.
* `titan run ext`: Test your extension in a lightweight harness.

---

# 📦 Deployment

Titan compiles your entire app—JS code, Rust code, and server logic—into a **single executable**.

* **Tiny Docker Images**: Alpine-based, ~20MB compressed.
* **Instant Startup**: No node_modules overhead.
* **Secure**: No access to system APIs from JS unless explicitly bridged.

---

# 🧱 Architecture Note
Titan is **not** a Node.js framework. It is a Rust server that speaks JavaScript.
* **No Event Loop** for JS (Request/Response model).
* **No `require`** (Use raw imports or bundled dependencies).
* **True Isolation** per request.

---

**Titan v26 — Stable**
* Production-ready Hybrid Runtime
* Native Rust Performance
* Zero-Config Cloud Deployment

