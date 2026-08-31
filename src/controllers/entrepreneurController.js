/**
 * controllers/entrepreneurController.js
 * ---------------------------------------
 * A controller's job: read what the request needs from req, ask the
 * repository (the data layer) for it, shape the response, send it. No
 * direct database queries live here — that separation is the whole
 * point of the controller/repository split. If the database ever
 * changed again, only repository.js should need to change; every
 * controller stays the same.
 */

const repo = require("../repository");
const botModule = require("../bot");
const { validateInitData } = require("../lib/telegramAuth");
const { getInitData } = require("../middleware/auth");

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function getServices(req, res) {
  const category = req.query.category || "";
  const data = category ? await repo.getServicesByCategory(category) : await repo.getAllServices();
  res.json(data);
}

async function getCategories(req, res) {
  res.json(await repo.getCategories());
}

async function getTop(req, res) {
  const limit = parseInt(req.query.limit) || 5;
  res.json(await repo.getTopEntrepreneurs(limit));
}

async function getRecent(req, res) {
  const limit = parseInt(req.query.limit) || 10;
  res.json(await repo.getRecentEntrepreneurs(limit));
}

async function getFeatured(req, res) {
  const limit = parseInt(req.query.limit) || 10;
  res.json(await repo.getFeaturedEntrepreneurs(limit));
}

async function getEntrepreneur(req, res) {
  const profile = await repo.getPublicProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: "not_found" });
  profile.is_favorited = await repo.isFavorited(req.user.id, req.params.id);
  res.json(profile);
}

async function find(req, res) {
  const { service: serviceQuery = "", category = "", type: serviceType = "" } = req.query;
  const lat = req.query.lat != null ? parseFloat(req.query.lat) : null;
  const lng = req.query.lng != null ? parseFloat(req.query.lng) : null;
  const maxDistance = req.query.max_distance != null ? parseFloat(req.query.max_distance) : null;
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;

  const result = await repo.findByService(serviceQuery, {
    category, serviceType,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    maxDistanceKm: Number.isFinite(maxDistance) ? maxDistance : null,
    limit, offset,
  });
  if (serviceQuery) await repo.logSearch(serviceQuery, result.total, req.user.id);
  res.json(result);
}

async function getProfile(req, res) {
  const profile = await repo.getEntrepreneurProfile(req.user.id);
  if (profile) {
    profile.reviews_written = await repo.countReviewsWritten(req.user.id);
    profile.favorites_count = await repo.countFavorites(req.user.id);
  }
  res.json(profile); // can legitimately be null — the frontend handles the "not registered yet" case
}

async function upgradeToFreelancer(req, res) {
  await repo.upgradeToFreelancer(req.user.id);
  res.json({ status: "ok" });
}

async function register(req, res) {
  const body = req.body || {};
  const name = (body.name || "").trim();
  const services = body.services || [];
  const email = (body.email || "").trim();
  const photoBase64 = body.photo_base64 || "";
  const homeAddress = (body.home_address || "").trim();
  const businessAddress = (body.business_address || "").trim();
  let userType = (body.user_type || "freelancer").trim();
  if (!["customer", "freelancer"].includes(userType)) userType = "freelancer";

  const phoneVerification = await repo.getPhoneVerification(req.user.id);
  if (!phoneVerification) return res.status(400).json({ error: "phone_not_verified" });

  let fields = {};
  if (userType === "customer") {
    const missing = [];
    if (!name) missing.push("name");
    if (!EMAIL_RE.test(email)) missing.push("email");
    if (!photoBase64 && !body.keep_existing_photo) missing.push("photo");
    if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

    fields = { name, email, userType: "customer" };
    if (photoBase64) fields.photoBase64 = photoBase64;
  } else {
    const missing = [];
    if (!name) missing.push("name");
    if (!services.length) missing.push("services");
    if (!EMAIL_RE.test(email)) missing.push("email");
    if (!photoBase64 && !body.keep_existing_photo) missing.push("photo");
    if (!homeAddress && !businessAddress) missing.push("business_address_or_home_address");
    if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

    fields = {
      name, email, businessAddress,
      website: (body.website || "").trim(),
      homeAddress,
      description: (body.description || "").trim().slice(0, 500),
      businessType: (body.business_type || "").trim(),
      userType: "freelancer",
    };
    if (Array.isArray(body.social_platforms)) fields.socialPlatforms = body.social_platforms;
    else if (typeof body.social_platforms === "string") fields.socialPlatforms = [body.social_platforms];
    if (photoBase64) fields.photoBase64 = photoBase64;
    if (Array.isArray(body.gallery)) fields.gallery = body.gallery;
  }

  if (body.lat != null && body.lng != null) {
    const lat = parseFloat(body.lat), lng = parseFloat(body.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) fields.location = { lat, lng, capturedAt: new Date() };
  }
  if (req.user.username) fields.telegramUsername = req.user.username;

  await repo.registerEntrepreneur(req.user.id, fields, userType === "freelancer" ? services : []);
  res.json({ status: "ok" });
}

// This one is unusual: it needs to work even though authUser wasn't run
// as middleware here (the route is intentionally left ungated in
// routes/entrepreneurRoutes.js — see the comment there), so it verifies
// initData itself instead of trusting req.user.
async function getPhoto(req, res) {
  const token = botModule.loadToken();
  if (!validateInitData(getInitData(req), token)) return res.status(401).end();
  const photo = await repo.getPhotoFields(req.params.id);
  if (!photo) return res.status(404).end();

  if (photo.photo_base64) {
    const [header, encoded] = photo.photo_base64.split(",");
    const contentType = header.includes(":") ? header.split(":")[1].split(";")[0] : "image/jpeg";
    return res.type(contentType).send(Buffer.from(encoded, "base64"));
  }
  if (photo.photo_file_id) {
    try {
      const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${photo.photo_file_id}`);
      const info = await infoRes.json();
      const filePath = info.result.file_path;
      const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      const contentType = fileRes.headers.get("content-type") || "image/jpeg";
      const buf = Buffer.from(await fileRes.arrayBuffer());
      return res.type(contentType).send(buf);
    } catch (e) {
      console.warn(`Failed to fetch Telegram photo ${photo.photo_file_id}:`, e.message);
      return res.status(404).end();
    }
  }
  res.status(404).end();
}

async function rate(req, res) {
  const { entrepreneur_id: entrepreneurId, score } = req.body || {};
  const comment = ((req.body || {}).comment || "").trim().slice(0, 500);
  if (typeof score !== "number" || score < 1 || score > 5 || !entrepreneurId) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const raterName = req.user.first_name || "Anonymous";
  const { success, reason } = await repo.rateEntrepreneurById(entrepreneurId, req.user.id, score, comment, raterName);
  if (!success) {
    if (reason === "self_rating") return res.status(400).json({ error: "self_rating", message: "You can't rate your own listing." });
    return res.status(404).json({ error: "not_found" });
  }
  res.json({ status: "ok" });
}

async function getReviews(req, res) {
  res.json(await repo.getReviews(req.params.id));
}

async function unregister(req, res) {
  const removed = await repo.deleteEntrepreneur(req.user.id);
  res.json({ status: "ok", removed });
}

async function checkPhone(req, res) {
  const verification = await repo.getPhoneVerification(req.user.id);
  res.json({ verified: !!verification, phone: verification ? verification.phone : null });
}

async function getMyAnalytics(req, res) {
  const analytics = await repo.getEntrepreneurAnalytics(req.user.id);
  if (!analytics) return res.status(404).json({ error: "not_registered" });
  res.json(analytics);
}

module.exports = {
  getServices, getCategories, getTop, getRecent, getFeatured, getEntrepreneur, find,
  getProfile, upgradeToFreelancer, register, getPhoto, rate, getReviews, unregister,
  checkPhone, getMyAnalytics,
};
