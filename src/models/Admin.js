const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  addedBy: Number,
  addedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Admin", AdminSchema);
