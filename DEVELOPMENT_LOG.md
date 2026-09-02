# GrowthHub Node — Development Log & Do-Not-Change Notes

Read this before making changes. It exists because work has been lost or
reintroduced as "fixes" by different AI sessions that didn't have this
context. If you're an AI model picking this project up: check here first.

## Hard conventions — do not deviate

- **All mutating job/admin routes are POST-only** (`/api/jobs/:id/close`,
  `/api/jobs/:id/delete`, `/api/admin/listings/:id/suspend`, etc.) — NOT
  PATCH/DELETE, even though that might look more "correct" RESTfully.
  This was a deliberate standardization. Frontend must always call these
  with `apiPost`, never a PATCH/DELETE helper.
- **Entrepreneur and job IDs are Mongo ObjectId strings** (24 hex chars),
  never numbers. Never wrap one in `Number(...)`. This exact bug broke
  Home/Explore/Favorites card clicks AND the favorites remove button
  AND every admin listing action button at different points — same root
  cause, found and fixed multiple times. Don't reintroduce it.
- **Never build `onclick="fn(${value})"` by string interpolation.** An
  ObjectId string embedded unquoted is invalid JS syntax (breaks
  instantly, silently). A name/string with an apostrophe breaks a
  quoted one too. Use `data-*` attributes + `addEventListener` instead
  — this is the pattern used everywhere in the app now.
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

## Known real bug, not yet fixed (as of this log)

- **Rate / Contact-on-Telegram buttons can incorrectly show on your own
  profile.** The "is this my own profile?" check
  (`currentProfile?.id === entrepreneurId` in `webapp/app.js`, detail
  render function) relies on a global `currentProfile` variable that's
  only populated by visiting the Profile tab (`loadProfile()`). If a
  user opens their own listing via Search/Explore/Home without having
  visited Profile first this session, `currentProfile` is still empty,
  the check silently fails, and both buttons wrongly appear — including
  "Contact on Telegram," which would be contacting yourself.
  **Correct fix direction:** compare the viewed profile's own Telegram
  ID against `tg.initDataUnsafe.user.id` directly (fetch it if needed),
  not a tab-visit-dependent variable.

## Things that look like bugs but are NOT — leave alone unless asked

- Contact-on-Telegram button is Telegram brand blue (`#0088cc`), Rate
  button is the app's own teal (`var(--secondary)`). Deliberate —
  matches the icon/action's own source, not a color mismatch to "fix."
- The "Fashion Desinging"-style fragment sometimes visible at the very
  top of a profile detail screenshot is just the tail end of the
  Services section — a scroll-position artifact in screenshots, not a
  rendering bug.
- On-site jobs are only visible to freelancers within
  `ON_SITE_RADIUS_KM` (15km) who have also shared their own location.
  Remote jobs (`requires_on_site: false`) are visible to everyone,
  no distance logic applies. This is intentional, not a filtering bug.

## Feature/architecture decisions made, with reasoning

- **No in-app chat feature.** Discussed and deliberately deferred —
  Telegram's own native DM (via "Contact on Telegram") already handles
  messaging reliably; building custom chat would duplicate a lot of
  infrastructure (storage, real-time delivery, moderation) for a
  marginal "stay in app" benefit. If privacy (not exposing a Telegram
  handle) becomes the actual driver later, a bot-relayed message system
  was floated as a lighter middle path — not built yet.
- **Job Board ("billboard") feature** — full stack: `JobPost` model,
  `jobRepository.js`, `jobController.js`, `jobRoutes.js` (mounted at
  `/api/jobs`), plus a full frontend tab (list/detail/post/respond) in
  `webapp/`. Statuses: `open`, `fulfilled`, `closed`.

## How to verify a fresh upload before trusting it

1. `node --check` every `.js` file (backend and `webapp/app.js`).
2. Static-check that every relative `require()` resolves to a real file
   — this project has regressed on `server.js`'s paths more than once.
3. Grep for `Number(` near anything with `.id` or `dataset` — should
   never appear for entrepreneur/job IDs.
4. Grep for `onclick="` — should be zero matches anywhere in `app.js`.
5. Diff against the previous known-good version before assuming new
   changes are additive-only; more than once an upload has been based
   on an older snapshot and silently reverted a prior fix.
