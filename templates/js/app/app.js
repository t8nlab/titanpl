import t from "@titanpl/route";

t.get("/user/:id<number>").action("getuser") // user/123

t.get("/").reply("Ready to land on Titan Planet 🚀");

t.start(5100, "Titan Running!");
