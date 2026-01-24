
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

# 🧱 Architecture: Strictly Synchronous V8 Runtime

Titan is **not** a Node.js framework. It is a **Rust server with embedded V8 engines** that executes JavaScript/TypeScript **synchronously**.

### Key Architectural Principles:

* **No Event Loop in Workers**: Unlike Node.js, Titan workers do **not** run an event loop. Code executes synchronously from request entry to response exit.
* **Request-Driven Execution**: Each worker processes one request at a time, blocks until completion, then awaits the next request.
* **Blocking I/O**: All I/O operations (HTTP, DB, file system) block the worker thread. Scaling is achieved by increasing worker threads, not through async I/O.
* **Deterministic Execution**: All code runs linearly, making debugging predictable and straightforward.
* **True Isolation**: Each worker owns an independent V8 isolate with zero shared state or cross-worker communication.
* **No `require` or `import.meta`**: Use ES6 imports only. Dependencies are bundled with esbuild.
* **No Async/Await**: JavaScript actions cannot use Promises, `async/await`, `setTimeout`, or any other asynchronous primitives.

### Synchronous Execution Model:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Incoming HTTP Request                        │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │   Axum HTTP Server     │
         │    (Rust, async)       │
         └────────┬───────────────┘
                  │
                  │ Dispatch to Worker
                  ▼
    ┌──────────────────────────────────┐
    │      Worker Thread (Rust)        │
    │  ┌────────────────────────────┐  │
    │  │   V8 Isolate               │  │
    │  │  ┌──────────────────────┐  │  │
    │  │  │  Execute Action      │  │  │ ◄── Synchronous, blocking execution
    │  │  │  (JavaScript/TS)     │  │  │
    │  │  │                      │  │  │
    │  │  │  t.fetch() ──────────┼──┼──┼──► Blocks until HTTP response
    │  │  │         │            │  │  │
    │  │  │         ▼            │  │  │
    │  │  │  return { ... }      │  │  │
    │  │  └──────────────────────┘  │  │
    │  └────────────────────────────┘  │
    └──────────┬───────────────────────┘
               │
               │ Return response
               ▼
    ┌─────────────────────────┐
    │   HTTP Response Sent    │
    └─────────────────────────┘
```

### Performance Characteristics:

* **Cold Start**: ~3-5ms (embedded runtime eliminates disk I/O)
* **Action Execute**: ~100-500µs
* **Memory/Worker**: ~40-80MB (configurable via V8 flags)
* **Throughput**: ~10k - 19k req/sec @ 200 concurrent connections
* **Latency**: ~14-17ms (p50), ~30ms (p97.5)

### When to Use TitanPL:

✅ **Perfect for:**
* CPU-bound or compute-heavy services
* Deterministic execution requirements
* Linear debugging workflows
* Predictable memory usage per worker
* Crash isolation (one worker crash doesn't affect others)

❌ **Not ideal for:**
* I/O-heavy services with high concurrency (use Node.js, Deno, or Bun)
* Applications requiring `setTimeout`, Promises, or async/await
* Real-time event-driven architectures

### Migration from Async Patterns:

If you're coming from Node.js, **do not** try to use async patterns:

```javascript
// ❌ This will NOT work
export const fetchUser = defineAction(async (req) => {
  const response = await t.fetch("https://api.example.com/user");
  return response;
});

// ✅ Use synchronous blocking calls instead
export const fetchUser = defineAction((req) => {
  const response = t.fetch("https://api.example.com/user"); // Blocks until complete
  return response;
});
```

---

# 🚀 TitanPL Multi-Threaded Architecture

### What this means:

* **Each CPU core runs JavaScript independently**
* **Every request is handled in parallel**
* **Zero lock contention**
* **Linear scaling with core count**
* **Massive throughput increase under real traffic**

No tricks. No fake concurrency.
Just **native multi-threaded JavaScript execution**, powered by Rust.

---

# 🧠 How It Works

TitanPL spins up a **worker pool**, where each worker owns:

* Its own V8 isolate
* Its own context
* Its own compiled actions
* **No event loop** (synchronous execution only)

Workers never share a lock, never block each other, and never wait for global state.

This gives TitanPL a performance profile similar to:

* Deno’s multi-isolate approach
* Chrome’s process-per-tab architecture
* High-performance Rust servers like Actix or Hyper

But executed **directly for JavaScript with synchronous semantics**.

---

# ⚡ Real Performance Gains

TitanPL demonstrates:

* **10× lower contention** compared with previous versions
* **2× higher throughput** on multi-core systems
* **Stable latency at 500–800 concurrent clients**
* **True hardware utilization**, not single-threaded bottlenecks

Example on an 8-core machine:

```
Before: 5k–6k req/sec
Now:   10k–12k+ req/sec
```

---

# 🛠 Why Multi-Threading Matters

Traditional JavaScript runtimes:

* Run user code on **one thread**
* Rely heavily on **async I/O** to “fake” concurrency
* Collapse under CPU-heavy workloads

TitanPL eliminates this limitation:

### Every worker can execute CPU-bound JavaScript simultaneously — **zero blocking**.

This is ideal for:

* AI systems
* Gaming backends
* Real-time analytics
* Compute-heavy actions
* Multi-user concurrency

---

# 🌌 TitanPL: The Future of JavaScript Backend Engines

With native Rust + V8 multi-threading, TitanPL becomes:

* Faster than single-threaded Node
* More scalable under load
* Safer and more predictable
* Architecturally modern
* Ready for enterprise-grade traffic

---



**Titan v26 — Stable**
* Production-ready Hybrid Runtime
* Strict TypeScript Support
* Native Rust Performance
* Zero-Config Cloud Deployment
