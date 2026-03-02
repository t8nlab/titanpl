# @titanpl/native

The native utility extension module for Titan Planet.

## What it works (What it does)
It acts as the low-level communication bridge offering type definitions and utility wrappers out-of-the-box. Rather than being dependent on heavy JavaScript libraries, this package bridges Node-style features gracefully to the Titan runtime environment. 

## How it works
You can import tools and primitives from this package into your server-side actions alongside `@titanpl/core` when you want direct low-level interaction or need access to platform operations that interact directly with the C/Rust engine.

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.
