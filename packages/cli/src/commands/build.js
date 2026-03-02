import { build } from "@titanpl/packet";

export async function buildCommand() {
  const dist = await build(process.cwd());
  console.log("✔ Build complete →", dist);
}