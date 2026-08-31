const mongoose = require("mongoose");

// One row per search, kept purely for the admin analytics dashboard
// (popular queries, searches-per-day). Nothing else in the app reads
// from this collection.
const SearchLogSchema = new mongoose.Schema({
  query: { type: String, required: true },
  resultCount: { type: Number, default: 0 },
  userTelegramId: Number,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SearchLog", SearchLogSchema);
