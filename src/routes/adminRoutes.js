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

router.delete("/reviews/:id", authAdmin, ctrl.deleteReview);
router.patch("/reviews/:id/hide", authAdmin, ctrl.hideReview);
router.patch("/reviews/:id/unhide", authAdmin, ctrl.unhideReview);

router.patch("/listings/:id/suspend", authAdmin, ctrl.suspendListing);
router.patch("/listings/:id/unsuspend", authAdmin, ctrl.unsuspendListing);

router.get("/audit_log", authAdmin, ctrl.getAuditLog);
router.get("/listing/:id", authAdmin, ctrl.getListing);
router.get("/search_listings", authAdmin, ctrl.searchListings);
router.post("/merge_services", authAdmin, ctrl.mergeServices);

router.get("/categories", authAdmin, ctrl.getAllCategories);
router.post("/categories", authAdmin, ctrl.addCategory);
router.delete("/categories/:category", authAdmin, ctrl.deleteCategory);

router.post("/feature", authAdmin, ctrl.feature);

router.get("/analytics/search", authAdmin, ctrl.searchAnalytics);
router.get("/analytics/growth", authAdmin, ctrl.growthAnalytics);

// Billboard moderation — same suspend/unsuspend/delete pattern as
// listings, just for job posts instead. Handled by jobController
// (not adminController) since the underlying data lives in
// jobRepository.js, not repository.js.
const jobCtrl = require("../controllers/jobController");
router.get("/jobs", authAdmin, jobCtrl.adminList);
router.patch("/jobs/:id/suspend", authAdmin, jobCtrl.adminSuspend);
router.patch("/jobs/:id/unsuspend", authAdmin, jobCtrl.adminUnsuspend);
router.delete("/jobs/:id", authAdmin, jobCtrl.adminDelete);

module.exports = router;
