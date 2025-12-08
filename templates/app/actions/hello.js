function hello(req) {
    return { "name": `${req.name || "user"}`, msg: `welcome to titan planet ${req.name || "user"}` }
}

globalThis.hello = hello;