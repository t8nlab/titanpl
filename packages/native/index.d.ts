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

export const db: any;
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

// Serialization
/** Binary-serializes a JavaScript value using V8's fast internal format. */
export function serialize(value: any): Uint8Array;
/** Binary-serializes a JavaScript value using V8's fast internal format. Alias for serialize. */
export function serialise(value: any): Uint8Array;
/** Deserializes a Uint8Array back into its original JavaScript value/object. */
export function deserialize(buffer: Uint8Array): any;
/** Deserializes a Uint8Array back into its original JavaScript value/object. Alias for deserialize. */
export function deserialise(buffer: Uint8Array): any;
