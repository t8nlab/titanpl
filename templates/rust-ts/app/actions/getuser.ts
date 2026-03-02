import { log, defineAction } from "@titanpl/native";

export const getuser = defineAction((req: any) => {
    log("Handling user request...");
    return {
        message: "Hello from TypeScript action!",
        user_id: req.params.id
    };
});
