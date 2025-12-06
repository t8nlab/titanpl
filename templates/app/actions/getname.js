function getname(req) {
    const name = req.name;
    return { name: name, msg: "It's a demo action on titan" }
}

globalThis.getname = getname;