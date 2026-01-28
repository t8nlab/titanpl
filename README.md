
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
🛡️ **Strict Mode:** Titan now enforces zero type errors before running.
✅ **For text response from a action file use t.response.text("Hii TitanPl")

---

# TITAN PLANET 🚀

[![npm version](https://img.shields.io/npm/v/@ezetgalaxy/titan.svg?style=flat-square)](https://www.npmjs.com/package/@ezetgalaxy/titan)


**TypeScript Precision. JavaScript Simplicity. Native Rust Power. Zero Configuration.**

Titan Planet is a **JavaScript/TypeScript-first Backend Framework** that compiles your application into a single, high-performance native binary. It embeds a V8 JavaScript runtime directly into a specialized Rust + Axum server.

**Start with pure TypeScript/JavaScript.**
**Need raw power? Add Rust actions seamlessly.**
Titan handles the compilation, bundling, and routing automatically for both.

Titan = **TS/JS productivity × Rust performance × Zero DevOps**

---

# 🌌 Why Titan?

| Feature                              | Titan | Express/Nest | FastAPI | Bun       |
| ------------------------------------ | ----- | ------------ | ------- | --------- |
| Native binary output                 | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Hybrid Rust + JS/TS Actions          | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Strict TypeScript Enforcement        | ✅ Yes | ❌ Setup Req. | ❌ No    | ❌ Partial |
| Zero-config Docker deploy            | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Action-based architecture            | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Hot reload dev server                | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Modular, Isolated Templates          | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |

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
Titan guides you through selecting the perfect architecture for your needs.

```bash
titan init my-app
```

**Select your language:**
1.  `JavaScript` (Fast, lightweight)
2.  `TypeScript` (Strict, typed)

**Select your architecture:**
1.  `Standard` (Pure JS/TS)
2.  `Rust + JS/TS (Hybrid)` (High-performance native actions)

This creates one of four isolated environments:
*   **Standard JS:** Lightweight server, zero Rust overhead.
*   **Standard TS:** Strict server, zero Rust overhead.
*   **Hybrid JS:** Full Rust integration + JS flexibility.
*   **Hybrid TS:** Full Rust integration + TS strictness.

Inside your project:
```bash
cd my-app
titan dev
```

You'll see the Titan Dev Server spin up:
```
  Titan Planet   v26.9.1   [ Dev Mode ]

  Type:        Rust + TS Actions
  Hot Reload:  Enabled
  Strict Mode: Active 🛡️

  • Preparing runtime... Done
  • A new orbit is ready for your app in 0.9s
  • Your app is now orbiting Titan Planet
```

---

# ⚡ Hybrid Action System

Titan is unique because it allows you to write endpoints in **JavaScript, TypeScript, and Rust** within the same project.

| Feature | Status | Notes |
| :--- | :--- | :--- |
| **Standard JavaScript** | ✅ Stable | Production Ready |
| **Standard TypeScript** | 🚧 Beta | **Ready for Dev**, Production Under Testing |
| **Rust + JS (Hybrid)** | 🧪 Experimental | **Dev Only**, Production Under Testing |
| **Rust + TS (Hybrid)** | 🧪 Experimental | **Dev Only**, Production Under Testing |

### 🔵 TypeScript Actions (`app/actions/hello.ts`)
Fully typed, strict, and auto-compiled.

```typescript
import { defineAction } from "../../titan/titan";

interface HelloResponse {
    message: string;
    user_name: string;
}

// "defineAction" provides automatic type inference for "req"
export const hello = defineAction((req): HelloResponse => {
    t.log("Handling request with strict types...");

    return { 
        message: "Hello from TypeScript!",
        user_name: req.body.name || "Guest"
    };
});
```

### 🟡 JavaScript Actions (`app/actions/hello.js`)
Perfect for business logic, rapid prototyping, and IO-bound tasks.
```javascript
export const hello = defineAction((req) => {
    t.log("Handling user request...");
    return { 
        message: "Hello from JavaScript!",
        user_id: req.params.id 
    };
});
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

**Titan automatically detects, compiles, and routes all types.**
* `.ts` files are type-checked and compiled with esbuild.
* `.js` files are bundled with esbuild.
* `.rs` files are compiled into the native binary.
* All share the same `routes.json` configuration.

---

# 🛡️ Strict Type Safety & Error Logs

Titan prioritizes code quality by enforcing **Strict TypeScript** logic during development. 

If `titan dev` detects a type error, the server **will not run**. This ensures you never ship or test broken code.

### Sample Error Output
When a type error occurs, Titan pauses execution and provides a clear, actionable log:

```text
[Titan] ❌ TypeScript Error:
app/actions/payment.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.

    10 |    const amount: number = req.body.amount;
    11 |    
  > 12 |    processPayment( "100" ); // Error here
       |    ^^^^^^^^^^^^^^^^^^^^^^^

[Titan] 🛑 Server paused due to type errors. Fix them to resume.
```

Once fixed, the server automatically resumes.

---

# ✨ Core Capabilities

### 🔌 Unified Runtime API (`t`)
All actions (JS/TS/Rust) have access to the powerful `t` namespace:

* `t.fetch(url, options)` — High-performance HTTP client
* `t.log(msg)` — Sandboxed, structured logging
* `t.jwt.sign / verify` — Fast JWT operations
* `t.password.hash / verify` — Secure password handling
* `t.db` — Database access
---

### 🧩 Extensions System
Extend the runtime with custom Rust engines using **Titan Extensions**.
* `titan create ext <name>`: Scaffold a new extension.
* `titan run ext`: Test your extension in a lightweight harness.

---

# 📦 Deployment

Titan compiles your entire app—JS/TS code, Rust code, and server logic—into a **single executable**.

* **Tiny Docker Images**: Alpine-based, ~20MB compressed.
* **Instant Startup**: No node_modules overhead.
* **Secure**: No access to system APIs from JS unless explicitly bridged.

---


**To know more read docs 💟 **Titan Planet docs:** https://titan-docs-ez.vercel.app/docs**
