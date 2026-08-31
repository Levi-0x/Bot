const mongoose = require("mongoose");

// A small, independent reference collection — categories aren't owned by
// any one entrepreneur, so unlike services/ratings they stay as their
// own top-level collection rather than being embedded.
const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  icon: { type: String, default: "" },
  color: { type: String, default: "" },
});

module.exports = mongoose.model("Category", CategorySchema);
