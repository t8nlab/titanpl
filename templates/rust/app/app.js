import t from "../titan/titan.js";




t.post("/hello").action("hello") // pass a json payload { "name": "titan" }
t.get("/rust").action("rust_hello") // This route uses a rust action

t.get("/").reply("Ready to land on Titan Planet 🚀");

t.start(3000, "Titan Running!");
