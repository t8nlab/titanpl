import t from "../titan/titan";




t.post("/hello").action("hello") // pass a json payload { "name": "titan" }

t.get("/").reply("Ready to land on Titan Planet 🚀");

t.start(5100, "Titan Running!");
