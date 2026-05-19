export function createExt(extName) {
  const natives = globalThis.t?.[extName];

  if (!natives) {
    throw new Error(`Native extension '${extName}' not found`);
  }

  function requireNative(fnName) {
    const fn = natives[fnName];

    if (typeof fn !== "function") {
      throw new Error(
        `Native binding '${fnName}' not found in '${extName}'`
      );
    }

    return fn;
  }

  function callNative(fnName, payload = {}) {
    const invoke = requireNative("titan_invoke");

    if (typeof invoke === "function") {
      const jsonStr = JSON.stringify({
        fn: fnName,
        data: payload,
      });

      const raw = invoke(jsonStr);

      if (raw === undefined || raw === null) {
        throw new Error(
          `Native binding 'titan_invoke' returned ${raw === null ? "null" : "undefined"} in '${extName}'`
        );
      }

      const res = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!res || res.ok === false) {
        throw new Error(res?.error || "Native execution error or invalid response");
      }

      return res?.value;
    }

    throw new Error(`Extension '${extName}' does not provide 'titan_invoke'`);
  }

  return {
    call: callNative,
    require: requireNative,
    raw: natives,
  };
}
