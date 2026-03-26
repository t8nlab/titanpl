# TitanPL: Drift vs. Synchronous Native Extensions

TitanPL v7.0.0 represents a massive leap in how asynchronous execution is handled.

## The Drift Concept

Unlike Node.js or conventional JS runtimes where you manage `Promise`, `async`, and `await`, TitanPL aims for **Zero-Config Synchronous execution**. Every core operation feels instantaneous and blocking, while internally non-blocking if needed.

When an operation requires I/O bound waiting (like fetching an API), it must utilize **Drift**. 

### 1. Transparent Drift (Auto-Drift)
Operations like `fetch` are intrinsically slow. To prevent the V8 isolate worker from blocking and decreasing throughput:

1. You wrap the call in `drift(fetch(...))`.
2. The engine instantly detects the `__SUSPEND__` token.
3. The V8 isolate is **Suspended**, saving its snapshot entirely. The worker thread is returned to the Thread Pool to process other requests!
4. The requested I/O occurs on a background async socket.
5. When complete, the request is **Resumed** (re-played or snapshot-restored). 

The developer only ever writes simple assignment:
```javascript
import { fetch, drift } from "@titanpl/native";

const raw = drift(fetch("https://dog.ceo/api/breeds/image/random"));
console.log(raw.status);
```

### 2. Synchronous by Default (Zero Auto-Drift for Native Exts)
By default, **ALL** User Native Extensions (via WebAssembly or DLLs) are handled Synchronously unless explicitly wrapped in a Drift task. 

This means that if you write a custom Rust Extension (`ls_set`, `crypto_random_bytes`), the engine expects:
- Near-zero latency execution.
- Cross-process boundaries (Native Host Helper) mapped natively to Rust threads.
- No auto-suspension. The JS thread simply blocks for the nanoseconds it takes for IPC.

### 3. FastPath Bypass
For explicitly static routes, the V8 worker pool is bypassed ENTIRELY.
The `Titan FastPath` system statically evaluats your Code at build-time using `OXC`.
If you write:

```javascript
import { response, defineAction } from "@titanpl/native";

export default defineAction((req) => {
    return response.json({ hello: "world" });
});
```
The router catches this, builds the cache natively, and serves the JSON strictly from Rust at 0ms latency!
