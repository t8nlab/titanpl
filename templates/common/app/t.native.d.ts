// =============================================================================
//  Titan Planet — Type Definitions
//  Framework: JavaScript-first backend compiled to native Rust + Axum binary
//  Version:   v26 (Stable)
//  Docs:      https://titan-docs-ez.vercel.app/docs
//  GitHub:    https://github.com/ezet-galaxy/titanpl
// =============================================================================

// ---------------------------------------------------------------------------
//  Module Definitions — Imports from "titan"
// ---------------------------------------------------------------------------

/**
 * Represents a normalized HTTP request object passed to every Titan action.
 *
 * This object is **stable, predictable, and serializable** — it is identical
 * across both development (`titan dev`) and production (native binary) modes.
 *
 * @example
 * ```js
 * // Accessing the request inside an action
 * export function getUser(req) {
 *   const userId = req.params.id;   // Route parameter
 *   const page   = req.query.page;  // Query string ?page=2
 *   const data   = req.body;        // Parsed JSON body (POST/PUT/PATCH)
 *   const auth   = req.headers["authorization"];
 *   return { userId, page, data, auth };
 * }
 * ```
 *
 * @see https://titan-docs-ez.vercel.app/docs/03-actions — Actions documentation
 * @see https://titan-docs-ez.vercel.app/docs/02-routes  — Routes & parameters
 */
export interface TitanRequest {
    /**
     * The parsed request body.
     *
     * - For `POST`, `PUT`, and `PATCH` requests, this contains the parsed JSON payload.
     * - For `GET` and `DELETE` requests, this is typically `null`.
     *
     * Titan automatically parses `application/json` bodies — no middleware needed.
     *
     * @example
     * ```js
     * export function createUser(req) {
     *   const { name, email } = req.body;
     *   return { created: true, name, email };
     * }
     * ```
     */
    body: any;

    /**
     * The HTTP method of the incoming request.
     *
     * Titan performs automatic method matching at the route level, so each
     * action typically handles a single method. However, you can inspect
     * this property to branch logic if needed.
     *
     * @example
     * ```js
     * export function handler(req) {
     *   if (req.method === "POST") return createItem(req.body);
     *   if (req.method === "GET")  return listItems();
     * }
     * ```
     */
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

    /**
     * The full URL path of the request (e.g., `"/user/42"`).
     *
     * This is the raw matched path including resolved dynamic segments.
     */
    path: string;

    /**
     * All HTTP request headers as a flat key-value map.
     *
     * Header names are **lowercased** (e.g., `"content-type"`, `"authorization"`).
     * A header may be `undefined` if it was not sent by the client.
     *
     * @example
     * ```js
     * export function secureAction(req) {
     *   const token = req.headers["authorization"];
     *   if (!token) return { error: "Unauthorized" };
     *   // ...
     * }
     * ```
     */
    headers: Record<string, string | undefined>;

    /**
     * Dynamic route parameters extracted from the URL path.
     *
     * Defined by route segments like `:id` or typed segments like `:id<number>`.
     * Values are always delivered as **strings** — cast them as needed.
     *
     * @example
     * ```js
     * // Route: /user/:id<number>
     * export function getUser(req) {
     *   const id = Number(req.params.id); // "42" → 42
     *   return { id };
     * }
     * ```
     *
     * @see https://titan-docs-ez.vercel.app/docs/02-routes — Dynamic routes
     */
    params: Record<string, string>;

    /**
     * Parsed query string parameters from the URL.
     *
     * For a request to `/search?q=titan&page=2`, this would be:
     * `{ q: "titan", page: "2" }`.
     *
     * Values are always strings. Returns an empty object `{}` when no
     * query parameters are present.
     *
     * @example
     * ```js
     * // GET /products?category=electronics&limit=10
     * export function listProducts(req) {
     *   const category = req.query.category; // "electronics"
     *   const limit    = Number(req.query.limit) || 20;
     *   return { category, limit };
     * }
     * ```
     */
    query: Record<string, string>;
}

/**
 * Wraps an action handler function with type-safe request typing.
 *
 * `defineAction` is an optional helper that provides IntelliSense and
 * type-checking for your action's `req` parameter and return value.
 * It is **purely a development-time utility** — at runtime it simply
 * returns the same function unchanged (zero overhead).
 *
 * @typeParam T - The return type of the action handler.
 * @param handler - The action function that receives a `TitanRequest` and returns `T`.
 * @returns The same handler function with proper type annotations.
 *
 * @example
 * ```js
 * import { defineAction } from "titan";
 *
 * export const getUser = defineAction((req) => {
 *   // req is fully typed as TitanRequest
 *   const id = Number(req.params.id);
 *   return { id, method: req.method };
 * });
 * ```
 *
 * @example
 * ```ts
 * // TypeScript — with explicit return type
 * import { defineAction } from "titan";
 *
 * interface UserResponse { id: number; name: string; }
 *
 * export const getUser = defineAction<UserResponse>((req) => {
 *   return { id: Number(req.params.id), name: "Titan" };
 * });
 * ```
 *
 * @see https://titan-docs-ez.vercel.app/docs/03-actions — Action definition patterns
 */
export function defineAction<T>(
    handler: (req: TitanRequest) => T
): (req: TitanRequest) => T;

/**
 * Built-in Rust-powered HTTP client.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanRuntimeUtils.fetch} for full documentation.
 */
export const fetch: typeof t.fetch;

/**
 * Action-scoped logging utility.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanRuntimeUtils.log} for full documentation.
 */
export const log: typeof t.log;

/**
 * Synchronous file reader for local files.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanRuntimeUtils.read} for full documentation.
 */
export const read: typeof t.read;

/**
 * JWT (JSON Web Token) signing and verification utilities.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanRuntimeUtils.jwt} for full documentation.
 */
export const jwt: typeof t.jwt;

/**
 * Secure password hashing and verification (bcrypt-based).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanRuntimeUtils.password} for full documentation.
 */
export const password: typeof t.password;

/**
 * Database connection and query interface.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanRuntimeUtils.db} for full documentation.
 */
export const db: typeof t.db;

/**
 * Async file system operations (read, write, mkdir, stat, etc.).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.FileSystem} for full documentation.
 */
export const fs: typeof t.fs;

/**
 * Path manipulation utilities (join, resolve, extname, etc.).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.Path} for full documentation.
 */
export const path: typeof t.path;

/**
 * Cryptographic utilities (hashing, encryption, UUIDs, etc.).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.Crypto} for full documentation.
 */
export const crypto: typeof t.crypto;

/**
 * Buffer encoding/decoding utilities (Base64, Hex, UTF-8).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.BufferModule} for full documentation.
 */
export const buffer: typeof t.buffer;

/**
 * Persistent key-value local storage (shorthand alias).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.LocalStorage} for full documentation.
 */
export const ls: typeof t.ls;

/**
 * Persistent key-value local storage.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.LocalStorage} for full documentation.
 */
export const localStorage: typeof t.localStorage;

/**
 * Server-side session management by session ID.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.Session} for full documentation.
 */
export const session: typeof t.session;

/**
 * HTTP cookie read/write/delete utilities.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.Cookies} for full documentation.
 */
export const cookies: typeof t.cookies;

/**
 * Operating system information (platform, CPU count, memory).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.OS} for full documentation.
 */
export const os: typeof t.os;

/**
 * Network utilities (DNS resolution, IP lookup, ping).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.Net} for full documentation.
 */
export const net: typeof t.net;

/**
 * Process-level information (PID, uptime, memory usage).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.Process} for full documentation.
 */
export const proc: typeof t.proc;

/**
 * Time utilities (sleep, timestamps, high-resolution clock).
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.Time} for full documentation.
 */
export const time: typeof t.time;

/**
 * URL parsing and formatting utilities.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.URLModule} for full documentation.
 */
export const url: typeof t.url;

/**
 * HTTP response builder for controlling status codes, headers, and content types.
 *
 * Re-exported from the `t` global for module-style imports.
 * @see {@link TitanCore.ResponseModule} for full documentation.
 */
export const response: typeof t.response;

/**
 * Runtime validation utilities.
 *
 * Provides schema-based validation for request data. Works with
 * the `@titanpl/valid` package for advanced validation rules.
 *
 * @see https://titan-docs-ez.vercel.app/docs/12-sdk — TitanPl SDK
 */
export const valid: any;


// ---------------------------------------------------------------------------
//  Global Definitions — Runtime Environment
// ---------------------------------------------------------------------------

declare global {

    // -----------------------------------------------------------------------
    //  Drift — Asynchronous Orchestration Engine
    // -----------------------------------------------------------------------

    /**
     * # Drift — Deterministic Replay-based Suspension Engine
     *
     * `drift` is Titan's revolutionary mechanism for handling asynchronous
     * operations inside the **strictly synchronous Gravity V8 runtime**.
     *
     * ## How it works
     *
     * When the runtime encounters a `drift()` call:
     *
     * 1. **Suspend** — The current V8 isolate is suspended (not blocked).
     * 2. **Offload** — The async task is dispatched to Rust's Tokio executor.
     * 3. **Free** — The isolate is released to handle other incoming requests.
     * 4. **Replay** — Once the task completes, the action code is **re-played**
     *    from the beginning with the resolved value injected deterministically.
     *
     * This model is conceptually similar to **Algebraic Effects** — your code
     * reads as synchronous while the runtime handles concurrency under the hood.
     *
     * ## Important notes
     *
     * - `drift` is the **only** way to await promises in Titan actions.
     * - The action function may be re-executed (replayed) — avoid side effects
     *   before the `drift` call that shouldn't be repeated.
     * - Can be used with any Titan API that returns a `Promise` (e.g.,
     *   `t.fetch`, `t.db.connect`, `t.password.hash`, `t.fs.readFile`, etc.).
     *
     * @typeParam T - The resolved type of the promise.
     * @param promise - The promise or expression to drift (suspend and resolve).
     * @returns The synchronously resolved value of the input promise.
     *
     * @example
     * ```js
     * // Basic fetch with drift
     * export function getExternalData(req) {
     *   const resp = drift(t.fetch("https://api.example.com/data"));
     *   return { ok: resp.ok, data: JSON.parse(resp.body) };
     * }
     * ```
     *
     * @example
     * ```js
     * // Multiple drift calls (sequential)
     * export function processOrder(req) {
     *   const user  = drift(t.fetch("https://api.example.com/user/1"));
     *   const order = drift(t.fetch("https://api.example.com/order/99"));
     *   return { user: JSON.parse(user.body), order: JSON.parse(order.body) };
     * }
     * ```
     *
     * @example
     * ```js
     * // Drift with database operations
     * export function getUsers(req) {
     *   const conn  = drift(t.db.connect(process.env.DATABASE_URL));
     *   const users = drift(conn.query("SELECT * FROM users LIMIT 10"));
     *   return { users };
     * }
     * ```
     *
     * @see https://titan-docs-ez.vercel.app/docs/14-drift — Drift documentation
     * @see https://titan-docs-ez.vercel.app/docs/runtime-architecture — Gravity Runtime
     */
    var drift: <T>(promise: Promise<T> | T) => T;


    // -----------------------------------------------------------------------
    //  Database Connection Interface
    // -----------------------------------------------------------------------

    /**
     * Represents an active database connection returned by `t.db.connect()`.
     *
     * Provides a single `query()` method for executing SQL statements with
     * optional parameterized values to prevent SQL injection.
     *
     * @example
     * ```js
     * export function listUsers(req) {
     *   const conn = drift(t.db.connect(process.env.DATABASE_URL));
     *
     *   // Simple query
     *   const all = drift(conn.query("SELECT * FROM users"));
     *
     *   // Parameterized query (safe from SQL injection)
     *   const one = drift(conn.query(
     *     "SELECT * FROM users WHERE id = $1",
     *     [req.params.id]
     *   ));
     *
     *   return { all, user: one[0] };
     * }
     * ```
     *
     * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs
     */
    interface DbConnection {
        /**
         * Execute a SQL query against the connected database.
         *
         * Supports parameterized queries using positional placeholders (`$1`, `$2`, etc.)
         * to prevent SQL injection attacks.
         *
         * @param sql - The SQL query string. Use `$1`, `$2`, ... for parameter placeholders.
         * @param params - Optional array of values to bind to the query placeholders (in order).
         * @returns A promise that resolves to an array of result rows (as plain objects).
         *
         * @example
         * ```js
         * // SELECT with parameters
         * const users = drift(conn.query(
         *   "SELECT * FROM users WHERE role = $1 AND active = $2",
         *   ["admin", true]
         * ));
         *
         * // INSERT
         * drift(conn.query(
         *   "INSERT INTO users (name, email) VALUES ($1, $2)",
         *   ["Alice", "alice@example.com"]
         * ));
         *
         * // UPDATE
         * drift(conn.query(
         *   "UPDATE users SET name = $1 WHERE id = $2",
         *   ["Bob", 42]
         * ));
         * ```
         */
        query(sql: string, params?: any[]): Promise<any[]>;
    }


    // -----------------------------------------------------------------------
    //  Titan Runtime Utils — The `t` / `Titan` global object
    // -----------------------------------------------------------------------

    /**
     * The Titan Runtime Utilities interface — the core API surface available
     * globally as `t` (or `Titan`) in every action.
     *
     * All methods on `t` are powered by native Rust implementations under
     * the hood, providing near-zero overhead and memory safety. Async methods
     * must be consumed via the `drift()` operator.
     *
     * @example
     * ```js
     * // The `t` object is always available — no imports needed
     * export function myAction(req) {
     *   t.log("Request received:", req.method, req.path);
     *   const resp = drift(t.fetch("https://api.example.com/data"));
     *   return { status: resp.status, body: JSON.parse(resp.body) };
     * }
     * ```
     *
     * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Complete Runtime APIs reference
     */
    interface TitanRuntimeUtils {

        // -------------------------------------------------------------------
        //  Core I/O
        // -------------------------------------------------------------------

        /**
         * Action-scoped, sandboxed logging utility.
         *
         * Writes messages to the Titan **Gravity Logs** system. Logs are
         * prefixed with the action name for easy filtering and debugging.
         * Accepts any number of arguments of any type (they are serialized
         * automatically).
         *
         * Output in the terminal appears as:
         * ```
         * [Titan] log(myAction): your message here
         * ```
         *
         * @param args - One or more values to log (strings, numbers, objects, etc.).
         *
         * @example
         * ```js
         * t.log("Processing user", req.params.id);
         * t.log("Body received:", req.body);
         * t.log("Multiple", "values", { are: "supported" }, 42);
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/06-logs — Gravity Logs
         */
        log(...args: any[]): void;

        /**
         * Synchronously reads the contents of a local file as a UTF-8 string.
         *
         * This is a **blocking, synchronous** operation — suitable for reading
         * small configuration files, templates, or static assets at startup.
         * For larger or async file operations, prefer `t.fs.readFile()` with `drift()`.
         *
         * @param path - Absolute or relative path to the file to read.
         * @returns The file contents as a UTF-8 string.
         * @throws If the file does not exist or cannot be read.
         *
         * @example
         * ```js
         * export function getConfig(req) {
         *   const raw = t.read("./config.json");
         *   return JSON.parse(raw);
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs
         */
        read(path: string): string;

        /**
         * Built-in Rust-powered HTTP client for making outbound requests.
         *
         * Powered by Rust's native HTTP stack — **not** `node-fetch` or any
         * JS-based client. Provides high-performance, non-blocking HTTP calls.
         *
         * Returns a `Promise` — use with `drift()` to resolve it inside an action.
         *
         * @param url - The target URL to request (must include protocol, e.g. `"https://..."`).
         * @param options - Optional request configuration.
         * @param options.method - HTTP method. Defaults to `"GET"`.
         * @param options.headers - Key-value map of request headers.
         * @param options.body - Request body. Strings are sent as-is; objects are
         *                       automatically JSON-serialized with `Content-Type: application/json`.
         *
         * @returns A promise resolving to a response object with:
         * - `ok` — `true` if the status code is 2xx.
         * - `status` — The HTTP status code (e.g., `200`, `404`, `500`).
         * - `body` — The response body as a string (parse with `JSON.parse()` if needed).
         * - `error` — An error message string if the request failed at the network level.
         *
         * @example
         * ```js
         * // Simple GET
         * export function getData(req) {
         *   const resp = drift(t.fetch("https://api.example.com/items"));
         *   return JSON.parse(resp.body);
         * }
         * ```
         *
         * @example
         * ```js
         * // POST with JSON body and headers
         * export function createItem(req) {
         *   const resp = drift(t.fetch("https://api.example.com/items", {
         *     method: "POST",
         *     headers: {
         *       "Authorization": "Bearer " + process.env.API_KEY,
         *       "Content-Type": "application/json"
         *     },
         *     body: { name: req.body.name, price: req.body.price }
         *   }));
         *
         *   if (!resp.ok) return { error: "Failed", status: resp.status };
         *   return JSON.parse(resp.body);
         * }
         * ```
         *
         * @example
         * ```js
         * // Error handling
         * export function safeFetch(req) {
         *   const resp = drift(t.fetch("https://unreliable-api.com/data"));
         *   if (resp.error) return { error: resp.error };
         *   if (!resp.ok)   return { error: `HTTP ${resp.status}` };
         *   return JSON.parse(resp.body);
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.fetch)
         */
        fetch(url: string, options?: {
            method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
            headers?: Record<string, string>;
            body?: string | object;
        }): Promise<{
            ok: boolean;
            status?: number;
            body?: string;
            error?: string;
        }>;


        // -------------------------------------------------------------------
        //  Authentication & Security
        // -------------------------------------------------------------------

        /**
         * JSON Web Token (JWT) utilities for stateless authentication.
         *
         * Provides `sign` and `verify` methods backed by Rust cryptographic
         * implementations. Ideal for issuing access tokens and validating
         * incoming Bearer tokens in API actions.
         *
         * > **Note:** Both methods are **synchronous** — no `drift()` needed.
         *
         * @example
         * ```js
         * // Sign a token
         * export function login(req) {
         *   const { username, password } = req.body;
         *   // ... validate credentials ...
         *   const token = t.jwt.sign(
         *     { sub: userId, role: "admin" },
         *     process.env.JWT_SECRET,
         *     { expiresIn: "7d" }
         *   );
         *   return { token };
         * }
         *
         * // Verify a token
         * export function protectedAction(req) {
         *   const token = req.headers["authorization"]?.replace("Bearer ", "");
         *   try {
         *     const payload = t.jwt.verify(token, process.env.JWT_SECRET);
         *     return { userId: payload.sub, role: payload.role };
         *   } catch (e) {
         *     return t.response.json({ error: "Invalid token" }, 401);
         *   }
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.jwt)
         */
        jwt: {
            /**
             * Create a signed JWT from a payload object.
             *
             * @param payload - The data to encode in the token (e.g., `{ sub: "user123", role: "admin" }`).
             *                  Avoid putting sensitive data here — JWTs are encoded, not encrypted.
             * @param secret - The secret key used for HMAC signing. Store in environment variables.
             * @param options - Optional signing options.
             * @param options.expiresIn - Token expiration time.
             *                            Accepts duration strings (`"1h"`, `"7d"`, `"30m"`) or
             *                            a number representing seconds.
             * @returns The signed JWT as a string (e.g., `"eyJhbGciOi..."`).
             *
             * @example
             * ```js
             * const token = t.jwt.sign({ userId: 1 }, "my-secret", { expiresIn: "24h" });
             * ```
             */
            sign(payload: object, secret: string, options?: { expiresIn?: string | number }): string;

            /**
             * Verify and decode a JWT, returning the original payload.
             *
             * @param token - The JWT string to verify.
             * @param secret - The secret key used to verify the signature.
             * @returns The decoded payload object if the token is valid and not expired.
             * @throws If the token is invalid, expired, or the signature doesn't match.
             *
             * @example
             * ```js
             * try {
             *   const payload = t.jwt.verify(token, process.env.JWT_SECRET);
             *   t.log("User:", payload.sub);
             * } catch (err) {
             *   t.log("Token verification failed");
             * }
             * ```
             */
            verify(token: string, secret: string): any;
        };

        /**
         * Secure password hashing and verification powered by bcrypt (Rust implementation).
         *
         * Both methods return `Promise` values — use `drift()` to resolve them.
         *
         * @example
         * ```js
         * // Registration: hash the password before storing
         * export function register(req) {
         *   const { email, password } = req.body;
         *   const hashed = drift(t.password.hash(password));
         *   // Store `hashed` in your database
         *   return { success: true, email };
         * }
         *
         * // Login: compare submitted password against stored hash
         * export function login(req) {
         *   const { email, password } = req.body;
         *   // Retrieve `storedHash` from your database
         *   const valid = drift(t.password.verify(password, storedHash));
         *   if (!valid) return t.response.json({ error: "Invalid credentials" }, 401);
         *   return { token: t.jwt.sign({ email }, process.env.JWT_SECRET) };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.password)
         */
        password: {
            /**
             * Hash a plain-text password using bcrypt.
             *
             * Automatically generates a secure salt. The resulting hash string
             * includes the salt, making it safe to store directly in a database.
             *
             * @param password - The plain-text password to hash.
             * @returns A promise resolving to the bcrypt hash string.
             *
             * @example
             * ```js
             * const hash = drift(t.password.hash("my-secure-password"));
             * // hash → "$2b$12$LJ3m4ys..."
             * ```
             */
            hash(password: string): Promise<string>;

            /**
             * Verify a plain-text password against a previously hashed value.
             *
             * @param password - The plain-text password to check.
             * @param hash - The bcrypt hash string to compare against.
             * @returns A promise resolving to `true` if the password matches, `false` otherwise.
             *
             * @example
             * ```js
             * const isValid = drift(t.password.verify("my-password", storedHash));
             * if (!isValid) return { error: "Wrong password" };
             * ```
             */
            verify(password: string, hash: string): Promise<boolean>;
        };


        // -------------------------------------------------------------------
        //  Database
        // -------------------------------------------------------------------

        /**
         * Database connection interface.
         *
         * Establish connections to SQL databases (PostgreSQL, MySQL, SQLite, etc.)
         * using a connection URL. Returns a `DbConnection` instance for executing queries.
         *
         * > **Important:** `connect()` returns a `Promise` — always wrap it with `drift()`.
         *
         * @example
         * ```js
         * export function getUsers(req) {
         *   const conn = drift(t.db.connect(process.env.DATABASE_URL));
         *   const users = drift(conn.query("SELECT id, name, email FROM users"));
         *   return { users };
         * }
         * ```
         *
         * @example
         * ```js
         * // Full CRUD example
         * export function createUser(req) {
         *   const conn = drift(t.db.connect(process.env.DATABASE_URL));
         *   const { name, email } = req.body;
         *
         *   drift(conn.query(
         *     "INSERT INTO users (name, email) VALUES ($1, $2)",
         *     [name, email]
         *   ));
         *
         *   return { created: true, name, email };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.db)
         */
        db: {
            /**
             * Establish a database connection.
             *
             * @param url - A database connection string.
             *
             * Supported formats:
             * - PostgreSQL: `"postgres://user:pass@host:5432/dbname"`
             * - MySQL: `"mysql://user:pass@host:3306/dbname"`
             * - SQLite: `"sqlite://./data.db"`
             *
             * @returns A promise resolving to a {@link DbConnection} instance.
             *
             * @example
             * ```js
             * const conn = drift(t.db.connect("postgres://admin:secret@localhost:5432/mydb"));
             * ```
             */
            connect(url: string): Promise<DbConnection>;
        };


        // -------------------------------------------------------------------
        //  File System & Paths
        // -------------------------------------------------------------------

        /**
         * Asynchronous file system operations.
         *
         * Provides async methods for reading, writing, and managing files and
         * directories. All methods return `Promise` — use `drift()` to resolve.
         *
         * @see {@link TitanCore.FileSystem} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.fs)
         */
        fs: TitanCore.FileSystem;

        /**
         * Path manipulation utilities.
         *
         * All methods are **synchronous** — no `drift()` needed. Provides
         * cross-platform path joining, resolving, and component extraction.
         *
         * @see {@link TitanCore.Path} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.path)
         */
        path: TitanCore.Path;


        // -------------------------------------------------------------------
        //  Cryptography & Encoding
        // -------------------------------------------------------------------

        /**
         * Cryptographic utilities powered by Rust's native crypto libraries.
         *
         * Includes hashing (SHA-256, SHA-512, MD5), HMAC, symmetric encryption/decryption,
         * random bytes generation, and UUID creation. Async methods require `drift()`.
         *
         * @see {@link TitanCore.Crypto} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.crypto)
         */
        crypto: TitanCore.Crypto;

        /**
         * Buffer encoding and decoding utilities for Base64, Hex, and UTF-8 conversions.
         *
         * All methods are **synchronous** — no `drift()` needed.
         *
         * @see {@link TitanCore.BufferModule} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.buffer)
         */
        buffer: TitanCore.BufferModule;


        // -------------------------------------------------------------------
        //  Storage & State
        // -------------------------------------------------------------------

        /**
         * Persistent key-value local storage (shorthand alias for `t.localStorage`).
         *
         * Data persists across requests and server restarts. All methods are
         * **synchronous**. Useful for caching, feature flags, or small config values.
         *
         * @see {@link TitanCore.LocalStorage} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.ls)
         */
        ls: TitanCore.LocalStorage;

        /**
         * Persistent key-value local storage.
         *
         * Data persists across requests and server restarts. All methods are
         * **synchronous**. Identical to `t.ls` — use whichever alias you prefer.
         *
         * @see {@link TitanCore.LocalStorage} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.localStorage)
         */
        localStorage: TitanCore.LocalStorage;

        /**
         * Server-side session management.
         *
         * Store and retrieve data by session ID. Sessions are scoped per client
         * and useful for tracking authentication state, user preferences, or
         * multi-step form data.
         *
         * All methods are **synchronous**.
         *
         * @see {@link TitanCore.Session} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.session)
         */
        session: TitanCore.Session;

        /**
         * HTTP cookie utilities for reading, setting, and deleting cookies.
         *
         * @see {@link TitanCore.Cookies} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.cookies)
         */
        cookies: TitanCore.Cookies;


        // -------------------------------------------------------------------
        //  System & Network
        // -------------------------------------------------------------------

        /**
         * Operating system information.
         *
         * Retrieve platform details, CPU count, and memory statistics of the
         * host machine running the Titan server.
         *
         * @see {@link TitanCore.OS} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.os)
         */
        os: TitanCore.OS;

        /**
         * Network utilities for DNS resolution, IP lookup, and host pinging.
         *
         * All methods return `Promise` — use `drift()` to resolve.
         *
         * @see {@link TitanCore.Net} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.net)
         */
        net: TitanCore.Net;

        /**
         * Process-level information for the running Titan server binary.
         *
         * All methods are **synchronous**.
         *
         * @see {@link TitanCore.Process} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.proc)
         */
        proc: TitanCore.Process;


        // -------------------------------------------------------------------
        //  Utilities
        // -------------------------------------------------------------------

        /**
         * Time-related utilities including sleep, timestamps, and high-resolution clock.
         *
         * `t.time.sleep()` is async (requires `drift()`); other methods are synchronous.
         *
         * @see {@link TitanCore.Time} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.time)
         */
        time: TitanCore.Time;

        /**
         * URL parsing and formatting utilities.
         *
         * @see {@link TitanCore.URLModule} for method signatures.
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.url)
         */
        url: TitanCore.URLModule;

        /**
         * Runtime validation utilities.
         *
         * Provides schema-based validation for request payloads and other data.
         * Works with the `@titanpl/valid` package for advanced rules.
         *
         * @see https://titan-docs-ez.vercel.app/docs/12-sdk — TitanPl SDK
         */
        valid: any;

        /**
         * Extension index signature — allows access to dynamically loaded
         * Titan Extensions registered via `titan create ext`.
         *
         * Custom extensions attach their methods to the `t` object at runtime,
         * making them available as `t.myExtension.someMethod()`.
         *
         * @see https://titan-docs-ez.vercel.app/docs/10-extensions — Extensions documentation
         */
        [key: string]: any;
    }

    /**
     * The primary global Titan runtime object.
     *
     * Available in every action without imports. Provides access to all
     * built-in Titan APIs: HTTP client, logging, JWT, database, file system,
     * crypto, storage, sessions, cookies, OS info, networking, and more.
     *
     * @example
     * ```js
     * export function myAction(req) {
     *   t.log("Hello from Titan!");
     *   return { message: "It works" };
     * }
     * ```
     *
     * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Full API reference
     */
    const t: TitanRuntimeUtils;

    /**
     * Alias for the `t` global runtime object.
     *
     * `Titan` and `t` are interchangeable — use whichever you prefer.
     * Both reference the exact same runtime utilities instance.
     *
     * @example
     * ```js
     * export function myAction(req) {
     *   Titan.log("Using the Titan alias");
     *   const resp = drift(Titan.fetch("https://api.example.com"));
     *   return JSON.parse(resp.body);
     * }
     * ```
     */
    const Titan: TitanRuntimeUtils;


    // -----------------------------------------------------------------------
    //  TitanCore Namespace — Detailed Sub-module Interfaces
    // -----------------------------------------------------------------------

    namespace TitanCore {
        /**
         * Asynchronous file system operations.
         *
         * All methods return `Promise` and must be used with `drift()`.
         *
         * @example
         * ```js
         * export function fileOps(req) {
         *   // Check if a file exists
         *   const exists = drift(t.fs.exists("./data/config.json"));
         *
         *   // Read a file
         *   const content = drift(t.fs.readFile("./data/config.json"));
         *
         *   // Write a file
         *   drift(t.fs.writeFile("./data/output.json", JSON.stringify({ ok: true })));
         *
         *   // Create a directory
         *   drift(t.fs.mkdir("./data/backups"));
         *
         *   // List directory contents
         *   const files = drift(t.fs.readdir("./data"));
         *
         *   // Get file metadata
         *   const info = drift(t.fs.stat("./data/config.json"));
         *   t.log("Size:", info.size, "Is file:", info.isFile);
         *
         *   // Delete a file
         *   drift(t.fs.remove("./data/temp.txt"));
         *
         *   return { exists, files, info };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.fs)
         */
        interface FileSystem {
            /**
             * Read the entire contents of a file as a UTF-8 string.
             *
             * @param path - Path to the file to read.
             * @returns A promise resolving to the file contents.
             * @throws If the file does not exist or cannot be read.
             */
            readFile(path: string): Promise<string>;

            /**
             * Write a string to a file, creating or overwriting it.
             *
             * @param path - Path to the file to write.
             * @param content - The string content to write.
             * @returns A promise that resolves when writing is complete.
             */
            writeFile(path: string, content: string): Promise<void>;

            /**
             * List the names of all entries in a directory.
             *
             * @param path - Path to the directory.
             * @returns A promise resolving to an array of file/directory names.
             */
            readdir(path: string): Promise<string[]>;

            /**
             * Create a directory (and parent directories if needed).
             *
             * @param path - Path of the directory to create.
             * @returns A promise that resolves when the directory is created.
             */
            mkdir(path: string): Promise<void>;

            /**
             * Check whether a file or directory exists at the given path.
             *
             * @param path - Path to check.
             * @returns A promise resolving to `true` if the path exists, `false` otherwise.
             */
            exists(path: string): Promise<boolean>;

            /**
             * Get metadata about a file or directory.
             *
             * @param path - Path to the file or directory.
             * @returns A promise resolving to a stat object with:
             *   - `size` — File size in bytes.
             *   - `isFile` — `true` if the path is a regular file.
             *   - `isDir` — `true` if the path is a directory.
             *   - `modified` — Last modification time as a Unix timestamp (ms).
             */
            stat(path: string): Promise<{
                size: number;
                isFile: boolean;
                isDir: boolean;
                modified: number;
            }>;

            /**
             * Delete a file or directory.
             *
             * @param path - Path to the file or directory to remove.
             * @returns A promise that resolves when the removal is complete.
             * @throws If the path does not exist.
             */
            remove(path: string): Promise<void>;
        }

        /**
         * Cross-platform path manipulation utilities.
         *
         * All methods are **synchronous** — no `drift()` needed.
         *
         * @example
         * ```js
         * const full = t.path.join("data", "users", "profile.json");
         * // → "data/users/profile.json"
         *
         * const abs = t.path.resolve("./config.json");
         * // → "/app/config.json"
         *
         * t.path.extname("photo.png");    // → ".png"
         * t.path.dirname("/a/b/c.txt");   // → "/a/b"
         * t.path.basename("/a/b/c.txt");  // → "c.txt"
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.path)
         */
        interface Path {
            /**
             * Join multiple path segments into a single normalized path.
             *
             * @param args - Two or more path segments to join.
             * @returns The joined and normalized path string.
             *
             * @example
             * ```js
             * t.path.join("data", "users", "profile.json");
             * // → "data/users/profile.json"
             * ```
             */
            join(...args: string[]): string;

            /**
             * Resolve a sequence of paths into an absolute path.
             *
             * @param args - Path segments. Relative segments are resolved against the working directory.
             * @returns The resolved absolute path string.
             *
             * @example
             * ```js
             * t.path.resolve("./config.json");
             * // → "/app/config.json"
             * ```
             */
            resolve(...args: string[]): string;

            /**
             * Get the file extension (including the leading dot).
             *
             * @param path - The file path.
             * @returns The extension string (e.g., `".json"`, `".png"`), or `""` if none.
             */
            extname(path: string): string;

            /**
             * Get the directory portion of a path.
             *
             * @param path - The file path.
             * @returns The directory path (e.g., `"/a/b"` from `"/a/b/c.txt"`).
             */
            dirname(path: string): string;

            /**
             * Get the last segment (filename) of a path.
             *
             * @param path - The file path.
             * @returns The filename (e.g., `"c.txt"` from `"/a/b/c.txt"`).
             */
            basename(path: string): string;
        }

        /**
         * Cryptographic operations powered by Rust's native crypto libraries.
         *
         * Includes hashing, HMAC, symmetric encryption/decryption, random bytes,
         * UUID generation, and constant-time comparison.
         *
         * Async methods (`hash`, `encrypt`, `decrypt`, `hashKeyed`) require `drift()`.
         * Sync methods (`randomBytes`, `uuid`, `compare`) do not.
         *
         * @example
         * ```js
         * export function cryptoDemo(req) {
         *   // Hash a string
         *   const sha = drift(t.crypto.hash("sha256", "hello world"));
         *
         *   // Generate a UUID
         *   const id = t.crypto.uuid();
         *
         *   // Random bytes (hex-encoded)
         *   const rand = t.crypto.randomBytes(32);
         *
         *   // HMAC signing
         *   const sig = drift(t.crypto.hashKeyed("hmac-sha256", "secret", "message"));
         *
         *   // Encrypt / Decrypt
         *   const encrypted = drift(t.crypto.encrypt("aes-256-gcm", "my-key", "secret data"));
         *   const decrypted = drift(t.crypto.decrypt("aes-256-gcm", "my-key", encrypted));
         *
         *   return { sha, id, rand, sig, decrypted };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.crypto)
         */
        interface Crypto {
            /**
             * Compute a cryptographic hash of the input data.
             *
             * @param algorithm - The hash algorithm: `"sha256"`, `"sha512"`, or `"md5"`.
             * @param data - The string to hash.
             * @returns A promise resolving to the hex-encoded hash string.
             *
             * @example
             * ```js
             * const hash = drift(t.crypto.hash("sha256", "hello"));
             * // → "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
             * ```
             */
            hash(algorithm: 'sha256' | 'sha512' | 'md5', data: string): Promise<string>;

            /**
             * Generate cryptographically secure random bytes as a hex string.
             *
             * This is a **synchronous** operation — no `drift()` needed.
             *
             * @param size - Number of random bytes to generate.
             * @returns A hex-encoded string of `size` random bytes (length = `size * 2`).
             *
             * @example
             * ```js
             * const secret = t.crypto.randomBytes(32);
             * // → "a1b2c3d4e5f6..." (64 hex chars)
             * ```
             */
            randomBytes(size: number): string;

            /**
             * Generate a random UUID v4 string.
             *
             * This is a **synchronous** operation — no `drift()` needed.
             *
             * @returns A UUID v4 string (e.g., `"550e8400-e29b-41d4-a716-446655440000"`).
             *
             * @example
             * ```js
             * const id = t.crypto.uuid();
             * // → "f47ac10b-58cc-4372-a567-0e02b2c3d479"
             * ```
             */
            uuid(): string;

            /**
             * Perform a constant-time string comparison to prevent timing attacks.
             *
             * This is a **synchronous** operation — no `drift()` needed.
             *
             * @param hash - The first string (typically a hash or token).
             * @param target - The second string to compare against.
             * @returns `true` if the strings are identical, `false` otherwise.
             *
             * @example
             * ```js
             * const isMatch = t.crypto.compare(computedHash, expectedHash);
             * ```
             */
            compare(hash: string, target: string): boolean;

            /**
             * Encrypt data using a symmetric encryption algorithm.
             *
             * @param algorithm - The encryption algorithm (e.g., `"aes-256-gcm"`).
             * @param key - The encryption key string.
             * @param plaintext - The data to encrypt.
             * @returns A promise resolving to the encrypted ciphertext string.
             *
             * @example
             * ```js
             * const encrypted = drift(t.crypto.encrypt("aes-256-gcm", myKey, "secret data"));
             * ```
             */
            encrypt(algorithm: string, key: string, plaintext: string): Promise<string>;

            /**
             * Decrypt data previously encrypted with `t.crypto.encrypt()`.
             *
             * @param algorithm - The same algorithm used for encryption.
             * @param key - The same key used for encryption.
             * @param ciphertext - The encrypted string to decrypt.
             * @returns A promise resolving to the original plaintext string.
             *
             * @example
             * ```js
             * const plaintext = drift(t.crypto.decrypt("aes-256-gcm", myKey, encrypted));
             * ```
             */
            decrypt(algorithm: string, key: string, ciphertext: string): Promise<string>;

            /**
             * Compute an HMAC (Hash-based Message Authentication Code).
             *
             * Useful for verifying message integrity and authenticity
             * (e.g., webhook signature validation).
             *
             * @param algorithm - The HMAC algorithm: `"hmac-sha256"` or `"hmac-sha512"`.
             * @param key - The secret key for the HMAC.
             * @param message - The message to authenticate.
             * @returns A promise resolving to the hex-encoded HMAC string.
             *
             * @example
             * ```js
             * // Verify a webhook signature
             * export function webhook(req) {
             *   const signature = req.headers["x-signature"];
             *   const computed  = drift(t.crypto.hashKeyed(
             *     "hmac-sha256",
             *     process.env.WEBHOOK_SECRET,
             *     JSON.stringify(req.body)
             *   ));
             *   if (!t.crypto.compare(computed, signature)) {
             *     return t.response.json({ error: "Invalid signature" }, 401);
             *   }
             *   return { verified: true };
             * }
             * ```
             */
            hashKeyed(algorithm: 'hmac-sha256' | 'hmac-sha512', key: string, message: string): Promise<string>;
        }

        /**
         * Buffer encoding and decoding utilities.
         *
         * Convert between `string`, `Uint8Array`, Base64, Hex, and UTF-8
         * representations. All methods are **synchronous** — no `drift()` needed.
         *
         * @example
         * ```js
         * // Base64 encode/decode
         * const encoded = t.buffer.toBase64("Hello, Titan!");
         * const decoded = t.buffer.toUtf8(t.buffer.fromBase64(encoded));
         *
         * // Hex encode/decode
         * const hex = t.buffer.toHex("Hello");
         * const bytes = t.buffer.fromHex(hex);
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.buffer)
         */
        interface BufferModule {
            /**
             * Decode a Base64-encoded string into a `Uint8Array`.
             *
             * @param str - The Base64-encoded string.
             * @returns The decoded byte array.
             */
            fromBase64(str: string): Uint8Array;

            /**
             * Encode bytes or a string to Base64.
             *
             * @param bytes - A `Uint8Array` or plain string to encode.
             * @returns The Base64-encoded string.
             */
            toBase64(bytes: Uint8Array | string): string;

            /**
             * Decode a hex-encoded string into a `Uint8Array`.
             *
             * @param str - The hex-encoded string (e.g., `"48656c6c6f"`).
             * @returns The decoded byte array.
             */
            fromHex(str: string): Uint8Array;

            /**
             * Encode bytes or a string to hexadecimal.
             *
             * @param bytes - A `Uint8Array` or plain string to encode.
             * @returns The hex-encoded string.
             */
            toHex(bytes: Uint8Array | string): string;

            /**
             * Encode a UTF-8 string into a `Uint8Array`.
             *
             * @param str - The string to encode.
             * @returns The UTF-8 encoded byte array.
             */
            fromUtf8(str: string): Uint8Array;

            /**
             * Decode a `Uint8Array` back into a UTF-8 string.
             *
             * @param bytes - The byte array to decode.
             * @returns The decoded UTF-8 string.
             */
            toUtf8(bytes: Uint8Array): string;
        }

        /**
         * Persistent server-side key-value storage.
         *
         * Data persists across requests and server restarts. Accessible via
         * `t.ls` (shorthand) or `t.localStorage` (full name).
         *
         * Values are stored as strings — serialize complex objects with
         * `JSON.stringify()` and parse with `JSON.parse()`.
         *
         * All methods are **synchronous** — no `drift()` needed.
         *
         * @example
         * ```js
         * // Set and retrieve values
         * t.ls.set("app:version", "2.0.0");
         * const version = t.ls.get("app:version"); // → "2.0.0"
         *
         * // Store objects (serialize manually)
         * t.ls.set("config", JSON.stringify({ theme: "dark", lang: "en" }));
         * const config = JSON.parse(t.ls.get("config"));
         *
         * // List all keys
         * const allKeys = t.ls.keys(); // → ["app:version", "config"]
         *
         * // Delete a key
         * t.ls.remove("app:version");
         *
         * // Clear all stored data
         * t.ls.clear();
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.ls / t.localStorage)
         */
        interface LocalStorage {
            /**
             * Retrieve the value associated with a key.
             *
             * @param key - The storage key.
             * @returns The stored string value, or `null` if the key does not exist.
             */
            get(key: string): string | null;

            /**
             * Store a value under the given key (creates or overwrites).
             *
             * @param key - The storage key.
             * @param value - The string value to store.
             */
            set(key: string, value: string): void;

            /**
             * Delete a single key from storage.
             *
             * @param key - The key to remove. No error if the key doesn't exist.
             */
            remove(key: string): void;

            /**
             * Clear all keys and values from local storage.
             *
             * ⚠️ **Destructive** — removes everything. Use with caution.
             */
            clear(): void;

            /**
             * Get a list of all stored keys.
             *
             * @returns An array of all key names currently in storage.
             */
            keys(): string[];
        }

        /**
         * Server-side session management scoped by session ID.
         *
         * Sessions store ephemeral per-client data on the server. Each session
         * is identified by a unique `sessionId` (typically from a cookie or token).
         *
         * All methods are **synchronous** — no `drift()` needed.
         *
         * @example
         * ```js
         * export function setPreference(req) {
         *   const sid = req.headers["x-session-id"];
         *   t.session.set(sid, "theme", "dark");
         *   t.session.set(sid, "lang", "en");
         *   return { saved: true };
         * }
         *
         * export function getPreference(req) {
         *   const sid = req.headers["x-session-id"];
         *   const theme = t.session.get(sid, "theme");
         *   return { theme };
         * }
         *
         * export function logout(req) {
         *   const sid = req.headers["x-session-id"];
         *   t.session.clear(sid); // Destroy entire session
         *   return { loggedOut: true };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.session)
         */
        interface Session {
            /**
             * Retrieve a value from a session.
             *
             * @param sessionId - The unique session identifier.
             * @param key - The key to look up within the session.
             * @returns The stored value, or `null` if not found.
             */
            get(sessionId: string, key: string): string | null;

            /**
             * Store a value in a session (creates or overwrites).
             *
             * @param sessionId - The unique session identifier.
             * @param key - The key to store under.
             * @param value - The string value to store.
             */
            set(sessionId: string, key: string, value: string): void;

            /**
             * Delete a single key from a session.
             *
             * @param sessionId - The unique session identifier.
             * @param key - The key to delete.
             */
            delete(sessionId: string, key: string): void;

            /**
             * Destroy an entire session, removing all its data.
             *
             * @param sessionId - The unique session identifier to clear.
             */
            clear(sessionId: string): void;
        }

        /**
         * HTTP cookie management utilities.
         *
         * Read, set, and delete cookies from incoming requests and outgoing responses.
         *
         * @example
         * ```js
         * export function handleCookies(req) {
         *   // Read a cookie from the request
         *   const token = t.cookies.get(req, "auth_token");
         *
         *   // Set a cookie (attach to response)
         *   t.cookies.set(req, "visited", "true", {
         *     httpOnly: true,
         *     secure: true,
         *     maxAge: 86400  // 1 day in seconds
         *   });
         *
         *   // Delete a cookie
         *   t.cookies.delete(req, "old_cookie");
         *
         *   return { hasToken: !!token };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.cookies)
         */
        interface Cookies {
            /**
             * Read a cookie value from the request.
             *
             * @param req - The Titan request object (or response context).
             * @param name - The cookie name.
             * @returns The cookie value string, or `null` if the cookie is not present.
             */
            get(req: any, name: string): string | null;

            /**
             * Set a cookie on the response.
             *
             * @param res - The response context object.
             * @param name - The cookie name.
             * @param value - The cookie value.
             * @param options - Optional cookie attributes (e.g., `httpOnly`, `secure`, `maxAge`, `path`, `sameSite`).
             */
            set(res: any, name: string, value: string, options?: any): void;

            /**
             * Delete a cookie by setting its expiration in the past.
             *
             * @param res - The response context object.
             * @param name - The cookie name to delete.
             */
            delete(res: any, name: string): void;
        }

        /**
         * Operating system information about the host running the Titan server.
         *
         * All methods are **synchronous** — no `drift()` needed.
         *
         * @example
         * ```js
         * export function serverInfo(req) {
         *   return {
         *     platform: t.os.platform(),      // e.g., "linux"
         *     cpus: t.os.cpus(),               // e.g., 8
         *     totalMemory: t.os.totalMemory(), // bytes
         *     freeMemory: t.os.freeMemory(),   // bytes
         *     tmpdir: t.os.tmpdir()            // e.g., "/tmp"
         *   };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.os)
         */
        interface OS {
            /**
             * Get the operating system platform identifier.
             *
             * @returns A string like `"linux"`, `"darwin"` (macOS), or `"win32"` (Windows).
             */
            platform(): string;

            /**
             * Get the number of logical CPU cores available.
             *
             * @returns The number of CPU cores.
             */
            cpus(): number;

            /**
             * Get the total system memory in bytes.
             *
             * @returns Total memory in bytes.
             */
            totalMemory(): number;

            /**
             * Get the currently available (free) system memory in bytes.
             *
             * @returns Free memory in bytes.
             */
            freeMemory(): number;

            /**
             * Get the path to the system's temporary directory.
             *
             * @returns The temporary directory path (e.g., `"/tmp"`).
             */
            tmpdir(): string;
        }

        /**
         * Network utility functions.
         *
         * All methods return `Promise` — use `drift()` to resolve.
         *
         * @example
         * ```js
         * export function networkInfo(req) {
         *   const ips = drift(t.net.resolveDNS("example.com"));
         *   const myIp = drift(t.net.ip());
         *   const reachable = drift(t.net.ping("8.8.8.8"));
         *   return { ips, myIp, reachable };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.net)
         */
        interface Net {
            /**
             * Resolve a hostname to its IP addresses via DNS lookup.
             *
             * @param hostname - The domain to resolve (e.g., `"example.com"`).
             * @returns A promise resolving to an array of IP address strings.
             */
            resolveDNS(hostname: string): Promise<string[]>;

            /**
             * Get the public IP address of the current server.
             *
             * @returns A promise resolving to the server's public IP string.
             */
            ip(): Promise<string>;

            /**
             * Ping a host to check if it is reachable.
             *
             * @param host - The hostname or IP address to ping.
             * @returns A promise resolving to `true` if the host responds, `false` otherwise.
             */
            ping(host: string): Promise<boolean>;
        }

        /**
         * Process-level information about the running Titan server binary.
         *
         * All methods are **synchronous** — no `drift()` needed.
         *
         * @example
         * ```js
         * export function processInfo(req) {
         *   return {
         *     pid: t.proc.pid(),        // e.g., 12345
         *     uptime: t.proc.uptime(),  // seconds since start
         *     memory: t.proc.memory()   // { rss, heapTotal, heapUsed, ... }
         *   };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.proc)
         */
        interface Process {
            /**
             * Get the process ID (PID) of the Titan server.
             *
             * @returns The numeric process ID.
             */
            pid(): number;

            /**
             * Get the server uptime in seconds since the process started.
             *
             * @returns Uptime in seconds.
             */
            uptime(): number;

            /**
             * Get memory usage statistics for the server process.
             *
             * @returns An object with memory metrics (e.g., `rss`, `heapTotal`, `heapUsed`).
             */
            memory(): Record<string, any>;
        }

        /**
         * Time-related utilities.
         *
         * `sleep()` is async (requires `drift()`). `now()` and `timestamp()` are synchronous.
         *
         * @example
         * ```js
         * export function timeDemo(req) {
         *   const start = t.time.now();       // High-resolution ms timestamp
         *   drift(t.time.sleep(100));          // Wait 100ms
         *   const elapsed = t.time.now() - start;
         *   const iso = t.time.timestamp();   // "2026-01-15T12:30:45.123Z"
         *   return { elapsed, iso };
         * }
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.time)
         */
        interface Time {
            /**
             * Pause execution for the given number of milliseconds.
             *
             * Returns a `Promise` — use `drift()` to suspend the action without blocking
             * the entire server. Useful for rate limiting, retry delays, or testing.
             *
             * @param ms - Duration to sleep in milliseconds.
             * @returns A promise that resolves after the specified duration.
             *
             * @example
             * ```js
             * drift(t.time.sleep(500)); // Wait 500ms
             * ```
             */
            sleep(ms: number): Promise<void>;

            /**
             * Get the current time as a high-resolution millisecond timestamp.
             *
             * This is a **synchronous** operation.
             *
             * @returns A numeric timestamp in milliseconds (similar to `Date.now()`).
             */
            now(): number;

            /**
             * Get the current time as an ISO 8601 formatted string.
             *
             * This is a **synchronous** operation.
             *
             * @returns An ISO timestamp string (e.g., `"2026-01-15T12:30:45.123Z"`).
             */
            timestamp(): string;
        }

        /**
         * URL parsing and formatting utilities.
         *
         * @example
         * ```js
         * const parsed = t.url.parse("https://example.com/path?q=titan&page=1");
         * // → { protocol: "https:", host: "example.com", pathname: "/path", ... }
         *
         * const url = t.url.format({
         *   protocol: "https:",
         *   host: "api.example.com",
         *   pathname: "/v2/users"
         * });
         * // → "https://api.example.com/v2/users"
         * ```
         *
         * @see https://titan-docs-ez.vercel.app/docs/04-runtime-apis — Runtime APIs (t.url)
         */
        interface URLModule {
            /**
             * Parse a URL string into its component parts.
             *
             * @param url - The URL string to parse.
             * @returns An object with URL components (protocol, host, pathname, search, hash, etc.).
             */
            parse(url: string): any;

            /**
             * Format a URL object back into a URL string.
             *
             * @param urlObj - An object with URL components.
             * @returns The formatted URL string.
             */
            format(urlObj: any): string;

            /**
             * URL search parameters utility (similar to the Web API `URLSearchParams`).
             */
            SearchParams: any;
        }
    }
}

export { };