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
                actionMap[key] = name;
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
    get(route) { return addRoute("GET", route); },
    post(route) { return addRoute("POST", route); },
    put(route) { return addRoute("PUT", route); },
    delete(route) { return addRoute("DELETE", route); },
    log(module, msg) { console.log(`[${module}] ${msg}`); },

    start(port = 3000, msg = "", threads, stack_mb = 8) {
        globalThis.__TITAN_CONFIG__ = { port, msg, threads, stack_mb };
    }
};

globalThis.__TITAN_ROUTES_MAP__ = routes;
globalThis.__TITAN_DYNAMIC_ROUTES__ = dynamicRoutes;
globalThis.__TITAN_ACTION_MAP__ = actionMap;

export default t;
