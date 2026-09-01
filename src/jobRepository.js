/**
 * jobRepository.js — Billboard (job posts) data layer
 * ------------------------------------------------------
 * Kept as its own file rather than folded into repository.js, mostly
 * because repository.js is already large, and this feature is cleanly
 * separable — it never needs to join against Entrepreneur data at the
 * database level (a job post's poster is just a plain telegramId/name
 * snapshot, not a reference that needs resolving). Same snake_case
 * output convention as repository.js, for the same reason: the frontend
 * shouldn't have to care that this is a different file.
 */

const JobPost = require("./models/JobPost");
const { haversineKm } = require("./lib/geo");
const { formatTravelEstimate } = require("./lib/travelTime");

// Fixed for the MVP rather than letting the poster pick a number — one
// less decision during posting, and easy to make configurable later
// without touching anything that depends on this constant.
const ON_SITE_RADIUS_KM = 15;
// The radius expressed as a rough time too, so the frontend never has
// to duplicate this math itself — just displays whatever this says.
const ON_SITE_RADIUS_ESTIMATE = formatTravelEstimate(ON_SITE_RADIUS_KM);

function toJobListItem(doc, distanceKm) {
  const out = {
    id: doc._id.toString(),
    poster_telegram_id: doc.posterTelegramId,
    poster_name: doc.posterName,
    poster_username: doc.posterUsername || "",
    title: doc.title,
    description: doc.description,
    category: doc.category || "",
    budget: doc.budget,
    budget_type: doc.budgetType,
    location: doc.location && doc.location.address ? doc.location.address : "",
    requires_on_site: doc.requiresOnSite,
    status: doc.status,
    response_count: doc.responses.length,
    created_at: doc.createdAt,
  };
  if (distanceKm != null) {
    out.distance_km = Math.round(distanceKm * 10) / 10;
    // Rough estimate only — see lib/travelTime.js for exactly what
    // assumption this is built on and why. Not a live traffic figure.
    const est = formatTravelEstimate(distanceKm);
    out.travel_estimate_min = est.minutes;
    out.travel_estimate_label = est.label; // e.g. "~15 min" — ready to render as-is
  }
  return out;
}

function toJobDetail(doc, { isOwner = false } = {}) {
  const out = toJobListItem(doc);
  // Responses are only meaningful to the person who posted the job —
  // nobody else needs to see who else expressed interest.
  if (isOwner) {
    out.responses = doc.responses
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        telegram_id: r.telegramId,
        name: r.name,
        message: r.message,
        created_at: r.createdAt,
      }));
  }
  return out;
}

async function createJobPost(poster, fields) {
  const doc = await JobPost.create({
    posterTelegramId: poster.id, // the real account — controls edit/close/delete rights, never overridable
    posterName: fields.posterName || poster.name, // the DISPLAY name — editable, so someone can post on another person's behalf
    posterUsername: poster.username || "",
    title: fields.title,
    description: fields.description,
    category: fields.category || "",
    budget: fields.budget ?? null,
    budgetType: fields.budgetType || "negotiable",
    requiresOnSite: !!fields.requiresOnSite,
    location: fields.location || undefined,
  });
  return doc._id.toString();
}

// The public browse feed. On-site-required jobs get filtered by distance
// from the viewer here, in JS, after fetching — same pragmatic approach
// (not a native Mongo geo query) as findByService() uses for
// entrepreneur search, for the same reason: no 2dsphere index set up,
// and this app's scale doesn't need one yet.
async function getJobPosts({ category = "", limit = 20, offset = 0, viewerLat = null, viewerLng = null } = {}) {
  const filter = { status: "open", suspended: { $ne: true } };
  if (category) filter.category = category;
  const docs = await JobPost.find(filter).sort({ createdAt: -1 });
  const visible = filterByProximity(docs, viewerLat, viewerLng);
  const total = visible.length;
  const page = visible.slice(offset, offset + limit).map(({ doc, distanceKm }) => toJobListItem(doc, distanceKm));
  return { results: page, total };
}

async function searchJobPosts(query, { limit = 20, offset = 0, viewerLat = null, viewerLng = null } = {}) {
  const q = query.trim();
  if (!q) return getJobPosts({ limit, offset, viewerLat, viewerLng });
  const filter = { status: "open", suspended: { $ne: true }, $text: { $search: q } };
  const docs = await JobPost.find(filter, { score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } });
  const visible = filterByProximity(docs, viewerLat, viewerLng);
  const total = visible.length;
  const page = visible.slice(offset, offset + limit).map(({ doc, distanceKm }) => toJobListItem(doc, distanceKm));
  return { results: page, total };
}

// Applies the "on-site jobs only show to nearby, location-sharing
// viewers" rule. A job with requiresOnSite=false always passes through
// untouched (distanceKm stays null — remote work has no meaningful
// distance to report). A job with requiresOnSite=true is dropped
// entirely if either side lacks a location to compare, since there's no
// way to confirm proximity without both.
function filterByProximity(docs, viewerLat, viewerLng) {
  const hasViewerLocation = viewerLat != null && viewerLng != null;
  const out = [];
  for (const doc of docs) {
    if (!doc.requiresOnSite) {
      out.push({ doc, distanceKm: null });
      continue;
    }
    const jobHasLocation = doc.location && doc.location.lat != null && doc.location.lng != null;
    if (!jobHasLocation || !hasViewerLocation) continue; // can't confirm proximity — hide rather than guess
    const distanceKm = haversineKm(viewerLat, viewerLng, doc.location.lat, doc.location.lng);
    if (distanceKm <= ON_SITE_RADIUS_KM) out.push({ doc, distanceKm });
  }
  // Nearest-first when distance is meaningful, otherwise newest-first
  // (docs are already sorted newest-first from the query, so a stable
  // sort here only reorders the ones that actually have a distance).
  return out.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}

async function getJobPost(jobId, viewerTelegramId) {
  const doc = await JobPost.findById(jobId);
  if (!doc) return null;
  const isOwner = doc.posterTelegramId === viewerTelegramId;
  if (doc.suspended && !isOwner) return null; // hidden from everyone except its own poster
  return toJobDetail(doc, { isOwner });
}

async function getMyJobPosts(telegramId) {
  const docs = await JobPost.find({ posterTelegramId: telegramId }).sort({ createdAt: -1 });
  return docs.map((d) => toJobDetail(d, { isOwner: true }));
}

async function respondToJob(jobId, responder, message) {
  const doc = await JobPost.findById(jobId);
  if (!doc) return { success: false, reason: "not_found" };
  if (doc.status !== "open" || doc.suspended) return { success: false, reason: "not_open" };
  if (doc.posterTelegramId === responder.id) return { success: false, reason: "own_post" };

  const already = doc.responses.some((r) => r.telegramId === responder.id);
  if (already) return { success: false, reason: "already_responded" };

  doc.responses.push({ telegramId: responder.id, name: responder.name, message: message || "" });
  await doc.save();
  return { success: true };
}

async function setJobStatus(jobId, ownerTelegramId, status) {
  const res = await JobPost.updateOne({ _id: jobId, posterTelegramId: ownerTelegramId }, { $set: { status } });
  return res.modifiedCount > 0;
}

async function deleteJobPost(jobId, ownerTelegramId) {
  const res = await JobPost.deleteOne({ _id: jobId, posterTelegramId: ownerTelegramId });
  return res.deletedCount > 0;
}

// ---------- Admin moderation (mirrors Entrepreneur moderation) ----------

async function adminListJobs({ query = "", limit = 20, offset = 0 } = {}) {
  const filter = {};
  if (query) filter.$or = [{ title: new RegExp(escapeRegex(query), "i") }, { posterName: new RegExp(escapeRegex(query), "i") }];
  const total = await JobPost.countDocuments(filter);
  const docs = await JobPost.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit);
  return { results: docs.map(toJobListItem), total };
}

async function adminSuspendJob(jobId) {
  const res = await JobPost.updateOne({ _id: jobId }, { $set: { suspended: true } });
  return res.modifiedCount > 0;
}

async function adminUnsuspendJob(jobId) {
  const res = await JobPost.updateOne({ _id: jobId }, { $set: { suspended: false } });
  return res.modifiedCount > 0;
}

async function adminDeleteJob(jobId) {
  const res = await JobPost.deleteOne({ _id: jobId });
  return res.deletedCount > 0;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  createJobPost, getJobPosts, searchJobPosts, getJobPost, getMyJobPosts,
  respondToJob, setJobStatus, deleteJobPost,
  adminListJobs, adminSuspendJob, adminUnsuspendJob, adminDeleteJob,
  ON_SITE_RADIUS_KM, ON_SITE_RADIUS_ESTIMATE,
};
