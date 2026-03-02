// titan.js - Named exports for users who prefer imports over the global `t`

export const fetch = t.fetch;
export const log = t.log;
export const read = t.read;

// Authentication & Security
export const jwt = t.jwt;
export const password = t.password;

// Database
export const db = t.db;

// File System & Path
export const fs = t.fs;
export const path = t.path;

// Crypto & Buffer
export const crypto = t.crypto;
export const buffer = t.buffer;

// Storage & Sessions
export const ls = t.ls;
export const localStorage = t.localStorage;
export const session = t.session;
export const cookies = t.cookies;

// System
export const os = t.os;
export const net = t.net;
export const proc = t.proc;

// Utilities
export const time = t.time;
export const url = t.url;
export const response = t.response;
export const valid = t.valid;

export const defineAction = (handler) => handler;
