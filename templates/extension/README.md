# TitanPL Rust Extension Starter

A professional starter kit for building native Rust extensions for the TitanPL framework.

## 🚀 Getting Started

This repository serves as a template. Before you begin developing, you **must** rename the extension to match your project.

### 🛠️ Customization (CRITICAL)
Search and replace `@ext/rust-extension` with your desired extension name (e.g., `@my-org/my-ext`) in the following files:
- `package.json`: The `"name"` field.
- `titan.json`: The `"name"` field.
- `ext.js`: The name passed to `createExt()`.
- `native/Cargo.toml`: The name field under `[package]` and `[lib]`.
- `index.d.ts`: The `@package` documentation tag.
- `test/tanfig.json`: The extension name in `allowNative`.
- `test/package.json`: The dependency name.

## 📋 Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Node.js & npm](https://nodejs.org/)
- [TitanPL CLI](https://github.com/t8nlab/titanpl)

## 📂 Project Structure

- `native/Cargo.toml`: The Cargo configuration for building the native library.
- `native/src/lib.rs`: The Rust source code for the native extension.
- `native/src/utils.rs`: Native Rust utilities for data handling and FFI bridging.
- `ext.js`: JavaScript bridge to register and interface with the native extension.
- `index.js`: Main entry point for the extension (Class-based).
- `index.d.ts`: TypeScript definitions for the extension.
- `utils/native.js`: JavaScript utility functions for data handling.
- `titan.json`: Extension metadata for TitanPL.

## 🏗️ Build Guide

To build the native binary:

- **Windows**: `npm run build` (outputs `rust-extension.dll`)
- **Linux**: `npm run build:linux` (outputs `rust-extension.so`)

The output binaries are required for the extension to function. You can change the output filenames in `package.json` and `titan.json`.

## 🧪 Testing Your Extension

1. **Initialize a Test Server**:
   Create a new TitanPL server for your test:
   ```bash
   titan init test
   ```

2. **Link the Extension**:
   From the root of this extension directory, run:
   ```bash
   npm link
   ```
   Then in your `test` directory, run:
   ```bash
   npm link @ext/rust-extension (replace with your extension name)
   ```
   *Alternatively, you can install it via relative path:*
   ```bash
   npm install ../
   ```

3. **Configure Permissions**:
   Ensure `test/tanfig.json` allows the native extension:
   ```json
   {
     "extensions": {
       "allowNative": [
         "@ext/rust-extension"
       ]
     }
   }
   ```

4. **Usage Example**:
   In your test server's actions or logic:
   ```javascript
   import { log } from "@titanpl/native";
   import Extension from '@ext/rust-extension';
   
   const ext = new Extension();
   const result = await ext.addNumber(10, 20);
   log(result); // 30
   ```

## 💡 Development Tips

- **Add Native Functions**: Add your Rust logic in `native/src/lib.rs` and register it in the `register_functions()` function using `utils::register("name", func)`.
- **Sync Types**: Always update `index.d.ts` when you add new methods to ensure a great developer experience.
- **Data Handling**: Use the helpers in `utils::` (like `utils::get_int`, `utils::get_string`) to safely parse inputs from JavaScript.
