import { log } from "@titanpl/native";

export function getuser(req) {
    log("Handling user request...");
    return {
        message: "Hello from JavaScript action!",
        user_id: req.params.id
    };
}
