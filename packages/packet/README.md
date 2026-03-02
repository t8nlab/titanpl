# @titanpl/packet

The internal bundler and module packer for Titan Planet.

## What it works (What it does)
This library parses all your app routes, components, middleware, and logic paths, then packages them into a static `build` output layer consisting of metadata files and JavaScript assets. 

## How it works
This package is triggered whenever you run `titan init` or `titan build` from the `@titanpl/cli`. It hooks into tools like `esbuild` to optimize your scripts efficiently. It strips unnecessary pieces out so that only explicit route actions make their way aggressively over to the Titan runtime engine.

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.
