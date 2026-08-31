const mongoose = require("mongoose");

// Favorites stay as their own collection rather than embedded, because a
// favorite links an arbitrary Telegram user (who might just be browsing,
// not registered as an entrepreneur) to a listing — it doesn't belong
// inside either side of that relationship.
const FavoriteSchema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true },
  // `ref: "Entrepreneur"` tells Mongoose what this ObjectId points to,
  // which is what makes `.populate()` possible later if it's ever needed
  // (this codebase fetches manually instead — see getFavorites() in
  // repository.js — but the ref is still useful documentation).
  entrepreneurId: { type: mongoose.Schema.Types.ObjectId, ref: "Entrepreneur", required: true },
  createdAt: { type: Date, default: Date.now },
});

// A compound unique index — Mongo will reject a second favorite with the
// same (user, entrepreneur) pair at the database level, the same
// guarantee Postgres's UNIQUE(user_telegram_id, entrepreneur_id) gave us.
// This is what lets addFavorite() just try the insert and treat a
// duplicate-key error as "already favorited" instead of checking first.
FavoriteSchema.index({ userTelegramId: 1, entrepreneurId: 1 }, { unique: true });

module.exports = mongoose.model("Favorite", FavoriteSchema);
