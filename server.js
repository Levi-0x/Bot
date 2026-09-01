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

/**
 * Global error-handling middleware — the other half of the fix in
 * middleware/asyncHandler.js. Express recognizes this as an error
 * handler specifically because it takes FOUR arguments (err, req, res,
 * next); a normal middleware/route function takes three or fewer. Every
 * wrapped controller and both auth middleware functions call next(err)
 * on failure, and this is where that error actually lands — logged
 * server-side, with a generic message sent to the client (never the raw
 * error, which could leak internal details like a database connection
 * string in a stack trace).
 *
 * This MUST be registered after app.use(routes) — Express only treats
 * error-handling middleware registered after the routes as applying to
 * errors from those routes.
 */
app.use((err, req, res, next) => {
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  if (res.headersSent) return next(err); // a response already started; let Express's default handler close it out
  res.status(500).json({ error: "internal_error" });
});

// Last-resort safety net. With every route and both auth middleware
// functions now wrapped, this should never actually fire from an HTTP
// request — but this catches anything genuinely unexpected (e.g. an
// error in code running outside a request, like the bot's own
// background polling) so it's logged instead of silently taking the
// process down.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

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
