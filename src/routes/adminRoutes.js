const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/adminController");
const { authUser, authAdmin } = require("../middleware/auth");

// The one route in this file that uses authUser instead of authAdmin —
// it needs to run for any signed-in user (to answer "is_admin: false"
// for a non-admin), so authAdmin's automatic 403 would be wrong here.
router.get("/check", authUser, ctrl.checkAdmin);

// Every other route in this router uses authAdmin: if it doesn't call
// next(), none of these ever run their controller function at all.
router.get("/stats", authAdmin, ctrl.getStats);
router.post("/broadcast", authAdmin, ctrl.broadcast);
router.get("/list_admins", authAdmin, ctrl.listAdmins);
router.post("/add_admin", authAdmin, ctrl.addAdmin);
router.post("/remove_admin", authAdmin, ctrl.removeAdmin);
router.post("/forceremove", authAdmin, ctrl.forceRemove);

// NOTE ON HTTP METHODS: PATCH/DELETE would be the more "textbook REST"
// choice for these actions. This app deliberately uses POST for all of
// them instead, because the existing frontend's apiPost() helper (in
// app.js) only ever sends POST — that was true before the billboard
// feature existed, and app.js's admin panel already calls
// /api/admin/listings/:id/suspend expecting POST. Using PATCH/DELETE
// here would silently 404 against the real frontend. One HTTP verb,
// consistently, beats being "more correct" per-route and inconsistent
// across the app.
router.post("/reviews/:id/delete", authAdmin, ctrl.deleteReview);
router.post("/reviews/:id/hide", authAdmin, ctrl.hideReview);
router.post("/reviews/:id/unhide", authAdmin, ctrl.unhideReview);

router.post("/listings/:id/suspend", authAdmin, ctrl.suspendListing);
router.post("/listings/:id/unsuspend", authAdmin, ctrl.unsuspendListing);

router.get("/audit_log", authAdmin, ctrl.getAuditLog);
router.get("/listing/:id", authAdmin, ctrl.getListing);
router.get("/search_listings", authAdmin, ctrl.searchListings);
router.post("/merge_services", authAdmin, ctrl.mergeServices);

router.get("/categories", authAdmin, ctrl.getAllCategories);
router.post("/categories", authAdmin, ctrl.addCategory);
router.post("/categories/:category/delete", authAdmin, ctrl.deleteCategory);

router.post("/feature", authAdmin, ctrl.feature);

router.get("/analytics/search", authAdmin, ctrl.searchAnalytics);
router.get("/analytics/growth", authAdmin, ctrl.growthAnalytics);

// Billboard moderation — same suspend/unsuspend/delete pattern as
// listings, just for job posts instead. Handled by jobController
// (not adminController) since the underlying data lives in
// jobRepository.js, not repository.js.
const jobCtrl = require("../controllers/jobController");
router.get("/jobs", authAdmin, jobCtrl.adminList);
router.post("/jobs/:id/suspend", authAdmin, jobCtrl.adminSuspend);
router.post("/jobs/:id/unsuspend", authAdmin, jobCtrl.adminUnsuspend);
router.post("/jobs/:id/delete", authAdmin, jobCtrl.adminDelete);

module.exports = router;
