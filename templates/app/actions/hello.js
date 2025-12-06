function hello(req) {
    const name = req.name;
    return { name: name, msg: `Hello ${name}` }
}

globalThis.hello = hello;