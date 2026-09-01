/**
 * middleware/asyncHandler.js
 * ----------------------------
 * THE BUG THIS FIXES, explained: every route handler and both auth
 * middleware functions in this app are `async`. In an Express 4 app
 * (this one), if an async handler throws — a bad database query, a
 * schema validation error, anything — Express does NOT automatically
 * catch it. What actually happens: the promise returned by that async
 * function rejects, nothing is listening for that rejection, and Node
 * treats an unhandled promise rejection as fatal by default — it kills
 * the ENTIRE process. Every user's request, not just the one that
 * triggered the bug, goes down with it.
 *
 * (Express 5, when it's the default, fixes this natively. This app pins
 * Express 4, so the fix has to be explicit.)
 *
 * wrapAsync() closes that gap: it runs your handler inside a try/catch
 * and forwards any error to next(err) — Express's built-in mechanism for
 * "something went wrong, let the error-handling middleware deal with
 * it" (see the errorHandler registered at the bottom of server.js).
 * That turns "the whole server crashes" into "this one request gets a
 * clean 500 response," which is what should have been happening all
 * along.
 *
 * wrapAllAsync() just applies wrapAsync() to every function in a
 * controller's exports object in one line, so no individual route file
 * had to change to pick up the fix.
 */

function wrapAsync(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

function wrapAllAsync(obj) {
  const wrapped = {};
  for (const [key, value] of Object.entries(obj)) {
    wrapped[key] = typeof value === "function" ? wrapAsync(value) : value;
  }
  return wrapped;
}

module.exports = { wrapAsync, wrapAllAsync };
