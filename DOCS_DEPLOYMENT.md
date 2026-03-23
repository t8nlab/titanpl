# 🚢 TitanPL Deployment & Distribution — Best Practices

TitanPL is designed for high-performance production environments. Its deployment process ensures that all security policies, extensions, and pre-computed routes are packed into a portable, production-ready bundle.

---

## 🏗️ Production Build (`titan build --release`)

The `titan build --release` command is the standard way to package your application for production.

### What it Does:
1.  **V8 Bundle**: Minifies and bundles all your actions into a single optimized runtime.
2.  **Route Pre-computation**: Generates a static map of all actions for faster startup.
3.  **Security Assets**: Automatically copies `tanfig.json` and `package.json` to the distribution.
4.  **Extension Bundling**: Scans `node_modules` for any `titan.json` files and copies the entire extension tree into a specialized `.ext/` directory.
5.  **Binary Extraction**: Pulls the correct platform-specific engine binary into the bundle root.

---

## 🛠️ Custom Assets & Build Configuration

You can control which folders and files are carried over to your production `build/` folder by adding a `build` block to your `tanfig.json`.

```json
{
  "name": "my-app",
  "build": {
    "files": ["public", "static", "db", "certs", "custom-assets"],
    "env": "production"
  }
}
```

### Supported Fields:
- `files`: An array of folder/file names in your project root to copy into the `build/` directory. By default, TitanPL copies `public`, `static`, `db`, and `tanfig.json`.
- `env`: Set to `production` or `deploy` to disable the creation of local symlinks in favor of a clean, standalone file structure.

---

## 🛡️ Production Safety Management

Deploying TitanPL to Docker is straightforward because the `build/` directory is self-contained.

### Sample `Dockerfile`:
```dockerfile
# Step 1: Build the app
FROM node:20-slim AS builder
WORKDIR /app
COPY . .
RUN npm install -g @titanpl/cli
RUN npm install
RUN titan build --release

# Step 2: Runtime image
FROM debian:stable-slim
WORKDIR /app

# Copy the generated build folder
COPY --from=builder /app/build /app/

# Environment setup
ENV TITAN_DEV=0
ENV PORT=5105

# Start the TitanPL engine directly
CMD ["./titan-server", "run", "dist"]
```

---

## 🛡️ Critical Security Checklist

Before deploying to production, ensure the following are correct:

### 1. `tanfig.json` Checklist
- [ ] `allowNative` only contains extensions you trust.
- [ ] `allowWasm` is only `true` if your extensions rely on it.
- [ ] Your project `name` in `tanfig.json` matches the root configuration.

### 2. Engine Visibility
- Titan-native host processes run out-of-process for security. If you are using a firewall or restrictive OS policy, ensure IPC pipes from the engine to its spawned sub-processes are allowed.

---

## 🚀 Execution in Production

Once your `build/` folder is on the server, you can start it with zero external dependencies:

```bash
cd build
./titan-server run dist
```

> [!TIP]
> **Zero-Downtime**: Use a process manager like `pm2` to monitor the `titan-server` binary and ensure it stays online during system reboots or crashes.
