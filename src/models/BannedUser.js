const mongoose = require("mongoose");

const BannedUserSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  reason: { type: String, default: "" },
  bannedBy: { type: Number, required: true },
  bannedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("BannedUser", BannedUserSchema);
