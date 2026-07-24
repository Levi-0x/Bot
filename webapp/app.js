/*
  app.js — GrowthHub Mini App
  --------------------------------
  Drives the whole single-page app: Home, Explore, Profile, and the
  5-step Register/Edit flow (grouping the 8 requested fields into
  logical steps: Basic Info, Services, Contact, Photo, Verification).
*/

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const AVATAR_COLORS = ["#0F9B8E", "#14213D", "#FCA311", "#4A6FA5"];

function colorForName(name) {
  let hash = 0;
  for (const char of name || "") hash = (hash * 31 + char.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0].toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function renderSocialPlatformsDisplay(profile) {
  let platforms = [];
  if (profile.social_platforms) {
    try {
      const parsed = typeof profile.social_platforms === "string"
        ? JSON.parse(profile.social_platforms)
        : profile.social_platforms;
      if (Array.isArray(parsed)) platforms = parsed;
    } catch(e) { /* ignore */ }
  }
  // Backwards compat: show old socials field as a tag
  if (!platforms.length && profile.socials) {
    platforms = [{ platform: "other", handle: profile.socials }];
  }
  if (!platforms.length) return "";

  const platDefs = {
    instagram: { icon: "📸", label: "Instagram", color: "#E4405F" },
    twitter: { icon: "𝕏", label: "X", color: "#1DA1F2" },
    facebook: { icon: "📘", label: "Facebook", color: "#1877F2" },
    linkedin: { icon: "💼", label: "LinkedIn", color: "#0A66C2" },
    tiktok: { icon: "🎵", label: "TikTok", color: "#010101" },
    youtube: { icon: "▶️", label: "YouTube", color: "#FF0000" },
    whatsapp: { icon: "💬", label: "WhatsApp", color: "#25D366" },
    telegram: { icon: "✈️", label: "Telegram", color: "#0088CC" },
    snapchat: { icon: "👻", label: "Snapchat", color: "#FFFC00" },
    pinterest: { icon: "📌", label: "Pinterest", color: "#BD081C" },
    website: { icon: "🌐", label: "Web", color: "#6B7280" },
    other: { icon: "🔗", label: "", color: "#6B7280" },
  };

  const tagsHtml = platforms.map(sp => {
    const def = platDefs[sp.platform] || platDefs.other;
    const displayHandle = sp.handle || "";
    return `<span class="social-tag" style="background:${def.color}20;color:${def.color};border:1px solid ${def.color}40;">
      <span class="social-tag-icon">${def.icon}</span>
      <span>${escapeHtml(displayHandle)}</span>
    </span>`;
  }).join("");

  return `
    <div class="social-display-section">
      <div class="section-head"><h2>Social Media</h2></div>
      <div class="social-tags-wrap">${tagsHtml}</div>
    </div>`;
}

function renderSocialPlatformsDisplayPublic(profile) {
  return renderSocialPlatformsDisplay(profile);
}

function checkCircleHtml(title) {
  return `<span class="check-circle" title="${escapeHtml(title)}"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="white" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

function avatarHtml(entrepreneur, size) {
  const style = size ? `width:${size}px;height:${size}px;font-size:${size * 0.34}px;` : "";
  if (entrepreneur.id && (entrepreneur.photo_base64 || entrepreneur.photo_file_id)) {
    return `<div class="avatar-circle" style="${style}"><img src="${photoUrl(entrepreneur.id)}" alt="" onerror="this.remove()"></div>`;
  }
  return `<div class="avatar-circle" style="background:${colorForName(entrepreneur.name)};${style}">${initials(entrepreneur.name)}</div>`;
}

// Every directory endpoint now requires proof this request genuinely came
// from inside the Mini App (valid initData) — otherwise anyone with a
// script could scrape every phone number, email, and photo in bulk from
// outside Telegram entirely. This helper keeps that from getting missed
// on any individual call.
function photoUrl(entrepreneurId) {
  return `/api/photo/${entrepreneurId}?initData=${encodeURIComponent(tg.initData)}`;
}

// ---- API helpers ----
async function apiGet(path) {
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${separator}initData=${encodeURIComponent(tg.initData)}`);
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

// ============================================================
// Navigation
// ============================================================
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");

  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  const navBtn = document.querySelector(`.nav-btn[data-nav="${name}"]`);
  if (navBtn) navBtn.classList.add("active");

  if (name === "explore") loadExplore();
  if (name === "profile") loadProfile();
  if (name === "home") loadHome();
  if (name === "admin") loadAdminPanel();
}

document.querySelectorAll("[data-nav]").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.nav)));
document.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", () => showView(el.dataset.goto)));

// ============================================================
// HOME
// ============================================================
let homeAllServices = [];
let homeActiveType = "all";

function renderResultCard(r) {
  const ratingText = r.avg_rating ? `⭐ ${r.avg_rating} (${r.rating_count} ratings)` : "No ratings yet";
  const serviceLabel = r.service || (r.services && r.services[0]) || "";
  const contactParts = [r.phone, r.socials].filter(Boolean).join(" · ");
  return `
    <div class="result-card" data-open-id="${r.id}">
      ${avatarHtml(r)}
      <div class="result-info">
        <h3>${escapeHtml(r.name)}</h3>
        <p class="result-service">${escapeHtml(serviceLabel)}</p>
        <p class="result-rating">${ratingText}</p>
        <p class="result-contact">${escapeHtml(contactParts)}</p>
      </div>
    </div>`;
}

// Attach click-to-open-detail on every rendered results container.
// Called after any innerHTML update that includes result-cards.
function wireResultCardClicks(container) {
  container.querySelectorAll("[data-open-id]").forEach((card) => {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => openDetail(Number(card.dataset.openId)));
  });
}

function emptyState(message) {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none"><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <p>${message}</p>
    </div>`;
}

async function loadHome() {
  const user = tg.initDataUnsafe?.user;
  document.getElementById("homeUserName").textContent = user?.first_name || "there";
  document.getElementById("homeAvatar").textContent = initials(user?.first_name || "?");

  const [services, top, categories] = await Promise.all([
    apiGet("/api/services"),
    apiGet("/api/top?limit=5"),
    apiGet("/api/categories"),
  ]);

  homeAllServices = services;

  // Render category tiles (filtered by type)
  renderHomeCategories(services);

  // Render category chip tiles
  renderHomeCategoryChips(categories);

  document.getElementById("homeTop").innerHTML = top.length
    ? top.map(renderResultCard).join("")
    : emptyState("No entrepreneurs listed yet.");
  wireResultCardClicks(document.getElementById("homeTop"));

  // Setup type tabs
  setupHomeTypeTabs();
}

function renderHomeCategories(services) {
  const container = document.getElementById("homeCategories");
  const filtered = homeActiveType === "all"
    ? services.slice(0, 8)
    : services.filter(s => (s.category || "service") === homeActiveType).slice(0, 8);

  container.innerHTML = filtered.length
    ? filtered.map(s => `
      <button class="category-tile" data-service="${escapeHtml(s.name)}">
        <span class="cat-icon" style="background:${colorForName(s.name)}">${s.name[0].toUpperCase()}</span>
        <span>${escapeHtml(s.name)}</span>
      </button>`).join("")
    : emptyState("No services in this category yet.");

  container.querySelectorAll(".category-tile").forEach(tile => {
    tile.addEventListener("click", () => {
      showView("explore");
      const q = tile.dataset.service;
      setTimeout(() => {
        document.getElementById("searchInput").value = q;
        runSearch(q);
      }, 0);
    });
  });
}

function renderHomeCategoryChips(categories) {
  const container = document.getElementById("homeCategoryTiles");
  container.innerHTML = categories.slice(0, 10).map(c => `
    <button class="category-chip" data-category="${escapeHtml(c.name)}">
      <span class="category-chip-icon" style="background:${escapeHtml(c.color)}">${escapeHtml(c.icon)}</span>
      <span>${escapeHtml(c.name)}</span>
    </button>`).join("");

  container.querySelectorAll(".category-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      showView("explore");
      setTimeout(() => {
        const catName = chip.dataset.category;
        // Filter explore chips to this category
        document.getElementById("searchInput").value = catName;
        runSearch(catName);
      }, 0);
    });
  });
}

function setupHomeTypeTabs() {
  document.querySelectorAll("#view-home .type-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#view-home .type-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      homeActiveType = tab.dataset.type;
      renderHomeCategories(homeAllServices);
    });
  });
}

// Home search functionality
let homeSearchTimer = null;
const homeSearchInput = document.getElementById("homeSearchInput");
const homeSearchResults = document.getElementById("homeSearchResults");
const homeDefaultContent = document.getElementById("homeDefaultContent");
const homeSearchClear = document.getElementById("homeSearchClear");

if (homeSearchInput) {
  homeSearchInput.addEventListener("input", (e) => {
    const q = e.target.value.trim();
    homeSearchClear.style.display = q ? "block" : "none";

    if (homeSearchTimer) clearTimeout(homeSearchTimer);
    if (q.length > 1) {
      homeSearchTimer = setTimeout(async () => {
        homeDefaultContent.style.display = "none";
        homeSearchResults.style.display = "flex";
        const results = await apiGet(`/api/find?service=${encodeURIComponent(q)}`);
        homeSearchResults.innerHTML = results.length
          ? results.map(renderResultCard).join("")
          : emptyState(`No results for "${escapeHtml(q)}". Try another search.`);
        wireResultCardClicks(homeSearchResults);
      }, 300);
    } else {
      homeDefaultContent.style.display = "block";
      homeSearchResults.style.display = "none";
    }
  });

  homeSearchClear.addEventListener("click", () => {
    homeSearchInput.value = "";
    homeSearchClear.style.display = "none";
    homeDefaultContent.style.display = "block";
    homeSearchResults.style.display = "none";
  });
}

// ============================================================
// EXPLORE
// ============================================================
let exploreServicesCache = [];
let exploreActiveType = "all";

async function loadExplore() {
  if (!exploreServicesCache.length) {
    exploreServicesCache = await apiGet("/api/services");
  }
  renderExploreChips();
  setupExploreTypeTabs();
}

function renderExploreChips() {
  const chipContainer = document.getElementById("exploreChips");
  const filtered = exploreActiveType === "all"
    ? exploreServicesCache
    : exploreServicesCache.filter(s => (s.category || "service") === exploreActiveType);

  chipContainer.innerHTML =
    `<button class="chip active" data-chip="all">All</button>` +
    filtered.slice(0, 10).map((s) => `<button class="chip" data-chip="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`).join("");

  chipContainer.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chipContainer.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const value = chip.dataset.chip === "all" ? "" : chip.dataset.chip;
      document.getElementById("searchInput").value = value;
      runSearch(value);
    });
  });
}

function setupExploreTypeTabs() {
  document.querySelectorAll("#view-explore .type-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#view-explore .type-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      exploreActiveType = tab.dataset.type;
      renderExploreChips();
      // Re-run search if there's a query
      const q = document.getElementById("searchInput").value.trim();
      if (q) runSearch(q);
    });
  });
}

async function runSearch(query) {
  const container = document.getElementById("exploreResults");
  if (!query) {
    container.innerHTML = "";
    return;
  }
  const typeParam = exploreActiveType !== "all" ? `&type=${exploreActiveType}` : "";
  const results = await apiGet(`/api/find?service=${encodeURIComponent(query)}${typeParam}`);
  container.innerHTML = results.length
    ? results.map(renderResultCard).join("")
    : emptyState(`We couldn't find anyone for "${escapeHtml(query)}". Try another search.`);
  wireResultCardClicks(container);
}

document.getElementById("searchInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  document.querySelectorAll("#exploreChips .chip").forEach((c) => c.classList.remove("active"));
  if (q.length > 1) runSearch(q);
  else document.getElementById("exploreResults").innerHTML = "";
});

// ============================================================
// PROFILE
// ============================================================
let currentProfile = null;

async function loadProfile() {
  const container = document.getElementById("profileContent");
  const res = await fetch(`/api/profile?initData=${encodeURIComponent(tg.initData)}`);

  if (res.status === 401) {
    container.innerHTML = emptyState("Couldn't verify your Telegram account. Try reopening the app from the bot.");
    return;
  }

  const profile = await res.json();
  currentProfile = profile;

  if (!profile) {
    container.innerHTML = `
      <div class="profile-cta">
        <div class="avatar-circle" style="background:var(--secondary);width:56px;height:56px;margin:0 auto 10px;">
          <svg viewBox="0 0 24 24" fill="none" style="width:24px;height:24px;"><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.4" stroke-linecap="round"/></svg>
        </div>
        <h3>You're not listed yet</h3>
        <p>Create your listing so people searching for your services can find you.</p>
        <button class="btn-primary" id="registerCta">Register as Entrepreneur</button>
      </div>`;
    document.getElementById("registerCta").addEventListener("click", () => openStepper(null));
    return;
  }

  const ratingText = profile.avg_rating ? `⭐ ${profile.avg_rating} (${profile.rating_count} reviews)` : "No ratings yet";
  const memberSince = profile.created_at ? profile.created_at.slice(0, 4) : "—";

  container.innerHTML = `
    <div class="profile-header-card">
      ${avatarHtml(profile, 68)}
      <h2>${escapeHtml(profile.name)}</h2>
      <p class="tagline">${escapeHtml(profile.services.join(", ")) || "No services yet"}</p>
      <p class="rating-line">${ratingText}</p>
      <div class="stat-row">
        <div class="stat"><b>${profile.services.length}</b><span>Services</span></div>
        <div class="stat"><b>${profile.rating_count}</b><span>Reviews</span></div>
        <div class="stat"><b>${memberSince}</b><span>Member Since</span></div>
      </div>
    </div>
    ${renderSocialPlatformsDisplay(profile)}
    <div class="detail-list">
      <div class="detail-row"><span class="label">Phone</span><span class="value">${escapeHtml(profile.phone) || "—"}${profile.phone_verified ? ` ${checkCircleHtml("Confirmed via Telegram")}` : ""}</span></div>
      <div class="detail-row"><span class="label">Email</span><span class="value">${escapeHtml(profile.email) || "—"}</span></div>
      <div class="detail-row"><span class="label">Business address</span><span class="value">${escapeHtml(profile.business_address) || "—"}</span></div>
      <div class="detail-row"><span class="label">Website</span><span class="value">${escapeHtml(profile.website) || "—"}</span></div>
      <div class="detail-row"><span class="label">Home address<span class="private-badge">Private</span></span><span class="value">${escapeHtml(profile.home_address) || "—"}</span></div>
    </div>
    <div class="menu-list">
      <div class="menu-item" id="editListingBtn">Edit My Listing<span class="chevron">›</span></div>
      <div class="menu-item danger" id="removeListingBtn">Remove My Listing<span class="chevron">›</span></div>
    </div>`;

  document.getElementById("editListingBtn").addEventListener("click", () => openStepper(profile));
  document.getElementById("removeListingBtn").addEventListener("click", () => {
    tg.showConfirm("Remove your listing? This can't be undone.", async (confirmed) => {
      if (!confirmed) return;
      await apiPost("/api/unregister", { initData: tg.initData });
      tg.showAlert("You've been removed from the list.");
      loadProfile();
    });
  });
}

// ============================================================
// ENTREPRENEUR DETAIL (public page — reached by tapping a search result)
// ============================================================
let detailReturnView = "explore";

async function openDetail(entrepreneurId) {
  const activeView = document.querySelector(".view.active");
  // Only remember where we came FROM if we're not already on the detail
  // page — otherwise refreshing after a rating overwrites the return
  // target with "detail" itself, which is exactly why Back stopped working.
  if (activeView && activeView.id !== "view-detail") {
    detailReturnView = activeView.id.replace("view-", "");
  }

  showView("detail");
  const container = document.getElementById("detailContent");
  container.innerHTML = `<p class="hint" style="text-align:center;color:var(--text-muted);padding:40px 0;">Loading...</p>`;

  const res = await fetch(`/api/entrepreneur/${entrepreneurId}?initData=${encodeURIComponent(tg.initData)}`);
  if (!res.ok) {
    container.innerHTML = emptyState("This listing couldn't be found — it may have been removed.");
    return;
  }
  const profile = await res.json();
  const reviews = await apiGet(`/api/reviews/${entrepreneurId}`);
  const ratingText = profile.avg_rating ? `⭐ ${profile.avg_rating} (${profile.rating_count} reviews)` : "No ratings yet";
  const phoneVerifiedBadge = profile.phone_verified ? ` ${checkCircleHtml("Confirmed via Telegram")}` : "";

  const reviewsHtml = reviews.length
    ? reviews.map((rev) => `
        <div class="review-card">
          <div class="review-head">
            <b>${escapeHtml(rev.rater_name || "Anonymous")}</b>
            <span class="review-stars">${"★".repeat(rev.score)}${"☆".repeat(5 - rev.score)}</span>
          </div>
          ${rev.comment ? `<p class="review-comment">${escapeHtml(rev.comment)}</p>` : ""}
        </div>`).join("")
    : `<p class="field-hint">No reviews yet — be the first to rate ${escapeHtml(profile.name)}.</p>`;

  container.innerHTML = `
    <div class="profile-header-card">
      ${avatarHtml(profile, 68)}
      <h2>${escapeHtml(profile.name)}</h2>
      <p class="tagline">${escapeHtml(profile.services.join(", ")) || ""}</p>
      <p class="rating-line">${ratingText}</p>
    </div>
    ${renderSocialPlatformsDisplay(profile)}
    <div class="detail-list">
      <div class="detail-row"><span class="label">Phone</span><span class="value">${escapeHtml(profile.phone) || "—"}${phoneVerifiedBadge}</span></div>
      <div class="detail-row"><span class="label">Email</span><span class="value">${escapeHtml(profile.email) || "—"}</span></div>
      <div class="detail-row"><span class="label">Business address</span><span class="value">${escapeHtml(profile.business_address) || "—"}</span></div>
      <div class="detail-row"><span class="label">Website</span><span class="value">${escapeHtml(profile.website) || "—"}</span></div>
    </div>
    <button class="btn-primary" id="detailRateBtn">Rate ${escapeHtml(profile.name)}</button>

    <div class="section-head" style="margin-top:22px;"><h2>Reviews</h2></div>
    <div class="reviews-list">${reviewsHtml}</div>`;

  document.getElementById("detailRateBtn").addEventListener("click", () => openRatingModal(entrepreneurId, profile.name));
}

// ---- Custom rating modal ----
// Not using tg.showPopup here: Telegram caps popups at 3 buttons, and we
// need 5 (one per star) plus Cancel — that's exactly why the old version
// silently did nothing. A plain in-page modal has no such limit.
function openRatingModal(entrepreneurId, name) {
  let selectedScore = 0;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>Rate ${escapeHtml(name)}</h3>
      <p class="field-hint">Tap a star, then add a comment if you'd like.</p>
      <div class="star-row">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="star-btn" data-score="${n}">★</button>`).join("")}
      </div>
      <textarea id="ratingComment" rows="3" placeholder="Optional — share what your experience was like"></textarea>
      <button class="btn-primary" id="ratingSubmitBtn">Submit Rating</button>
      <button class="btn-secondary" id="ratingCancelBtn">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);

  const starButtons = overlay.querySelectorAll(".star-btn");
  starButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedScore = Number(btn.dataset.score);
      starButtons.forEach((b) => b.classList.toggle("selected", Number(b.dataset.score) <= selectedScore));
    });
  });

  document.getElementById("ratingSubmitBtn").addEventListener("click", async () => {
    if (!selectedScore) {
      tg.showAlert ? tg.showAlert("Please tap a star first.") : alert("Please tap a star first.");
      return;
    }
    const comment = document.getElementById("ratingComment").value.trim();
    overlay.remove();
    const { ok } = await apiPost("/api/rate", { initData: tg.initData, entrepreneur_id: entrepreneurId, score: selectedScore, comment });
    tg.showAlert ? tg.showAlert(ok ? "Thanks for rating!" : "Something went wrong submitting your rating.")
                 : alert(ok ? "Thanks for rating!" : "Something went wrong submitting your rating.");
    if (ok) openDetail(entrepreneurId);
  });

  document.getElementById("ratingCancelBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

document.getElementById("detailBack").addEventListener("click", () => showView(detailReturnView));

// ============================================================
// STEPPER (5 steps: Basic Info, Services, Contact, Photo, Verification)
// ============================================================
let stepperTags = [];
let currentStep = 1;
let uploadedPhotoBase64 = null;
let verifiedPhoneNumber = null;   // set once /api/check_phone confirms verification
let phonePollTimer = null;
const TOTAL_STEPS = 5;

const SOCIAL_PLATFORMS = [
  { id: "instagram", label: "Instagram", icon: "📸", placeholder: "@username" },
  { id: "twitter", label: "X (Twitter)", icon: "𝕏", placeholder: "@username" },
  { id: "facebook", label: "Facebook", icon: "📘", placeholder: "facebook.com/username" },
  { id: "linkedin", label: "LinkedIn", icon: "💼", placeholder: "linkedin.com/in/username" },
  { id: "tiktok", label: "TikTok", icon: "🎵", placeholder: "@username" },
  { id: "youtube", label: "YouTube", icon: "▶️", placeholder: "@channel" },
  { id: "whatsapp", label: "WhatsApp", icon: "💬", placeholder: "+234..." },
  { id: "telegram", label: "Telegram", icon: "✈️", placeholder: "@username" },
  { id: "snapchat", label: "Snapchat", icon: "👻", placeholder: "username" },
  { id: "pinterest", label: "Pinterest", icon: "📌", placeholder: "pinterest.com/username" },
  { id: "website", label: "Other Website", icon: "🌐", placeholder: "https://..." },
];

let socialPlatforms = []; // Array of { platform: "instagram", handle: "@janedoe" }

function renderSocialPlatforms() {
  const container = document.getElementById("socialPlatformsList");
  if (!container) return;

  container.innerHTML = socialPlatforms.map((sp, i) => {
    const platDef = SOCIAL_PLATFORMS.find(p => p.id === sp.platform) || SOCIAL_PLATFORMS[0];
    return `
      <div class="social-platform-row" data-index="${i}">
        <div class="social-platform-select-wrap">
          <select class="social-platform-select" data-index="${i}">
            ${SOCIAL_PLATFORMS.map(p =>
              `<option value="${p.id}" ${p.id === sp.platform ? "selected" : ""}>${p.icon} ${p.label}</option>`
            ).join("")}
          </select>
        </div>
        <input type="text" class="social-platform-handle" data-index="${i}"
               placeholder="${escapeHtml(platDef.placeholder)}"
               value="${escapeHtml(sp.handle)}" />
        <button type="button" class="social-platform-remove" data-index="${i}">&times;</button>
      </div>`;
  }).join("");

  // Bind events
  container.querySelectorAll(".social-platform-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.index);
      socialPlatforms[idx].platform = e.target.value;
      // Update placeholder
      const platDef = SOCIAL_PLATFORMS.find(p => p.id === e.target.value);
      const handleInput = container.querySelector(`.social-platform-handle[data-index="${idx}"]`);
      if (handleInput && platDef) handleInput.placeholder = platDef.placeholder;
    });
  });

  container.querySelectorAll(".social-platform-handle").forEach(input => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.index);
      socialPlatforms[idx].handle = e.target.value;
    });
  });

  container.querySelectorAll(".social-platform-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.index);
      socialPlatforms.splice(idx, 1);
      renderSocialPlatforms();
    });
  });
}

function addSocialPlatform() {
  if (socialPlatforms.length >= 11) {
    tg.showAlert ? tg.showAlert("You can add up to 11 social accounts.") : alert("You can add up to 11 social accounts.");
    return;
  }
  // Pick the next unused platform, or default to instagram
  const usedPlatforms = socialPlatforms.map(sp => sp.platform);
  const nextPlat = SOCIAL_PLATFORMS.find(p => !usedPlatforms.includes(p.id)) || SOCIAL_PLATFORMS[0];
  socialPlatforms.push({ platform: nextPlat.id, handle: "" });
  renderSocialPlatforms();
  // Focus the new handle input
  const handles = document.querySelectorAll(".social-platform-handle");
  if (handles.length) handles[handles.length - 1].focus();
}

function openStepper(existingProfile) {
  currentStep = 1;
  stepperTags = existingProfile ? [...existingProfile.services] : [];
  uploadedPhotoBase64 = null;
  verifiedPhoneNumber = existingProfile?.phone_verified ? existingProfile.phone : null;

  document.getElementById("stepName").value = existingProfile?.name || "";
  document.getElementById("stepEmail").value = existingProfile?.email || "";
  document.getElementById("stepBusinessAddress").value = existingProfile?.business_address || "";
  document.getElementById("stepWebsite").value = existingProfile?.website || "";
  document.getElementById("stepHomeAddress").value = existingProfile?.home_address || "";

  // Load social platforms from existing profile
  socialPlatforms = [];
  if (existingProfile?.social_platforms) {
    try {
      const parsed = typeof existingProfile.social_platforms === "string"
        ? JSON.parse(existingProfile.social_platforms)
        : existingProfile.social_platforms;
      if (Array.isArray(parsed)) socialPlatforms = parsed;
    } catch(e) { /* ignore parse errors */ }
  }
  // Backwards compat: if no social_platforms but there's old socials text, show it
  if (!socialPlatforms.length && existingProfile?.socials) {
    socialPlatforms = [{ platform: "instagram", handle: existingProfile.socials }];
  }
  renderSocialPlatforms();

  refreshPhoneVerifiedUI();
  checkPhoneVerification(); // in case they verified in an earlier session

  const previewImg = document.getElementById("photoPreviewImg");
  const placeholderIcon = document.getElementById("photoPlaceholderIcon");
  if (existingProfile?.id && (existingProfile.photo_base64 || existingProfile.photo_file_id)) {
    previewImg.src = photoUrl(existingProfile.id);
    previewImg.style.display = "block";
    placeholderIcon.style.display = "none";
    document.getElementById("photoUploadLabel").textContent = "Tap to change photo";
  } else {
    previewImg.style.display = "none";
    placeholderIcon.style.display = "block";
    document.getElementById("photoUploadLabel").textContent = "Upload a photo of yourself or your business";
  }

  document.getElementById("stepperTitle").textContent = existingProfile ? "Edit Your Listing" : "List Your Services";
  renderTags();
  goToStep(1);
  showView("stepper");
}

function renderTags() {
  const container = document.getElementById("serviceTags");
  container.innerHTML = stepperTags.map((t, i) => `<span class="tag-pill">${escapeHtml(t)}<button data-remove="${i}">×</button></span>`).join("");
  container.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      stepperTags.splice(Number(btn.dataset.remove), 1);
      renderTags();
    });
  });
}

// ---- Phone verification: real gating, not cosmetic ----
// Telegram delivers the verified number to the BOT chat (a message),
// not directly back to this webpage — so after requesting it, we poll
// our own backend every 2s until it shows up, then unlock. This is what
// makes "you can't continue without verifying" actually enforced rather
// than just a label, since the Next button stays disabled the whole time.
// Three visual states: button (not started) -> waiting spinner (polling)
// -> circular checkmark (confirmed). Only one is ever visible at a time.
function refreshPhoneVerifiedUI(state) {
  // state: "idle" | "waiting" | "verified" — inferred if not passed
  if (!state) state = verifiedPhoneNumber ? "verified" : "idle";

  const display = document.getElementById("phoneVerifiedDisplay");
  const waiting = document.getElementById("phoneWaitingState");
  const btn = document.getElementById("verifyPhoneBtn");
  const numberSpan = document.getElementById("phoneVerifiedNumber");
  const hint = document.getElementById("verifyPhoneHint");

  display.style.display = state === "verified" ? "flex" : "none";
  waiting.style.display = state === "waiting" ? "flex" : "none";
  btn.style.display = state === "idle" ? "block" : "none";

  if (state === "verified") {
    numberSpan.textContent = verifiedPhoneNumber;
    hint.textContent = "Verified — you're all set for this step.";
  } else if (state === "waiting") {
    hint.textContent = "";
  } else {
    hint.textContent = "Tap the button and approve the prompt Telegram shows you. That's it — no other steps needed.";
  }
}

async function checkPhoneVerification() {
  const { verified, phone } = await apiGet("/api/check_phone");
  if (verified) {
    verifiedPhoneNumber = phone;
    refreshPhoneVerifiedUI("verified");
    if (phonePollTimer) { clearInterval(phonePollTimer); phonePollTimer = null; }
  }
  return verified;
}

document.getElementById("verifyPhoneBtn").addEventListener("click", () => {
  if (typeof tg.requestContact !== "function") {
    const msg = "Your Telegram app version doesn't support this — please update Telegram to register.";
    tg.showAlert ? tg.showAlert(msg) : alert(msg);
    return;
  }
  tg.requestContact((shared) => {
    if (!shared) return;
    refreshPhoneVerifiedUI("waiting");
    if (phonePollTimer) clearInterval(phonePollTimer);
    let attempts = 0;
    phonePollTimer = setInterval(async () => {
      attempts++;
      const ok = await checkPhoneVerification();
      if (ok || attempts > 15) { // ~30s timeout
        clearInterval(phonePollTimer);
        phonePollTimer = null;
        if (!ok) {
          refreshPhoneVerifiedUI("idle");
          document.getElementById("verifyPhoneHint").textContent = "Still waiting — check your chat with the bot for a confirmation message, then tap Verify again.";
        }
      }
    }, 2000);
  });
});

document.getElementById("serviceEntry").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const value = e.target.value.trim().replace(/,$/, "");
    if (value) {
      stepperTags.push(value);
      renderTags();
    }
    e.target.value = "";
  }
});

// ---- Photo upload: pick a file, resize/compress it client-side, preview it ----
document.getElementById("photoUploadZone").addEventListener("click", () => document.getElementById("photoInput").click());

document.getElementById("photoInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      // Resize down to a max width so the base64 payload stays small
      const MAX_WIDTH = 640;
      const scale = Math.min(1, MAX_WIDTH / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      uploadedPhotoBase64 = canvas.toDataURL("image/jpeg", 0.75);

      const previewImg = document.getElementById("photoPreviewImg");
      previewImg.src = uploadedPhotoBase64;
      previewImg.style.display = "block";
      document.getElementById("photoPlaceholderIcon").style.display = "none";
      document.getElementById("photoUploadLabel").textContent = "Tap to change photo";
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

// Social platforms: add button
document.getElementById("addSocialPlatformBtn").addEventListener("click", addSocialPlatform);

function goToStep(step) {
  currentStep = step;
  document.querySelectorAll(".step-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector(`.step-panel[data-step-panel="${step}"]`).classList.add("active");

  document.querySelectorAll(".dot").forEach((dot) => {
    const dotStep = Number(dot.dataset.step);
    dot.classList.toggle("active", dotStep === step);
    dot.classList.toggle("done", dotStep < step);
  });

  document.getElementById("stepLabel").textContent = `Step ${step} of ${TOTAL_STEPS}`;
  document.getElementById("stepBackBtn").style.visibility = step === 1 ? "hidden" : "visible";
  document.getElementById("stepNextBtn").textContent = step === TOTAL_STEPS ? "Submit" : "Next";

  if (step === 5) {
    const hasBusinessAddress = document.getElementById("stepBusinessAddress").value.trim().length > 0;
    const badge = document.getElementById("homeAddressStepBadge");
    const labelBadge = document.getElementById("homeAddressLabelBadge");
    const explainer = document.getElementById("homeAddressExplainer");
    if (hasBusinessAddress) {
      badge.textContent = "optional";
      badge.className = "opt";
      labelBadge.textContent = "optional";
      labelBadge.className = "opt";
      explainer.textContent = "You've already added a business address, so this is optional — only fill it in if you'd like extra verification on file.";
    } else {
      badge.textContent = "*required";
      badge.className = "req";
      labelBadge.textContent = "*required";
      labelBadge.className = "req";
      explainer.textContent = "You didn't add a business address, so we need this instead — it's how we confirm real entrepreneurs for work-from-home services.";
    }
  }
}

document.getElementById("stepBackBtn").addEventListener("click", () => {
  if (currentStep > 1) goToStep(currentStep - 1);
});

document.getElementById("stepNextBtn").addEventListener("click", async () => {
  if (currentStep === 1) {
    const name = document.getElementById("stepName").value.trim();
    const email = document.getElementById("stepEmail").value.trim();
    if (!name) return tg.showAlert("Please enter your name.");
    if (!verifiedPhoneNumber) {
      // Double-check with the backend in case verification landed while they
      // weren't polling (e.g. they verified, closed the app, reopened later).
      const justVerified = await checkPhoneVerification();
      if (!justVerified) return tg.showAlert("Please verify your phone with Telegram before continuing.");
    }
    if (!email.includes("@") || !email.split("@").pop().includes(".")) return tg.showAlert("Please enter a valid email.");
    goToStep(2);
    return;
  }
  if (currentStep === 2) {
    if (!stepperTags.length) return tg.showAlert("Add at least one service.");
    goToStep(3);
    return;
  }
  if (currentStep === 3) {
    goToStep(4); // all fields on this step are optional
    return;
  }
  if (currentStep === 4) {
    if (!uploadedPhotoBase64 && !currentProfile?.id) return tg.showAlert("Please upload a photo.");
    goToStep(5);
    return;
  }

  // Step 5 -> submit
  const homeAddress = document.getElementById("stepHomeAddress").value.trim();
  const businessAddress = document.getElementById("stepBusinessAddress").value.trim();
  if (!homeAddress && !businessAddress) {
    return tg.showAlert("Add a business address, or a home address if you work from home — we need at least one.");
  }

  const payload = {
    initData: tg.initData,
    name: document.getElementById("stepName").value.trim(),
    email: document.getElementById("stepEmail").value.trim(),
    services: stepperTags,
    social_platforms: socialPlatforms.filter(sp => sp.handle.trim()),
    business_address: businessAddress,
    website: document.getElementById("stepWebsite").value.trim(),
    home_address: homeAddress,
    // Note: phone is deliberately NOT sent here — the backend always uses
    // whatever's in phone_verifications for this Telegram user, so there's
    // no path where an edited/fake number could sneak into the payload.
  };
  if (uploadedPhotoBase64) {
    payload.photo_base64 = uploadedPhotoBase64;
  } else if (currentProfile?.id) {
    payload.keep_existing_photo = true; // editing without re-uploading a photo
  }

  const { ok, data } = await apiPost("/api/register", payload);

  if (ok) {
    showView("success");
  } else if (data?.error === "phone_not_verified") {
    tg.showAlert("Your phone verification expired or wasn't found — please verify again on Step 1.");
    goToStep(1);
  } else {
    tg.showAlert(data?.error === "missing_fields" ? `Missing: ${data.fields.join(", ")}` : "Something went wrong. Please try again.");
  }
});

document.getElementById("stepperBack").addEventListener("click", () => showView("profile"));

// ============================================================
// Theme: subtle dark-mode support, palette otherwise stays fixed
// ============================================================
function applyTelegramTheme() {
  if (tg.colorScheme === "dark") {
    document.documentElement.style.setProperty("--bg", "#0F1115");
    document.documentElement.style.setProperty("--surface", "#1A1D24");
    document.documentElement.style.setProperty("--text", "#F5F6FA");
    document.documentElement.style.setProperty("--text-muted", "#9098B1");
    document.documentElement.style.setProperty("--border", "#2A2E3A");
    document.documentElement.style.setProperty("--secondary-soft", "#123531");
    // Deliberately NOT theming --input-text or form field backgrounds here.
    // Telegram's in-app browser has been unreliable about matching its
    // reported color scheme to what's actually rendered, which is exactly
    // what caused the grey/invisible text bug. Form fields now always
    // stay white-background/black-text (set in style.css), independent
    // of theme detection, so they can't break this way again.
  }
}
applyTelegramTheme();
tg.onEvent("themeChanged", applyTelegramTheme);

// ============================================================
// ADMIN PANEL
// ============================================================
// Admins are configured on the bot side (ADMIN_IDS env var / admins.txt),
// same list used for the bot's /stats, /broadcast, /forceremove commands.
// This just gives admins a visual alternative to typing those commands.

async function checkAdminAccess() {
  const res = await apiGet(`/api/admin/check?initData=${encodeURIComponent(tg.initData)}`);
  if (res.is_admin) {
    document.getElementById("adminNavBtn").style.display = "flex";
  }
}

async function loadAdminPanel() {
  const statsRes = await fetch(`/api/admin/stats?initData=${encodeURIComponent(tg.initData)}`);
  if (statsRes.status === 403) {
    document.getElementById("adminStats").innerHTML = emptyState("You don't have admin access.");
    return;
  }
  const stats = await statsRes.json();
  document.getElementById("adminStats").innerHTML = `
    <div class="stat-card"><b>${stats.entrepreneurs}</b><span>Entrepreneurs</span></div>
    <div class="stat-card"><b>${stats.services}</b><span>Services</span></div>
    <div class="stat-card"><b>${stats.ratings}</b><span>Ratings</span></div>`;

  await refreshAdminList();
}

async function refreshAdminList() {
  const res = await fetch(`/api/admin/list_admins?initData=${encodeURIComponent(tg.initData)}`);
  const data = await res.json();
  if (!res.ok) return;
  document.getElementById("adminListDisplay").innerHTML =
    `<b>Root (Render):</b> ${data.root_admins.join(", ") || "none"}<br>` +
    `<b>Added via app/bot:</b> ${data.added_admins.join(", ") || "none"}`;
}

document.getElementById("adminBack").addEventListener("click", () => showView("profile"));

document.getElementById("adminBroadcastBtn").addEventListener("click", () => {
  const message = document.getElementById("adminBroadcastText").value.trim();
  if (!message) return tg.showAlert("Write a message first.");

  tg.showConfirm(`Send this to every registered entrepreneur?\n\n"${message}"`, async (confirmed) => {
    if (!confirmed) return;
    const { ok, data } = await apiPost("/api/admin/broadcast", { initData: tg.initData, message });
    tg.showAlert(ok ? `Sent to ${data.sent} (${data.failed} failed).` : "Broadcast failed. Please try again.");
    if (ok) document.getElementById("adminBroadcastText").value = "";
  });
});


document.getElementById("addAdminBtn").addEventListener("click", async () => {
  const id = Number(document.getElementById("adminIdInput").value.trim());
  if (!id) return tg.showAlert("Enter a valid numeric Telegram ID.");
  const { ok } = await apiPost("/api/admin/add_admin", { initData: tg.initData, telegram_id: id });
  tg.showAlert(ok ? "✅ Admin added." : "Something went wrong.");
  if (ok) { document.getElementById("adminIdInput").value = ""; refreshAdminList(); }
});

document.getElementById("removeAdminBtn").addEventListener("click", async () => {
  const id = Number(document.getElementById("adminIdInput").value.trim());
  if (!id) return tg.showAlert("Enter a valid numeric Telegram ID.");
  const { ok, data } = await apiPost("/api/admin/remove_admin", { initData: tg.initData, telegram_id: id });
  if (data?.error === "is_root_admin") {
    tg.showAlert("That's a root admin (set in Render) — remove them there instead.");
  } else {
    tg.showAlert(ok && data.removed ? "Admin removed." : "That ID wasn't a bot-added admin.");
    if (ok && data.removed) { document.getElementById("adminIdInput").value = ""; refreshAdminList(); }
  }
});

document.getElementById("adminRemoveBtn").addEventListener("click", () => {
  const name = document.getElementById("adminRemoveName").value.trim();
  if (!name) return tg.showAlert("Enter a name first.");

  tg.showConfirm(`Remove the listing matching "${name}"? This can't be undone.`, async (confirmed) => {
    if (!confirmed) return;
    const { ok, data } = await apiPost("/api/admin/forceremove", { initData: tg.initData, name });
    tg.showAlert(ok && data.removed ? "Listing removed." : "No matching listing found.");
    if (ok && data.removed) document.getElementById("adminRemoveName").value = "";
  });
});

// ---- Boot ----
loadHome();
checkAdminAccess();
