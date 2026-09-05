# GrowthHub Node — Development Log & Do-Not-Change Notes

Read this before making changes. It exists because work has been lost or
reintroduced as "fixes" by different AI sessions that didn't have this
context. If you're an AI model picking this project up: check here first.
This file gets rewritten/updated as the project evolves — if a section
here contradicts what you see in the code, trust the code, but flag the
mismatch rather than silently picking one.

## What the app currently does (high level)

A Telegram Mini App marketplace: freelancers register a listing
(services, photo, location, socials), customers browse/search/favorite/
rate them. Separately, a Job Board ("billboard") lets anyone post a job
others can respond to — remote jobs are visible to everyone, on-site
jobs only to freelancers within a set radius who share their location.
An admin panel handles moderation: search/suspend/ban/remove listings,
manage other admins, broadcast messages, manage categories, view basic
analytics and an audit log.

## Hard conventions — do not deviate

- **All mutating job/admin routes are POST-only** (`/api/jobs/:id/close`,
  `/api/jobs/:id/delete`, `/api/admin/listings/:id/suspend`,
  `/api/admin/listings/:id/ban`, etc.) — NOT PATCH/DELETE, even though
  that might look more "correct" RESTfully. This was a deliberate
  standardization. Frontend must always call these with `apiPost`,
  never a PATCH/DELETE helper.
- **Entrepreneur and job IDs are Mongo ObjectId strings** (24 hex chars),
  never numbers. Never wrap one in `Number(...)`. This exact bug broke
  Home/Explore/Favorites card clicks AND the favorites remove button
  AND every admin listing action button at different points — same root
  cause, found and fixed multiple times. Don't reintroduce it.
  (Telegram IDs, by contrast, genuinely ARE numbers — `Number()` is
  correct for those. Don't over-correct and start treating Telegram IDs
  as strings too.)
- **Never build `onclick="fn(${value})"` by string interpolation.** An
  ObjectId string embedded unquoted is invalid JS syntax (breaks
  instantly, silently). A name/string with an apostrophe breaks a
  quoted one too. Use `data-*` attributes + `addEventListener` instead
  — this is the pattern used everywhere in the app now.
- **Never call `escapeHtml()` twice on the same value.** It happened
  once already (Manage Admins row rendering) — a name containing `&`,
  `<`, or `>` displayed mangled (`R&D` rendered as `R&amp;D`). Escape
  once, at the point of insertion into HTML, and nowhere else.
- **`server.js` requires must point into `./src/...`**, not flat
  `./routes`, `./bot`, `./config/db`. The whole backend (except
  `server.js` itself) lives under `src/`. This has regressed multiple
  times across different uploads — always re-check `server.js`'s
  requires after merging in someone else's version of the project.
- **`socialPlatforms` is `[{ platform, handle }]` objects**, not
  `[String]`. Was originally miss-declared as `[String]` in the Mongoose
  schema, which crashed the whole server on save (unhandled rejection,
  no try/catch existed at the time). Fixed in the schema AND with
  defensive filtering on the frontend for any legacy accounts that still
  have old malformed string data saved.
- **All async route handlers are wrapped via `wrapAllAsync`**
  (`src/middleware/asyncHandler.js`) + a global Express error handler in
  `server.js`, plus process-level `unhandledRejection`/`uncaughtException`
  safety nets. This exists so a single bad request can't crash the
  entire server for every other user. Don't strip this out; if adding a
  new controller, make sure its exports go through the same wrapper.
- **`avatarHtml()` / `noPhotoIconHtml()` — no-photo fallback is a
  generic person-silhouette icon, never text initials.** Initials-as-
  text was the original (unintentional) behavior and read as a bug, not
  a design choice. Same rule for Home's `renderCardScroll` avatars.
- **`photo_base64` in any API response (list or profile) is a boolean
  presence flag, never the actual image data.** The real photo is
  fetched separately via `/api/photo/:id` (`photoUrl()` in `app.js`) so
  responses don't balloon with embedded base64. This field was missing
  entirely from `toListItem`/`toFullProfile` for a long stretch of this
  project's history — uploaded photos silently never displayed anywhere
  (Home, Explore, Favorites, Profile, welcome banner) even though the
  upload itself always saved correctly. If photos ever stop showing up
  again, check this first before assuming it's a frontend bug.
- **Category pills use hand-drawn outline SVG icons** (`categoryIconHtml()`,
  `CATEGORY_ICON_PATHS`), not emoji. Emoji rendered inconsistently
  across devices in Telegram's in-app browser. One shared accent color
  for every icon circle (not per-category custom colors) — this was a
  specific design choice the user approved from a mockup.
- **"Manage Services" admin panel section is intentionally removed.**
  It was broken (used numeric service IDs; the backend was redesigned
  to use service names) and has been stripped from both `index.html`
  and `app.js` more than once after reappearing from stale uploads.
  Do not re-add it unless explicitly asked, and if you do, it needs
  redesigning around name-based lookups, not IDs.
- **Travel time estimate is a rough static conversion (15 km/h assumed
  city speed), not a real routing API call.** Lives in
  `src/lib/travelTime.js`, computed server-side, sent to the frontend
  as `travel_estimate_min` / `travel_estimate_label` — the frontend
  should never recompute this itself. Explicitly NOT meant to be
  precise; always labelled "~" and "(traffic permitting)". Do not swap
  in a paid routing API without being asked — there's no evidence yet
  it's needed.
- **On-site job location auto-fills from the poster's saved profile
  address** (`business_address || home_address`), and prefers their
  *saved* lat/lng over live GPS on submit — reasoning: a poster's
  current GPS position isn't necessarily where the job actually is.
  Field stays editable; this is a default, not a lock.
- **"Is this my own profile/listing?" is decided server-side**, via an
  `is_owner` boolean the backend computes and attaches to the profile
  response (`getPublicProfile()` in `repository.js`, comparing the
  listing's real `telegramId` against the authenticated viewer's ID —
  never exposed as a raw comparable field to the client). Never go back
  to a frontend-only check like a global `currentProfile` variable that
  depends on some other page having been visited first this session —
  that was the exact bug that let people rate/favorite/message
  themselves, fixed by moving the check server-side.
- **Suspension is time-based, not a plain on/off toggle.**
  `Entrepreneur.suspended` (Boolean) + `Entrepreneur.suspendedUntil`
  (Date, nullable) together decide the real state — `suspendedUntil:
  null` means indefinite, a future date means it auto-expires, nothing
  needs to run a cleanup job. **Never read either field alone.** Always
  go through `isCurrentlySuspended(doc)` (single-doc check) or
  `notSuspendedFilter()` (spread into a Mongo query alongside other
  conditions) in `repository.js` — both in one place so the expiry
  logic can't drift out of sync between different call sites.
- **Admin tiers (Tier 1 = root/`.env`, Tier 2 = added via `/addadmin`)
  have identical capabilities everywhere except removal.** `authAdmin`
  doesn't check tier at all for any action — broadcast, suspend, ban,
  categories, analytics, adding/removing other admins, all open to any
  admin regardless of tier. The only tier-aware logic in the whole
  codebase is: Tier 1 can't be removed via the app by anyone (not even
  another Tier 1 admin — they're not a database row, they come straight
  from `ADMIN_IDS` in the deploy config, so there's nothing to delete;
  changing that means editing the env var and redeploying). Don't build
  a "demote" or "suspend an admin" action without checking whether
  that's actually been asked for — as of this writing it hasn't, and no
  such action exists anywhere in the code.
- **Ban is two distinct steps, always in this order:** `banIdentity()`
  writes to the `BannedUser` collection first, *then*
  `deleteEntrepreneur()` wipes the listing and related data
  (`banAndDeleteEntrepreneur()` in `repository.js` does both). Ban-first
  matters: if the delete step ever failed partway through, the identity
  is still blocked, which is the safer failure direction versus a
  half-deleted-but-still-bannable account. The ban check itself lives in
  `authUser`/`authAdmin` middleware (`src/middleware/auth.js`), not just
  the register endpoint — a banned identity gets a 403 on *any*
  authenticated route, not only when trying to re-register.
- **`ADMIN_IDS` must be set in Render's own Environment tab, not just a
  local `.env` file.** Render doesn't read a committed/local `.env` in
  production — it only sees what's actually configured in its
  dashboard. Adding someone to `.env` locally but not to Render's env
  vars means the deployed server never sees them as root, so they'll
  show as Tier 2 (added via the app) instead of Tier 1 even though
  `.env` "looks right." This isn't a code bug, but it's a support
  question that's come up and will again — check Render's dashboard
  env vars first, not the code, if a supposedly-root admin shows Tier 2.
- **Adding an admin who already has access is now caught explicitly,**
  not a silent no-op or a generic error. `repo.addAdmin()` returns
  whether it created a genuinely new row (via `upsertedCount`), and the
  controller checks `botModule.isRootAdmin()` before that even runs —
  so trying to add an existing Tier 1 admin returns `already_root_admin`,
  an existing Tier 2 admin returns `already_admin`, distinct from a
  real `already` server error. Both "make admin" entry points (by ID,
  by name/email search) share one `addAdminErrorMessage()` helper in
  `app.js` so the wording can't drift apart between the two.

## Things that look like bugs but are NOT — leave alone unless asked

- Contact-on-Telegram button is Telegram brand blue, Rate button is the
  app's own teal-to-lighter-teal gradient. Deliberate — matches the
  icon/action's own source, not a color mismatch to "fix." Both buttons
  now share identical sizing (padding/radius/font) so they read as a
  matched pair despite the different colors — that part *was* a real
  bug (mismatched padding/radius/font-size between the two) and is
  fixed; don't let the two rules drift apart again if either is edited.
- The "Fashion Desinging"-style fragment sometimes visible at the very
  top of a profile detail screenshot is just the tail end of the
  Services section — a scroll-position artifact in screenshots, not a
  rendering bug.
- On-site jobs are only visible to freelancers within
  `ON_SITE_RADIUS_KM` (15km) who have also shared their own location.
  Remote jobs (`requires_on_site: false`) are visible to everyone,
  no distance logic applies. This is intentional, not a filtering bug.
- "Popular Categories" on Home is not actually popularity-ranked by any
  metric (listing count, search volume, etc.) — it's just every
  category in `Category`, alphabetically sorted, sliced to 10. Since
  there are exactly 10 default categories, all of them always show. The
  name is arguably misleading, but this is how it's always worked, not
  a broken ranking algorithm.
- A job's `category` field is free text the poster types in — it is
  **not** validated against or linked to the `Category` collection
  Popular Categories pulls from. Someone could type "plumbing" as a job
  category while the categories list has "repair & maintenance," and
  they'll never match. These are two independent systems that happen to
  share the word "category," not a bug where they've drifted apart.

## Feature/architecture decisions made, with reasoning

- **No in-app chat feature.** Discussed and deliberately deferred —
  Telegram's own native DM (via "Contact on Telegram") already handles
  messaging reliably; building custom chat would duplicate a lot of
  infrastructure (storage, real-time delivery, moderation) for a
  marginal "stay in app" benefit. If privacy (not exposing a Telegram
  handle) becomes the actual driver later, a bot-relayed message system
  was floated as a lighter middle path — not built yet.
- **"Contact on Telegram" uses `tg.openTelegramLink()`, not a plain
  `<a href="https://t.me/...">`.** A raw link fully closed the mini app
  on handoff; `openTelegramLink()` is Telegram's own method for this
  exact handoff and (since Bot API 7.0) doesn't close the mini app when
  called. Leaving to an actual different chat is still inherent to what
  "contact via DM" means — this only smooths the transition, it can't
  avoid leaving entirely.
- **Job Board ("billboard") feature** — full stack: `JobPost` model,
  `jobRepository.js`, `jobController.js`, `jobRoutes.js` (mounted at
  `/api/jobs`), plus a full frontend tab (list/detail/post/respond) in
  `webapp/`. Statuses: `open`, `fulfilled`, `closed`.
- **Manage Admins supports three ways to add someone:** search by name/
  email (reuses the same `search_listings` backend Search Listings
  uses, just with a "Make Admin" button instead of moderation actions),
  or enter a Telegram ID directly. The admin list itself renders as
  individual rows in a fixed-height scrollable container (not a giant
  page-length list, not a flat comma-joined text blob — both were real,
  separately-fixed problems at different points), each tagged Tier 1
  (red border) or Tier 2 (orange border).
- **Search Listings has never supported searching by Mongo `_id`** —
  only case-insensitive partial match on name/email. The placeholder
  text used to claim ID search existed; that was just a stale label,
  fixed to match actual behavior rather than the other way around.
- **Suspend/Ban/Delete already apply equally to both Freelancers and
  Customers** — there's no `userType` filter anywhere in
  `adminSearchListings`, `suspendListing`, `banAndDeleteEntrepreneur`,
  etc. This was true before it was explicitly asked for; nothing needed
  to change to satisfy that requirement, it was just confirmed.
- **Audit log genuinely works** — every mutating admin action
  (broadcast, add/remove admin, suspend/unsuspend, ban, force-remove,
  hide/unhide/delete review, feature/unfeature, category add/delete,
  service merge) calls `logAdminAction()`. It's not auto-loaded when the
  Admin tab opens, though — there's a "Load Audit Log" button that has
  to be tapped to fetch the most recent 30 entries. If someone reports
  "the audit log doesn't show anything," check whether they tapped that
  button before assuming the logging itself is broken.

## How to verify a fresh upload before trusting it

1. `node --check` every `.js` file (backend and `webapp/app.js`).
2. Static-check that every relative `require()` resolves to a real file
   — this project has regressed on `server.js`'s paths more than once.
3. Grep for `Number(` near anything with `.id` or `dataset` — should
   never appear for entrepreneur/job IDs (Telegram IDs are the
   exception, see above).
4. Grep for `onclick="` — should be zero matches anywhere in `app.js`.
5. Grep for `escapeHtml(escapeHtml(` or any nested double-escape pattern
   — should be zero matches.
6. Diff against the previous known-good version before assuming new
   changes are additive-only; more than once an upload has been based
   on an older snapshot and silently reverted a prior fix. Diff every
   file that changed, not just the ones a commit message mentions —
   more than once an upload changed files nobody mentioned changing.
7. Check `suspended`/`suspendedUntil` are always read together through
   `isCurrentlySuspended()`/`notSuspendedFilter()`, never `doc.suspended`
   alone — a query filter or output field reading just the boolean will
   silently ignore time-based expiry.

- **`safeAlert`/`safeConfirm` are used for every alert/confirm dialog in
  the app**, not just the jobs feature where they started. Plain
  `tg.showAlert`/`tg.showConfirm` require a fairly recent Telegram Bot
  API version; on an older client they silently no-op (no dialog, no
  callback, so whatever action was gated behind "confirm" just never
  happens) with nothing to indicate why. `safeAlert`/`safeConfirm` fall
  back to `alert()`/`window.confirm()` when the real ones aren't
  available. Don't add a new `tg.showAlert`/`tg.showConfirm` call
  anywhere — use the safe wrappers.
- **"Manage Admins" is one section**, not split across two. It used to
  briefly be two separate cards ("Manage Admins" + "Promote User to
  Admin") from an intermediate upload — merged back into one: the admin
  list always shows at the top, search-by-name/email to promote someone
  sits in the middle, add-by-Telegram-ID directly is the fallback at the
  bottom. Don't split this back into two sections without being asked
  — it was confusing to have the same underlying feature (making
  someone an admin) spread across two different UI cards.

## Security audit (adversarial review)

A full pass looking specifically for exploitable bugs — auth bypass,
IDOR, mass assignment, injection, XSS, SSRF, information disclosure.
Two real issues found and fixed; everything else held up. Documenting
both what was fixed and what was checked and found solid, so a future
session doesn't have to redo this whole pass from scratch.

### Fixed

- **`GET /api/photo/:id` bypassed the ban check.** It used to run
  without the `authUser` middleware at all, re-implementing the same
  `validateInitData` check manually inline instead (because an `<img
  src>` tag can't easily go through the normal fetch-based auth flow).
  That was still genuinely authenticated — just not through the shared
  middleware, which is where the ban check (added later) actually
  lives. Net effect: a banned identity could still fetch photos, the
  one authenticated action in the app a ban didn't block. Fixed by
  routing it through `authUser` like every other route — `getInitData()`
  already reads `initData` from the query string for GET requests,
  which is exactly how `photoUrl()` in `app.js` was already calling it,
  so nothing on the frontend needed to change.
- **`phoneVerified` and `photoFileId` removed from `ALLOWED_FIELDS`**
  in `repository.js`. Neither was actually reachable through the
  register/upgrade controllers (both build their `fields` object by
  hand-picking named `body.x` properties, never spreading `req.body`
  wholesale — so this wasn't a live, exploitable hole), but both sitting
  in a generic client-writable whitelist was a real latent risk: if a
  future change ever got looser about how `fields` gets built (a
  spread, a new endpoint that forwards more of the body), `phoneVerified`
  becomes fake-able (bypassing real OTP verification) and `photoFileId`
  becomes attacker-controlled input into a server-side outbound request
  to Telegram's `getFile` API in `getPhoto()`. Removing them doesn't
  change any current behavior — `phoneVerified` is still set correctly,
  just via the explicit, trusted `PhoneVerification`-collection check a
  few lines below the whitelist filter, same as before; `photoFileId`
  isn't set anywhere in the current app at all. If either genuinely
  needs to become client-settable later, build a specific validated
  path for it — don't just add it back to this list.

### Checked and confirmed solid (no change needed)

- **`validateInitData()`** (`src/lib/telegramAuth.js`) — correct HMAC
  derivation per Telegram's own spec, `crypto.timingSafeEqual` for the
  hash comparison (not a plain `===`, which would leak timing
  information about how much of the hash matched), and an expiry check
  against `auth_date`. No flaw found.
- **Every route requiring auth actually has `authUser`/`authAdmin`** —
  checked the full route table across all five route files. `/photo/:id`
  was the one gap, now fixed (see above).
- **IDOR** — checked every controller that takes an ID from the client
  (jobs, favorites, ratings, notifications, admin actions). Job
  close/delete (`setJobStatus`/`deleteJobPost` in `jobRepository.js`)
  enforce ownership at the *query* level (`{_id, posterTelegramId}`
  together), not just app logic — can't be bypassed by knowing someone
  else's job ID. Notifications are scoped to `req.user.id` with no ID
  parameter accepted from the client at all.
- **Self-rating and self-favoriting are blocked server-side**, not just
  hidden in the UI. `rateEntrepreneurById()` and `addFavorite()` both
  check the target's real `telegramId` against the caller's before
  writing anything — calling either API directly with someone's own ID
  fails the same way the UI button not showing implies it should.
- **Rating spam** — submitting a second rating updates the rater's
  existing entry in place rather than adding a new one, so the same
  person can't stack multiple ratings to skew an average.
- **NoSQL/regex injection** — every place user input builds a `RegExp`
  (search, admin search, audit-adjacent name matching) goes through
  `escapeRegex()`, and that function's character class is complete
  (escapes all of `. * + ? ^ $ { } ( ) | [ ] \`). No gaps found, no
  ReDoS surface from unescaped user input.
- **XSS** — scanned every template literal in `app.js` for user-controlled
  fields (name, description, title, message, comment, reason, etc.)
  inserted without `escapeHtml()`. The few hits that came back
  unescaped (`colorForName()`, `categoryIconHtml()`) only ever use the
  string as a hash/lookup key internally, never render it — confirmed
  by reading both functions, not just the call site.
- **Error handling doesn't leak internals** — the global Express error
  handler (`server.js`) logs the real error server-side but only ever
  sends the client a generic `{error: "internal_error"}`, no stack
  trace or message detail.

### Lower-priority, flagged but not fixed

- **No rate limiting anywhere** — registration, job posting, rating,
  and broadcast can all be called as fast as a client wants. Not
  exploitable for privilege escalation or data access, but a real spam/
  abuse surface (e.g., an admin account — even a newly-added Tier 2 one
  — could hammer `broadcast` repeatedly with no throttle). Worth real
  rate-limiting middleware if this becomes a practical problem; didn't
  build it preemptively since there's no evidence yet it's been abused.
- **`broadcast` has no message length cap** app-side — low severity
  since Telegram's own API enforces a 4096-character limit and simply
  rejects anything longer (a failed send per recipient, not a crash).
- **`POST /api/admin/feature`'s `listing_id` isn't validated as a
  well-formed ObjectId before use** — an admin sending garbage gets a
  generic 500 (global error handler catches it, no crash, no leak),
  not a clean 400. Cosmetic robustness gap, admin-only, low priority.

## Two real bugs, found together, worth understanding as a pair

- **The Mongo connection env var got silently renamed from
  `MONGODB_URI` to `MONGODB_URL`** at some point in `src/config/db.js`,
  by an upload from a different model session — not something built
  here. Since Render's actual env var is `MONGODB_URI` (established
  from this project's very first fix, still what `.env.example`
  documents), that made `process.env.MONGODB_URI` always undefined on
  the deployed server. Because `connect()` falls back to
  `mongodb://localhost:27017/growthhub` when the env var is missing,
  and because *something* apparently answered at whatever
  `MONGODB_URL` resolved to (the server started up cleanly, no crash,
  no connection-error loop in Render's logs), the app was quietly
  connected to the wrong — likely empty — database the whole time.
  That's what "opens fine but acts like I've never registered, even
  though my data's still in MongoDB" looks like: not a broken
  registration flow, a clean connection to the wrong place. Fixed back
  to `MONGODB_URI`, plus added a startup warning if that var is ever
  missing again, so this fails loudly next time instead of silently.
  **Never rename this env var in code without renaming it on Render
  too** (or vice versa) — they have to match exactly.
- **Bot now runs on a webhook, not polling.** `{ polling: true }` means
  this process itself repeatedly asks Telegram "any updates for me?" —
  and Telegram only allows one active poller per bot token at a time.
  Render's zero-downtime deploys briefly run the old and new instance
  side by side, so for a few seconds both were polling simultaneously
  — exactly what produces `409 Conflict: terminated by other getUpdates
  request`. A webhook has no such constraint: Telegram pushes updates
  to a URL instead of two processes racing to ask. `buildBot()` now
  takes the Express `app` as a parameter (called as
  `botModule.buildBot(app)` from `server.js`), registers
  `POST /telegram-webhook/:token` on it, and calls `bot.setWebHook()`
  once at startup pointed at `${WEBAPP_URL}/telegram-webhook/${token}`.
  The token in the URL path isn't a real auth mechanism — Telegram
  doesn't send any secret back — it's just enough that the endpoint
  can't be trivially guessed by someone who doesn't already have the
  bot token, which they'd need for anything meaningful anyway. **This
  requires `WEBAPP_URL` to be set to the real public HTTPS URL** — if
  it's missing, the bot has no webhook registered and won't receive
  any messages at all (a startup warning now says so explicitly rather
  than failing silently). Don't switch this back to `{ polling: true }`
  without a real reason — that's what caused the 409 in the first place.

