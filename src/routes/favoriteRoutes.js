const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/favoriteController");
const { authUser } = require("../middleware/auth");

router.get("/", authUser, ctrl.getFavorites);
router.post("/add", authUser, ctrl.addFavorite);
router.post("/remove", authUser, ctrl.removeFavorite);

module.exports = router;
