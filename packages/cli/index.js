#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildCommand } from "./src/commands/build.js";
import { devCommand } from "./src/commands/dev.js";
import { startCommand } from "./src/commands/start.js";
import { migrateCommand } from "./src/commands/migrate.js";
import { updateCommand } from "./src/commands/update.js";
import { initCommand } from "./src/commands/init.js";

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
    ${cyan("init")}      ${gray("Scaffold a new Titan project")}
    ${cyan("create")}    ${gray("Create a new project or extension (e.g. 'titan create ext my-ext')")}
    ${cyan("build")}     ${gray("Compile actions and build production dist")}
    ${cyan("dev")}       ${gray("Start the Gravity Engine in dev/watch mode")}
    ${cyan("start")}     ${gray("Start the production Gravity Engine")}
    ${cyan("update")}    ${gray("Update an existing project to latest Titan version")}
    ${cyan("migrate")}   ${gray("Migrate a legacy project to the new architecture")}

  ${bold("Options:")}
    ${cyan("-v, --version")}  ${gray("Output the current version")}
    ${cyan("-h, --help")}     ${gray("Display this help message")}

${gray("  The Titan Planet Engine runs your JS/TS server natively without Node.js. ")}
  ${cyan("https://titan-docs-ez.vercel.app")}
`);
}

/* -------------------------------------------------------
 * CLI Router
 * ----------------------------------------------------- */
process.title = "TitanPL";
const cmd = process.argv[2];

(async () => {
  try {
    // -------------------------------------------------------
    // Legacy Check
    // -------------------------------------------------------
    if (cmd !== 'migrate' && cmd !== 'init') {
      const legacyCargo = path.join(process.cwd(), "server", "Cargo.toml");
      if (fs.existsSync(legacyCargo)) {
        console.log(yellow(`\n⚠️ This project uses legacy server architecture. Migration recommended.`));
        console.log(`Please run: ${bold(cyan('titan migrate'))}\n`);
        process.exit(1);
      }
    }

    // -------------------------------------------------------
    // Old tit / titan detection note
    // -------------------------------------------------------
    const scriptBase = path.basename(process.argv[1]);
    if (scriptBase === 'tit') {
      console.log(yellow(`\n⚠️ [Notice]: \`tit\` is deprecated. Please use \`titan\` instead.\n`));
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
        if (type === "ext" || type === "extension") {
          await initCommand(name, "extension");
        } else {
          // Fallback to init behavior
          await initCommand(type, null);
        }
        break;
      }

      case "build":
        console.log(cyan("→ Building Titan project..."));
        await buildCommand();
        console.log(green("✔ Build complete"));
        break;

      case "dev":
        await devCommand();
        break;

      case "start":
        console.log(cyan("→ Starting Titan Server..."));
        startCommand();
        break;

      case "update":
        await updateCommand();
        break;

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