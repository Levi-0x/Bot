// config/db.js
// Equivalent to database.py's get_connection()/init_db() pairing — but
// with one real difference worth understanding: the Postgres version
// opens a fresh connection per request (via a Python context manager),
// while Mongoose keeps ONE pooled connection open for the app's whole
// lifetime. mongoose.connect() here isn't "connect for this request" —
// it's "set up the pool once at boot," and every query anywhere else in
// the app reuses it automatically without needing to pass a connection
// object around.
const mongoose = require("mongoose");
const repo = require("../repository");

async function connect() {
  const uri = process.env.MONGODB_URL || "mongodb://localhost:27017/growthhub";
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");
  await repo.initDb(); // seeds default categories — same role as init_db() in Python
}

module.exports = { connect };
