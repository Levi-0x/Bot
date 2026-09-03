/**
 * repository.js — GrowthHub data layer (MongoDB / Mongoose)
 *
 * This is the Node/Mongo equivalent of database.py, kept in the same
 * order (section by section) so it can be read side-by-side with the
 * Python original. See models/Entrepreneur.js first — the embedding
 * decision made there is why a lot of the code below looks different
 * from a literal SQL translation.
 *
 * Every function returns data shaped in snake_case (avg_rating, not
 * avgRating) to match server.py's existing JSON responses exactly, so
 * the current webapp/app.js frontend can point at this backend with
 * zero changes. Internally, Mongoose schemas use camelCase (JS
 * convention) — the translation between the two happens once, in the
 * toListItem()/toFullProfile() helpers below, rather than scattered
 * throughout every route.
 */

const Entrepreneur = require("./models/Entrepreneur");
const Category = require("./models/Category");
const Favorite = require("./models/Favorite");
const PhoneVerification = require("./models/PhoneVerification");
const Admin = require("./models/Admin");
const SearchLog = require("./models/SearchLog");
const AdminAction = require("./models/AdminAction");
const Notification = require("./models/Notification");
const BannedUser = require("./models/BannedUser");
const { stem } = require("./lib/stem");
const { haversineKm } = require("./lib/geo");

const DEFAULT_CATEGORIES = [
  ["home services", "🏠", "#0F9B8E"],
  ["digital services", "💻", "#4A6FA5"],
  ["creative", "🎨", "#FCA311"],
  ["health & wellness", "💚", "#2ECC71"],
  ["education", "📚", "#9B59B6"],
  ["food & catering", "🍽", "#E74C3C"],
  ["transport", "🚗", "#3498DB"],
  ["fashion & beauty", "👗", "#E91E63"],
  ["repair & maintenance", "🔧", "#F39C12"],
  ["other", "📦", "#95A5A6"],
];

// ---------- Setup ----------

// In Postgres, init_db() runs CREATE TABLE IF NOT EXISTS for every table.
// Mongoose doesn't need that — collections are created automatically the
// first time something is written to them. The only real equivalent left
// is seeding the default categories once, the first time the app boots
// against an empty database.
async function initDb() {
  const count = await Category.countDocuments();
  if (count === 0) {
    await Category.insertMany(
      DEFAULT_CATEGORIES.map(([name, icon, color]) => ({ name, icon, color })),
      { ordered: false } // keep inserting the rest even if one somehow collides
    ).catch(() => {});
  }
}

// ---------- Shared helpers ----------

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

// Mirrors "ROUND(AVG(score), 1) ... FILTER (WHERE hidden IS NOT TRUE)" —
// since ratings are a plain embedded array here (not a SQL aggregate),
// this is just a JS filter + reduce instead of a database-side AVG().
function computeRatingStats(ratings) {
  const visible = (ratings || []).filter((r) => !r.hidden);
  if (visible.length === 0) return { avg_rating: null, rating_count: 0 };
  const sum = visible.reduce((s, r) => s + r.score, 0);
  return { avg_rating: round1(sum / visible.length), rating_count: visible.length };
}

// The list-view shape (Home / Explore / Favorites cards) — services
// collapse to just their names, matching what SQL's STRING_AGG produced
// for the same views. A card doesn't need each service's full price and
// description, just enough to show as tags.
function toListItem(doc, distanceKm) {
  const stats = computeRatingStats(doc.ratings);
  const out = {
    id: doc._id.toString(), // Mongo's ObjectId isn't a plain string by default — always convert before sending JSON
    name: doc.name,
    description: doc.description || "",
    socials: doc.socials || "",
    social_platforms: (doc.socialPlatforms || []).map(sp => ({ platform: sp.platform, handle: sp.handle })),
    phone: doc.phone || "",
    email: doc.email || "",
    business_address: doc.businessAddress || "",
    website: doc.website || "",
    photo_file_id: doc.photoFileId || "",
    // Presence flag only — never the actual image bytes. The real photo
    // is fetched separately via /api/photo/:id (see photoUrl() in
    // app.js) so list/profile responses don't balloon with embedded
    // base64 data. This field was previously missing entirely — the
    // upload always saved correctly, but was never serialized into any
    // API response, so an uploaded photo silently never showed up
    // anywhere (Home, Explore, Favorites, Profile, welcome banner).
    photo_base64: !!doc.photoBase64,
    gallery: doc.gallery || [],
    business_type: doc.businessType || "",
    user_type: doc.userType,
    phone_verified: doc.phoneVerified,
    created_at: doc.createdAt,
    services: (doc.services || []).map((s) => s.name),
    ...stats,
  };
  if (distanceKm != null) out.distance_km = round1(distanceKm);
  return out;
}

// The full-profile shape (detail view, own profile, admin view) —
// services expand into full objects here, since a profile page needs
// each one's price and description, not just its name.
function toFullProfile(doc, { includePrivate = false } = {}) {
  const stats = computeRatingStats(doc.ratings);
  const out = {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description || "",
    socials: doc.socials || "",
    social_platforms: (doc.socialPlatforms || []).map(sp => ({ platform: sp.platform, handle: sp.handle })),
    phone: doc.phone || "",
    email: doc.email || "",
    business_address: doc.businessAddress || "",
    website: doc.website || "",
    photo_file_id: doc.photoFileId || "",
    // Presence flag only — never the actual image bytes. The real photo
    // is fetched separately via /api/photo/:id (see photoUrl() in
    // app.js) so list/profile responses don't balloon with embedded
    // base64 data. This field was previously missing entirely — the
    // upload always saved correctly, but was never serialized into any
    // API response, so an uploaded photo silently never showed up
    // anywhere (Home, Explore, Favorites, Profile, welcome banner).
    photo_base64: !!doc.photoBase64,
    gallery: doc.gallery || [],
    business_type: doc.businessType || "",
    user_type: doc.userType,
    phone_verified: doc.phoneVerified,
    identity_verified: doc.identityVerified,
    telegram_username: doc.telegramUsername || "",
    created_at: doc.createdAt,
    services: (doc.services || []).map((s) => ({
      name: s.name,
      type: s.type,
      description: s.description,
      price: s.price,
      delivery_available: s.deliveryAvailable,
    })),
    ...stats,
  };
  // telegram_id, home_address, suspended, and saved_location are only
  // ever meant for the profile owner or an admin — a stranger viewing
  // someone's public listing should never receive precise coordinates
  // for where they registered from. This flag is how the same helper
  // serves both the public detail route and the "my profile"/admin
  // routes without duplicating the whole object shape twice.
  if (includePrivate) {
    out.telegram_id = doc.telegramId;
    out.home_address = doc.homeAddress || "";
    out.suspended = isCurrentlySuspended(doc);
    out.suspended_until = doc.suspendedUntil || null;
    if (doc.location && doc.location.lat != null && doc.location.lng != null) {
      out.saved_location = { lat: doc.location.lat, lng: doc.location.lng };
    }
  }
  return out;
}

// The single source of truth for "is this listing suspended right now."
// A listing can be suspended two ways: indefinitely (`suspended: true`,
// `suspendedUntil: null`) or for a set duration (`suspended: true`,
// `suspendedUntil` set to when it lifts). Once `suspendedUntil` is in
// the past, it's no longer suspended even though the boolean flag is
// still `true` on the document — nothing goes back and flips that flag
// automatically, so never read `doc.suspended` alone anywhere. This
// function (and notSuspendedFilter() below, its query-side equivalent)
// are the only two places that should ever decide this.
function isCurrentlySuspended(doc) {
  if (!doc.suspended) return false;
  if (doc.suspendedUntil == null) return true; // indefinite suspension
  return doc.suspendedUntil > new Date();
}

// Query-side equivalent of isCurrentlySuspended() above, for filtering
// listings OUT of public queries (search, top, recent, featured,
// favorites, single-listing lookup). Spread into any filter object
// alongside other conditions, e.g. { userType: "freelancer",
// ...notSuspendedFilter() } — Mongo ANDs a plain field with a top-level
// $or automatically, no extra $and wrapper needed.
function notSuspendedFilter() {
  return {
    $or: [
      { suspended: { $ne: true } },
      { suspendedUntil: { $ne: null, $lte: new Date() } },
    ],
  };
}

// ---------- Entrepreneur registration ----------

// A whitelist of which incoming fields are actually allowed to be
// written — the same defensive move server.py's register_entrepreneur
// makes. Without it, a client could send arbitrary extra JSON keys and
// have them land straight on the document.
const ALLOWED_FIELDS = new Set([
  "name", "socials", "phone", "email", "photoFileId", "photoBase64",
  "gallery", "businessAddress", "website", "homeAddress",
  "phoneVerified", "socialPlatforms", "description", "businessType",
  "userType", "location", "telegramUsername",
]);

async function registerEntrepreneur(telegramId, fields, serviceNames) {
  const update = {};
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(k)) update[k] = v;
  }

  const verified = await PhoneVerification.findOne({ telegramId });
  if (verified) {
    update.phone = verified.phone;
    update.phoneVerified = true;
  }

  const services = (serviceNames || [])
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
    .map((name) => ({ name }));
  update.services = services; // an empty array here still overwrites — same "wipe then reinsert" behaviour as the SQL version

  // findOneAndUpdate with upsert:true is doing two jobs SQL needed a
  // separate SELECT + INSERT-or-UPDATE for: if a document matching the
  // filter exists, update it; if not, create one. $setOnInsert only
  // applies on the "create" branch, so telegramId doesn't get
  // needlessly rewritten on every edit.
  const doc = await Entrepreneur.findOneAndUpdate(
    { telegramId },
    { $set: update, $setOnInsert: { telegramId } },
    { new: true, upsert: true } // new:true returns the document AFTER the update, not before
  );
  return doc._id.toString();
}

// ---------- Searching ----------

async function getTopEntrepreneurs(limit = 5) {
  const docs = await Entrepreneur.find({ userType: "freelancer", ...notSuspendedFilter() });
  return docs
    .map((d) => toListItem(d))
    .sort((a, b) => (b.avg_rating ?? -1) - (a.avg_rating ?? -1) || b.rating_count - a.rating_count)
    .slice(0, limit);
}

async function getRecentEntrepreneurs(limit = 10) {
  const docs = await Entrepreneur.find({ userType: "freelancer", ...notSuspendedFilter() })
    .sort({ createdAt: -1 })
    .limit(limit);
  return docs.map((d) => toListItem(d));
}

async function getFeaturedEntrepreneurs(limit = 10) {
  const docs = await Entrepreneur.find({ userType: "freelancer", ...notSuspendedFilter() });
  return docs
    .map((d) => ({ doc: d, item: toListItem(d) }))
    .filter(({ doc, item }) => doc.forceFeatured || (item.avg_rating >= 4.0 && item.rating_count >= 3))
    .sort((a, b) => {
      if (a.doc.forceFeatured !== b.doc.forceFeatured) return a.doc.forceFeatured ? -1 : 1;
      return b.item.rating_count - a.item.rating_count || (b.item.avg_rating ?? 0) - (a.item.avg_rating ?? 0);
    })
    .slice(0, limit)
    .map(({ item }) => item);
}

// The clearest example of the embedding trade-off mentioned at the top
// of this file. In SQL, "list every distinct service, with how many
// entrepreneurs offer each one" was a single GROUP BY on a real table.
// Here, services live inside each entrepreneur's document, so getting
// the same answer means an aggregation PIPELINE — a sequence of steps
// piped into each other, similar in spirit to chaining .filter().map()
// in JS, but running inside MongoDB itself instead of in Node:
//   1. $match   — only freelancers, not suspended (same as a WHERE clause)
//   2. $unwind  — turn each entrepreneur's `services` ARRAY into one
//                 separate document PER service (so a person offering 3
//                 services becomes 3 rows here, each with one service)
//   3. $group   — collapse back down by service NAME, counting how many
//                 unwound rows shared that name (that count is
//                 entrepreneur_count)
//   4. $project — reshape the output field names to match the JSON the
//                 frontend expects
async function getAllServices() {
  return Entrepreneur.aggregate([
    { $match: { userType: "freelancer", ...notSuspendedFilter() } },
    { $unwind: "$services" },
    {
      $group: {
        _id: "$services.name",
        category: { $first: "$services.category" },
        type: { $first: "$services.type" },
        description: { $first: "$services.description" },
        price: { $first: "$services.price" },
        delivery_available: { $first: "$services.deliveryAvailable" },
        entrepreneur_count: { $sum: 1 },
      },
    },
    { $project: { _id: 0, name: "$_id", category: 1, type: 1, description: 1, price: 1, delivery_available: 1, entrepreneur_count: 1 } },
    { $sort: { category: 1, name: 1 } },
  ]);
}

async function getCategories() {
  const docs = await Category.find().sort({ name: 1 });
  return docs.map((c) => ({ id: c._id.toString(), name: c.name, icon: c.icon, color: c.color }));
}
const getAllCategories = getCategories; // same duplication that exists in database.py, kept for parity

async function getServicesByCategory(category) {
  const all = await getAllServices();
  return all.filter((s) => s.category === category);
}

// Direct port of find_by_service(), including its two-part matching
// logic: match by SERVICE (fuzzy name/stem match against the catalog)
// OR match by the entrepreneur's own name/address/description.
async function findByService(query, { category = "", serviceType = "", lat = null, lng = null, maxDistanceKm = null, limit = 20, offset = 0 } = {}) {
  const queryLower = query.trim().toLowerCase();
  const queryStem = stem(query);

  // Same approach as the Python version: pull the whole service catalog
  // into memory and filter it in JS with the stemmer, rather than trying
  // to express "fuzzy substring-or-stem match" as a Mongo query. Fine at
  // this app's scale; would need rethinking (e.g. a real search index)
  // if the catalog grew into the tens of thousands.
  const allServices = await getAllServices();
  const matchingServiceNames = allServices
    .filter((s) => {
      const nameMatch = s.name.toLowerCase().includes(queryLower) || queryStem.includes(stem(s.name)) || stem(s.name).includes(queryStem);
      const categoryOk = !category || s.category === category;
      const typeOk = !serviceType || s.type === serviceType;
      return nameMatch && categoryOk && typeOk;
    })
    .map((s) => s.name);

  const baseFilter = { userType: "freelancer", ...notSuspendedFilter() };
  // $or — match ANY of these conditions, the Mongo equivalent of SQL's OR.
  const orClauses = [
    { name: new RegExp(escapeRegex(queryLower), "i") },           // "i" = case-insensitive
    { businessAddress: new RegExp(escapeRegex(queryLower), "i") },
    { description: new RegExp(escapeRegex(queryLower), "i") },
  ];
  // "services.name": { $in: [...] } reaches INSIDE the embedded array —
  // Mongo matches a document if ANY element of that array has a name in
  // the list, without needing to unwind anything for a simple filter
  // like this (aggregation's $unwind is only needed for grouping/counting).
  if (matchingServiceNames.length) orClauses.push({ "services.name": { $in: matchingServiceNames } });

  let docs = await Entrepreneur.find({ ...baseFilter, $or: orClauses });

  let items = docs.map((d) => {
    let distanceKm = null;
    if (lat != null && lng != null && d.location && d.location.lat != null && d.location.lng != null) {
      distanceKm = haversineKm(lat, lng, d.location.lat, d.location.lng);
    }
    return { item: toListItem(d, distanceKm), distanceKm };
  });

  if (lat != null && lng != null) {
    if (maxDistanceKm) items = items.filter((x) => x.distanceKm != null && x.distanceKm <= maxDistanceKm);
    items.sort((a, b) => {
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm || (b.item.avg_rating ?? 0) - (a.item.avg_rating ?? 0);
    });
  } else {
    items.sort((a, b) => (b.item.avg_rating ?? -1) - (a.item.avg_rating ?? -1) || b.item.rating_count - a.item.rating_count);
  }

  const total = items.length;
  const page = items.slice(offset, offset + limit).map((x) => x.item);
  return { results: page, total };
}

// Regexes are Mongo's rough equivalent of SQL's LIKE '%...%' — but since
// the search text comes from a user, any regex special characters in it
// (., *, +, etc.) need escaping first, or a search for "c++" could throw
// or match things it shouldn't.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- Ratings ----------

async function rateEntrepreneurById(entrepreneurId, raterTelegramId, score, comment = "", raterName = "") {
  const doc = await Entrepreneur.findById(entrepreneurId);
  if (!doc) return { success: false, reason: "not_found" };

  if (doc.telegramId === raterTelegramId) return { success: false, reason: "self_rating" };

  // .find() on a plain JS array here — `doc.ratings` is a real, in-memory
  // array once the document is loaded, so ordinary array methods work on
  // it directly (this is different from querying; we already have the
  // whole document, we're just reading/mutating a field on it).
  const existing = doc.ratings.find((r) => r.raterTelegramId === raterTelegramId);
  if (existing) {
    existing.score = score;
    existing.comment = comment;
    existing.raterName = raterName;
    existing.createdAt = new Date();
  } else {
    doc.ratings.push({ raterTelegramId, score, comment, raterName });
  }
  await doc.save(); // .save() writes the ENTIRE document back — fine at this scale, see hideReview() below for the more surgical alternative
  return { success: true, reason: "ok" };
}

async function getReviews(entrepreneurId, limit = 50) {
  const doc = await Entrepreneur.findById(entrepreneurId);
  if (!doc) return [];
  return doc.ratings
    .filter((r) => !r.hidden)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((r) => ({ score: r.score, comment: r.comment, rater_name: r.raterName, created_at: r.createdAt }));
}

// ---------- Favorites ----------

async function addFavorite(userTelegramId, entrepreneurId) {
  const doc = await Entrepreneur.findById(entrepreneurId);
  if (!doc) return { success: false, reason: "not_found" };
  if (doc.telegramId === userTelegramId) return { success: false, reason: "self_favorite" };
  try {
    await Favorite.create({ userTelegramId, entrepreneurId });
    return { success: true };
  } catch {
    // The unique compound index on Favorite (see models/Favorite.js)
    // makes a duplicate favorite throw here instead of silently
    // succeeding — we just treat that as "already favorited."
    return { success: false, reason: "already_favorited" };
  }
}

async function removeFavorite(userTelegramId, entrepreneurId) {
  const res = await Favorite.deleteOne({ userTelegramId, entrepreneurId });
  return res.deletedCount > 0;
}

async function isFavorited(userTelegramId, entrepreneurId) {
  const fav = await Favorite.findOne({ userTelegramId, entrepreneurId });
  return !!fav;
}

async function getFavorites(userTelegramId) {
  const favs = await Favorite.find({ userTelegramId }).sort({ createdAt: -1 });
  // One query for all the entrepreneur documents at once ($in), then
  // matched back up in JS — cheaper than N separate findById() calls in
  // a loop, and it also lets us drop any favorite that points at a
  // listing which got suspended or deleted since it was favorited.
  const docs = await Entrepreneur.find({
    _id: { $in: favs.map((f) => f.entrepreneurId) },
    userType: "freelancer",
    ...notSuspendedFilter(),
  });
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  return favs.map((f) => byId.get(f.entrepreneurId.toString())).filter(Boolean).map((d) => toListItem(d));
}

// ---------- Customer helpers ----------

async function getUserType(telegramId) {
  const doc = await Entrepreneur.findOne({ telegramId }, "userType"); // 2nd arg = projection: only fetch this one field
  return doc ? doc.userType : null;
}

async function countReviewsWritten(telegramId) {
  const result = await Entrepreneur.aggregate([
    { $unwind: "$ratings" },
    { $match: { "ratings.raterTelegramId": telegramId } },
    { $count: "cnt" },
  ]);
  return result[0]?.cnt || 0;
}

async function countFavorites(telegramId) {
  return Favorite.countDocuments({ userTelegramId: telegramId });
}

// ---------- Review moderation ----------
// The positional `$` operator below is the key trick for editing ONE
// element inside an embedded array without rewriting the whole document
// or knowing its parent's id in advance. `{ "ratings._id": reviewId }`
// finds the document containing a rating with that id; Mongo then
// remembers WHICH array element matched, and `"ratings.$.hidden"` means
// "update the `hidden` field of THAT specific matched element."

async function hideReview(reviewId) {
  const res = await Entrepreneur.updateOne({ "ratings._id": reviewId }, { $set: { "ratings.$.hidden": true } });
  return res.modifiedCount > 0;
}

async function unhideReview(reviewId) {
  const res = await Entrepreneur.updateOne({ "ratings._id": reviewId }, { $set: { "ratings.$.hidden": false } });
  return res.modifiedCount > 0;
}

async function deleteReview(reviewId) {
  // $pull removes every array element matching its condition — here,
  // "remove the rating whose _id equals reviewId" from whichever
  // document's ratings array contains it.
  const res = await Entrepreneur.updateOne({ "ratings._id": reviewId }, { $pull: { ratings: { _id: reviewId } } });
  return res.modifiedCount > 0;
}

async function getReviewById(reviewId) {
  const doc = await Entrepreneur.findOne({ "ratings._id": reviewId }, "ratings");
  if (!doc) return null;
  // .id() is a Mongoose-specific helper on array subdocuments — a
  // shortcut for "find the element in this array whose _id matches",
  // so we don't have to write our own .find() after already narrowing
  // down to the right document.
  const r = doc.ratings.id(reviewId);
  if (!r) return null;
  return { id: r._id.toString(), score: r.score, comment: r.comment, rater_name: r.raterName, hidden: r.hidden, created_at: r.createdAt };
}

// durationHours: null/omitted means an indefinite suspension (no
// auto-expiry, must be manually unsuspended). A number sets
// suspendedUntil to that many hours from now — isCurrentlySuspended()
// and notSuspendedFilter() both automatically stop treating this
// listing as suspended once that time passes, no cron job or cleanup
// step needed.
async function suspendListing(entrepreneurId, durationHours = null) {
  const suspendedUntil = durationHours != null && durationHours > 0
    ? new Date(Date.now() + durationHours * 60 * 60 * 1000)
    : null;
  const res = await Entrepreneur.updateOne(
    { _id: entrepreneurId },
    { $set: { suspended: true, suspendedUntil } }
  );
  return res.modifiedCount > 0;
}

async function unsuspendListing(entrepreneurId) {
  const res = await Entrepreneur.updateOne({ _id: entrepreneurId }, { $set: { suspended: false, suspendedUntil: null } });
  return res.modifiedCount > 0;
}

async function logAdminAction(adminTelegramId, action, { targetType = null, targetId = null, details = null } = {}) {
  await AdminAction.create({ adminTelegramId, action, targetType, targetId, details });
}

async function getAdminAuditLog(limit = 50, offset = 0) {
  const docs = await AdminAction.find().sort({ createdAt: -1 }).skip(offset).limit(limit);
  return docs.map((d) => ({
    id: d._id.toString(), admin_telegram_id: d.adminTelegramId, action: d.action,
    target_type: d.targetType, target_id: d.targetId, details: d.details, created_at: d.createdAt,
  }));
}

// Deliberately different from the Python version: admin_get_listing()
// there reuses get_reviews(), which filters out hidden reviews — meaning
// a hidden review becomes unreachable even to the admin who'd need to
// see it again to unhide it. That's a real bug carried over from the SQL
// side; fixed here by giving admins every review, hidden or not.
async function adminGetListing(entrepreneurId) {
  const doc = await Entrepreneur.findById(entrepreneurId);
  if (!doc) return null;
  const profile = toFullProfile(doc, { includePrivate: true });
  profile.reviews = doc.ratings
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r._id.toString(), score: r.score, comment: r.comment,
      rater_name: r.raterName, hidden: r.hidden, created_at: r.createdAt,
    }));
  return profile;
}

async function adminSearchListings(query, limit = 20, offset = 0) {
  const q = new RegExp(escapeRegex(query.trim().toLowerCase()), "i");
  const filter = { $or: [{ name: q }, { email: q }] };
  const total = await Entrepreneur.countDocuments(filter);
  const docs = await Entrepreneur.find(filter).sort({ _id: 1 }).skip(offset).limit(limit);
  const results = docs.map((d) => {
    const stats = computeRatingStats(d.ratings);
    return {
      id: d._id.toString(), name: d.name, email: d.email, user_type: d.userType,
      // telegram_id is normally kept private (see toFullProfile's
      // includePrivate gating) — but this whole function is already
      // authAdmin-only, and an admin needs it here to actually act on a
      // result (suspend/ban already identify by Mongo _id, but "make
      // this person an admin" needs their Telegram ID specifically).
      telegram_id: d.telegramId,
      suspended: isCurrentlySuspended(d), suspended_until: d.suspendedUntil || null,
      // Missing here for a while — the frontend's Feature/Unfeature
      // button label reads r.force_featured to decide which word to
      // show, but with this field absent from the response that check
      // was always falsy, so the button always said "Feature," even
      // for a listing that was already featured, with no way to tell
      // from this list which listings actually were.
      force_featured: !!d.forceFeatured,
      identity_verified: d.identityVerified, phone_verified: d.phoneVerified,
      created_at: d.createdAt, services: (d.services || []).map((s) => s.name), ...stats,
    };
  });
  return { results, total };
}

// Adapted for the embedded schema: merges by SERVICE NAME instead of a
// numeric service_id, since services no longer live in their own global
// table with their own primary key. Every entrepreneur offering
// sourceName gets it renamed to targetName; if they already offer both,
// the duplicate is dropped instead of creating two identical entries.
async function mergeServices(sourceName, targetName) {
  sourceName = sourceName.trim().toLowerCase();
  targetName = targetName.trim().toLowerCase();
  if (!sourceName || !targetName || sourceName === targetName) return { success: false, message: "Invalid service names" };

  const docs = await Entrepreneur.find({ "services.name": sourceName });
  for (const doc of docs) {
    const hasTarget = doc.services.some((s) => s.name === targetName);
    doc.services = doc.services
      .filter((s) => !(s.name === sourceName && hasTarget))
      .map((s) => (s.name === sourceName ? { ...s.toObject(), name: targetName } : s));
    await doc.save();
  }
  return { success: true, message: `Merged "${sourceName}" into "${targetName}" across ${docs.length} listing(s)` };
}

async function addCategory(name, icon = "", color = "") {
  // $setOnInsert + upsert:true here means "create it if it doesn't
  // exist, do nothing if it does" — a clean way to make this endpoint
  // idempotent (calling it twice with the same name isn't an error).
  await Category.updateOne({ name: name.trim().toLowerCase() }, { $setOnInsert: { icon, color } }, { upsert: true });
}

async function deleteCategory(category) {
  // This guard is here on purpose — an earlier version of this feature
  // (on the Python/Postgres side) let admins delete a category that
  // still had real services attached to it, which cascaded into
  // deleting those services outright. Blocking the delete while
  // anything still references the category prevents that class of bug
  // from being possible here at all.
  const all = await getAllServices();
  const inUse = all.filter((s) => s.category === category).length;
  if (inUse > 0) return { success: false, message: `"${category}" still has ${inUse} service(s) using it — reassign or remove those first.` };
  const res = await Category.deleteOne({ name: category });
  if (res.deletedCount === 0) return { success: false, message: `No category named "${category}" found.` };
  return { success: true, message: `Deleted category "${category}".` };
}

async function setForceFeatured(entrepreneurId, featured) {
  const res = await Entrepreneur.updateOne({ _id: entrepreneurId }, { $set: { forceFeatured: !!featured } });
  return res.modifiedCount > 0;
}

async function logSearch(query, resultCount, userTelegramId = null) {
  await SearchLog.create({ query, resultCount, userTelegramId });
}

async function getSearchAnalytics(days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const total = await SearchLog.countDocuments({ createdAt: { $gte: since } });
  const popular = await SearchLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: "$query", cnt: { $sum: 1 } } },
    { $sort: { cnt: -1 } },
    { $limit: 10 },
    { $project: { _id: 0, query: "$_id", cnt: 1 } },
  ]);
  // $dateToString buckets every search's timestamp down to just its
  // calendar day, so grouping by that gives "searches per day" — the
  // Mongo equivalent of SQL's DATE_TRUNC('day', created_at).
  const daily = await SearchLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, cnt: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, day: "$_id", cnt: 1 } },
  ]);
  return { total_searches: total, popular_queries: popular, daily_counts: daily };
}

async function getGrowthAnalytics() {
  const [totalUsers, totalFreelancers, totalCustomers, totalFavorites] = await Promise.all([
    Entrepreneur.countDocuments(),
    Entrepreneur.countDocuments({ userType: "freelancer" }),
    Entrepreneur.countDocuments({ userType: "customer" }),
    Favorite.countDocuments(),
  ]);
  // $size on an array field, summed across all documents — how you count
  // total embedded ratings when there's no separate ratings table to
  // just COUNT(*) on.
  const reviewCountAgg = await Entrepreneur.aggregate([{ $project: { n: { $size: "$ratings" } } }, { $group: { _id: null, total: { $sum: "$n" } } }]);
  const totalReviews = reviewCountAgg[0]?.total || 0;

  const since = new Date(Date.now() - 30 * 86400000);
  const recentRegistrations = await Entrepreneur.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, cnt: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, day: "$_id", cnt: 1 } },
  ]);

  return {
    total_users: totalUsers, total_freelancers: totalFreelancers, total_customers: totalCustomers,
    total_reviews: totalReviews, total_favorites: totalFavorites, recent_registrations: recentRegistrations,
  };
}

// ---------- Notifications ----------

async function sendNotification(userTelegramId, title, body) {
  await Notification.create({ userTelegramId, title, body });
}

async function getNotifications(userTelegramId, limit = 20) {
  const docs = await Notification.find({ userTelegramId }).sort({ createdAt: -1 }).limit(limit);
  return docs.map((d) => ({ id: d._id.toString(), title: d.title, body: d.body, is_read: d.isRead, created_at: d.createdAt }));
}

async function markNotificationsRead(userTelegramId) {
  // updateMany, not updateOne — this needs to flip EVERY unread
  // notification for this user, not just the first match.
  await Notification.updateMany({ userTelegramId, isRead: false }, { $set: { isRead: true } });
}

async function countUnreadNotifications(userTelegramId) {
  return Notification.countDocuments({ userTelegramId, isRead: false });
}

// ---------- Entrepreneur analytics ----------

async function getEntrepreneurAnalytics(telegramId) {
  const doc = await Entrepreneur.findOne({ telegramId });
  if (!doc) return null;
  const favoritesCount = await Favorite.countDocuments({ entrepreneurId: doc._id });
  const stats = computeRatingStats(doc.ratings);
  const searchMentions = await SearchLog.countDocuments({ query: new RegExp(escapeRegex(doc.name), "i") });
  return {
    favorites_count: favoritesCount,
    reviews_count: doc.ratings.length,
    avg_rating: stats.avg_rating,
    search_mentions: searchMentions,
  };
}

// ---------- Monetization prep ----------

async function setListingPlan(telegramId, plan) {
  const update = { plan };
  update.planExpiresAt = plan === "pro" ? new Date(Date.now() + 30 * 86400000) : null;
  await Entrepreneur.updateOne({ telegramId }, { $set: update });
}

async function upgradeToFreelancer(telegramId) {
  await Entrepreneur.updateOne({ telegramId }, { $set: { userType: "freelancer" } });
  return true;
}

// ---------- Profile management ----------

async function getPublicProfile(entrepreneurId, viewerTelegramId = null) {
  const doc = await Entrepreneur.findOne({ _id: entrepreneurId, userType: "freelancer", ...notSuspendedFilter() });
  if (!doc) return null;
  const out = toFullProfile(doc); // includePrivate defaults to false — strangers don't get telegram_id
  // is_owner is derived here (before telegram_id gets stripped by
  // toFullProfile above) so the frontend has a reliable, always-correct
  // way to know "is this my own listing?" without ever exposing the
  // actual telegram_id to a stranger, and without depending on some
  // other page having already been visited this session.
  out.is_owner = viewerTelegramId != null && doc.telegramId === viewerTelegramId;
  return out;
}

async function getPhotoFields(entrepreneurId) {
  const doc = await Entrepreneur.findById(entrepreneurId, "photoFileId photoBase64");
  if (!doc) return null;
  return { photo_file_id: doc.photoFileId, photo_base64: doc.photoBase64 };
}

async function getEntrepreneurProfile(telegramId) {
  const doc = await Entrepreneur.findOne({ telegramId });
  if (!doc) return null;
  return toFullProfile(doc, { includePrivate: true }); // this IS the owner viewing their own data
}

async function forceDeleteByName(name) {
  const q = new RegExp(escapeRegex(name.trim()), "i");
  const doc = await Entrepreneur.findOne({ name: q });
  if (!doc) return { success: false, telegramId: null };
  await Entrepreneur.deleteOne({ _id: doc._id });
  return { success: true, telegramId: doc.telegramId };
}

async function deleteEntrepreneur(telegramId) {
  // Three separate deletes across three collections — this is exactly
  // the kind of multi-step cleanup that's automatic with SQL's
  // ON DELETE CASCADE on a foreign key. Mongo has no cross-collection
  // cascade, so anything that isn't embedded has to be cleaned up by
  // hand here.
  const res = await Entrepreneur.deleteOne({ telegramId });
  await Favorite.deleteMany({ userTelegramId: telegramId });
  await PhoneVerification.deleteOne({ telegramId });
  return res.deletedCount > 0;
}

async function isBanned(telegramId) {
  const doc = await BannedUser.findOne({ telegramId });
  return !!doc;
}

async function banIdentity(telegramId, reason, bannedByTelegramId) {
  // Upsert, not create: if this identity is somehow already on the
  // blocklist (shouldn't normally happen, but a retried request or an
  // old ban re-applied shouldn't throw a duplicate-key error), just
  // refresh the reason/bannedBy/bannedAt rather than failing.
  await BannedUser.updateOne(
    { telegramId },
    { $set: { reason: reason || "", bannedBy: bannedByTelegramId, bannedAt: new Date() } },
    { upsert: true }
  );
}

// Deliberately two separate steps, not one combined query — per the
// spec this implements: recording the block and wiping the account are
// distinct operations so they can be reasoned about (and, if ever
// needed, retried or audited) independently. banIdentity() runs first
// so that even if the delete step fails partway through for some
// reason, the identity is already blocked from creating a new account —
// the safer failure direction, versus a half-deleted-but-still-bannable
// account.
async function banAndDeleteEntrepreneur(entrepreneurId, reason, bannedByTelegramId) {
  const doc = await Entrepreneur.findById(entrepreneurId, "telegramId");
  if (!doc) return { success: false, reason: "not_found" };
  await banIdentity(doc.telegramId, reason, bannedByTelegramId);
  await deleteEntrepreneur(doc.telegramId);
  return { success: true, telegramId: doc.telegramId };
}

async function addServices(telegramId, serviceNames) {
  const doc = await Entrepreneur.findOne({ telegramId });
  if (!doc) return false;
  const existingNames = new Set(doc.services.map((s) => s.name));
  for (const raw of serviceNames) {
    const name = raw.trim().toLowerCase();
    if (name && !existingNames.has(name)) {
      doc.services.push({ name });
      existingNames.add(name);
    }
  }
  await doc.save();
  return true;
}

async function removeServices(telegramId, serviceNames) {
  const doc = await Entrepreneur.findOne({ telegramId });
  if (!doc) return false;
  const toRemove = new Set(serviceNames.map((n) => n.trim().toLowerCase()));
  doc.services = doc.services.filter((s) => !toRemove.has(s.name));
  await doc.save();
  return true;
}

// ---------- Admin ----------

async function getAdminIdsFromDb() {
  const docs = await Admin.find({}, "telegramId");
  return new Set(docs.map((d) => d.telegramId));
}

// Returns true if this created a genuinely new admin row, false if the
// telegramId was already in the collection (upsert with $setOnInsert
// silently no-ops on an existing match, so the caller needs
// upsertedCount specifically to tell those two cases apart).
async function addAdmin(telegramId, addedBy) {
  const res = await Admin.updateOne({ telegramId }, { $setOnInsert: { addedBy } }, { upsert: true });
  return res.upsertedCount > 0;
}

async function removeAdmin(telegramId) {
  const res = await Admin.deleteOne({ telegramId });
  return res.deletedCount > 0;
}

async function getAdminDetails() {
  const admins = await Admin.find({}, "telegramId addedBy addedAt");
  const allIds = admins.map(a => a.telegramId);
  const entrepreneurs = await Entrepreneur.find({ telegramId: { $in: allIds } }, "telegramId name");
  const nameMap = new Map(entrepreneurs.map(e => [e.telegramId, e.name]));
  return admins.map(a => ({
    telegramId: a.telegramId,
    name: nameMap.get(a.telegramId) || null,
    addedBy: a.addedBy,
    addedAt: a.addedAt,
  }));
}

async function getEntrepreneurNames(telegramIds) {
  const entrepreneurs = await Entrepreneur.find({ telegramId: { $in: telegramIds } }, "telegramId name");
  return new Map(entrepreneurs.map(e => [e.telegramId, e.name]));
}

// ---------- Phone verification ----------

async function setVerifiedPhone(telegramId, phone) {
  await PhoneVerification.updateOne({ telegramId }, { $set: { phone, verifiedAt: new Date() } }, { upsert: true });
  await Entrepreneur.updateOne({ telegramId }, { $set: { phone, phoneVerified: true } });
}

async function getPhoneVerification(telegramId) {
  const doc = await PhoneVerification.findOne({ telegramId });
  if (!doc) return null;
  return { phone: doc.phone, verified_at: doc.verifiedAt };
}

// ---------- Stats ----------

async function getStats() {
  const entrepreneurs = await Entrepreneur.countDocuments();
  const servicesAgg = await Entrepreneur.aggregate([
    { $unwind: "$services" },
    { $group: { _id: "$services.name" } },
    { $count: "cnt" },
  ]);
  const ratingsAgg = await Entrepreneur.aggregate([
    { $project: { n: { $size: "$ratings" } } },
    { $group: { _id: null, total: { $sum: "$n" } } },
  ]);
  return {
    entrepreneurs,
    services: servicesAgg[0]?.cnt || 0,
    ratings: ratingsAgg[0]?.total || 0,
  };
}

async function getAllTelegramIds() {
  const docs = await Entrepreneur.find({}, "telegramId");
  return docs.map((d) => d.telegramId);
}

module.exports = {
  initDb, registerEntrepreneur,
  getTopEntrepreneurs, getRecentEntrepreneurs, getFeaturedEntrepreneurs,
  getAllServices, getCategories, getAllCategories, getServicesByCategory, findByService,
  rateEntrepreneurById, getReviews,
  addFavorite, removeFavorite, isFavorited, getFavorites,
  getUserType, countReviewsWritten, countFavorites,
  hideReview, unhideReview, deleteReview, getReviewById,
  suspendListing, unsuspendListing, logAdminAction, getAdminAuditLog,
  adminGetListing, adminSearchListings, mergeServices, addCategory, deleteCategory,
  setForceFeatured, logSearch, getSearchAnalytics, getGrowthAnalytics,
  sendNotification, getNotifications, markNotificationsRead, countUnreadNotifications,
  getEntrepreneurAnalytics, setListingPlan, upgradeToFreelancer,
  getPublicProfile, getPhotoFields, getEntrepreneurProfile,
  forceDeleteByName, deleteEntrepreneur, addServices, removeServices,
  isBanned, banIdentity, banAndDeleteEntrepreneur,
  getAdminIdsFromDb, addAdmin, removeAdmin, getAdminDetails, getEntrepreneurNames,
  setVerifiedPhone, getPhoneVerification,
  getStats, getAllTelegramIds,
};
