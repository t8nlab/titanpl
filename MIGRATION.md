# Titan Planet Migration Guide: Legacy to Gravity Engine

Welcome to the **Global Gravity Engine** architecture! 🪐

As of version `26.16.0`, Titan Planet has fundamentally changed how projects are structured and executed. This guide explains what changed and how to adapt an old project.

## The Old Way (Legacy Architecture)
Previously, when you ran `titan init`, we generated a `server/` directory containing a full Rust project (`Cargo.toml`, `src/main.rs`, etc.). 
- **The Problem:** It required users to have Rust installed, caused extremely slow cold boots, and required developers to deal with complex Cargo compilation graphs just to run JavaScript actions.

## The New Way (Gravity Engine Architecture)
We completely eliminated the local `server/` folder. 
- **The Solution:** We now distribute a fully-compiled, production-ready Rust binary via npm (`@titanpl/engine-<os>-<arch>`). 
- When you run `titan dev` or `titan start`, Titan uses the pre-compiled binary instantly.
- **Zero Config:** Just write your `actions/*.js` or `actions/*.ts`, and the system automatically bundles them using `@titanpl/packet` and runs them via the Engine.

---

## 🚀 How to Migrate

We provide an automated CLI command to do this for you.

### Step 1: Update CLI
Make sure you are running the latest Titan CLI:
```bash
npm install -g titanpl
```

### Step 2: Run the Migration Script
Inside your old project's root folder (where the `server/` directory is located), run:

```bash
titan migrate
```

### What does `titan migrate` do?
1. Checks for the existence of `server/Cargo.toml`.
2. Scans your legacy Rust extensions (if you created native ones).
3. Warns you to back up custom Rust code.
4. Deletes the entire `server/` directory and its Cargo build cache (`target/`).
5. Updates your project's `package.json` to include the correct start and dev engine scripts.
6. Installs the `@titanpl/engine` binaries for your OS.

### Step 3: Install & Start
```bash
npm install
titan dev
```

That's it! Your server will now boot almost instantaneously using the new Embedded Binary Engine.

---

## What if I had custom Rust Extensions?
The Gravity Engine architecture still supports Native Extensions, but they are now built as standalone `.dylib` / `.so` / `.dll` files using the `titan create ext` command. 
If during your migration you had custom Rust code inside `server/src/`, you will need to re-scaffold them as a Native Extension and link them to your app.

1. Generate a new extension: `titan create ext my_custom_logic`
2. Port your Rust logic from the old `server/src/` into the new extension template.
3. Build the extension and link it in your new project's `mkctx.config.json` or `titan.json`.

Please check the documentation for more details on Native Extensions.

---

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.
