const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/notificationController");
const { authUser } = require("../middleware/auth");

router.get("/", authUser, ctrl.getNotifications);
router.post("/read", authUser, ctrl.markRead);

module.exports = router;
