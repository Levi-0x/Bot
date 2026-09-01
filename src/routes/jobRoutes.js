const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/jobController");
const { authUser } = require("../middleware/auth");

// Order matters here: an Express route like "/:id" would otherwise match
// the literal path "/mine" too (treating "mine" as if it were an :id),
// since Express checks routes top-to-bottom and takes the first match.
// Putting "/mine" above "/:id" avoids that collision.
router.get("/", authUser, ctrl.list);
router.post("/", authUser, ctrl.create);
router.get("/mine", authUser, ctrl.getMine);
router.get("/:id", authUser, ctrl.getOne);
router.post("/:id/respond", authUser, ctrl.respond);

// POST, not PATCH/DELETE — see the note in routes/adminRoutes.js. This
// app's frontend only ever sends POST, so every mutating route here
// follows that same convention rather than mixing HTTP verbs.
router.post("/:id/close", authUser, ctrl.close);
router.post("/:id/delete", authUser, ctrl.remove);

module.exports = router;
