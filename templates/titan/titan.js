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

const t = {
  get(route) {
    return addRoute("GET", route);
  },

  post(route) {
    return addRoute("POST", route);
  },

  async start(port = 3000, msg = "") {
    console.log(cyan("[Titan] Bundling actions..."));
    await bundle();

    const base = path.join(process.cwd(), "server");
    fs.mkdirSync(base, { recursive: true });

    fs.writeFileSync(
      path.join(base, "routes.json"),
      JSON.stringify(
        {
          __config: { port },
          routes,
          __dynamic_routes: Object.values(dynamicRoutes).flat()
        },
        null,
        2
      )
    );

    fs.writeFileSync(
      path.join(base, "action_map.json"),
      JSON.stringify(actionMap, null, 2)
    );

    console.log(green(`Titan: routes.json + action_map.json written -> ${base}`));
    if (msg) console.log(cyan(msg));
  }
};

export default t;
