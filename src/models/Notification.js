const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Notification", NotificationSchema);
