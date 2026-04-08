<p align="center">
  <a href="https://titanpl.vercel.app/" target="_blank">
    <img src="https://i.ibb.co/VpBsTg6m/tpl-Logo.png" width="120" alt="TitanPl Logo" />
  </a>
</p>

<p align="center">
   You write zero Rust. TitanPl handles routing, bundling, runtime execution, hot reload, and deployment — <br> all powered by <a href="https://rust-lang.org/">Rust</a> under the hood.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/titanpl">
    <img src="https://img.shields.io/npm/v/titanpl?style=for-the-badge&logo=npm&logoColor=white" />
  </a>

  <img src="https://img.shields.io/badge/Runtime-Gravity(V8)%20%26%20Rust%20Tokio-1f2937?style=for-the-badge" />

  <img src="https://img.shields.io/badge/Powered%20By%20Rust%20Axum-DEA584?style=for-the-badge&logo=rust&logoColor=black" />

  <a href="https://discord.gg/Dm9cD8QGUa">
    <img src="https://img.shields.io/badge/Join-5865F2?style=for-the-badge&logo=discord&logoColor=white" />
  </a>

  <a href="https://x.com/TitanPl">
    <img src="https://img.shields.io/badge/Follow-000000?style=for-the-badge&logo=x&logoColor=white" />
  </a>

</p>




<h1> Description
</h1>

Titan Planet is a JavaScript/TypeScript-first Backend Framework that compiles your application into a single, high-performance native binary. It embeds it's own Gravity (V8) JavaScript runtime directly into a specialized Rust + Axum server.

**TypeScript Precision. JavaScript Simplicity. Native Rust Power. Zero Configuration.**

<p>
   
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/Rust-DEA584?style=for-the-badge&logo=rust&logoColor=black" />
</p>

  
## Why Titan?

Titan Planet compiles your JavaScript or TypeScript application into a **single native Rust binary**.

It embeds a V8 runtime inside a Rust + Axum server — giving you:

- ⚡ Native-level performance
- 📦 Single binary deployment
- 🧠 Strict TypeScript enforcement
- 🛡 Zero type errors before runtime
- 🚀 No DevOps configuration required

Start with pure TypeScript.
Drop into Rust when you need extreme performance.
Titan handles the integration automatically.

<p>
  <a href="https://titan-docs-ez.vercel.app/docs" target="_blank">
    <img src="https://i.ibb.co/VpBsTg6m/tpl-Logo.png" width="28" style="vertical-align:middle;" />
    <strong style="vertical-align:middle;"> Documentation</strong>
</p>
<p>
<a href="https://titan-docs-ez.vercel.app/docs/runtime-architecture" target="_blank">
    <strong style="vertical-align:middle;">Gravity Runtime</strong>
  </a>
</p>
  
 <p>
     <a href="https://titan-docs-ez.vercel.app/docs/14-drift" target="_blank">
    <strong style="vertical-align:middle;">Drift</strong>
  </a>
 </p>

# 🚀 Quick Start
### 1. Prerequisites
* **Rust** (latest stable): [Install Rust](https://rust-lang.org/tools/install/) [Optional]
* **Node.js** (v18+): Required for CLI and JS tooling.

### 2. Install CLI
**The `titanpl` CLI is used to create and manage all your new projects and everything related to Titan.**
```bash
npm install -g @titanpl/cli@latest
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

Inside your project:
```bash
cd my-app
npm run dev
```

You'll see the Titan Dev Server spin up:
```
  ⏣ Titan Planet   v1.0.0   [ Dev Mode ]

  Type:        TS Actions
  Hot Reload:  Enabled
  Env:         Loaded

🚀 Starting Titan Engine...
[Titan] 1 reply route(s) pre-computed
Titan server running at: http://localhost:5100  (Threads: 32, Stack: 8MB, Dev Mode)


```


# ⚡ Hybrid Action System

Titan is unique because it allows you to write endpoints in **JavaScript, TypeScript, and Rust** within the same project.

| Feature | Status | Notes |
| :--- | :--- | :--- |
| **Standard JavaScript** | ✅ Stable | Production Ready |
| **Standard TypeScript** | ✅ Stable | Production Ready |
| **Rust + JS (Hybrid)** | 🧪 Experimental | **Dev Only**, Production Under Testing |
| **Rust + TS (Hybrid)** | 🧪 Experimental | **Dev Only**, Production Under Testing |

### 🔵 TypeScript Actions (`app/actions/hello.ts`)
Fully typed, strict, and auto-compiled.

```typescript
import { defineAction } from "@titanpl/native";

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

### 🎈 Flexible Action Discovery
Starting from **v7.0.6**, TitanPL supports a more flexible action naming convention. You no longer need to match the exported function name with the file name.

* **File-based Routing**: If you have `app/actions/get-user.ts`, you can simply use `.action("get-user")` in your routes.
* **Auto-discovery**: TitanPL will automatically find the `export default` or the first named `export` in the file.
* **Next.js Familiarity**: Works just like Next.js API routes, keeping your `app/app.ts` clean and focused on routing.

```typescript
// app/actions/auth.ts
export default defineAction((req) => {
    return { status: "authenticated" };
});

// app/app.ts
t.post("/login").action("auth"); // Matches auth.ts default export
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

# 📦 Building & Deployment

Titan offers a unified build system that packages your JS/TS code, assets, and the native engine into a single, self-contained `build/` directory.

### 1. Production Build
Run this command from your project root:
```bash
titan build --release
```
This will:
* Bundle your actions into optimized `.jsbundle` files.
* Extract all required Titan extensions and native libraries to `.ext/`.
* Copy your `public/`, `static/`, and other configured assets.
* Generate a `titan-server` executable in the `build/` folder.

### 2. Run the Build
```bash
cd build
./titan-server
```
Your application is now running as a standalone native server.

### 🐳 Docker Deployment
The `titan build --release` command is optimized for Docker. Your `Dockerfile` can be as simple as:

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY . .
RUN npm install --include=optional
RUN npx titan build --release

FROM ubuntu:24.04
WORKDIR /app
COPY --from=builder /app/build .
CMD ["./titan-server", "run", "dist"]
```
This produces a tiny, high-performance production image with zero `node_modules`.

### 🛠 Configuration (`tanfig.json`)
You can customize the build process in your `tanfig.json`:
```json
{
  "build": {
    "purpose": "deploy",
    "files": ["public", "db", "secrets"]
  }
}
```
* **`purpose`**: Use `deploy` to skip `node_modules` junctions for the smallest possible footprint.
* **`files`**: List any extra folders you want included in the `build/` output.

---


**To know more read docs 💟 **Titan Planet docs:** https://titanpl.vercel.app/docs**
