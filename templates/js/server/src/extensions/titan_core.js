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
    // Response API (Dual-Signature)
    // -----------------------------
    // Supports TWO calling conventions for compatibility with fast-path parser:
    //
    //   Positional (legacy):
    //     t.response.json(data, 201, { "X-Custom": "val" })
    //
    //   Options object (preferred — matches fast-path syntax):
    //     t.response.json(data, { status: 201, headers: { "X-Custom": "val" } })
    //
    // The fast-path scanner parses the source code and expects the options-object
    // form. Using the positional form works at runtime but won't be detected by
    // fast-path. The options-object form works in BOTH paths.
    //
    // Internal helper to normalize the second argument:
    function _parseResponseOpts(secondArg, thirdArg) {
        let status = 200;
        let extraHeaders = {};

        if (secondArg !== undefined && secondArg !== null && typeof secondArg === 'object') {
            // Options object form: { status: N, headers: {...} }
            status = secondArg.status || 200;
            extraHeaders = secondArg.headers || {};
            // Also merge thirdArg if provided (defensive)
            if (thirdArg && typeof thirdArg === 'object') {
                extraHeaders = { ...extraHeaders, ...thirdArg };
            }
        } else {
            // Positional form: (status, extraHeaders)
            status = secondArg || 200;
            extraHeaders = thirdArg || {};
        }

        return { status, extraHeaders };
    }

    const titanResponse = {
        json(data, second, third) {
            const { status, extraHeaders } = _parseResponseOpts(second, third);
            return {
                _isResponse: true,
                status,
                headers: { "Content-Type": "application/json", ...extraHeaders },
                body: JSON.stringify(data)
            };
        },
        text(data, second, third) {
            const { status, extraHeaders } = _parseResponseOpts(second, third);
            return {
                _isResponse: true,
                status,
                headers: { "Content-Type": "text/plain", ...extraHeaders },
                body: String(data)
            };
        },
        html(data, second, third) {
            const { status, extraHeaders } = _parseResponseOpts(second, third);
            return {
                _isResponse: true,
                status,
                headers: { "Content-Type": "text/html", ...extraHeaders },
                body: String(data)
            };
        },
        redirect(url, second, third) {
            const { status: rawStatus, extraHeaders } = _parseResponseOpts(second, third);
            // For redirects, default to 302 and ensure 3xx range
            let status = rawStatus;
            if (status < 300 || status >= 400) status = 302;
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