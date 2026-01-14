/**
 * TITAN TYPE DEFINITIONS
 * ----------------------
 * These types are globally available in your Titan project.
 */

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
 * Define a Titan Action with type inference.
 * @example
 * export const hello = defineAction((req) => {
 *   return req.headers;
 * });
 */
declare function defineAction<T>(actionFn: (req: TitanRequest) => T): (req: TitanRequest) => T;

/**
 * Titan Runtime Utilities
 */
declare const t: {
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
};

