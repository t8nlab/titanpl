const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;

export function buildHelp() {
    console.log(`
  ${bold(cyan("TitanPl Build [Packet Bundler]"))}
  
  ${yellow("Usage:")}
    titan build [options]
    titan build ext
  
  ${bold("Description:")}
    Compiles Titan applications and extensions into
    deployable runtime artifacts.
  
  ${bold("Commands:")}
    ${cyan("build")}
        Compile routes/actions into dist/
  
    ${cyan("build --release")}
        Generate optimized production ready build for deployment 
  
    ${cyan("build ext")}
        Compile native, Go, or WASM extensions
  
  ${bold("Examples:")}
    titan build
    titan build --release
    titan build ext
  `);
  }