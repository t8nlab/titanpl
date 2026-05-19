const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;

export function runHelp() {
    console.log(`
  ${bold(cyan("TitanPl Runtime Launcher"))}
  
  ${yellow("Usage:")}
    titan run
    titan run ext
  
  ${bold("Description:")}
    Starts TitanPl production runtimes or launches
    isolated extension testing sandboxes.
  
  ${bold("Commands:")}
    ${cyan("run")}
        Execute compiled production server
  
    ${cyan("run ext")}
        Launch extension sandbox environment
  
  ${bold("Sandbox Modes:")}
    ${cyan("TitanPl Sandbox")}
        Minimal TitanPl server with extension injection
  
    ${cyan("TGRV")}
        Standalone Gravity runtime execution
  
  ${bold("Examples:")}
    titan run
    titan run ext
  `);
  }