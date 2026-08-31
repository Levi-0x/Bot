/**
 * server.js — GrowthHub Express app
 * -----------------------------------
 * Compare this to the earlier flat version: what used to be 700+ lines
 * of routes living directly in this file is now just one line —
 * `app.use(routes)` — because routes/index.js owns wiring URLs to
 * controllers, and the controllers own what each endpoint actually does.
 * This file's only job now is assembling the pieces and starting them.
 */

require("dotenv").config();
const express = require("express");
const path = require("path");

const routes = require("./src/routes");
const botModule = require("./src/bot");
const { connect } = require("./src/config/db");

const WEBAPP_DIR = path.join(__dirname, "webapp");
const app = express();

app.use(express.json());              // parses incoming JSON bodies into req.body
app.use(express.static(WEBAPP_DIR));  // serves index.html/style.css/app.js as plain files

app.get("/", (req, res) => {
  res.sendFile(path.join(WEBAPP_DIR, "index.html"));
});

app.use(routes); // every /api/* route, from routes/index.js

async function main() {
  await connect();          // opens the Mongo connection pool + seeds categories
  botModule.buildBot();     // starts the bot polling in the background
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`GrowthHub (Node) listening on port ${port}`));
}

// Node's version of Python's `if __name__ == "__main__":` — lets other
// files require() the Express `app` (e.g. for tests) without starting
// the server and the bot every time this file is merely imported.
if (require.main === module) {
  main().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

module.exports = app;
