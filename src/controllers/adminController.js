/**
 * controllers/adminController.js
 * --------------------------------
 * Everything here assumes the `authAdmin` middleware already ran (see
 * routes/adminRoutes.js) — by the time any function below executes,
 * `req.user` is guaranteed to be a real, signed-in admin. That's the
 * benefit of moving the auth check into middleware: these functions get
 * to just focus on what the action DOES, not on re-proving who's asking.
 *
 * The one exception is checkAdmin() — it deliberately answers
 * "am I an admin?" for ANY signed-in user (including "no"), so it can't
 * be gated by authAdmin the same way; see routes/adminRoutes.js for how
 * that one's wired differently.
 */

const repo = require("../repository");
const botModule = require("../bot");
const { validateInitData } = require("../lib/telegramAuth");
const { getInitData } = require("../middleware/auth");

async function checkAdmin(req, res) {
  const token = botModule.loadToken();
  const user = validateInitData(getInitData(req), token);
  const isAdmin = !!(user && (await botModule.loadAdminIds()).has(user.id));
  res.json({ is_admin: isAdmin });
}

async function getStats(req, res) {
  res.json(await repo.getStats());
}

async function broadcast(req, res) {
  const message = ((req.body || {}).message || "").trim();
  if (!message) return res.status(400).json({ error: "empty_message" });

  const token = botModule.loadToken();
  const telegramIds = await repo.getAllTelegramIds();
  let sent = 0, failed = 0;
  for (const telegramId of telegramIds) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramId, text: `📢 Announcement:\n\n${message}` }),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      sent++;
    } catch (e) {
      console.warn(`Broadcast (web) failed for ${telegramId}:`, e.message);
      failed++;
    }
  }
  await repo.logAdminAction(req.user.id, "broadcast", { details: `sent=${sent} failed=${failed}` });
  res.json({ status: "ok", sent, failed });
}

async function listAdmins(req, res) {
  const rootIds = [...botModule.rootAdminIds()].sort((a, b) => a - b).map(String);
  const dbIds = [...(await repo.getAdminIdsFromDb())].sort((a, b) => a - b);
  res.json({ root_admins: rootIds, added_admins: dbIds });
}

async function addAdmin(req, res) {
  const newAdminId = (req.body || {}).telegram_id;
  if (typeof newAdminId !== "number") return res.status(400).json({ error: "invalid_telegram_id" });
  await repo.addAdmin(newAdminId, req.user.id);
  await repo.logAdminAction(req.user.id, "add_admin", { targetType: "user", targetId: String(newAdminId) });
  res.json({ status: "ok" });
}

async function removeAdmin(req, res) {
  const targetId = (req.body || {}).telegram_id;
  if (typeof targetId !== "number") return res.status(400).json({ error: "invalid_telegram_id" });
  if (botModule.isRootAdmin(targetId)) return res.status(400).json({ error: "is_root_admin" });
  const removed = await repo.removeAdmin(targetId);
  await repo.logAdminAction(req.user.id, "remove_admin", { targetType: "user", targetId: String(targetId) });
  res.json({ status: "ok", removed });
}

async function forceRemove(req, res) {
  const name = ((req.body || {}).name || "").trim();
  if (!name) return res.status(400).json({ error: "missing_name" });
  const { success } = await repo.forceDeleteByName(name);
  await repo.logAdminAction(req.user.id, "force_remove", { targetType: "listing", targetId: name, details: `removed=${success}` });
  res.json({ status: "ok", removed: success });
}

async function deleteReview(req, res) {
  const deleted = await repo.deleteReview(req.params.id);
  await repo.logAdminAction(req.user.id, "delete_review", { targetType: "review", targetId: req.params.id });
  res.json({ status: "ok", deleted });
}

async function hideReview(req, res) {
  const hidden = await repo.hideReview(req.params.id);
  await repo.logAdminAction(req.user.id, "hide_review", { targetType: "review", targetId: req.params.id });
  res.json({ status: "ok", hidden });
}

async function unhideReview(req, res) {
  const unhidden = await repo.unhideReview(req.params.id);
  await repo.logAdminAction(req.user.id, "unhide_review", { targetType: "review", targetId: req.params.id });
  res.json({ status: "ok", unhidden });
}

async function suspendListing(req, res) {
  const suspended = await repo.suspendListing(req.params.id);
  await repo.logAdminAction(req.user.id, "suspend_listing", { targetType: "listing", targetId: req.params.id });
  res.json({ status: "ok", suspended });
}

async function unsuspendListing(req, res) {
  const unsuspended = await repo.unsuspendListing(req.params.id);
  await repo.logAdminAction(req.user.id, "unsuspend_listing", { targetType: "listing", targetId: req.params.id });
  res.json({ status: "ok", unsuspended });
}

async function getAuditLog(req, res) {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  res.json(await repo.getAdminAuditLog(limit, offset));
}

async function getListing(req, res) {
  const profile = await repo.adminGetListing(req.params.id);
  if (!profile) return res.status(404).json({ error: "not_found" });
  res.json(profile);
}

async function searchListings(req, res) {
  const query = req.query.q || "";
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;
  res.json(await repo.adminSearchListings(query, limit, offset));
}

async function mergeServices(req, res) {
  // Takes service NAMES, not numeric ids — see the comment on
  // mergeServices() in repository.js for why.
  const { source_name: sourceName, target_name: targetName } = req.body || {};
  if (!sourceName || !targetName) return res.status(400).json({ error: "invalid_names" });
  const { success, message } = await repo.mergeServices(sourceName, targetName);
  await repo.logAdminAction(req.user.id, "merge_services", { targetType: "service", targetId: `${sourceName}->${targetName}`, details: message });
  res.json({ status: success ? "ok" : "error", message });
}

async function getAllCategories(req, res) {
  res.json(await repo.getAllCategories());
}

async function addCategory(req, res) {
  const name = ((req.body || {}).name || "").trim();
  if (!name) return res.status(400).json({ error: "missing_name" });
  await repo.addCategory(name, (req.body || {}).icon || "", (req.body || {}).color || "");
  await repo.logAdminAction(req.user.id, "add_category", { targetType: "category", targetId: name });
  res.json({ status: "ok" });
}

async function deleteCategory(req, res) {
  const { success, message } = await repo.deleteCategory(req.params.category);
  await repo.logAdminAction(req.user.id, "delete_category", { targetType: "category", targetId: req.params.category, details: message });
  res.status(success ? 200 : 409).json({ status: success ? "ok" : "error", message });
}

async function feature(req, res) {
  const { listing_id: listingId, featured = true } = req.body || {};
  if (!listingId) return res.status(400).json({ error: "invalid_id" });
  await repo.setForceFeatured(listingId, featured);
  await repo.logAdminAction(req.user.id, featured ? "feature_listing" : "unfeature_listing", { targetType: "listing", targetId: String(listingId) });
  res.json({ status: "ok" });
}

async function searchAnalytics(req, res) {
  const days = parseInt(req.query.days) || 30;
  res.json(await repo.getSearchAnalytics(days));
}

async function growthAnalytics(req, res) {
  res.json(await repo.getGrowthAnalytics());
}

module.exports = require("../middleware/asyncHandler").wrapAllAsync({
  checkAdmin, getStats, broadcast, listAdmins, addAdmin, removeAdmin, forceRemove,
  deleteReview, hideReview, unhideReview, suspendListing, unsuspendListing,
  getAuditLog, getListing, searchListings, mergeServices,
  getAllCategories, addCategory, deleteCategory, feature,
  searchAnalytics, growthAnalytics,
});
