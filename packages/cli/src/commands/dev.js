import { dev } from "@titanpl/packet";
import { resolveEngineBinaryPath } from "../engine.js";

export async function devCommand() {
  // Resolve the engine binary from CLI's context (where optionalDependencies live)
  // and inject it into the environment so packet can find it without re-resolving.
  const enginePath = resolveEngineBinaryPath();
  if (enginePath) {
    process.env.TITAN_ENGINE_BINARY = enginePath;
  }
  await dev(process.cwd());
}
