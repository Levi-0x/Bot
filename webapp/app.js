/*
  app.js — VentureVault Mini App
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

function avatarHtml(entrepreneur, size) {
  const style = size ? `width:${size}px;height:${size}px;font-size:${size * 0.34}px;` : "";
  if (entrepreneur.id && (entrepreneur.photo_base64 || entrepreneur.photo_file_id)) {
    return `<div class="avatar-circle" style="${style}"><img src="/api/photo/${entrepreneur.id}" alt="" onerror="this.remove()"></div>`;
  }
  return `<div class="avatar-circle" style="background:${colorForName(entrepreneur.name)};${style}">${initials(entrepreneur.name)}</div>`;
}

// ---- API helpers ----
async function apiGet(path) {
  const res = await fetch(path);
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
}

document.querySelectorAll("[data-nav]").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.nav)));
document.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", () => showView(el.dataset.goto)));

// ============================================================
// HOME
// ============================================================
function renderResultCard(r) {
  const ratingText = r.avg_rating ? `⭐ ${r.avg_rating} (${r.rating_count} ratings)` : "No ratings yet";
  const serviceLabel = r.service || (r.services && r.services[0]) || "";
  const contactParts = [r.phone, r.socials].filter(Boolean).join(" · ");
  return `
    <div class="result-card">
      ${avatarHtml(r)}
      <div class="result-info">
        <h3>${escapeHtml(r.name)}</h3>
        <p class="result-service">${escapeHtml(serviceLabel)}</p>
        <p class="result-rating">${ratingText}</p>
        <p class="result-contact">${escapeHtml(contactParts)}</p>
      </div>
    </div>`;
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

  const [services, top] = await Promise.all([apiGet("/api/services"), apiGet("/api/top?limit=5")]);

  const catContainer = document.getElementById("homeCategories");
  const topServices = services.slice(0, 8);
  catContainer.innerHTML = topServices
    .map(
      (s) => `
      <button class="category-tile" data-service="${escapeHtml(s.name)}">
        <span class="cat-icon" style="background:${colorForName(s.name)}">${s.name[0].toUpperCase()}</span>
        <span>${escapeHtml(s.name)}</span>
      </button>`
    )
    .join("");
  catContainer.querySelectorAll(".category-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      showView("explore");
      const q = tile.dataset.service;
      setTimeout(() => {
        document.getElementById("searchInput").value = q;
        runSearch(q);
      }, 0);
    });
  });

  document.getElementById("homeTop").innerHTML = top.length
    ? top.map(renderResultCard).join("")
    : emptyState("No entrepreneurs listed yet.");
}

// ============================================================
// EXPLORE
// ============================================================
let exploreServicesCache = [];

async function loadExplore() {
  if (!exploreServicesCache.length) {
    exploreServicesCache = await apiGet("/api/services");
    const chipContainer = document.getElementById("exploreChips");
    chipContainer.innerHTML =
      `<button class="chip active" data-chip="all">All</button>` +
      exploreServicesCache.slice(0, 10).map((s) => `<button class="chip" data-chip="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`).join("");

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
}

async function runSearch(query) {
  const container = document.getElementById("exploreResults");
  if (!query) {
    container.innerHTML = "";
    return;
  }
  const results = await apiGet(`/api/find?service=${encodeURIComponent(query)}`);
  container.innerHTML = results.length
    ? results.map(renderResultCard).join("")
    : emptyState(`We couldn't find anyone for "${escapeHtml(query)}". Try another search.`);
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
        <div class="avatar-circle" style="background:var(--secondary);width:56px;height:56px;font-size:20px;margin:0 auto 10px;">+</div>
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
// STEPPER (5 steps: Basic Info, Services, Contact, Photo, Verification)
// ============================================================
let stepperTags = [];
let currentStep = 1;
let uploadedPhotoBase64 = null;
const TOTAL_STEPS = 5;

function openStepper(existingProfile) {
  currentStep = 1;
  stepperTags = existingProfile ? [...existingProfile.services] : [];
  uploadedPhotoBase64 = null;

  document.getElementById("stepName").value = existingProfile?.name || "";
  document.getElementById("stepPhone").value = existingProfile?.phone || "";
  document.getElementById("stepEmail").value = existingProfile?.email || "";
  document.getElementById("stepSocials").value = existingProfile?.socials || "";
  document.getElementById("stepBusinessAddress").value = existingProfile?.business_address || "";
  document.getElementById("stepWebsite").value = existingProfile?.website || "";
  document.getElementById("stepHomeAddress").value = existingProfile?.home_address || "";

  const previewImg = document.getElementById("photoPreviewImg");
  const placeholderIcon = document.getElementById("photoPlaceholderIcon");
  if (existingProfile?.id && (existingProfile.photo_base64 || existingProfile.photo_file_id)) {
    previewImg.src = `/api/photo/${existingProfile.id}`;
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
}

document.getElementById("stepBackBtn").addEventListener("click", () => {
  if (currentStep > 1) goToStep(currentStep - 1);
});

document.getElementById("stepNextBtn").addEventListener("click", async () => {
  if (currentStep === 1) {
    const name = document.getElementById("stepName").value.trim();
    const phone = document.getElementById("stepPhone").value.trim();
    const email = document.getElementById("stepEmail").value.trim();
    if (!name) return tg.showAlert("Please enter your name.");
    if (!phone) return tg.showAlert("Please enter your phone number.");
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
  if (!homeAddress) return tg.showAlert("Home address is required for verification.");

  const payload = {
    initData: tg.initData,
    name: document.getElementById("stepName").value.trim(),
    phone: document.getElementById("stepPhone").value.trim(),
    email: document.getElementById("stepEmail").value.trim(),
    services: stepperTags,
    socials: document.getElementById("stepSocials").value.trim(),
    business_address: document.getElementById("stepBusinessAddress").value.trim(),
    website: document.getElementById("stepWebsite").value.trim(),
    home_address: homeAddress,
  };
  if (uploadedPhotoBase64) {
    payload.photo_base64 = uploadedPhotoBase64;
  } else if (currentProfile?.id) {
    payload.keep_existing_photo = true; // editing without re-uploading a photo
  }

  const { ok, data } = await apiPost("/api/register", payload);

  if (ok) {
    showView("success");
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
  }
}
applyTelegramTheme();
tg.onEvent("themeChanged", applyTelegramTheme);

// ---- Boot ----
loadHome();
