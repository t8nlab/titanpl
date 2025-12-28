export function hello(req) {
    return {
        message: `Hello from Titan ${req.name}`,
    };
}
