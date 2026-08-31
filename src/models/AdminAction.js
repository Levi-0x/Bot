const mongoose = require("mongoose");

// The audit log: one row per admin action, so if two or more admins are
// moderating the same directory, there's a record of who did what.
const AdminActionSchema = new mongoose.Schema({
  adminTelegramId: { type: Number, required: true },
  action: { type: String, required: true }, // e.g. "delete_review", "suspend_listing"
  targetType: String,                        // e.g. "review", "listing", "category"
  targetId: String,
  details: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("AdminAction", AdminActionSchema);
