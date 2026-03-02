# @titanpl/engine-win32-x64

The Windows x64 pre-compiled native engine binary for Titan Planet.

## What it works (What it does)
This module provides the highly concurrent Rust-based server binary (`titan.exe`) powered by Axum and Boa. It removes the necessity of a Node.js event loop by only executing static routes in Rust and specific dynamic logic in embedded JavaScript.

## How it works
Like the other engine packages, this works entirely behind the scenes. When `@titanpl/cli` is installed on a Windows instance, it fetches this `.exe` runtime. The CLI then maps your built assets and JS routes into the binary for deployment.

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.
