
```
████████╗██╗████████╗ █████╗ ███╗   ██╗
╚══██╔══╝██║╚══██╔══╝██╔══██╗████╗  ██║
   ██║   ██║   ██║   ███████║██╔██╗ ██║
   ██║   ██║   ██║   ██╔══██║██║╚██╗██║
   ██║   ██║   ██║   ██║  ██║██║ ╚████║
   ╚═╝   ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝
```

# Notice

✅ **Production mode is ready**
💙 **Enjoy development mode `tit dev`**
✅ **No more `globalThis` required**


---

# TITAN PLANET 🚀

**JavaScript Simplicity. Rust Power. Zero Configuration.**

Titan Planet is a JavaScript-first backend framework that compiles your JavaScript routes and actions into a **native Rust + Axum server**.

You write **zero Rust**.
Titan ships a full backend engine, dev server, bundler, router, action runtime, and Docker deploy pipeline — all powered by Rust under the hood.

Titan = **JavaScript productivity × Rust performance × Zero DevOps**

---

# 🌌 Why Titan?

| Feature                              | Titan | Express/Nest | FastAPI | Bun       |
| ------------------------------------ | ----- | ------------ | ------- | --------- |
| Native binary output                 | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Rust-level performance               | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Pure JavaScript developer experience | ✅ Yes | ✅ Yes        | ❌ No    | ❌ Partial |
| Zero-config Docker deploy            | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Action-based architecture            | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |
| Hot reload dev server                | ✅ Yes | ❌ No         | ❌ No    | ❌ No      |

Titan gives you:

* Native speed
* JS comfort
* Cloud-first deployment
* Full environment variable support
* Built-in HTTP client (`t.fetch`)
* Lightweight serverless-like actions
* Instant hot reload
* Zero configuration
* Single deployable binary

---

# 🚀 Quick Start


# ⚙ Requirements

Install before using Titan:

### 1. Rust (latest stable)

[https://rust-lang.org/tools/install/](https://rust-lang.org/tools/install/)

### 2. Node.js (v18+)

Required for:

* Titan CLI
* esbuild
* JS → Rust compilation pipeline

Verify:

```bash
node -v
npm -v
rustc -V
```

---

### Install Titan CLI

```bash
npm install -g @ezetgalaxy/titan
```

### Create a new project

```bash
tit init my-app
cd my-app
tit dev
```

Titan will:

* Build routes
* Bundle actions
* Start Rust dev server
* Watch file changes
* Trigger instant reload

---

# Update to new version

* At first update the cli 

```bash
npm install -g @ezetgalaxy/titan@latest
```
* Then 

```bash
tit update
```
* ``tit update`` will update and add new features in your Titan project


# ✨ What Titan Can Do (New & Core Features)

Titan now includes a **complete runtime engine** with the following built-in capabilities:

### 🛣 Routing & HTTP

* Static routes (`/`, `/health`)
* Dynamic routes (`/user/:id<number>`)
* Typed route parameters
* Automatic method matching (GET / POST)
* Query parsing (`req.query`)
* Body parsing (`req.body`)
* Zero-config routing metadata generation

### 🧠 Action Runtime

* JavaScript actions executed inside a Rust runtime (Boa)
* Automatic action discovery and execution
* No `globalThis` required anymore
* Safe handling of `undefined` returns
* JSON serialization guardrails
* Action-scoped execution context

### 🔌 Runtime APIs (`t`)

* `t.fetch(...)` — built-in Rust-powered HTTP client
* `t.log(...)` — sandboxed, action-scoped logging
* Environment variable access (`process.env`)
* No access to raw Node.js APIs (safe by default)

### 🧾 Request Object (`req`)

Each action receives a normalized request object:

```json
{
  "method": "GET",
  "path": "/user/90",
  "params": { "id": "90" },
  "query": {},
  "body": null
}
```

This object is:

* Stable
* Predictable
* Serializable
* Identical across dev & production

---

### 🔥 Developer Experience

* Hot reload dev server (`tit dev`)
* Automatic rebundling of actions
* Automatic Rust server restart
* Colored request logs
* Per-route timing metrics
* Action-aware logs

Example runtime log:

```
[Titan] GET /user/90 → getUser (dynamic) in 0.42ms
[Titan] log(getUser): Fetching user 90
```

---

### 🧨 Error Handling & Diagnostics

* JavaScript runtime errors captured safely
* Action-aware error reporting
* Line & column hints from runtime
* Red-colored error logs
* No server crashes on user mistakes
* Safe fallback for `undefined` returns

---

### ⚙ Build & Deployment

* Native Rust binary output
* Zero-config Dockerfile generation
* Multi-stage optimized Docker builds
* Works on:

  * Railway
  * Fly.io
  * Render
  * VPS
  * Kubernetes
* No Node.js required in production

---

### 🧱 Architecture Guarantees

* No runtime reflection
* No Node.js in production
* No framework lock-in
* No magic globals
* No config files
* No Rust knowledge required

---

# 🧩 Example Action (Updated – No `globalThis` Needed)

```js
export function getUser(req) {
  t.log("User id:", req.params.id);

  return {
    id: Number(req.params.id),
    method: req.method
  };
}
```

That’s it.
No exports wiring. No globals. No boilerplate.

---

# 📦 Version

**Titan v25 — Stable**

* Production-ready runtime
* Safe JS execution
* Native Rust performance
* Designed for cloud & AI workloads

---
