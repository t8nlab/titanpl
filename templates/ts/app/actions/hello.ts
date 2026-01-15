interface HelloResponse {
    message: string;
}

export const hello = defineAction((req): HelloResponse => {
    return {
        message: `Hello from Titan ${req.body.name || "World"}`,
    };
});
