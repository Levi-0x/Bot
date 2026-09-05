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
  // MONGODB_URI, not MONGODB_URL — this previously read MONGODB_URL,
  // which doesn't match this project's actual convention (see
  // .env.example, and the very first fix made to this codebase). If
  // your Render env var is genuinely named MONGODB_URI (it should be)
  // and this file was reading MONGODB_URL instead, every connection was
  // silently falling through to whatever MONGODB_URL happened to
  // resolve to instead — which, if set to anything at all (even a
  // stray leftover from testing), would connect successfully to a
  // DIFFERENT, likely-empty database with no crash and no error, while
  // your real data sat untouched under MONGODB_URI. That matches
  // "the app opened fine but acted like I'd never registered" exactly:
  // a clean connection to the wrong place, not a failed connection.
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/growthhub";
  if (!process.env.MONGODB_URI) {
    console.warn("MONGODB_URI is not set — falling back to a local MongoDB. " +
      "If this is running on Render, that's almost certainly wrong; double-check the env var name and value in the dashboard.");
  }
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");
  await repo.initDb(); // seeds default categories — same role as init_db() in Python
}

module.exports = { connect };
