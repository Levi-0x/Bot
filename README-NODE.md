# GrowthHub — Node.js + Express + MongoDB version

A full, heavily-commented conversion of the Python/Flask/Postgres backend
to Node.js, Express, and MongoDB (via Mongoose) — built for you to
actually read and learn from, not just drop in and forget. Comments lean
toward explaining *why* a pattern is used (especially anywhere Mongo
genuinely works differently from SQL), rather than narrating every line —
the goal is that someone experienced skimming this can do so without
tripping over comment noise, while the parts that are genuinely new to
you have real explanation next to them.

Every file mirrors its Python counterpart function-for-function and
route-for-route — **44 routes on both sides**, checked mechanically.

## How to run it

```bash
npm install
cp .env.example .env     # fill in BOT_TOKEN, ADMIN_IDS, MONGODB_URI, etc.
npm start
```

Copy your existing `webapp/` folder (`index.html`, `style.css`, `app.js`)
into this project unchanged — the whole point of this conversion is that
the frontend doesn't need to know or care which backend is serving it.

For `MONGODB_URI`: run MongoDB locally, or use a free
[MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) cluster.

## Structure

This uses the `model` / `controller` / `route` split you'd have seen in
most Express tutorials (`models/`, `controllers/`, `routes/`), plus a
`middleware/` folder for the auth checks:

```
models/       — Mongoose schemas (unchanged from the flat version)
middleware/   — authUser / authAdmin, run before a route's controller
controllers/  — what each endpoint actually DOES
routes/       — which URL + HTTP method maps to which controller function
repository.js — the data-access layer every controller calls into
bot.js        — the Telegram bot (unchanged)
server.js     — assembles app.use(routes) and starts everything
```

An earlier pass at this had one flat `server.js` with all 44 routes
inline, deliberately mirroring how `server.py` is laid out as a single
file — useful for a direct side-by-side comparison, but not the shape
you'll see in most real Express projects. This version trades that
direct comparison for the more conventional structure.

## Where to actually start reading

If you want to follow the "why," read in this order:
1. `models/Entrepreneur.js` — the single biggest design decision in the
   whole conversion (embedding vs. joining) is explained at the top of
   this file. Everything else makes more sense once this clicks.
2. `lib/telegramAuth.js` — the HMAC signature-verification steps are
   commented individually; this is genuinely useful security logic worth
   understanding, not just Mongo trivia.
3. `repository.js`, top to bottom — this is where Mongoose patterns
   (upserts, the positional `$` operator, aggregation pipelines) show up
   with comments explaining each one where it first appears.
4. `server.js` — the Express fundamentals are explained once at the top
   of the file rather than repeated on all 44 routes.

## ⚠️ Testing limitations — read this before trusting it blindly

For the Postgres migration earlier in this project, I installed a real
Postgres server and ran your actual registration/search/rating/favorite
flows against it before handing the code over. I still can't do the
same here — this sandbox has no MongoDB server available (not in the
package manager, no Docker, and `mongodb-memory-server`'s automatic
binary download is blocked by the sandbox's network policy).

What I verified this time, same as before:
- Every file passes `node --check`, including the new `controllers/`,
  `routes/`, and `middleware/` files.
- `require()`-ing the app succeeds with no missing exports or broken
  references — if a controller function referenced in a route file
  didn't exist, Express would throw the moment that route got
  registered, and it didn't.
- Route count still matches exactly after the restructure: **44 routes**,
  enumerated programmatically (not just eyeballed) both before and after
  splitting `server.js` into `controllers/`/`routes/`.

What's still unverified: that any given query returns correct data
against a real database. Before deploying this anywhere real, run it
against a free MongoDB Atlas cluster or local `mongod` and walk through
register → search → rate → favorite once. Bring back any real error and
I'll fix it against actual output.

## The big design decision: embedding instead of joining

Postgres spreads one entrepreneur's data across four tables
(`entrepreneurs`, `services`, `entrepreneur_services`, `ratings`) joined
at query time. Here, a single `Entrepreneur` document embeds its own
`services` and `ratings` arrays — one document read gets you an entire
profile, no joins. The cost shows up wherever the old code relied on
`services` being a *global* table (like "list every distinct service
anyone offers") — that's now an aggregation pipeline instead of a GROUP
BY. See the comment on `getAllServices()` in `repository.js` for a full
walkthrough of that trade-off.

## Other deliberate changes (not oversights)

- **Distance search** computes Haversine in plain JS after fetching
  candidates, rather than as native MongoDB geospatial query — noted in
  `lib/geo.js` as a reasonable stretch goal, not added here.
- **`mergeServices()`** takes two service *names* instead of two numeric
  ids, since services no longer have their own table with their own
  primary key.
- **`adminGetListing()`** shows admins every review, including hidden
  ones — the Python version's `admin_get_listing()` reuses
  `get_reviews()`, which filters hidden reviews out, making a hidden
  review unreachable even to the admin who'd need to see it to unhide
  it. Fixed here rather than carried over.
- **Self-rating is blocked** (`rateEntrepreneurById()`), matching the fix
  made on the Python side earlier in this project.
- **`deleteCategory()`** refuses to delete a category still in use by
  real services — this guards against a bug that existed on the Python
  side at one point, where deleting a category label cascaded into
  deleting real services.

## File map

| Python | Node | Notes |
|---|---|---|
| `database.py` | `repository.js` + `models/*.js` | schema redesigned for embedding |
| `server.py` | `server.js` | route-for-route port |
| `bot.py` | `bot.js` | `node-telegram-bot-api` instead of `python-telegram-bot` |
| (Flask per-request connect) | `config/db.js` | one pooled Mongoose connection for the app's lifetime |
