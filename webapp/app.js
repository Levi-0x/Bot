/*
  app.js — GrowthHub Mini App
  Complete frontend logic for the redesigned UI.
*/

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const AVATAR_COLORS = ["#0F9B8E", "#14213D", "#FCA311", "#4A6FA5", "#E91E63", "#2ECC71"];

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
    } catch(e) {}
  }
  if (!platforms.length) return "";

  const platDefs = {
    instagram: { label: "Instagram", color: "#E4405F",
      svg: `<svg viewBox="0 0 24 24" fill="#E4405F"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>` },
    twitter: { label: "X", color: "#000000", lightBg: true,
      svg: `<svg viewBox="0 0 24 24" fill="#000000"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` },
    facebook: { label: "Facebook", color: "#1877F2",
      svg: `<svg viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>` },
    linkedin: { label: "LinkedIn", color: "#0A66C2",
      svg: `<svg viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>` },
    youtube: { label: "YouTube", color: "#FF0000",
      svg: `<svg viewBox="0 0 24 24" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>` },
  };

  const tagsHtml = platforms.map(sp => {
    const def = platDefs[sp.platform];
    if (!def) return "";
    const isLight = def.lightBg;
    const bgColor = isLight ? "#FFFFFF" : `${def.color}12`;
    const borderColor = isLight ? "#E0E0E0" : `${def.color}30`;
    const textColor = isLight ? "#333333" : def.color;
    return `<span class="social-tag" style="background:${bgColor};color:${textColor};border:1px solid ${borderColor};">
      <span class="social-tag-icon">${def.svg}</span>
      <span class="social-tag-label">${escapeHtml(def.label)}</span>
      <span class="social-tag-handle">${escapeHtml(sp.handle || "")}</span>
    </span>`;
  }).filter(Boolean).join("");

  if (!tagsHtml) return "";

  return `
    <div class="detail-section">
      <div class="detail-section-title">Social Media</div>
      <div class="social-tags-wrap">${tagsHtml}</div>
    </div>`;
}

function photoUrl(entrepreneurId) {
  return `/api/photo/${entrepreneurId}?initData=${encodeURIComponent(tg.initData)}`;
}

function avatarHtml(entrepreneur, size) {
  const style = size ? `width:${size}px;height:${size}px;font-size:${size * 0.34}px;` : "";
  if (entrepreneur.id && (entrepreneur.photo_base64 || entrepreneur.photo_file_id)) {
    return `<div class="avatar-circle" style="${style}"><img src="${photoUrl(entrepreneur.id)}" alt="" onerror="this.remove()"></div>`;
  }
  return `<div class="avatar-circle" style="background:${colorForName(entrepreneur.name)};${style}">${initials(entrepreneur.name)}</div>`;
}

// ---- API helpers ----
async function apiGet(path) {
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${separator}initData=${encodeURIComponent(tg.initData)}`);
  return res.json();
}

function asArray(data) {
  return Array.isArray(data) ? data : [];
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

function emptyState(message) {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 15s1.5-2 4-2 4 2 4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="9" x2="9.01" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="15" y1="9" x2="15.01" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <p>${message}</p>
    </div>`;
}

// ============================================================
// Navigation
// ============================================================
let currentView = "home";

function showView(name) {
  if (name === "stepper") {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-stepper").classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    currentView = name;
    return;
  }
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const navBtn = document.querySelector(`.nav-btn[data-nav="${name}"]`);
  if (navBtn) navBtn.classList.add("active");
  currentView = name;

  if (name === "home") loadHome();
  if (name === "explore") loadExplore();
  if (name === "favorites") loadFavorites();
  if (name === "profile") loadProfile();
  if (name === "admin") loadAdminPanel();
}

document.querySelectorAll("[data-nav]").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.nav));
});
document.querySelectorAll("[data-goto]").forEach(el => {
  el.addEventListener("click", () => showView(el.dataset.goto));
});

// ============================================================
// HOME
// ============================================================
async function loadHome() {
  const user = tg.initDataUnsafe?.user;
  const firstName = user?.first_name || "";
  const photoUrl = user?.photo_url;

  const storageKey = "growthhub_visited";
  const isFirstVisit = !localStorage.getItem(storageKey);
  const welcomeEl = document.getElementById("homeWelcomeText");
  const nameEl = document.getElementById("homeUserName");

  if (isFirstVisit) {
    welcomeEl.textContent = "Hello there";
    nameEl.textContent = firstName || "";
    localStorage.setItem(storageKey, "1");
  } else {
    welcomeEl.textContent = "Welcome back";
    nameEl.textContent = firstName || "there";
  }

  const avatarEl = document.getElementById("homeAvatar");
  if (photoUrl) {
    avatarEl.innerHTML = `<img src="${escapeHtml(photoUrl)}" alt="" onerror="this.parentElement.innerHTML='<svg viewBox=\\'0 0 24 24\\' fill=\\'none\\'><circle cx=\\'12\\' cy=\\'8\\' r=\\'4\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'/><path d=\\'M4 20c0-4 4-6 8-6s8 2 8 6\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' stroke-linecap=\\'round\\'/></svg>'">`;
  } else {
    avatarEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  }

  const [categories, top, recent, featured] = await Promise.all([
    asArray(await apiGet("/api/categories")),
    asArray(await apiGet("/api/top?limit=10")),
    asArray(await apiGet("/api/recent?limit=10")),
    asArray(await apiGet("/api/featured?limit=10")),
  ]);

  // Categories
  const chipContainer = document.getElementById("homeCategoryChips");
  chipContainer.innerHTML = categories.slice(0, 10).map(c => `
    <button class="category-chip" data-category="${escapeHtml(c.name)}">
      <span class="category-chip-icon" style="background:${escapeHtml(c.color)}">${escapeHtml(c.icon)}</span>
      <span>${escapeHtml(c.name)}</span>
    </button>`).join("");
  chipContainer.querySelectorAll(".category-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      showView("explore");
      setTimeout(() => {
        document.getElementById("searchInput").value = chip.dataset.category;
        runSearch(chip.dataset.category);
      }, 50);
    });
  });

  // Top
  renderCardScroll("homeTop", top);

  // Recent
  renderCardScroll("homeRecent", recent);

  // Trending (use top as proxy)
  if (top.length > 3) {
    document.getElementById("homeTrendingBlock").style.display = "block";
    renderCardScroll("homeTrending", top.slice(0, 8));
  }

  // Featured
  if (featured.length > 0) {
    document.getElementById("homeFeaturedBlock").style.display = "block";
    renderCardScroll("homeFeatured", featured);
  }
}

function renderCardScroll(containerId, items) {
  const container = document.getElementById(containerId);
  if (!items.length) {
    container.innerHTML = `<div class="empty-state" style="min-width:200px;"><p>No entrepreneurs yet.</p></div>`;
    return;
  }
  container.innerHTML = items.map(item => {
    const ratingText = item.avg_rating ? `\u2b50 ${item.avg_rating}` : "";
    const rawService = (item.services && item.services[0]) || "";
    const serviceLabel = typeof rawService === "object" ? rawService.name : rawService;
    return `
      <div class="business-card" data-open-id="${item.id}">
        <div class="card-avatar" style="background:${colorForName(item.name)}">
          ${item.id && (item.photo_base64 || item.photo_file_id)
            ? `<img src="${photoUrl(item.id)}" alt="" onerror="this.parentElement.textContent='${initials(item.name)}'">`
            : initials(item.name)}
        </div>
        <div class="card-name">${escapeHtml(item.name)}</div>
        <div class="card-service">${escapeHtml(serviceLabel)}</div>
        <div class="card-rating">${ratingText}</div>
      </div>`;
  }).join("");
  container.querySelectorAll("[data-open-id]").forEach(card => {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => openDetail(Number(card.dataset.openId)));
  });
}

// ============================================================
// EXPLORE
// ============================================================
let exploreServicesCache = [];
let exploreActiveType = "all";

async function loadExplore() {
  if (!exploreServicesCache.length) {
    exploreServicesCache = asArray(await apiGet("/api/services"));
  }
  renderExploreChips();
  setupExploreTypeTabs();
}

function renderExploreChips() {
  const chipContainer = document.getElementById("exploreChips");
  const filtered = exploreActiveType === "all"
    ? exploreServicesCache
    : exploreServicesCache.filter(s => (s.type || "service") === exploreActiveType);

  chipContainer.innerHTML =
    `<button class="chip active" data-chip="all">All</button>` +
    filtered.slice(0, 12).map(s => `<button class="chip" data-chip="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`).join("");

  chipContainer.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      chipContainer.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const value = chip.dataset.chip === "all" ? "" : chip.dataset.chip;
      document.getElementById("searchInput").value = value;
      runSearch(value);
    });
  });
}

function setupExploreTypeTabs() {
  document.querySelectorAll(".explore-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".explore-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      exploreActiveType = tab.dataset.type;
      renderExploreChips();
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
  const results = asArray(await apiGet(`/api/find?service=${encodeURIComponent(query)}${typeParam}`));
  container.innerHTML = results.length
    ? results.map(r => renderResultCard(r)).join("")
    : emptyState(`No results for "${escapeHtml(query)}". Try another search.`);
  wireResultCardClicks(container);
}

function renderResultCard(r) {
  const ratingText = r.avg_rating ? `\u2b50 ${r.avg_rating} (${r.rating_count})` : "No ratings yet";
  const rawService = (r.services && r.services[0]) || "";
  const serviceLabel = typeof rawService === "object" ? rawService.name : rawService;
  return `
    <div class="result-card" data-open-id="${r.id}">
      ${avatarHtml(r)}
      <div class="result-info">
        <h3>${escapeHtml(r.name)}</h3>
        <p class="result-service">${escapeHtml(serviceLabel)}</p>
        <p class="result-rating">${ratingText}</p>
      </div>
    </div>`;
}

function wireResultCardClicks(container) {
  container.querySelectorAll("[data-open-id]").forEach(card => {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => openDetail(Number(card.dataset.openId)));
  });
}

document.getElementById("searchInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  document.querySelectorAll("#exploreChips .chip").forEach(c => c.classList.remove("active"));
  if (q.length > 1) runSearch(q);
  else document.getElementById("exploreResults").innerHTML = "";
});

// ============================================================
// FAVORITES
// ============================================================
async function loadFavorites() {
  const container = document.getElementById("favoritesContent");
  const favorites = asArray(await apiGet("/api/favorites"));
  if (!favorites.length) {
    container.innerHTML = `
      <div class="favorites-empty">
        <svg viewBox="0 0 24 24" fill="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="currentColor" stroke-width="2"/></svg>
        <p>No favorites yet.<br>Tap the heart icon on any profile to save it here.</p>
      </div>`;
    return;
  }
  container.innerHTML = `<div class="results">${favorites.map(r => `
    <div class="result-card" data-open-id="${r.id}">
      ${avatarHtml(r)}
      <div class="result-info">
        <h3>${escapeHtml(r.name)}</h3>
        <p class="result-service">${escapeHtml((r.services && r.services[0]) || "")}</p>
        <p class="result-rating">${r.avg_rating ? `\u2b50 ${r.avg_rating} (${r.rating_count})` : "No ratings yet"}</p>
      </div>
      <button class="fav-remove-btn" data-fav-remove="${r.id}" title="Remove from favorites">
        <svg viewBox="0 0 24 24" fill="none" style="width:16px;height:16px;"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>`).join("")}</div>`;
  wireResultCardClicks(container);
  container.querySelectorAll("[data-fav-remove]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.favRemove);
      await apiPost("/api/favorites/remove", { initData: tg.initData, entrepreneur_id: id });
      loadFavorites();
    });
  });
}

// ============================================================
// PROFILE
// ============================================================
let currentProfile = null;

async function loadProfile() {
  const container = document.getElementById("profileContent");
  const profile = await apiGet("/api/profile");

  if (profile.error === "invalid_init_data") {
    container.innerHTML = emptyState("Couldn't verify your account. Try reopening from the bot.");
    return;
  }
  currentProfile = profile;

  if (!profile) {
    container.innerHTML = `
      <div class="profile-cta">
        <div class="avatar-circle" style="background:var(--secondary);width:60px;height:60px;margin:0 auto 12px;">
          <svg viewBox="0 0 24 24" fill="none" style="width:26px;height:26px;"><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.4" stroke-linecap="round"/></svg>
        </div>
        <h3>You're not listed yet</h3>
        <p>Create your listing so people can discover your services and products.</p>
        <button class="btn-primary" id="registerCta">Get Started</button>
      </div>`;
    document.getElementById("registerCta").addEventListener("click", () => openStepper(null));
    return;
  }

  const ratingText = profile.avg_rating ? `\u2b50 ${profile.avg_rating} (${profile.rating_count} reviews)` : "No ratings yet";
  const memberSince = profile.created_at ? profile.created_at.slice(0, 4) : "\u2014";
  const servicesList = (profile.services || []).map(s => typeof s === "object" ? s.name : s).join(", ");

  container.innerHTML = `
    <div class="profile-hero">
      ${avatarHtml(profile, 76)}
      <h2>${escapeHtml(profile.name)}</h2>
      <p class="tagline">${escapeHtml(servicesList) || "No services yet"}</p>
      <p class="rating-line">${ratingText}</p>
      <div class="stat-row">
        <div class="stat"><b>${(profile.services || []).length}</b><span>Services</span></div>
        <div class="stat"><b>${profile.rating_count}</b><span>Reviews</span></div>
        <div class="stat"><b>${memberSince}</b><span>Member</span></div>
      </div>
    </div>
    ${profile.description ? `<div class="detail-section"><div class="detail-section-title">About</div><p style="font-size:14px;color:var(--text-muted);line-height:1.6;margin:0;">${escapeHtml(profile.description)}</p></div>` : ""}
    ${renderSocialPlatformsDisplay(profile)}
    <div class="detail-section">
      <div class="detail-section-title">Contact</div>
      <div class="detail-list">
        <div class="detail-row"><span class="label">Phone</span><span class="value">${escapeHtml(profile.phone) || "\u2014"}</span></div>
        <div class="detail-row"><span class="label">Email</span><span class="value">${escapeHtml(profile.email) || "\u2014"}</span></div>
        <div class="detail-row"><span class="label">Business address</span><span class="value">${escapeHtml(profile.business_address) || "\u2014"}</span></div>
        <div class="detail-row"><span class="label">Website</span><span class="value">${escapeHtml(profile.website) || "\u2014"}</span></div>
        <div class="detail-row"><span class="label">Home address<span class="private-badge">Private</span></span><span class="value">${escapeHtml(profile.home_address) || "\u2014"}</span></div>
      </div>
    </div>
    <div class="menu-list">
      <div class="menu-item" id="editListingBtn">Edit My Listing<span class="chevron">\u203a</span></div>
      <div class="menu-item danger" id="removeListingBtn">Remove My Listing<span class="chevron">\u203a</span></div>
    </div>`;

  document.getElementById("editListingBtn").addEventListener("click", () => openStepper(profile));
  document.getElementById("removeListingBtn").addEventListener("click", () => {
    tg.showConfirm("Remove your listing? This can't be undone.", async (confirmed) => {
      if (!confirmed) return;
      await apiPost("/api/unregister", { initData: tg.initData });
      verifiedPhoneNumber = null;
      tg.showAlert("You've been removed from the list.");
      loadProfile();
    });
  });
}

// ============================================================
// ENTREPRENEUR DETAIL
// ============================================================
let detailReturnView = "explore";
let detailEntrepreneurId = null;
let detailIsFavorited = false;

async function openDetail(entrepreneurId) {
  const activeView = document.querySelector(".view.active");
  if (activeView && activeView.id !== "view-detail") {
    detailReturnView = activeView.id.replace("view-", "");
  }
  detailEntrepreneurId = entrepreneurId;

  showView("detail");
  const container = document.getElementById("detailContent");
  container.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:40px 0;">Loading...</p>`;

  const profile = await apiGet(`/api/entrepreneur/${entrepreneurId}`);
  if (profile.error) {
    container.innerHTML = emptyState("This listing couldn't be found.");
    return;
  }
  const reviews = asArray(await apiGet(`/api/reviews/${entrepreneurId}`));
  detailIsFavorited = profile.is_favorited || false;

  // Update fav button
  const favBtn = document.getElementById("detailFavBtn");
  favBtn.style.display = "flex";
  updateFavButton();

  const ratingText = profile.avg_rating ? `\u2b50 ${profile.avg_rating} (${profile.rating_count} reviews)` : "No ratings yet";
  const servicesList = (profile.services || []).map(s => typeof s === "object" ? s.name : s).join(", ");

  // Cover image
  let coverHtml = "";
  if (profile.cover_base64) {
    coverHtml = `<div style="width:100%;height:160px;border-radius:var(--radius-md);overflow:hidden;margin-bottom:16px;"><img src="data:image/jpeg;base64,${profile.cover_base64}" style="width:100%;height:100%;object-fit:cover;" /></div>`;
  }

  // Logo
  let logoHtml = "";
  if (profile.logo_base64) {
    logoHtml = `<div style="width:56px;height:56px;border-radius:12px;overflow:hidden;margin:0 auto 10px;border:2px solid rgba(255,255,255,0.3);"><img src="data:image/jpeg;base64,${profile.logo_base64}" style="width:100%;height:100%;object-fit:cover;" /></div>`;
  }

  // Gallery
  let galleryHtml = "";
  if (profile.gallery && profile.gallery.length > 0) {
    galleryHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Gallery</div>
        <div class="gallery-grid">${profile.gallery.map(img => `<img src="data:image/jpeg;base64,${img}" />`).join("")}</div>
      </div>`;
  }

  // Services/Products
  let servicesHtml = "";
  if (profile.services && profile.services.length > 0) {
    servicesHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Services & Products</div>
        <div class="services-list">${profile.services.map(s => {
          const name = typeof s === "object" ? s.name : s;
          const desc = typeof s === "object" ? s.description : "";
          const price = typeof s === "object" ? s.price : 0;
          return `
            <div class="service-item">
              <div class="service-item-info">
                <div class="service-item-name">${escapeHtml(name)}</div>
                ${desc ? `<div class="service-item-desc">${escapeHtml(desc)}</div>` : ""}
              </div>
              ${price > 0 ? `<div class="service-item-price">\u20a6${Number(price).toLocaleString()}</div>` : ""}
            </div>`;
        }).join("")}</div>
      </div>`;
  }

  // Reviews
  let reviewsHtml = reviews.length
    ? reviews.map(rev => `
      <div class="review-card">
        <div class="review-head">
          <b>${escapeHtml(rev.rater_name || "Anonymous")}</b>
          <span class="review-stars">${"\u2605".repeat(rev.score)}${"\u2606".repeat(5 - rev.score)}</span>
        </div>
        ${rev.comment ? `<p class="review-comment">${escapeHtml(rev.comment)}</p>` : ""}
        ${rev.created_at ? `<div class="review-date">${escapeHtml(rev.created_at.slice(0, 10))}</div>` : ""}
      </div>`).join("")
    : `<p class="field-hint">No reviews yet \u2014 be the first to rate ${escapeHtml(profile.name)}.</p>`;

  container.innerHTML = `
    ${coverHtml}
    <div class="profile-hero">
      ${logoHtml || avatarHtml(profile, 76)}
      <h2>${escapeHtml(profile.name)}</h2>
      <p class="tagline">${escapeHtml(servicesList) || ""}</p>
      <p class="rating-line">${ratingText}</p>
    </div>
    ${profile.description ? `<div class="detail-section"><div class="detail-section-title">About</div><p style="font-size:14px;color:var(--text-muted);line-height:1.6;margin:0;">${escapeHtml(profile.description)}</p></div>` : ""}
    ${servicesHtml}
    ${galleryHtml}
    ${renderSocialPlatformsDisplay(profile)}
    <div class="detail-section">
      <div class="detail-section-title">Contact</div>
      <div class="contact-btns">
        ${profile.phone ? `<button class="contact-btn contact-btn-call" onclick="window.location.href='tel:${escapeHtml(profile.phone)}'">Call</button>` : ""}
        ${profile.phone ? `<button class="contact-btn contact-btn-message" onclick="window.location.href='https://wa.me/${escapeHtml(profile.phone?.replace(/[^0-9]/g, ''))}'">Message</button>` : ""}
        <button class="contact-btn contact-btn-share" id="shareBtn">Share</button>
      </div>
      <div class="detail-list">
        <div class="detail-row"><span class="label">Phone</span><span class="value">${escapeHtml(profile.phone) || "\u2014"}</span></div>
        <div class="detail-row"><span class="label">Email</span><span class="value">${escapeHtml(profile.email) || "\u2014"}</span></div>
        <div class="detail-row"><span class="label">Business address</span><span class="value">${escapeHtml(profile.business_address) || "\u2014"}</span></div>
        <div class="detail-row"><span class="label">Website</span><span class="value">${escapeHtml(profile.website) || "\u2014"}</span></div>
      </div>
    </div>
    <button class="btn-primary" id="detailRateBtn">Rate ${escapeHtml(profile.name)}</button>
    <div class="detail-section" style="margin-top:22px;">
      <div class="detail-section-title">Reviews</div>
      <div class="reviews-list">${reviewsHtml}</div>
    </div>`;

  document.getElementById("detailRateBtn").addEventListener("click", () => openRatingModal(entrepreneurId, profile.name));
  document.getElementById("shareBtn").addEventListener("click", () => {
    if (tg.shareUrl) {
      tg.shareUrl(window.location.href);
    } else {
      navigator.clipboard?.writeText(window.location.href);
      tg.showAlert?.("Link copied!");
    }
  });
}

function updateFavButton() {
  const favBtn = document.getElementById("detailFavBtn");
  if (detailIsFavorited) {
    favBtn.classList.add("fav-active");
    favBtn.querySelector("svg").setAttribute("fill", "currentColor");
  } else {
    favBtn.classList.remove("fav-active");
    favBtn.querySelector("svg").setAttribute("fill", "none");
  }
}

document.getElementById("detailFavBtn").addEventListener("click", async () => {
  if (!detailEntrepreneurId) return;
  if (detailIsFavorited) {
    await apiPost("/api/favorites/remove", { initData: tg.initData, entrepreneur_id: detailEntrepreneurId });
    detailIsFavorited = false;
  } else {
    await apiPost("/api/favorites/add", { initData: tg.initData, entrepreneur_id: detailEntrepreneurId });
    detailIsFavorited = true;
  }
  updateFavButton();
});

// ---- Rating Modal ----
function openRatingModal(entrepreneurId, name) {
  let selectedScore = 0;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>Rate ${escapeHtml(name)}</h3>
      <p class="field-hint">Tap a star, then add a comment if you'd like.</p>
      <div class="star-row">
        ${[1,2,3,4,5].map(n => `<button class="star-btn" data-score="${n}">\u2605</button>`).join("")}
      </div>
      <textarea id="ratingComment" rows="3" placeholder="Optional — share your experience"></textarea>
      <button class="btn-primary" id="ratingSubmitBtn">Submit Rating</button>
      <button class="btn-secondary" id="ratingCancelBtn">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);

  const starButtons = overlay.querySelectorAll(".star-btn");
  starButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      selectedScore = Number(btn.dataset.score);
      starButtons.forEach(b => b.classList.toggle("selected", Number(b.dataset.score) <= selectedScore));
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
    tg.showAlert ? tg.showAlert(ok ? "Thanks for rating!" : "Something went wrong.") : alert(ok ? "Thanks!" : "Error.");
    if (ok) openDetail(entrepreneurId);
  });

  document.getElementById("ratingCancelBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

document.getElementById("detailBack").addEventListener("click", () => showView(detailReturnView));

// ============================================================
// STEPPER (6 steps)
// ============================================================
let stepperTags = [];
let currentStep = 1;
let uploadedPhotoBase64 = null;
let uploadedLogoBase64 = null;
let uploadedCoverBase64 = null;
let verifiedPhoneNumber = null;
let phonePollTimer = null;
let selectedOfferType = "service";
const TOTAL_STEPS = 6;

const SOCIAL_PLATFORMS = [
  { id: "instagram", label: "Instagram", placeholder: "@username",
    svg: `<svg viewBox="0 0 24 24" fill="#E4405F"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>` },
  { id: "twitter", label: "X", placeholder: "@username",
    svg: `<svg viewBox="0 0 24 24" fill="#000000"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` },
  { id: "facebook", label: "Facebook", placeholder: "facebook.com/username",
    svg: `<svg viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>` },
  { id: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/username",
    svg: `<svg viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>` },
  { id: "youtube", label: "YouTube", placeholder: "@channel",
    svg: `<svg viewBox="0 0 24 24" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>` },
];

let socialPlatforms = [];

function renderSocialPlatforms() {
  const container = document.getElementById("socialPlatformsList");
  if (!container) return;
  container.innerHTML = socialPlatforms.map((sp, i) => {
    const platDef = SOCIAL_PLATFORMS.find(p => p.id === sp.platform) || SOCIAL_PLATFORMS[0];
    return `
      <div class="social-platform-row" data-index="${i}">
        <div class="social-platform-select-wrap">
          <select class="social-platform-select" data-index="${i}">
            ${SOCIAL_PLATFORMS.map(p => `<option value="${p.id}" ${p.id === sp.platform ? "selected" : ""}>${p.label}</option>`).join("")}
          </select>
          <svg class="social-platform-arrow" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <input type="text" class="social-platform-handle" data-index="${i}"
               placeholder="${escapeHtml(platDef.placeholder)}"
               value="${escapeHtml(sp.handle)}" />
        <button type="button" class="social-platform-remove" data-index="${i}">&times;</button>
      </div>`;
  }).join("");

  container.querySelectorAll(".social-platform-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.index);
      socialPlatforms[idx].platform = e.target.value;
      const platDef = SOCIAL_PLATFORMS.find(p => p.id === e.target.value);
      const handleInput = container.querySelector(`.social-platform-handle[data-index="${idx}"]`);
      if (handleInput && platDef) handleInput.placeholder = platDef.placeholder;
    });
  });
  container.querySelectorAll(".social-platform-handle").forEach(input => {
    input.addEventListener("input", (e) => {
      socialPlatforms[Number(e.target.dataset.index)].handle = e.target.value;
    });
  });
  container.querySelectorAll(".social-platform-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      socialPlatforms.splice(Number(btn.dataset.index), 1);
      renderSocialPlatforms();
    });
  });
}

function addSocialPlatform() {
  if (socialPlatforms.length >= 9) {
    tg.showAlert?.("Maximum 9 social accounts.");
    return;
  }
  const usedPlatforms = socialPlatforms.map(sp => sp.platform);
  const nextPlat = SOCIAL_PLATFORMS.find(p => !usedPlatforms.includes(p.id)) || SOCIAL_PLATFORMS[0];
  socialPlatforms.push({ platform: nextPlat.id, handle: "" });
  renderSocialPlatforms();
  const handles = document.querySelectorAll(".social-platform-handle");
  if (handles.length) handles[handles.length - 1].focus();
}

function openStepper(existingProfile) {
  currentStep = 1;
  stepperTags = existingProfile ? [...(existingProfile.services || []).map(s => typeof s === "object" ? s.name : s)] : [];
  uploadedPhotoBase64 = null;
  uploadedLogoBase64 = null;
  uploadedCoverBase64 = null;
  verifiedPhoneNumber = existingProfile?.phone_verified ? existingProfile.phone : null;
  selectedOfferType = existingProfile?.business_type || "service";

  document.getElementById("stepName").value = existingProfile?.name || (tg.initDataUnsafe?.user ? [tg.initDataUnsafe.user.first_name, tg.initDataUnsafe.user.last_name].filter(Boolean).join(" ") : "");
  document.getElementById("stepEmail").value = existingProfile?.email || "";
  document.getElementById("stepBusinessAddress").value = existingProfile?.business_address || "";
  document.getElementById("stepWebsite").value = existingProfile?.website || "";
  document.getElementById("stepHomeAddress").value = existingProfile?.home_address || "";
  document.getElementById("stepDescription").value = existingProfile?.description || "";

  socialPlatforms = [];
  if (existingProfile?.social_platforms) {
    try {
      const parsed = typeof existingProfile.social_platforms === "string"
        ? JSON.parse(existingProfile.social_platforms) : existingProfile.social_platforms;
      if (Array.isArray(parsed)) socialPlatforms = parsed;
    } catch(e) {}
  }
  renderSocialPlatforms();

  refreshPhoneVerifiedUI();
  checkPhoneVerification();

  // Reset photo previews
  document.getElementById("photoPreviewImg").style.display = "none";
  document.getElementById("photoPlaceholderIcon").style.display = "block";
  document.getElementById("photoUploadLabel").textContent = "Upload a photo";
  document.getElementById("logoPreviewImg").style.display = "none";
  document.getElementById("logoPlaceholderIcon").style.display = "block";
  document.getElementById("logoUploadLabel").textContent = "Upload logo";
  document.getElementById("coverPreviewImg").style.display = "none";
  document.getElementById("coverPlaceholderIcon").style.display = "block";
  document.getElementById("coverUploadLabel").textContent = "Upload cover image";

  if (existingProfile?.id && (existingProfile.photo_base64 || existingProfile.photo_file_id)) {
    document.getElementById("photoPreviewImg").src = photoUrl(existingProfile.id);
    document.getElementById("photoPreviewImg").style.display = "block";
    document.getElementById("photoPlaceholderIcon").style.display = "none";
    document.getElementById("photoUploadLabel").textContent = "Tap to change";
  }

  document.getElementById("stepperTitle").textContent = existingProfile ? "Edit Listing" : "Register";

  // Reset offer type selection
  document.querySelectorAll(".offer-type-card").forEach(c => c.classList.remove("selected"));
  const selectedCard = document.querySelector(`.offer-type-card[data-offer="${selectedOfferType}"]`);
  if (selectedCard) selectedCard.classList.add("selected");

  renderTags();
  goToStep(1);
  showView("stepper");
}

function renderTags() {
  const container = document.getElementById("serviceTags");
  container.innerHTML = stepperTags.map((t, i) => `<span class="tag-pill">${escapeHtml(t)}<button data-remove="${i}">\u00d7</button></span>`).join("");
  container.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      stepperTags.splice(Number(btn.dataset.remove), 1);
      renderTags();
    });
  });
}

// ---- Phone verification ----
function refreshPhoneVerifiedUI(state) {
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
    hint.textContent = "Verified \u2014 you're all set.";
  } else if (state === "waiting") {
    hint.textContent = "";
  } else {
    hint.textContent = "Tap the button and approve the prompt. No other steps needed.";
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
    tg.showAlert?.("Please update Telegram to register.");
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
      if (ok || attempts > 15) {
        clearInterval(phonePollTimer);
        phonePollTimer = null;
        if (!ok) {
          refreshPhoneVerifiedUI("idle");
          document.getElementById("verifyPhoneHint").textContent = "Still waiting \u2014 check your bot chat, then try again.";
        }
      }
    }, 2000);
  });
});

document.getElementById("serviceEntry").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const value = e.target.value.trim().replace(/,$/, "");
    if (value) { stepperTags.push(value); renderTags(); }
    e.target.value = "";
  }
});

// ---- Photo uploads ----
function setupPhotoUpload(zoneId, inputId, previewImgId, placeholderId, labelId, stateKey) {
  document.getElementById(zoneId).addEventListener("click", () => document.getElementById(inputId).click());
  document.getElementById(inputId).addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = stateKey === "cover" ? 800 : 640;
        const scale = Math.min(1, MAX_WIDTH / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", 0.75);
        if (stateKey === "photo") uploadedPhotoBase64 = base64;
        if (stateKey === "logo") uploadedLogoBase64 = base64;
        if (stateKey === "cover") uploadedCoverBase64 = base64;
        document.getElementById(previewImgId).src = base64;
        document.getElementById(previewImgId).style.display = "block";
        document.getElementById(placeholderId).style.display = "none";
        document.getElementById(labelId).textContent = "Tap to change";
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}
setupPhotoUpload("photoUploadZone", "photoInput", "photoPreviewImg", "photoPlaceholderIcon", "photoUploadLabel", "photo");
setupPhotoUpload("logoUploadZone", "logoInput", "logoPreviewImg", "logoPlaceholderIcon", "logoUploadLabel", "logo");
setupPhotoUpload("coverUploadZone", "coverInput", "coverPreviewImg", "coverPlaceholderIcon", "coverUploadLabel", "cover");

// Social platforms: add button
document.getElementById("addSocialPlatformBtn").addEventListener("click", addSocialPlatform);

function goToStep(step) {
  currentStep = step;
  document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
  document.querySelector(`.step-panel[data-step-panel="${step}"]`).classList.add("active");

  const progress = ((step - 1) / (TOTAL_STEPS - 1)) * 100;
  document.getElementById("progressFill").style.width = `${progress}%`;
  document.getElementById("stepLabel").textContent = `Step ${step} of ${TOTAL_STEPS}`;
  document.getElementById("stepBackBtn").style.visibility = step === 1 ? "hidden" : "visible";
  document.getElementById("stepNextBtn").textContent = step === TOTAL_STEPS ? "Submit" : "Next";

  // Update step 3 title based on offer type
  if (step === 3) {
    const title = document.getElementById("step3Title");
    const productFields = document.getElementById("productFields");
    if (selectedOfferType === "product") {
      title.innerHTML = 'Your Products <span class="req">*required</span>';
      productFields.style.display = "block";
    } else if (selectedOfferType === "both") {
      title.innerHTML = 'Your Services & Products <span class="req">*required</span>';
      productFields.style.display = "block";
    } else {
      title.innerHTML = 'Your Services <span class="req">*required</span>';
      productFields.style.display = "none";
    }
  }

  // Step 6: home address requirement
  if (step === 6) {
    const hasBusinessAddress = document.getElementById("stepBusinessAddress").value.trim().length > 0;
    const badge = document.getElementById("homeAddressStepBadge");
    const labelBadge = document.getElementById("homeAddressLabelBadge");
    const explainer = document.getElementById("homeAddressExplainer");
    if (hasBusinessAddress) {
      badge.textContent = "optional"; badge.className = "opt";
      labelBadge.textContent = "optional"; labelBadge.className = "opt";
      explainer.textContent = "You already added a business address \u2014 this is optional.";
    } else {
      badge.textContent = "*required"; badge.className = "req";
      labelBadge.textContent = "*required"; labelBadge.className = "req";
      explainer.textContent = "We need this for verification since you didn't add a business address.";
    }
  }
}

document.getElementById("stepBackBtn").addEventListener("click", () => {
  if (currentStep > 1) goToStep(currentStep - 1);
});

// Offer type selection
document.querySelectorAll(".offer-type-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".offer-type-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    selectedOfferType = card.dataset.offer;
  });
});

document.getElementById("stepNextBtn").addEventListener("click", async () => {
  if (currentStep === 1) {
    if (!selectedOfferType) return tg.showAlert("Please select what you offer.");
    goToStep(2);
    return;
  }
  if (currentStep === 2) {
    const name = document.getElementById("stepName").value.trim();
    const email = document.getElementById("stepEmail").value.trim();
    if (!name) return tg.showAlert("Please enter your name.");
    if (!verifiedPhoneNumber) {
      const justVerified = await checkPhoneVerification();
      if (!justVerified) return tg.showAlert("Please verify your phone first.");
    }
    if (!email.includes("@") || !email.split("@").pop().includes(".")) return tg.showAlert("Please enter a valid email.");
    goToStep(3);
    return;
  }
  if (currentStep === 3) {
    if (!stepperTags.length) return tg.showAlert("Add at least one service or product.");
    goToStep(4);
    return;
  }
  if (currentStep === 4) {
    goToStep(5);
    return;
  }
  if (currentStep === 5) {
    if (!uploadedPhotoBase64 && !currentProfile?.id) return tg.showAlert("Please upload a photo.");
    goToStep(6);
    return;
  }

  // Step 6 -> submit
  const homeAddress = document.getElementById("stepHomeAddress").value.trim();
  const businessAddress = document.getElementById("stepBusinessAddress").value.trim();
  if (!homeAddress && !businessAddress) {
    return tg.showAlert("Add a business address, or a home address if you work from home.");
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
    description: document.getElementById("stepDescription").value.trim(),
    business_type: selectedOfferType,
    price: Number(document.getElementById("stepPrice").value) || 0,
    delivery_available: document.getElementById("stepDelivery").checked ? 1 : 0,
  };
  if (uploadedPhotoBase64) payload.photo_base64 = uploadedPhotoBase64;
  else if (currentProfile?.id) payload.keep_existing_photo = true;
  if (uploadedLogoBase64) payload.logo_base64 = uploadedLogoBase64;
  if (uploadedCoverBase64) payload.cover_base64 = uploadedCoverBase64;

  const { ok, data } = await apiPost("/api/register", payload);
  if (ok) {
    showView("success");
  } else if (data?.error === "phone_not_verified") {
    tg.showAlert("Phone verification expired \u2014 please verify again.");
    goToStep(2);
  } else {
    tg.showAlert(data?.error === "missing_fields" ? `Missing: ${data.fields.join(", ")}` : "Something went wrong.");
  }
});

document.getElementById("stepperBack").addEventListener("click", () => showView("profile"));

// ============================================================
// Theme
// ============================================================
function applyTelegramTheme() {
  if (tg.colorScheme === "dark") {
    document.documentElement.style.setProperty("--bg", "#0F1115");
    document.documentElement.style.setProperty("--surface", "#1A1D24");
    document.documentElement.style.setProperty("--text", "#F5F6FA");
    document.documentElement.style.setProperty("--text-muted", "#9098B1");
    document.documentElement.style.setProperty("--border", "#2A2E3A");
    document.documentElement.style.setProperty("--secondary-soft", "#123531");
    document.documentElement.style.setProperty("--accent-soft", "#3D2E0A");
    document.documentElement.style.setProperty("--danger-soft", "#3D1515");
  }
}
applyTelegramTheme();
tg.onEvent("themeChanged", applyTelegramTheme);

// ============================================================
// ADMIN PANEL
// ============================================================
async function checkAdminAccess() {
  const res = await apiGet("/api/admin/check");
  if (res.is_admin) {
    document.getElementById("adminNavBtn").style.display = "flex";
  }
}

async function loadAdminPanel() {
  const stats = await apiGet("/api/admin/stats");
  if (stats.error) {
    document.getElementById("adminStats").innerHTML = emptyState("No admin access.");
    return;
  }
  document.getElementById("adminStats").innerHTML = `
    <div class="stat-card"><b>${stats.entrepreneurs}</b><span>Entrepreneurs</span></div>
    <div class="stat-card"><b>${stats.services}</b><span>Services</span></div>
    <div class="stat-card"><b>${stats.ratings}</b><span>Ratings</span></div>`;
  await refreshAdminList();
}

async function refreshAdminList() {
  const data = await apiGet("/api/admin/list_admins");
  if (data.error) return;
  document.getElementById("adminListDisplay").innerHTML =
    `<b>Root:</b> ${data.root_admins.join(", ") || "none"}<br><b>Added:</b> ${data.added_admins.join(", ") || "none"}`;
}

document.getElementById("adminBack").addEventListener("click", () => showView("profile"));
document.getElementById("adminBroadcastBtn").addEventListener("click", () => {
  const message = document.getElementById("adminBroadcastText").value.trim();
  if (!message) return tg.showAlert("Write a message first.");
  tg.showConfirm(`Send to all?\n\n"${message}"`, async (confirmed) => {
    if (!confirmed) return;
    const { ok, data } = await apiPost("/api/admin/broadcast", { initData: tg.initData, message });
    tg.showAlert(ok ? `Sent to ${data.sent} (${data.failed} failed).` : "Failed.");
    if (ok) document.getElementById("adminBroadcastText").value = "";
  });
});
document.getElementById("addAdminBtn").addEventListener("click", async () => {
  const id = Number(document.getElementById("adminIdInput").value.trim());
  if (!id) return tg.showAlert("Enter a valid ID.");
  const { ok } = await apiPost("/api/admin/add_admin", { initData: tg.initData, telegram_id: id });
  tg.showAlert(ok ? "Admin added." : "Error.");
  if (ok) { document.getElementById("adminIdInput").value = ""; refreshAdminList(); }
});
document.getElementById("removeAdminBtn").addEventListener("click", async () => {
  const id = Number(document.getElementById("adminIdInput").value.trim());
  if (!id) return tg.showAlert("Enter a valid ID.");
  const { ok, data } = await apiPost("/api/admin/remove_admin", { initData: tg.initData, telegram_id: id });
  if (data?.error === "is_root_admin") tg.showAlert("Root admin \u2014 remove via Render.");
  else { tg.showAlert(ok && data.removed ? "Removed." : "Not found."); if (ok && data.removed) { document.getElementById("adminIdInput").value = ""; refreshAdminList(); } }
});
document.getElementById("adminRemoveBtn").addEventListener("click", () => {
  const name = document.getElementById("adminRemoveName").value.trim();
  if (!name) return tg.showAlert("Enter a name.");
  tg.showConfirm(`Remove "${name}"?`, async (confirmed) => {
    if (!confirmed) return;
    const { ok, data } = await apiPost("/api/admin/forceremove", { initData: tg.initData, name });
    tg.showAlert(ok && data.removed ? "Removed." : "Not found.");
    if (ok && data.removed) document.getElementById("adminRemoveName").value = "";
  });
});

// ---- Boot ----
loadHome();
checkAdminAccess();
