const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/entrepreneurController");
const { authUser } = require("../middleware/auth");

// router.get(path, ...middleware, handler) — Express runs each argument
// in order. authUser runs first on every route below; only if it calls
// next() does the actual controller function run.
router.get("/services", authUser, ctrl.getServices);
router.get("/categories", authUser, ctrl.getCategories);
router.get("/top", authUser, ctrl.getTop);
router.get("/recent", authUser, ctrl.getRecent);
router.get("/featured", authUser, ctrl.getFeatured);
router.get("/entrepreneur/:id", authUser, ctrl.getEntrepreneur);
router.get("/find", authUser, ctrl.find);

router.get("/profile", authUser, ctrl.getProfile);
router.post("/upgrade_to_freelancer", authUser, ctrl.upgradeToFreelancer);
router.post("/register", authUser, ctrl.register);

// Deliberately NOT using authUser here — not because an <img> tag can't
// send initData (it can, as a query param, same as any other GET route),
// but because authUser's failure response is a JSON error body, and a
// broken <img> tag has no use for JSON — the browser just wants either
// image bytes or a plain empty response. getPhoto() verifies auth itself
// so it can fail with res.status(401).end() instead.
router.get("/photo/:id", authUser, ctrl.getPhoto);

router.post("/rate", authUser, ctrl.rate);
router.get("/reviews/:id", authUser, ctrl.getReviews);
router.post("/unregister", authUser, ctrl.unregister);
router.get("/check_phone", authUser, ctrl.checkPhone);
router.get("/my-analytics", authUser, ctrl.getMyAnalytics);

module.exports = router;
