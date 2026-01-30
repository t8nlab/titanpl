// Titan Core Runtime JS
// Safe Bootstrap — runs only once
if (!globalThis.__TITAN_CORE_LOADED__) {
    globalThis.__TITAN_CORE_LOADED__ = true;

    globalThis.global = globalThis;

    // ensure t exists early
    if (!globalThis.t) globalThis.t = {};

    // -----------------------------
    // defineAction identity helper
    // -----------------------------
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
                    result.then(
                        (data) => {
                            t._finish_request(requestId, data);
                        },
                        (err) => {
                            if (isSuspend(err)) return;
                            t._finish_request(requestId, { error: err.message || String(err) });
                        }
                    );
                } else {
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


    // -----------------------------
    // TextDecoder Polyfill
    // -----------------------------
    globalThis.TextDecoder = class TextDecoder {
        decode(buffer) {
            return t.decodeUtf8(buffer);
        }
    };

    // -----------------------------
    // process.env
    // -----------------------------
    globalThis.process = {
        env: t.loadEnv ? t.loadEnv() : {}
    };

    // -----------------------------
    // Async Proxy Creator
    // -----------------------------
    function createAsyncOp(op) {
        return new Proxy(op, {
            get(target, prop) {
                if (
                    prop === "__titanAsync" ||
                    prop === "type" ||
                    prop === "data" ||
                    typeof prop === 'symbol'
                ) {
                    return target[prop];
                }

                throw new Error(
                    `[Titan Error] Accessed '${String(prop)}' without drift(). ` +
                    `Fix: const res = drift(t.fetch(...));`
                );
            }
        });
    }

    // -----------------------------
    // Response API
    // -----------------------------
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

    t.response = titanResponse;

    // -----------------------------
    // Drift Support
    // -----------------------------
    globalThis.drift = function (value) {
        if (Array.isArray(value)) {
            for (const item of value) {
                if (!item || !item.__titanAsync) {
                    throw new Error("drift() array must contain async ops only.");
                }
            }
        } else if (!value || !value.__titanAsync) {
            throw new Error("drift() must wrap async ops.");
        }

        return t._drift_call(value);
    };

    // -----------------------------
    // Safe Wrappers
    // -----------------------------

    // fetch
    if (t.fetch && !t.fetch.__titanWrapped) {
        const nativeFetch = t.fetch;
        t.fetch = function (...args) {
            return createAsyncOp(nativeFetch(...args));
        };
        t.fetch.__titanWrapped = true;
    }

    // db.connect
    if (t.db && !t.db.__titanWrapped) {
        const nativeDbConnect = t.db.connect;

        t.db.connect = function (connString) {
            const conn = nativeDbConnect(connString);

            if (!conn.query.__titanWrapped) {
                const nativeQuery = conn.query;
                conn.query = (sql) => {
                    return createAsyncOp({
                        __titanAsync: true,
                        type: "db_query",
                        data: { conn: connString, query: sql }
                    });
                };
                conn.query.__titanWrapped = true;
            }

            return conn;
        };

        t.db.__titanWrapped = true;
    }

}
