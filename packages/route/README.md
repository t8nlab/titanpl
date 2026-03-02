# @titanpl/route

The declarative Routing DSL for Titan Planet.

## What it works (What it does)
This is a zero-runtime-overhead DSL used to define your backend API routes. It captures routing metadata that the Titan engine uses to static-map requests directly to your actions.

## How it works
Import `t` and use it to define your endpoints.

```javascript
import t from "@titanpl/route";

// Define an action-based route
t.post("/hello").action("hello"); // pass a json payload { "name": "titan" }

// Define a direct reply route
t.get("/").reply("Ready to land on Titan Planet 🚀");

// Configure the server
t.start(5100, "Titan Running!");
```

**Important Note:** Currently, Titan Planet and its entire package ecosystem are only for Windows. The Linux version is in development (dev only) for the new architecture and will be launched later.
