# @titanpl/engine-darwin-arm64

The macOS ARM64 pre-compiled native engine binary for Titan Planet.

## What it works (What it does)
This package is the compiled core Rust + Axum server embedded with the Boa JavaScript runtime. It is specifically built for Apple Silicon (ARM64) macOS devices.

## How it works
This package is listed as an "optional dependency" in `@titanpl/cli`. During package installation, your package manager identifies the OS and automatically downloads this binary if it matches `darwin` + `arm64`. You do not need to install it directly. 

When you run `titan start`, the CLI locates this binary and executes it as your web server.

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux and macOS versions are in development (dev only) for the new architecture and will be launched later.
