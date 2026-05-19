const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;
const gray = (t) => `\x1b[90m${t}\x1b[0m`;

export function updateHelp() {
  console.log(`
${bold(cyan("TitanPl Update System"))}

${yellow("Usage:")}
  ${cyan("titan update")} ${gray("[options]")}

${bold("Description:")}
  ${gray("Migrates TitanPl projects to the latest framework architecture,")}
  ${gray("synchronizes runtime configs, refreshes template assets,")}
  ${gray("updates TitanPl packages, validates extensions, and converts")}
  ${gray("project templates between JavaScript and TypeScript.")}

${bold("Options:")}

  ${cyan("--status")}, ${cyan("-s")}
      ${gray("Perform a full TitanPl ecosystem audit:")}
      ${gray("- TitanPl package version checks")}
      ${gray("- extension validation")}
      ${gray("- native binary verification")}
      ${gray("- marketplace registration checks")}
      ${gray("- runtime compatibility inspection")}

  ${cyan("--template <js|ts>")}, ${cyan("-t <js|ts>")}
      ${gray("Convert the application template language.")}

      ${gray("Automatically:")}
      ${gray("- updates titan.template in package.json")}
      ${gray("- renames app/ source files")}
      ${gray("- switches jsconfig.json <-> tsconfig.json")}

${bold("Examples:")}

  ${cyan("titan update")}
      ${gray("Upgrade current project to latest TitanPl ecosystem version")}

  ${cyan("titan update --status")}
      ${gray("Inspect installed TitanPl packages, extensions,")}
      ${gray("binaries, and marketplace verification state")}

  ${cyan("titan update --template ts")}
      ${gray("Convert app/ source files from JavaScript to TypeScript")}

  ${cyan("titan update --template js")}
      ${gray("Convert app/ source files from TypeScript to JavaScript")}

${bold("Notes:")}

  ${gray("- Template conversion only affects the")} ${cyan("app/")} ${gray("directory")}
  ${gray("-")} ${cyan("node_modules/")}${gray(",")} ${cyan("dist/")}${gray(",")} ${cyan("target/")} ${gray("and")} ${cyan("sandbox/")} ${gray("are ignored")}
  ${gray("- After updating packages, run:")}
      ${cyan("npm install")}

`);
}