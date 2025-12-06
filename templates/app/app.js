import t from "../titan/titan.js";




t.post("/getname").action("getname") // pass a json payload { "name": "titan" }

t.get("/").reply("Ready to land on Titan 🚀");

t.start(3000, "Titan Running!");
