const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;


export function extensionHelp() {
    console.log(`
  ${bold(cyan("TitanPl Extension Toolkit"))}
  
  ${yellow("Usage:")}
    ${cyan("titan create ext")} ${gray("<name>")}
    ${cyan("titan build ext")}
    ${cyan("titan run ext")}
  
  ${bold("Description:")}
    ${gray("TitanPl extensions allow you to extend the Gravity runtime")}
    ${gray("using JavaScript, Rust native libraries, Go shared objects,")}
    ${gray("or WebAssembly modules.")}
  
  ${bold("Extension Lifecycle:")}
  
    ${cyan("1. Create")}
        ${gray("Scaffold a new extension package")}
  
    ${cyan("2. Build")}
        ${gray("Compile native/Go/WASM runtime binaries")}
  
    ${cyan("3. Run")}
        ${gray("Launch isolated extension testing sandboxes")}
  
  ${bold("Commands:")}
  
    ${cyan("titan create ext <name>")}
        ${gray("Create a new TitanPl extension package")}
  
        ${gray("Supported extension types:")}
        ${gray("- js      → Pure JavaScript runtime extension")}
        ${gray("- native  → Rust native extension (.dll/.so/.dylib)")}
        ${gray("- golang  → Go shared library extension")}
  
    ${cyan("titan build ext")}
        ${gray("Compile extension runtime binaries")}
  
        ${gray("Supported build targets:")}
        ${gray("- Rust native libraries")}
        ${gray("- Go shared objects")}
        ${gray("- WebAssembly modules")}
  
    ${cyan("titan run ext")}
        ${gray("Boot extension testing environments")}
  
        ${gray("Sandbox modes:")}
        ${gray("- TitanPl Sandbox → Minimal TitanPl server runtime")}
        ${gray("- TGRV Sandbox  → Standalone Gravity execution")}
  
  ${bold("Examples:")}
  
    ${cyan("titan create ext my-ext")}
        ${gray("Create a new extension package")}
  
    ${cyan("titan build ext")}
        ${gray("Compile native extension binaries")}
  
    ${cyan("titan run ext")}
        ${gray("Launch extension sandbox testing")}
  
  ${bold("Generated Structure:")}
  
    ${cyan("native/")}
        ${gray("Rust/Go native source code")}
  
    ${cyan("sandbox/")}
        ${gray("Temporary extension testing runtime")}
  
    ${cyan("titan.json")}
        ${gray("Extension runtime manifest")}
  
    ${cyan("index.js")}
        ${gray("Runtime registration entrypoint")}
  
  ${bold("Notes:")}
  
    ${gray("- JS extensions require no build step")}
    ${gray("- Native extensions require")} ${cyan("allowNative")} ${gray("permission")}
    ${gray("- TitanPl automatically generates runtime bindings")}
    ${gray("- Extensions run isolated from the main Gravity runtime")}
  
  `);
  }