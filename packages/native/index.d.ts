export interface Request {
    method: string;
    path: string;
    headers: Record<string, string>;
    params: Record<string, any>;
    query: Record<string, any>;
    body: any;
}

export interface FileSystem {
    readFile(path: string, options?: any, callback?: (err: any, data: string) => void): string;
    writeFile(path: string, data: string): void;
    exists(path: string): boolean;
    readdir(path: string): string[];
    mkdir(path: string): void;
    stat(path: string): any;
}

export const fs: FileSystem;
export function log(message: any): void;
export function defineAction<T = any>(handler: (req: Request) => T | Promise<T>): (req: Request) => T | Promise<T>;
export function fetch(url: string, options?: any): any;
export function drift<T>(op: any): T;

export interface ShareContext {
    get(key: string): any;
    set(key: string, value: any): void;
    delete(key: string): void;
    keys(): string[];
    broadcast(event: string, payload: any): void;
}

// Add more as needed based on native/index.js
export interface WebSocketModule {
    send(socketId: string, message: string): void;
    broadcast(message: string): void;
}

export interface QueryOptions {
    /** Timeout in milliseconds for the query execution. Defaults to 10000 (10s). */
    timeout?: number;
}

export interface ConnectionOptions {
    /** Maximum number of connections in the pool. Defaults to 16. */
    max?: number;
    /** Timeout in milliseconds for acquiring a connection from the pool. Defaults to 5000 (5s). */
    pool_timeout?: number;
}

export interface DbConnection {
    /**
     * Executes a SQL query.
     * 
     * @param sql - The SQL query string (e.g., "SELECT * FROM users WHERE id = $1").
     * @param params - Array of positional parameters to bind to the query.
     * @param options - Optional settings like custom timeout.
     * 
     * @example
     * ```js
     * const users = drift(conn.query("SELECT * FROM users LIMIT 10"));
     * ```
     */
    query(sql: string, params?: any[], options?: QueryOptions): any;
}

export interface DatabaseModule {
    /**
     * Connects to a PostgreSQL database and initializes the connection pool.
     * 
     * @param url - The PostgreSQL connection string.
     * @param options - Pool and timeout configurations.
     */
    connect(url: string, options?: ConnectionOptions): DbConnection;
}

export const db: DatabaseModule;
/**
 * WebSocket communication utilities.
 *
 * @example
 * ```js
 * import { ws } from "@titanpl/native";
 * 
 * export default function chat(req) {
 *   if (req.event === "open") {
 *     ws.send(req.socketId, "Welcome!");
 *     ws.broadcast("Someone joined.");
 *   }
 * }
 * ```
 */
export const ws: WebSocketModule;
export const path: any;
export const jwt: any;
export const password: any;
export const crypto: any;
export const buffer: any;
export const ls: any;
export const session: any;
export const cookies: any;
export const shareContext: ShareContext;
export const os: any;
export const net: any;
export const proc: any;
export const time: any;
export const url: any;
/**
 * HTTP Response builder utilities.
 *
 * @example
 * ```js
 * import { response } from "@titanpl/native";
 * 
 * export function get(req) {
 *   return response.json({ hello: "world" });
 * }
 * ```
 */
export const response: any;
export const valid: any;

export interface TaskStatus {
    /** The current state of the task. */
    state: "pending" | "running" | "done" | "failed";
    /** The Unix timestamp (ms) when the task was started. */
    startedAt: number;
    /** The duration of the task in milliseconds (present if done or failed). */
    duration?: number;
    /** The error message if the task failed. */
    error?: string;
}

export interface TaskOptions {
    /** Whether to deduplicate tasks by key. If true, spawning a task with an existing key will be a no-op if it's already pending or running. Defaults to true. */
    dedupe?: boolean;
    /** Timeout in milliseconds for the task execution. Defaults to 30000 (30s). */
    timeout?: number;
}

export interface TaskModule {
    /**
     * Spawns a single background job that runs the named action.
     * 
     * @param key - Unique task identifier used for deduplication and status tracking.
     * @param actionName - The name of the Titan action to execute (e.g., "emails/send").
     * @param payload - JSON payload delivered as req.body to the background action.
     * @param options - Task configuration options.
     * 
     * @example
     * ```js
     * task.spawn(`cleanup:${userId}`, "user/cleanup", { userId });
     * ```
     */
    spawn(key: string, actionName: string, payload?: any, options?: TaskOptions): void;

    /**
     * Enqueues a job in a FIFO queue. Jobs with the same queueKey run sequentially.
     * 
     * @param queueKey - Queue identifier. All jobs sharing this key run one-at-a-time in order.
     * @param actionName - The name of the Titan action to execute.
     * @param payload - JSON payload delivered as req.body to the background action.
     * @param options - Task configuration options (timeout).
     * 
     * @example
     * ```js
     * task.enqueue(`sync:${userId}`, "data/sync", { page: 1 });
     * task.enqueue(`sync:${userId}`, "data/sync", { page: 2 });
     * ```
     */
    enqueue(queueKey: string, actionName: string, payload?: any, options?: { timeout?: number }): void;

    /**
     * Stops a task by removing it from the registry.
     * Note: A currently running task will complete naturally; this prevents it from being tracked.
     * 
     * @param key - The unique task key to stop.
     */
    stop(key: string): void;

    /**
     * Returns the current status of a task by its key.
     * 
     * @param key - The unique task key to inspect.
     */
    status(key: string): TaskStatus | null;

    /**
     * Clears all pending (not-yet-started) jobs from a queue.
     * Currently running jobs in the queue will complete naturally.
     * 
     * @param queueKey - The queue identifier to clear.
     */
    clear(queueKey: string): void;
}

/**
 * Managed background task scheduler.
 * 
 * Allows offloading long-running work to background workers by executing Titan actions.
 */
export const task: TaskModule;

// Serialization
/** Binary-serializes a JavaScript value using V8's fast internal format. */
export function serialize(value: any): Uint8Array;
/** Binary-serializes a JavaScript value using V8's fast internal format. Alias for serialize. */
export function serialise(value: any): Uint8Array;
/** Deserializes a Uint8Array back into its original JavaScript value/object. */
export function deserialize(buffer: Uint8Array): any;
/** Deserializes a Uint8Array back into its original JavaScript value/object. Alias for deserialize. */
export function deserialise(buffer: Uint8Array): any;

export interface TitanTypes {
    STRING(val: any): any;
    NUMBER(val: any): any;
    BOOLEAN(val: any): any;
    UUID(val: string): any;
    TIMESTAMP(val: string): any;
    TIMESTAMPTZ(val: string): any;
    DATE(val: string): any;
    JSON(val: any): any;
    VARCHAR(val: string): any;
    CHAR(val: string): any;
    TEXT(val: string): any;
    INT(val: number): any;
    BIGINT(val: string | number): any;
    FLOAT(val: number): any;
}

/**
 * Type Casting API for deterministic database operations.
 * 
 * @example
 * ```js
 * import { types, db, drift } from "@titanpl/native";
 * 
 * export function save(req) {
 *   const conn = drift(db.connect(url));
 *   drift(conn.query("INSERT INTO users (id) VALUES ($1)", [types.UUID(req.body.id)]));
 * }
 * ```
 */
export const types: TitanTypes;

/**
 * Environment variables loaded from .env file.
 */
export const env: Record<string, string>;
