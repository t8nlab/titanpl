
// -- Module Definitions (for imports from "titan") --

export interface RouteHandler {
    reply(value: any): void;
    action(name: string): void;
}

export interface TitanBuilder {
    get(route: string): RouteHandler;
    post(route: string): RouteHandler;
    log(module: string, msg: string): void;
    start(port?: number, msg?: string): Promise<void>;
}

// The default export from titan.js is the Builder
declare const builder: TitanBuilder;
export const Titan: TitanBuilder;
export default builder;

/**
 * Define a Titan Action with type inference.
 */
export declare function defineAction<T>(actionFn: (req: TitanRequest) => T): (req: TitanRequest) => T;


// -- Global Definitions (Runtime Environment) --

declare global {
    /**
     * The Titan Request Object passed to actions.
     */
    interface TitanRequest {
        body: any;
        method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
        path: string;
        headers: {
            host?: string;
            "content-type"?: string;
            "user-agent"?: string;
            authorization?: string;
            [key: string]: string | undefined;
        };
        params: Record<string, string>;
        query: Record<string, string>;
    }

    interface DbConnection {
        /**
         * Execute a SQL query.
         * @param sql The SQL query string.
         * @param params (Optional) Parameters for the query ($1, $2, etc).
         */
        query(sql: string, params?: any[]): any[];
    }

    /**
     * Global defineAction (available without import in runtime, though imports are preferred in TS)
     */
    function defineAction<T>(actionFn: (req: TitanRequest) => T): (req: TitanRequest) => T;

    /**
     * Global Request Object
     * Available automatically in actions.
     */
    var req: TitanRequest;

    /**
     * Titan Runtime Utilities
     * (Available globally in the runtime, e.g. inside actions)
     */
    interface TitanRuntimeUtils {
        /**
         * Log messages to the server console with Titan formatting.
         */
        log(...args: any[]): void;

        /**
         * Read a file contents as string.
         * @param path Relative path to the file from project root.
         */
        read(path: string): string;

        fetch(url: string, options?: {
            method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
            headers?: Record<string, string>;
            body?: string | object;
        }): {
            ok: boolean;
            status?: number;
            body?: string;
            error?: string;
        };

        jwt: {
            sign(
                payload: object,
                secret: string,
                options?: { expiresIn?: string | number }
            ): string;
            verify(token: string, secret: string): any;
        };

        password: {
            hash(password: string): string;
            verify(password: string, hash: string): boolean;
        };

        db: {
            connect(url: string): DbConnection;
        };

        /**
         * Titan Validator (Zod-compatible)
         */
        valid: any;
    }

    /**
     * Titan Runtime Utilities
     * (Available globally in the runtime, e.g. inside actions)
     */
    const t: TitanRuntimeUtils;

    /**
     * Titan Runtime Utilities (Alias for t)
     */
    const Titan: TitanRuntimeUtils;
}
