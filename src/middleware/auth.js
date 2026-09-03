/**
 * middleware/auth.js
 * -------------------
 * In the flat server.js version, every route called requireUser()/
 * requireAdmin() itself, at the top of its own handler — that matched
 * server.py's structure closely, which was the point at the time.
 *
 * This is the more idiomatic Express way to do the same job: as real
 * middleware, registered on a route (or a whole router) rather than
 * repeated inside every handler. Express runs middleware BEFORE the
 * route handler, and it decides whether the handler even runs — calling
 * `next()` continues on to it, while sending a response (like
 * `res.status(401).json(...)`) without calling `next()` stops the
 * request right there.
 *
 * Usage in a routes file:
 *   router.get("/profile", authUser, entrepreneurController.getProfile);
 *
 * By the time `getProfile` runs, `req.user` is already set — the
 * controller doesn't need to know or care HOW the user was verified,
 * just that `req.user` is trustworthy if it got this far.
 *
 * Both functions below are wrapped in wrapAsync() before being exported
 * — they're async and can throw (e.g. loadToken() throws a plain Error
 * if no bot token is configured), and without that wrapper an error
 * here would crash the whole process the same way an unwrapped
 * controller would. See middleware/asyncHandler.js for the full
 * explanation.
 */

const botModule = require("../bot");
const { validateInitData } = require("../lib/telegramAuth");
const { wrapAsync } = require("./asyncHandler");

function getInitData(req) {
  return (req.method === "GET" ? req.query.initData : req.body.initData) || "";
}

const authUser = wrapAsync(async (req, res, next) => {
  const token = botModule.loadToken();
  const user = validateInitData(getInitData(req), token);
  if (!user) return res.status(401).json({ error: "invalid_init_data" });
  // "Ban" blocks both future account creation (checked again, more
  // specifically, in entrepreneurController.register()) and general
  // access — checking it here in the shared auth middleware means every
  // authenticated route is covered, not just registration. A banned
  // identity gets 403'd before req.user is even trusted by anything
  // downstream. require()'d lazily inside the function body, not at
  // module load time, to sidestep any require-order sensitivity between
  // this file and repository.js — there's no actual circular require
  // today, but this keeps it that way even if repository.js ever grows
  // a dependency back toward middleware/ in the future.
  const repo = require("../repository");
  if (await repo.isBanned(user.id)) return res.status(403).json({ error: "banned" });
  req.user = user;
  next();
});

// Layers on top of authUser's check rather than duplicating it — an
// admin is still a normal signed-in user, just one who's also in the
// admin list.
const authAdmin = wrapAsync(async (req, res, next) => {
  const token = botModule.loadToken();
  const user = validateInitData(getInitData(req), token);
  if (!user) return res.status(401).json({ error: "invalid_init_data" });
  const repo = require("../repository");
  if (await repo.isBanned(user.id)) return res.status(403).json({ error: "banned" });
  const admins = await botModule.loadAdminIds();
  if (!admins.has(user.id)) return res.status(403).json({ error: "forbidden" });
  req.user = user;
  next();
});

module.exports = { authUser, authAdmin, getInitData };
