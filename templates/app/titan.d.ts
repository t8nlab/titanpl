/**
 * Titan Runtime Global Object
 */
declare global {
    /**
     * Titan Request Object passed to actions
     */
    interface TitanRequest {
        body: any;
        method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
        path: string;
        headers: Record<string, string>;
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
     * Titan Runtime Utilities
     */
    const t: {
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
            /**
             * Sign a JWT token.
             * @param payload The data to include in the token.
             * @param secret The secret key to sign with.
             * @param options Configuration options.
             */
            sign(
                payload: object,
                secret: string,
                options?: { expiresIn?: string | number }
            ): string;

            /**
             * Verify a JWT token.
             * @param token The JWT string to verify.
             * @param secret The secret key used for signing.
             * @throws Error if invalid or expired.
             */
            verify(token: string, secret: string): any;
        };

        password: {
            /**
             * Hash a password securely using bcrypt.
             */
            hash(password: string): string;

            /**
             * Verify a password against a bcrypt hash.
             */
            verify(password: string, hash: string): boolean;
        };

        db: {
            /**
             * Connect to a PostgreSQL database.
             * @param url Connection string (e.g. postgres://user:pass@localhost:5432/db)
             */
            connect(url: string): DbConnection;
        };
    };
}

export { };
