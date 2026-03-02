# @titanpl/engine-linux-x64

The Linux x64 pre-compiled native engine binary for Titan Planet.

## What it works (What it does)
This package holds the core Rust + Axum high-performance web server tightly coupled with the Boa JavaScript execution runtime. It is built natively for Linux x64 environments, requiring no Node.js execution layer.

## How it works
You don't need to manually interact with this module. It acts as an optional dependency resolved by `#titanpl/cli`. If you run TitanPlanet on a Linux x64 machine, npm/yarn automatically downloads this native binary to run your application.

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.
