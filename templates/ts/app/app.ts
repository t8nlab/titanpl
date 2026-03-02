import t from "@titanpl/route";

t.get("/user/:id<number>").action("getuser") // pass a json payload { "name": "titan" }

t.get("/").reply("Ready to land on Titan Planet 🚀");

t.start(5100, "Titan Running!");
