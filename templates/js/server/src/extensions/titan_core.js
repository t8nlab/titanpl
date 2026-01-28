
// Titan Core Runtime JS
// This is embedded in the binary for ultra-fast startup.

globalThis.global = globalThis;

// defineAction identity helper
globalThis.defineAction = (fn) => {
    if (fn.__titanWrapped) return fn;
    const wrapped = function (req) {
        const requestId = req.__titan_request_id;

        const isSuspend = (err) => {
            const msg = err && (err.message || String(err));
            return msg && (msg.includes("__SUSPEND__") || msg.includes("SUSPEND"));
        };

        try {
            const result = fn(req);

            if (result && typeof result.then === 'function') {
                // It's a Promise (or thenable)
                result.then(
                    (data) => t._finish_request(requestId, data),
                    (err) => {
                        if (isSuspend(err)) return;
                        t._finish_request(requestId, { error: err.message || String(err) })
                    }
                );
            } else {
                // Synchronous direct return
                t._finish_request(requestId, result);
            }
        } catch (err) {
            if (isSuspend(err)) return;
            t._finish_request(requestId, { error: err.message || String(err) });
        }
    };
    wrapped.__titanWrapped = true;
    return wrapped;
};

// TextDecoder Polyfill using native t.decodeUtf8
globalThis.TextDecoder = class TextDecoder {
    decode(buffer) {
        return t.decodeUtf8(buffer);
    }
};

// Process environment variables
globalThis.process = {
    env: t.loadEnv()
};

// Everything is strictly synchronous and request-driven.

function createAsyncOp(op) {
    return new Proxy(op, {
        get(target, prop) {
            // Internal properties accessed by drift()
            if (prop === "__titanAsync" || prop === "type" || prop === "data" || typeof prop === 'symbol') {
                return target[prop];
            }
            // If they access anything else (body, status, ok, etc.), it's a mistake
            throw new Error(`[Titan Error] Attempted to access response property '${String(prop)}' without using drift(). \n` +
                `Fix: const result = drift(t.fetch(...));`);
        }
    });
}

// --- Response API ---
const titanResponse = {
    json(data, status = 200, extraHeaders = {}) {
        return {
            _isResponse: true,
            status,
            headers: { "Content-Type": "application/json", ...extraHeaders },
            body: JSON.stringify(data)
        };
    },
    text(data, status = 200, extraHeaders = {}) {
        return {
            _isResponse: true,
            status,
            headers: { "Content-Type": "text/plain", ...extraHeaders },
            body: String(data)
        };
    },
    html(data, status = 200, extraHeaders = {}) {
        return {
            _isResponse: true,
            status,
            headers: { "Content-Type": "text/html", ...extraHeaders },
            body: String(data)
        };
    },
    redirect(url, status = 302, extraHeaders = {}) {
        return {
            _isResponse: true,
            status,
            headers: { "Location": url, ...extraHeaders },
            redirect: url
        };
    }
};

if (globalThis.t) {
    globalThis.t.response = titanResponse;
} else {
    globalThis.t = { response: titanResponse };
}

// --- Drift Support ---

globalThis.drift = function (value) {
    if (Array.isArray(value)) {
        for (const item of value) {
            if (!item || !item.__titanAsync) {
                throw new Error("drift() array must contain t.fetch/t.db.query/t.read async ops only.");
            }
        }
    } else if (!value || !value.__titanAsync) {
        throw new Error("drift() must wrap t.fetch/t.db.query/t.read async ops only.");
    }
    return t._drift_call(value);
};

// Wrap native fetch
if (t.fetch && !t.fetch.__titanWrapped) {
    const nativeFetch = t.fetch;
    t.fetch = function (...args) {
        return createAsyncOp(nativeFetch(...args));
    };
    t.fetch.__titanWrapped = true;
}

// Wrap t.read (it's now async metadata)
if (t.read && !t.read.__titanWrapped) {
    const nativeRead = t.read;
    t.read = function (path) {
        return createAsyncOp(nativeRead(path));
    };
    t.read.__titanWrapped = true;
}

// Fix t.core.fs.read mapping
if (t.core && t.core.fs) {
    if (t.core.fs.read && !t.core.fs.read.__titanWrapped) {
        const nativeFsRead = t.core.fs.read;
        t.core.fs.read = function (path) {
            return createAsyncOp(nativeFsRead(path));
        };
        t.core.fs.read.__titanWrapped = true;
        // Alias
        t.core.fs.readFile = t.core.fs.read;
    }
}



// Wrap t.db.connect
const nativeDbConnect = t.db.connect;
t.db.connect = function (connString) {
    const conn = nativeDbConnect(connString);
    const nativeQuery = conn.query;
    conn.query = (sql) => {
        return createAsyncOp({
            __titanAsync: true,
            type: "db_query",
            data: {
                conn: connString,
                query: sql
            }
        });
    };
    return conn;
};

