/**
 * routes/index.js
 * ----------------
 * One place that says "these URLs starting with /api/x go to this
 * router" — server.js just mounts this one file instead of knowing
 * about every individual route.
 */

const express = require("express");
const router = express.Router();

router.use("/api", require("./entrepreneurRoutes"));       // /api/services, /api/find, /api/profile, etc.
router.use("/api/favorites", require("./favoriteRoutes"));  // /api/favorites, /api/favorites/add, ...
router.use("/api/notifications", require("./notificationRoutes"));
router.use("/api/jobs", require("./jobRoutes"));             // the billboard feature
router.use("/api/admin", require("./adminRoutes"));

module.exports = router;
