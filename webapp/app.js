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
    instagram: { label: "Instagram", color: "#E4405F",
      svg: `<svg viewBox="0 0 24 24" fill="#E4405F" width="14" height="14"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>` },
    twitter: { label: "X", color: "#000000",
      svg: `<svg viewBox="0 0 24 24" fill="#000000" width="14" height="14"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` },
    facebook: { label: "Facebook", color: "#1877F2",
      svg: `<svg viewBox="0 0 24 24" fill="#1877F2" width="14" height="14"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>` },
    linkedin: { label: "LinkedIn", color: "#0A66C2",
      svg: `<svg viewBox="0 0 24 24" fill="#0A66C2" width="14" height="14"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>` },
    tiktok: { label: "TikTok", color: "#010101",
      svg: `<svg viewBox="0 0 24 24" fill="#010101" width="14" height="14"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>` },
    youtube: { label: "YouTube", color: "#FF0000",
      svg: `<svg viewBox="0 0 24 24" fill="#FF0000" width="14" height="14"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>` },
    snapchat: { label: "Snapchat", color: "#FFFC00",
      svg: `<svg viewBox="0 0 24 24" fill="#000000" width="14" height="14"><path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12.922-.214.094-.04.199-.06.3-.06.337 0 .596.181.731.394.09.136.15.3.152.475 0 .195-.055.39-.164.557-.352.552-.956.79-1.457.914-.17.042-.34.075-.492.1-.09.015-.18.031-.27.047l-.06.012c-.032.009-.062.021-.09.033-.015.006-.03.014-.045.021-.12.06-.21.105-.33.15-.39.135-.957.24-1.573.342-.24.042-.48.075-.72.105-.12.015-.24.03-.36.045-.06.009-.12.018-.18.026-.015.003-.03.006-.045.009-.12.025-.24.045-.36.06-.36.055-.72.09-1.2.09s-.84-.035-1.2-.09c-.12-.015-.24-.035-.36-.06-.015-.003-.03-.006-.045-.009-.06-.009-.12-.018-.18-.026-.12-.015-.24-.03-.36-.045-.24-.03-.48-.063-.72-.105-.615-.103-1.183-.208-1.573-.342-.12-.045-.21-.09-.33-.15-.028-.012-.058-.024-.09-.033l-.06-.012c-.152-.025-.322-.058-.492-.1-.5-.123-1.105-.362-1.457-.914-.109-.167-.164-.362-.164-.557 0-.175.062-.34.152-.475.135-.213.394-.394.731-.394.1 0 .206.02.3.06.263.094.622.198.922.214.198 0 .326-.045.401-.09-.008-.165-.018-.33-.03-.51l-.003-.06c-.104-1.628-.23-3.654.299-4.847C7.859 1.069 11.216.793 12.206.793z"/></svg>` },
    pinterest: { label: "Pinterest", color: "#BD081C",
      svg: `<svg viewBox="0 0 24 24" fill="#BD081C" width="14" height="14"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z"/></svg>` },
    website: { label: "Website", color: "#6B7280",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>` },
    other: { label: "", color: "#6B7280",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" width="14" height="14"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>` },
  };

  const tagsHtml = platforms.map(sp => {
    const def = platDefs[sp.platform] || platDefs.other;
    const displayHandle = sp.handle || "";
    return `<span class="social-tag" style="background:${def.color}12;color:${def.color};border:1px solid ${def.color}30;">
      <span class="social-tag-icon">${def.svg}</span>
      <span class="social-tag-label">${escapeHtml(def.label)}</span>
      <span class="social-tag-handle">${escapeHtml(displayHandle)}</span>
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
      <div class="detail-row"><span class="label">Phone</span><span class="value">${escapeHtml(profile.phone) || "—"}</span></div>
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
  const phoneVerifiedBadge = "";

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
  { id: "instagram", label: "Instagram", placeholder: "@username",
    svg: `<svg viewBox="0 0 24 24" fill="#E4405F"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>` },
  { id: "twitter", label: "X (Twitter)", placeholder: "@username",
    svg: `<svg viewBox="0 0 24 24" fill="#000000"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` },
  { id: "facebook", label: "Facebook", placeholder: "facebook.com/username",
    svg: `<svg viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>` },
  { id: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/username",
    svg: `<svg viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>` },
  { id: "tiktok", label: "TikTok", placeholder: "@username",
    svg: `<svg viewBox="0 0 24 24" fill="#010101"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>` },
  { id: "youtube", label: "YouTube", placeholder: "@channel",
    svg: `<svg viewBox="0 0 24 24" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>` },
  { id: "snapchat", label: "Snapchat", placeholder: "username",
    svg: `<svg viewBox="0 0 24 24" fill="#FFFC00"><path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12.922-.214.094-.04.199-.06.3-.06.337 0 .596.181.731.394.09.136.15.3.152.475 0 .195-.055.39-.164.557-.352.552-.956.79-1.457.914-.17.042-.34.075-.492.1-.09.015-.18.031-.27.047l-.06.012c-.032.009-.062.021-.09.033-.015.006-.03.014-.045.021-.12.06-.21.105-.33.15-.39.135-.957.24-1.573.342-.24.042-.48.075-.72.105-.12.015-.24.03-.36.045-.06.009-.12.018-.18.026-.015.003-.03.006-.045.009-.12.025-.24.045-.36.06-.36.055-.72.09-1.2.09s-.84-.035-1.2-.09c-.12-.015-.24-.035-.36-.06-.015-.003-.03-.006-.045-.009-.06-.009-.12-.018-.18-.026-.12-.015-.24-.03-.36-.045-.24-.03-.48-.063-.72-.105-.615-.103-1.183-.208-1.573-.342-.12-.045-.21-.09-.33-.15-.028-.012-.058-.024-.09-.033l-.06-.012c-.152-.025-.322-.058-.492-.1-.5-.123-1.105-.362-1.457-.914-.109-.167-.164-.362-.164-.557 0-.175.062-.34.152-.475.135-.213.394-.394.731-.394.1 0 .206.02.3.06.263.094.622.198.922.214.198 0 .326-.045.401-.09-.008-.165-.018-.33-.03-.51l-.003-.06c-.104-1.628-.23-3.654.299-4.847C7.859 1.069 11.216.793 12.206.793zM9.62 13.019c.018.292.018.584.018.874 0 1.537-.646 3.18-2.103 3.814-.138.06-.285.105-.39.15-.33.135-.522.3-.6.465-.06.135-.075.27-.03.39.165.435.69.69 1.14.81.09.022.18.042.27.057.09.015.18.03.255.037.285.03.495.24.57.495.03.105.045.225.045.345 0 .18-.06.345-.165.465-.195.225-.51.36-.855.42-.09.015-.18.03-.255.045-.3.055-.48.27-.555.495-.03.105-.06.21-.06.33 0 .195.09.375.24.495.21.15.48.24.75.285.105.015.21.03.3.045.135.02.255.045.36.075.36.105.585.435.57.795-.015.36-.225.66-.51.795-.06.03-.12.06-.195.075-.375.075-.75.15-1.155.21-.135.015-.27.045-.405.06-.06.009-.12.018-.18.026-.015.003-.03.006-.045.009-.27.045-.48.255-.51.525-.015.135-.015.27-.015.405 0 .135.015.27.045.405.09.42.42.72.855.75.135.009.27.015.405.015.39 0 .78-.06 1.155-.165.15-.045.3-.075.435-.12.36-.12.63-.39.75-.75.06-.18.09-.36.09-.555 0-.27-.06-.525-.18-.75-.135-.24-.33-.42-.555-.525-.18-.09-.375-.15-.57-.195-.06-.015-.12-.03-.18-.045-.075-.015-.15-.03-.21-.045-.15-.03-.285-.075-.375-.15-.165-.135-.24-.33-.24-.54 0-.06.015-.12.03-.18.045-.18.15-.33.285-.435.12-.105.27-.165.42-.21.135-.045.27-.075.39-.12.18-.06.33-.15.435-.3.09-.135.135-.3.135-.465 0-.06-.015-.12-.03-.18-.06-.18-.18-.33-.33-.42-.12-.075-.255-.12-.39-.15-.135-.03-.27-.06-.39-.105-.18-.06-.315-.18-.39-.345-.06-.135-.09-.3-.09-.465 0-.18.06-.345.165-.48.135-.18.33-.3.54-.375.18-.06.36-.105.54-.15.18-.045.345-.105.465-.195.135-.105.21-.255.21-.42 0-.06-.015-.12-.03-.18-.06-.18-.18-.33-.345-.405-.12-.06-.255-.09-.39-.12-.135-.03-.27-.06-.375-.12-.18-.09-.3-.24-.33-.435-.015-.09-.015-.18-.015-.27 0-.18.045-.345.135-.495.105-.18.27-.315.465-.39.15-.06.315-.105.48-.15.18-.045.345-.105.465-.21.12-.105.18-.255.18-.42 0-.045-.015-.09-.03-.135-.06-.18-.18-.33-.36-.42-.12-.06-.255-.09-.39-.12-.135-.03-.27-.06-.375-.12-.18-.09-.3-.24-.33-.435-.015-.09-.015-.18-.015-.27 0-.18.045-.345.135-.495.105-.18.27-.315.465-.39.15-.06.315-.105.48-.15.18-.045.345-.105.465-.21.12-.105.18-.255.18-.42 0-.06-.015-.12-.045-.18-.075-.165-.225-.285-.405-.33-.12-.03-.24-.045-.36-.06-.12-.015-.24-.03-.345-.06-.18-.045-.315-.15-.375-.3-.045-.105-.06-.225-.06-.345 0-.18.06-.345.165-.48.135-.18.33-.3.54-.375.18-.06.36-.105.54-.15.18-.045.345-.105.465-.195.135-.105.21-.255.21-.42z"/></svg>` },
  { id: "pinterest", label: "Pinterest", placeholder: "pinterest.com/username",
    svg: `<svg viewBox="0 0 24 24" fill="#BD081C"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z"/></svg>` },
  { id: "website", label: "Other Website", placeholder: "https://...",
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>` },
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
              `<option value="${p.id}" ${p.id === sp.platform ? "selected" : ""}>${p.label}</option>`
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
  if (socialPlatforms.length >= 9) {
    tg.showAlert ? tg.showAlert("You can add up to 9 social accounts.") : alert("You can add up to 9 social accounts.");
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
    socialPlatforms = [{ platform: "website", handle: existingProfile.socials }];
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
