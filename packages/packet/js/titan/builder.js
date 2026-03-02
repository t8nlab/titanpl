import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export async function buildMetadata(root, dist) {
    const appDir = path.join(root, "app");
    const appFile = "app.js";
    const appPath = path.join(appDir, appFile);

    if (!fs.existsSync(appPath)) {
        console.error(`\x1b[31m❌ app/${appFile} not found.\x1b[0m`);
        process.exit(1);
    }

    try {
        const appUrl = pathToFileURL(appPath).href;
        const cacheBuster = `?t=${Date.now()}`;
        await import(appUrl + cacheBuster);

        const config = globalThis.__TITAN_CONFIG__ || { port: 3000, threads: 4, stack_mb: 8 };
        const routes = globalThis.__TITAN_ROUTES_MAP__ || {};
        const dynamicRoutes = globalThis.__TITAN_DYNAMIC_ROUTES__ || {};
        const actionMap = globalThis.__TITAN_ACTION_MAP__ || {};

        const routesPath = path.join(dist, "routes.json");
        const actionMapPath = path.join(dist, "action_map.json");

        fs.writeFileSync(
            routesPath,
            JSON.stringify(
                {
                    __config: config,
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

    } catch (err) {
        console.error("\x1b[31m❌ Failed to parse routes from app.js\x1b[0m", err);
        process.exit(1);
    }
}
