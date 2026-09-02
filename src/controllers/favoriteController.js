const repo = require("../repository");

async function getFavorites(req, res) {
  res.json(await repo.getFavorites(req.user.id));
}

async function addFavorite(req, res) {
  const { entrepreneur_id: entrepreneurId } = req.body || {};
  if (!entrepreneurId) return res.status(400).json({ error: "invalid_input" });
  const result = await repo.addFavorite(req.user.id, entrepreneurId);
  if (!result.success) {
    if (result.reason === "self_favorite") return res.status(400).json({ error: "self_favorite", message: "You can't favorite your own listing." });
    return res.status(404).json({ error: result.reason });
  }
  res.json({ status: "ok" });
}

async function removeFavorite(req, res) {
  const { entrepreneur_id: entrepreneurId } = req.body || {};
  if (!entrepreneurId) return res.status(400).json({ error: "invalid_input" });
  await repo.removeFavorite(req.user.id, entrepreneurId);
  res.json({ status: "ok" });
}

module.exports = require("../middleware/asyncHandler").wrapAllAsync({ getFavorites, addFavorite, removeFavorite });
