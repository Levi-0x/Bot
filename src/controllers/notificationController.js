const repo = require("../repository");

async function getNotifications(req, res) {
  res.json({
    notifications: await repo.getNotifications(req.user.id),
    unread_count: await repo.countUnreadNotifications(req.user.id),
  });
}

async function markRead(req, res) {
  await repo.markNotificationsRead(req.user.id);
  res.json({ status: "ok" });
}

module.exports = require("../middleware/asyncHandler").wrapAllAsync({ getNotifications, markRead });
