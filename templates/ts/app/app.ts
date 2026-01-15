import t from "../titan/titan.js";




t.post("/hello").action("hello") // pass a json payload { "name": "titan" }

t.get("/").reply("Ready to land on Titan Planet 🚀");

t.start(3000, "Titan Running!");
