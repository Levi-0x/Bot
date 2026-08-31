const mongoose = require("mongoose");

const PhoneVerificationSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  phone: { type: String, required: true },
  verifiedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("PhoneVerification", PhoneVerificationSchema);
