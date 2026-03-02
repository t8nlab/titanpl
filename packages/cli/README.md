# @titanpl/cli

The command-line interface (CLI) for Titan Planet. It provides the `titan` and `tit` commands for initializing, building, and running Titan Planet servers.

## What it works (What it does)
The CLI is responsible for bridging your JavaScript codebase with the underlying Rust/Axum engine. It handles scaffolding, compiling JS actions, generating metadata, and running the server.

## How it works
You can install this package globally or use it via your package runner (e.g., `npx`). Alternatively, you can install it as a dev dependency in your project.

```bash
npx titan help
```

It parses your application source code, coordinates with `@titanpl/packet` to build the required JS endpoints, and then spins up the pre-compiled native core engine for your OS.

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.
