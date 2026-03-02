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

// Add more as needed based on native/index.js
export const db: any;
export const path: any;
export const jwt: any;
export const password: any;
export const crypto: any;
export const buffer: any;
export const ls: any;
export const session: any;
export const cookies: any;
export const os: any;
export const net: any;
export const proc: any;
export const time: any;
export const url: any;
export const response: any;
export const valid: any;
