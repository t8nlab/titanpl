#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildCommand } from "./src/commands/build.js";
import { devCommand } from "./src/commands/dev.js";
import { startCommand } from "./src/commands/start.js";
import { updateCommand } from "./src/commands/update.js";
import { initCommand } from "./src/commands/init.js";
import { createCommand } from "./src/commands/create.js";
import { buildExtensionCommand } from "./src/commands/build-ext.js";
import { runExtensionCommand } from "./src/commands/run-ext.js";
import { buildHelp } from "./src/docs/build-help.js"
import { extensionHelp } from "./src/docs/ext-help.js"
import { initHelp } from "./src/docs/init-help.js"
import { runHelp } from "./src/docs/run-help.js"
import { updateHelp } from "./src/docs/update-help.js"


/* -------------------------------------------------------
 * Resolve __dirname (ESM safe)
 * ----------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------------------------------------------
 * Colors (Old Titan Theme Style)
 * ----------------------------------------------------- */
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;

/* -------------------------------------------------------
 * Version
 * ----------------------------------------------------- */
let VERSION = "1.0.0";

try {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
  );
  VERSION = pkg.version;
} catch { }

/* -------------------------------------------------------
 * Help Output
 * ----------------------------------------------------- */
function help() {
  console.log(`
${bold(cyan("╭───────────────────────────────────────────────╮"))}
${bold(cyan("│"))}  🪐 ${bold(cyan("Titan Planet"))} CLI                     ${gray(`v${VERSION}`.padEnd(6, ' '))} ${bold(cyan("│"))}
${bold(cyan("╰───────────────────────────────────────────────╯"))}

  ${yellow("Usage:")} ${bold("titan <command> [options]")}

${bold("Commands:")}
  ${cyan("init")}      
      ${gray("Scaffold a new TitanPl application with JS/TS or Hybrid Rust architecture")}

  ${cyan("create")}    
      ${gray("Generate TitanPl extensions, native modules, or reusable runtime packages")}

  ${cyan("dev")}       
      ${gray("Start the Gravity Engine in live development mode with hot reload and route watching")}

  ${cyan("build")}     
    ${gray("Compile Titan routes/actions into deployable runtime artifacts")}

  ${cyan("build --release")} 
    ${gray("Generate a fully optimized production release for deployment")}

  ${cyan("build ext")} 
      ${gray("Compile native, Go, or WASM TitanPl extensions into runtime-loadable binaries")}

  ${cyan("run")}       
      ${gray("Run a compiled TitanPl production server or execute extension sandboxes")}

  ${cyan("run ext")}   
      ${gray("Boot an isolated extension testing sandbox using TitanPl small server or standalone TGRV")}

  ${cyan("start")}     
      ${gray("Launch the production TitanPl Server from an existing build")}

  ${cyan("update")}    
      ${gray("Migrate TitanPl projects across framework versions, templates, configs, and runtime APIs")}

  ${bold("Options:")}
    ${cyan("-v, --version")}  ${gray("Output the current version")}
    ${cyan("-h, --help")}     ${gray("Display this help message or specific command help")}

${gray("  The Titan Planet Engine runs your JS/TS server natively without Node.js. ")}
  ${cyan("https://titanpl.vercel.app")}
`);
}

/* -------------------------------------------------------
 * CLI Router
 * ----------------------------------------------------- */
process.title = "TitanPL";

const args = process.argv.slice(2);
const cmd = process.argv[2];
const sub = args[1];

const wantsHelp =
  args.includes("--help") || args.includes("-h");

(async () => {
  try {

    // -------------------------------------------------------
    // Old tit / titan detection note
    // -------------------------------------------------------
    const scriptBase = path.basename(process.argv[1]);
    if (scriptBase === 'tit') {
      console.log(yellow(`\n⚠️ [Notice]: \`tit\` is deprecated. Please use \`titan\` instead.\n`));
    }

    if (wantsHelp) {
      switch (cmd) {
        case "build":
          return buildHelp();

        case "ext":
          return extensionHelp();

        case "update":
          return updateHelp();

        case "init":
          return initHelp();

        case "run":
          return runHelp();

        default:
          return help();
      }
    }

    switch (cmd) {
      case "init": {
        const projectName = process.argv[3];
        let template = null;
        const tIndex = process.argv.indexOf("-t") !== -1 ? process.argv.indexOf("-t") : process.argv.indexOf("--template");
        if (tIndex !== -1 && process.argv[tIndex + 1]) {
          template = process.argv[tIndex + 1];
        }
        await initCommand(projectName, template);
        break;
      }

      case "create": {
        const type = process.argv[3];
        const name = process.argv[4];
        await createCommand(type, name);
        break;
      }

      case "build": {
        if (process.argv[3] === "ext" || process.argv[3] === "extension") {
          await buildExtensionCommand();
        } else {
          const isRelease = process.argv.includes("--release") || process.argv.includes("-r");
          console.log(cyan(`→ Building Titan project${isRelease ? " (Release mode)" : ""}...`));
          await buildCommand(isRelease);
          console.log(green(`✔ ${isRelease ? "Release" : "Build"} complete`));
        }
        break;
      }

      case "dev":
        await devCommand();
        break;

      case "run":
        if (process.argv[3] === "ext" || process.argv[3] === "extension") {
          await runExtensionCommand();
        } else {
          console.log(cyan("→ Starting Titan Server..."));
          startCommand();
        }
        break;

      case "start":
        console.log(cyan("→ Starting Titan Server..."));
        startCommand();
        break;

      case "update": {
        const option = process.argv[3];
        const value = process.argv[4];
        await updateCommand(option, value);
        break;
      }

      case "migrate":
        await migrateCommand();
        break;

      case "--version":
      case "-v":
      case "version":
        console.log(cyan(`Titan CLI v${VERSION}`));
        break;

      default:
        help();
    }
  } catch (err) {
    console.error(red("✖ Titan CLI Error"));
    console.error(gray(err?.message || err));
    process.exit(1);
  }
})();

