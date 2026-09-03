const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * THE BIG DESIGN DECISION IN THIS WHOLE CONVERSION
 * -------------------------------------------------
 * In Postgres, one entrepreneur's data is spread across four tables:
 * entrepreneurs, services, entrepreneur_services (the join table), and
 * ratings — linked by foreign keys, combined at query time with JOIN.
 *
 * MongoDB doesn't have joins the same way (it has $lookup in aggregation
 * pipelines, but it's slower and more awkward than a real relational
 * join). Instead, the idiomatic MongoDB move for data that's always read
 * and written together is to EMBED it directly in the parent document.
 *
 * An entrepreneur's services and reviews are never useful without the
 * entrepreneur they belong to, and nothing in this app needs "all
 * ratings across every entrepreneur" as a single query. So here, both
 * live as arrays right inside the Entrepreneur document. One
 * `Entrepreneur.findById()` call gets you an entire profile — no joins,
 * no second query.
 *
 * The cost of that choice: anything that WAS a simple global table (like
 * "list every distinct service anyone offers") now needs an aggregation
 * pipeline that unwinds the array across every document. See
 * getAllServices() in repository.js for what that trade actually looks
 * like in practice.
 */

// { _id: false } — a Mongoose option meaning "don't give each service its
// own ObjectId". These are only ever read/written as part of their parent
// entrepreneur, so a separate id per service would just be unused noise.
const ServiceOfferedSchema = new Schema(
  {
    name: { type: String, required: true, lowercase: true, trim: true },
    category: { type: String, default: "service" },
    type: { type: String, default: "service" },
    description: { type: String, default: "" },
    price: { type: Number, default: 0 },
    deliveryAvailable: { type: Boolean, default: false },
  },
  { _id: false }
);

// Ratings DO keep their _id (the default — we don't disable it here),
// because the admin moderation tools (hide/unhide/delete a specific
// review) need to address one review directly without knowing which
// entrepreneur it belongs to. Mongo's ObjectIds are globally unique, so
// `Entrepreneur.findOne({ "ratings._id": someId })` works even though
// ratings live nested inside many different documents.
// FIX: socialPlatforms used to be declared as `[String]` here, but the
// frontend has always sent (and expected back) an array of
// {platform, handle} objects — e.g. { platform: "instagram", handle:
// "@janes_bakery" }. Mongoose tried to cast each incoming object down
// to a plain string on every save, which throws a CastError. Worse,
// because nothing in this app caught that error before now (see
// middleware/asyncHandler.js), it didn't just fail that one request —
// it crashed the entire server process for every user. This schema now
// matches what's actually being sent.
const SocialPlatformSchema = new Schema(
  {
    platform: { type: String, required: true }, // e.g. "instagram", "twitter", "facebook"
    handle: { type: String, default: "" },
  },
  { _id: false }
);

const RatingSchema = new Schema({
  raterTelegramId: { type: Number, required: true },
  score: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: "" },
  raterName: { type: String, default: "" },
  hidden: { type: Boolean, default: false }, // moderation flag, see repository.js hideReview()
  createdAt: { type: Date, default: Date.now },
});

const EntrepreneurSchema = new Schema({
  // unique + index: Mongo enforces one document per Telegram user and
  // builds a fast lookup index on this field, same job as Postgres's
  // `telegram_id BIGINT UNIQUE`.
  telegramId: { type: Number, required: true, unique: true, index: true },
  telegramUsername: String,

  name: { type: String, required: true },
  description: { type: String, default: "" },
  socials: String,
  socialPlatforms: { type: [SocialPlatformSchema], default: [] },
  phone: String,
  email: String,

  photoFileId: String,   // a Telegram-hosted file id (free to store, Telegram serves the image)
  photoBase64: String,   // fallback: the image itself, base64-encoded, stored directly in the document
  gallery: { type: [String], default: [] },

  businessAddress: String,
  website: String,
  homeAddress: String,
  businessType: { type: String, default: "" },

  // "freelancer" has a public listing; "customer" only browses/rates/favorites.
  userType: { type: String, enum: ["freelancer", "customer"], default: "freelancer" },

  phoneVerified: { type: Boolean, default: false },
  identityVerified: { type: Boolean, default: false },
  verifiedAt: Date,

  // A plain sub-object rather than a schema of its own — it's small,
  // always read/written as a unit, and never queried independently.
  location: {
    lat: Number,
    lng: Number,
    capturedAt: Date,
  },

  suspended: { type: Boolean, default: false },     // moderation: hide without deleting
  // Time-based suspension: when set and in the future, the listing is
  // treated as suspended even if `suspended` above is false — this lets
  // an admin set a suspension that lifts itself instead of requiring a
  // manual unsuspend later. `suspended` (the plain boolean) still exists
  // for an indefinite/manual suspension with no set end time; the two
  // are combined in isCurrentlySuspended() in repository.js, which is
  // the one place that should ever be used to check "is this actually
  // suspended right now" — don't read either field alone elsewhere.
  suspendedUntil: { type: Date, default: null },
  forceFeatured: { type: Boolean, default: false }, // admin override for the Home "Featured" section
  plan: { type: String, default: "free" },
  planExpiresAt: Date,

  services: { type: [ServiceOfferedSchema], default: [] },
  ratings: { type: [RatingSchema], default: [] },

  createdAt: { type: Date, default: Date.now },
});

// A MongoDB text index — lets one query search across all three fields
// at once (used for the "match by name/address/description" branch of
// findByService()) roughly like Postgres's `LIKE '%...%'` scan did, but
// as a proper index instead of a full table scan.
EntrepreneurSchema.index({ name: "text", businessAddress: "text", description: "text" });

module.exports = mongoose.model("Entrepreneur", EntrepreneurSchema);
