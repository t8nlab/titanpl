/**
 * Titan.js
 * Main Titan runtime builder
 * RULE: This file does NOT handle esbuild errors - bundle.js handles those
 */

import fs from "fs";
import path from "path";
import { bundle } from "./bundle.js";

const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;

const routes = {};
const dynamicRoutes = {};
const actionMap = {};

function addRoute(method, route) {
  const key = `${method.toUpperCase()}:${route}`;

  return {
    reply(value) {
      routes[key] = {
        type: typeof value === "object" ? "json" : "text",
        value
      };
    },

    action(name) {
      if (route.includes(":")) {
        if (!dynamicRoutes[method]) dynamicRoutes[method] = [];
        dynamicRoutes[method].push({
          method: method.toUpperCase(),
          pattern: route,
          action: name
        });
      } else {
        routes[key] = {
          type: "action",
          value: name
        };
        actionMap[key] = name;
      }
    }
  };
}

/**
 * Titan App Builder
 */
const t = {
  /**
   * Define a GET route
   */
  get(route) {
    return addRoute("GET", route);
  },

  /**
   * Define a POST route
   */
  post(route) {
    return addRoute("POST", route);
  },

  log(module, msg) {
    console.log(`[\x1b[35m${module}\x1b[0m] ${msg}`);
  },

  /**
   * Start the Titan Server
   * RULE: Only calls bundle() - does NOT handle esbuild errors
   * RULE: If bundle throws __TITAN_BUNDLE_FAILED__, stop immediately without printing
   */
  async start(port = 3000, msg = "", threads) {
    try {
      console.log(cyan("[Titan] Preparing runtime..."));

      // RULE: Just call bundle() - it handles its own errors
      await bundle();

      const base = path.join(process.cwd(), "server");
      if (!fs.existsSync(base)) {
        fs.mkdirSync(base, { recursive: true });
      }

      const routesPath = path.join(base, "routes.json");
      const actionMapPath = path.join(base, "action_map.json");

      fs.writeFileSync(
        routesPath,
        JSON.stringify(
          {
            __config: { port, threads },
            routes,
            __dynamic_routes: Object.values(dynamicRoutes).flat()
          },
          null,
          2
        )
      );

      fs.writeFileSync(
        actionMapPath,
        JSON.stringify(actionMap, null, 2)
      );

      console.log(green("✔ Titan metadata written successfully"));
      if (msg) console.log(cyan(msg));

    } catch (e) {
      // RULE: If bundle threw __TITAN_BUNDLE_FAILED__, just re-throw it
      // The error box was already printed by bundle.js
      if (e.message === '__TITAN_BUNDLE_FAILED__') {
        throw e;
      }

      // Other unexpected errors (not from bundle)
      console.error(`\x1b[31m[Titan] Unexpected error: ${e.message}\x1b[0m`);
      throw e;
    }
  }
};

/**
 * Titan App Builder (Alias for t)
 */
export const Titan = t;
export default t;
