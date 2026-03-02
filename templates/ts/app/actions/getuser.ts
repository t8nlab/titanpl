import { log, defineAction } from "@titanpl/native";

export const getuser = defineAction((req) => {
    log("Handling user request...");
    return {
        message: "Hello from TypeScript action!",
        user_id: req.params.id
    };
});
