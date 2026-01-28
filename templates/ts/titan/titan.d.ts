
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

declare const builder: TitanBuilder;
export const Titan: TitanBuilder;
export default builder;

export declare function defineAction<T>(actionFn: (req: TitanRequest) => T): (req: TitanRequest) => T;

// -- Global Definitions (Runtime Environment) --

/**
 * # Drift - Orchestration Engine
 * 
 * Revolutionary system for high-performance asynchronous operations using a **Deterministic Replay-based Suspension** model.
 * 
 * ## Mechanism
 * Drift utilizes a suspension model similar to **Algebraic Effects**. When a `drift()` operation is encountered, 
 * the runtime suspends the isolate, offloads the task to the background Tokio executor, and frees the isolate 
 * to handle other requests. Upon completion, the code is efficiently **re-played** with the result injected.
 * 
 * @param promise - The promise or expression to drift.
 * @returns The resolved value of the input promise.
 * 
 * @example
 * ```javascript
 * const resp = drift t.fetch("http://api.titan.com");
 * ```
 */
declare var drift: <T>(promise: Promise<T> | T) => T;

declare global {
    /**
     * Titan Global Drift
     */
    var drift: <T>(promise: Promise<T> | T) => T;

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
        query(sql: string, params?: any[]): any[];
    }

    function defineAction<T>(actionFn: (req: TitanRequest) => T): (req: TitanRequest) => T;

    var req: TitanRequest;

    interface TitanRuntimeUtils {
        log(...args: any[]): void;
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
            sign(payload: object, secret: string, options?: { expiresIn?: string | number }): string;
            verify(token: string, secret: string): any;
        };

        password: {
            hash(password: string): string;
            verify(password: string, hash: string): boolean;
        };

        /** ### `db` (Database Connection) */
        db: {
            connect(url: string): DbConnection;
        };

        /** ### `fs` (File System) */
        fs: TitanCore.FileSystem;

        /** ### `path` (Path Manipulation) */
        path: TitanCore.Path;

        /** ### `crypto` (Cryptography) */
        crypto: TitanCore.Crypto;

        /** ### `buffer` (Buffer Utilities) */
        buffer: TitanCore.BufferModule;

        /** ### `ls` / `localStorage` (Persistent Storage) */
        ls: TitanCore.LocalStorage;
        localStorage: TitanCore.LocalStorage;

        /** ### `session` (Server-side Sessions) */
        session: TitanCore.Session;

        /** ### `cookies` (HTTP Cookies) */
        cookies: TitanCore.Cookies;

        /** ### `os` (Operating System) */
        os: TitanCore.OS;

        /** ### `net` (Network) */
        net: TitanCore.Net;

        /** ### `proc` (Process) */
        proc: TitanCore.Process;

        /** ### `time` (Time) */
        time: TitanCore.Time;

        /** ### `url` (URL) */
        url: TitanCore.URLModule;

        /** ### `response` (HTTP Response Builder) */
        response: TitanCore.ResponseModule;

        valid: any;
        [key: string]: any;
    }

    const t: TitanRuntimeUtils;
    const Titan: TitanRuntimeUtils;

    namespace TitanCore {
        interface FileSystem {
            readFile(path: string): string;
            writeFile(path: string, content: string): void;
            readdir(path: string): string[];
            mkdir(path: string): void;
            exists(path: string): boolean;
            stat(path: string): { size: number, isFile: boolean, isDir: boolean, modified: number };
            remove(path: string): void;
        }

        interface Path {
            join(...args: string[]): string;
            resolve(...args: string[]): string;
            extname(path: string): string;
            dirname(path: string): string;
            basename(path: string): string;
        }

        interface Crypto {
            hash(algorithm: 'sha256' | 'sha512' | 'md5', data: string): string;
            randomBytes(size: number): string;
            uuid(): string;
            compare(hash: string, target: string): boolean;
            encrypt(algorithm: string, key: string, plaintext: string): string;
            decrypt(algorithm: string, key: string, ciphertext: string): string;
            hashKeyed(algorithm: 'hmac-sha256' | 'hmac-sha512', key: string, message: string): string;
        }

        interface BufferModule {
            fromBase64(str: string): Uint8Array;
            toBase64(bytes: Uint8Array | string): string;
            fromHex(str: string): Uint8Array;
            toHex(bytes: Uint8Array | string): string;
            fromUtf8(str: string): Uint8Array;
            toUtf8(bytes: Uint8Array): string;
        }

        interface LocalStorage {
            get(key: string): string | null;
            set(key: string, value: string): void;
            remove(key: string): void;
            clear(): void;
            keys(): string[];
        }

        interface Session {
            get(sessionId: string, key: string): string | null;
            set(sessionId: string, key: string, value: string): void;
            delete(sessionId: string, key: string): void;
            clear(sessionId: string): void;
        }

        interface Cookies {
            get(req: any, name: string): string | null;
            set(res: any, name: string, value: string, options?: any): void;
            delete(res: any, name: string): void;
        }

        interface OS {
            platform(): string;
            cpus(): number;
            totalMemory(): number;
            freeMemory(): number;
            tmpdir(): string;
        }

        interface Net {
            resolveDNS(hostname: string): string[];
            ip(): string;
            ping(host: string): boolean;
        }

        interface Process {
            pid(): number;
            uptime(): number;
            memory(): Record<string, any>;
        }

        interface Time {
            sleep(ms: number): void;
            now(): number;
            timestamp(): string;
        }

        interface URLModule {
            parse(url: string): any;
            format(urlObj: any): string;
            SearchParams: any;
        }

        interface ResponseModule {
            (options: any): any;
            text(content: string, status?: number): any;
            html(content: string, status?: number): any;
            json(content: any, status?: number): any;
            redirect(url: string, status?: number): any;
            empty(status?: number): any;
        }
    }
}
