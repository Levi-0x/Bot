const jobRepo = require("../jobRepository");
const repo = require("../repository");

async function list(req, res) {
  const category = req.query.category || "";
  const query = req.query.q || "";
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;
  const viewerLat = req.query.lat != null ? parseFloat(req.query.lat) : null;
  const viewerLng = req.query.lng != null ? parseFloat(req.query.lng) : null;
  const opts = {
    limit, offset,
    viewerLat: Number.isFinite(viewerLat) ? viewerLat : null,
    viewerLng: Number.isFinite(viewerLng) ? viewerLng : null,
  };

  const result = query
    ? await jobRepo.searchJobPosts(query, opts)
    : await jobRepo.getJobPosts({ ...opts, category });
  result.on_site_radius_km = jobRepo.ON_SITE_RADIUS_KM; // so the frontend never hardcodes this number itself
  res.json(result);
}

async function create(req, res) {
  const body = req.body || {};
  const title = (body.title || "").trim();
  const description = (body.description || "").trim();
  const missing = [];
  if (!title) missing.push("title");
  if (!description) missing.push("description");

  const requiresOnSite = !!body.requires_on_site;
  const hasLocation = body.location_address || (body.lat != null && body.lng != null);
  // On-site jobs are meaningless without a location to be on-site AT —
  // enforced here rather than left to silently produce an unfindable job.
  if (requiresOnSite && !hasLocation) missing.push("location");

  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

  const budgetType = ["fixed", "hourly", "negotiable"].includes(body.budget_type) ? body.budget_type : "negotiable";
  const budget = body.budget != null && body.budget !== "" ? Number(body.budget) : null;

  const fields = {
    title: title.slice(0, 120),
    description: description.slice(0, 1000),
    category: (body.category || "").trim(),
    budget: Number.isFinite(budget) ? budget : null,
    budgetType,
    requiresOnSite,
    // The editable display name — defaults to the poster's own Telegram
    // name if left blank, but a typed-in value overrides it. This is
    // what makes "post this on behalf of someone else" possible; see the
    // comment in jobRepository.js's createJobPost() for the identity/
    // display-name distinction this relies on.
    posterName: (body.poster_name || "").trim() || undefined,
  };
  if (hasLocation) {
    fields.location = {
      address: (body.location_address || "").trim(),
      lat: body.lat != null ? parseFloat(body.lat) : undefined,
      lng: body.lng != null ? parseFloat(body.lng) : undefined,
    };
  }

  const poster = {
    id: req.user.id,
    name: req.user.first_name || "Someone",
    username: req.user.username || "",
  };
  const id = await jobRepo.createJobPost(poster, fields);
  res.json({ status: "ok", id });
}

async function getMine(req, res) {
  res.json(await jobRepo.getMyJobPosts(req.user.id));
}

async function getOne(req, res) {
  const job = await jobRepo.getJobPost(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: "not_found" });
  res.json(job);
}

async function respond(req, res) {
  const message = ((req.body || {}).message || "").trim().slice(0, 300);
  const responder = { id: req.user.id, name: req.user.first_name || "Someone" };
  const { success, reason } = await jobRepo.respondToJob(req.params.id, responder, message);
  if (!success) {
    const codes = { not_found: 404, own_post: 400, not_open: 400, already_responded: 400 };
    return res.status(codes[reason] || 400).json({ error: reason });
  }
  res.json({ status: "ok" });
}

async function close(req, res) {
  const status = req.body && req.body.status === "closed" ? "closed" : "fulfilled";
  const updated = await jobRepo.setJobStatus(req.params.id, req.user.id, status);
  if (!updated) return res.status(404).json({ error: "not_found_or_not_yours" });
  res.json({ status: "ok" });
}

async function remove(req, res) {
  const deleted = await jobRepo.deleteJobPost(req.params.id, req.user.id);
  if (!deleted) return res.status(404).json({ error: "not_found_or_not_yours" });
  res.json({ status: "ok", deleted });
}

// ---------- Admin ----------

async function adminList(req, res) {
  const query = req.query.q || "";
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;
  res.json(await jobRepo.adminListJobs({ query, limit, offset }));
}

async function adminSuspend(req, res) {
  const suspended = await jobRepo.adminSuspendJob(req.params.id);
  await repo.logAdminAction(req.user.id, "suspend_job", { targetType: "job", targetId: req.params.id });
  res.json({ status: "ok", suspended });
}

async function adminUnsuspend(req, res) {
  const unsuspended = await jobRepo.adminUnsuspendJob(req.params.id);
  await repo.logAdminAction(req.user.id, "unsuspend_job", { targetType: "job", targetId: req.params.id });
  res.json({ status: "ok", unsuspended });
}

async function adminDelete(req, res) {
  const deleted = await jobRepo.adminDeleteJob(req.params.id);
  await repo.logAdminAction(req.user.id, "delete_job", { targetType: "job", targetId: req.params.id });
  res.json({ status: "ok", deleted });
}

module.exports = require("../middleware/asyncHandler").wrapAllAsync({
  list, create, getMine, getOne, respond, close, remove,
  adminList, adminSuspend, adminUnsuspend, adminDelete,
});
