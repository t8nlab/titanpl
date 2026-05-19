const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;

export function initHelp() {
    console.log(`
  ${bold(cyan("TitanPl Project Initializer"))}
  
  ${yellow("Usage:")}
    titan init <project-name> [options]
  
  ${bold("Options:")}
    ${cyan("-t, --template")}
        Select template architecture
  
  ${bold("Templates:")}
    ${cyan("js")}
        Standard JavaScript application
  
    ${cyan("ts")}
        Standard TypeScript application
  
    ${cyan("rust-js")}
        Hybrid Rust + JavaScript architecture (Experimental)
  
    ${cyan("rust-ts")}
        Hybrid Rust + TypeScript architecture (Experimental)
  
  ${bold("Examples:")}
    titan init my-app
    titan init my-app -t ts
    titan init my-app -t rust-ts
  `);
  }