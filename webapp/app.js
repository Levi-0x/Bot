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
function renderResultCard(r) {
  const ratingText = r.avg_rating ? `⭐ ${r.avg_rating} (${r.rating_count} ratings)` : "No ratings yet";
  const serviceLabel = r.service || (r.services && r.services[0]) || "";
  const contactParts = [r.phone, r.socials].filter(Boolean).join(" · ");
  const verifiedBadge = r.identity_verified ? ' <span class="verified-badge" title="Manually verified by an admin">✅</span>' : "";
  return `
    <div class="result-card" data-open-id="${r.id}">
      ${avatarHtml(r)}
      <div class="result-info">
        <h3>${escapeHtml(r.name)}${verifiedBadge}</h3>
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
  wireResultCardClicks(document.getElementById("homeTop"));
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
    <div class="detail-list">
      <div class="detail-row"><span class="label">Phone</span><span class="value">${escapeHtml(profile.phone) || "—"}${profile.phone_verified ? ' <span class="verified-badge" title="Confirmed via Telegram">✅</span>' : ""}</span></div>
      <div class="detail-row"><span class="label">Email</span><span class="value">${escapeHtml(profile.email) || "—"}</span></div>
      <div class="detail-row"><span class="label">Business address</span><span class="value">${escapeHtml(profile.business_address) || "—"}</span></div>
      <div class="detail-row"><span class="label">Website</span><span class="value">${escapeHtml(profile.website) || "—"}</span></div>
      <div class="detail-row"><span class="label">Home address<span class="private-badge">Private</span></span><span class="value">${escapeHtml(profile.home_address) || "—"}</span></div>
    </div>
    <div class="menu-list">
      ${verificationMenuItem(profile)}
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

  const requestBtn = document.getElementById("requestVerificationBtn");
  if (requestBtn) {
    requestBtn.addEventListener("click", async () => {
      const { ok, data } = await apiPost("/api/request_verification", { initData: tg.initData });
      if (ok) {
        tg.showAlert("Request sent — an admin will review it soon.");
        loadProfile();
      } else if (data?.error === "phone_not_verified") {
        tg.showAlert("Verify your phone first (edit your listing, Step 1).");
      } else if (data?.error === "no_photo") {
        tg.showAlert("Add a profile photo first (edit your listing, Step 4).");
      } else {
        tg.showAlert("Something went wrong. Please try again.");
      }
    });
  }
}

// Eligibility gate lives here too, mirroring the backend: only entrepreneurs
// who've already verified their phone and uploaded a photo can even see the
// button — everyone else sees why they're not eligible yet instead.
function verificationMenuItem(profile) {
  if (profile.identity_verified) {
    return `<div class="menu-item">✅ Verified listing<span class="verified-badge">Verified</span></div>`;
  }
  if (!profile.phone_verified || !(profile.photo_file_id || profile.photo_base64)) {
    return `<div class="menu-item" style="color:var(--text-muted);">Request Verification (verify phone + add photo first)</div>`;
  }
  return `<div class="menu-item" id="requestVerificationBtn">Request Verification Badge<span class="chevron">›</span></div>`;
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
  const ratingText = profile.avg_rating ? `⭐ ${profile.avg_rating} (${profile.rating_count} reviews)` : "No ratings yet";
  const verifiedBadge = profile.identity_verified ? ' <span class="verified-badge" title="Manually verified by an admin">✅ Verified</span>' : "";
  const phoneVerifiedBadge = profile.phone_verified ? ' <span class="verified-badge" title="Confirmed via Telegram">✅</span>' : "";

  container.innerHTML = `
    <div class="profile-header-card">
      ${avatarHtml(profile, 68)}
      <h2>${escapeHtml(profile.name)}${verifiedBadge}</h2>
      <p class="tagline">${escapeHtml(profile.services.join(", ")) || ""}</p>
      <p class="rating-line">${ratingText}</p>
    </div>
    <div class="detail-list">
      <div class="detail-row"><span class="label">Phone</span><span class="value">${escapeHtml(profile.phone) || "—"}${phoneVerifiedBadge}</span></div>
      <div class="detail-row"><span class="label">Email</span><span class="value">${escapeHtml(profile.email) || "—"}</span></div>
      <div class="detail-row"><span class="label">Socials</span><span class="value">${escapeHtml(profile.socials) || "—"}</span></div>
      <div class="detail-row"><span class="label">Business address</span><span class="value">${escapeHtml(profile.business_address) || "—"}</span></div>
      <div class="detail-row"><span class="label">Website</span><span class="value">${escapeHtml(profile.website) || "—"}</span></div>
    </div>
    <button class="btn-primary" id="detailRateBtn">Rate ${escapeHtml(profile.name)}</button>`;

  document.getElementById("detailRateBtn").addEventListener("click", () => openRatingModal(entrepreneurId, profile.name));
}

// ---- Custom rating modal ----
// Not using tg.showPopup here: Telegram caps popups at 3 buttons, and we
// need 5 (one per star) plus Cancel — that's exactly why the old version
// silently did nothing. A plain in-page modal has no such limit.
function openRatingModal(entrepreneurId, name) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>Rate ${escapeHtml(name)}</h3>
      <p class="field-hint">Tap a star to submit your rating.</p>
      <div class="star-row">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="star-btn" data-score="${n}">★</button>`).join("")}
      </div>
      <button class="btn-secondary" id="ratingCancelBtn">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll(".star-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const score = Number(btn.dataset.score);
      overlay.remove();
      const { ok } = await apiPost("/api/rate", { initData: tg.initData, entrepreneur_id: entrepreneurId, score });
      tg.showAlert ? tg.showAlert(ok ? "Thanks for rating!" : "Something went wrong submitting your rating.")
                   : alert(ok ? "Thanks for rating!" : "Something went wrong submitting your rating.");
      if (ok) openDetail(entrepreneurId);
    });
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
let capturedLocation = null;       // {latitude, longitude} if the person shared it
let phonePollTimer = null;
const TOTAL_STEPS = 5;

function openStepper(existingProfile) {
  currentStep = 1;
  stepperTags = existingProfile ? [...existingProfile.services] : [];
  uploadedPhotoBase64 = null;
  capturedLocation = null;
  verifiedPhoneNumber = existingProfile?.phone_verified ? existingProfile.phone : null;

  document.getElementById("stepName").value = existingProfile?.name || "";
  document.getElementById("stepEmail").value = existingProfile?.email || "";
  document.getElementById("stepSocials").value = existingProfile?.socials || "";
  document.getElementById("stepBusinessAddress").value = existingProfile?.business_address || "";
  document.getElementById("stepWebsite").value = existingProfile?.website || "";
  document.getElementById("stepHomeAddress").value = existingProfile?.home_address || "";

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
function refreshPhoneVerifiedUI() {
  const display = document.getElementById("phoneVerifiedDisplay");
  const btn = document.getElementById("verifyPhoneBtn");
  const numberSpan = document.getElementById("phoneVerifiedNumber");
  if (verifiedPhoneNumber) {
    display.style.display = "flex";
    numberSpan.textContent = verifiedPhoneNumber;
    btn.style.display = "none";
    document.getElementById("verifyPhoneHint").textContent = "Verified — you're all set for this step.";
  } else {
    display.style.display = "none";
    btn.style.display = "block";
  }
}

async function checkPhoneVerification() {
  const { verified, phone } = await apiGet("/api/check_phone");
  if (verified) {
    verifiedPhoneNumber = phone;
    refreshPhoneVerifiedUI();
    if (phonePollTimer) { clearInterval(phonePollTimer); phonePollTimer = null; }
  }
  return verified;
}

document.getElementById("verifyPhoneBtn").addEventListener("click", () => {
  const hint = document.getElementById("verifyPhoneHint");
  if (typeof tg.requestContact !== "function") {
    const msg = "Your Telegram app version doesn't support this — please update Telegram to register.";
    tg.showAlert ? tg.showAlert(msg) : alert(msg);
    return;
  }
  tg.requestContact((shared) => {
    if (!shared) return;
    hint.textContent = "Confirming with Telegram...";
    if (phonePollTimer) clearInterval(phonePollTimer);
    let attempts = 0;
    phonePollTimer = setInterval(async () => {
      attempts++;
      const ok = await checkPhoneVerification();
      if (ok || attempts > 15) { // ~30s timeout
        clearInterval(phonePollTimer);
        phonePollTimer = null;
        if (!ok) hint.textContent = "Still waiting — check your chat with the bot, then tap Verify again.";
      }
    }, 2000);
  });
});

// ---- Location capture via Telegram's LocationManager (optional, best-effort) ----
// Real limitation, not hidden: this API is fairly new (Bot API 8.0, late
// 2024) and has known quirks — it doesn't work on Telegram Desktop at
// all, and can be flaky on some Android builds. That's exactly why this
// is optional and never blocks registration, unlike phone verification.
document.getElementById("captureLocationBtn").addEventListener("click", () => {
  const hint = document.getElementById("locationHint");
  const btn = document.getElementById("captureLocationBtn");
  if (!tg.LocationManager) {
    hint.textContent = "Location isn't supported in this version of Telegram — that's fine, this step is optional.";
    return;
  }
  hint.textContent = "Requesting location...";
  tg.LocationManager.init(() => {
    tg.LocationManager.getLocation((data) => {
      if (data) {
        capturedLocation = { latitude: data.latitude, longitude: data.longitude };
        btn.textContent = "📍 Location captured";
        hint.textContent = "Got it — this will be attached to your listing as an automated signal.";
      } else {
        hint.textContent = "Couldn't get your location (permission denied or unsupported here) — no problem, this is optional.";
      }
    });
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
  if (!homeAddress) return tg.showAlert("Home address is required for verification.");

  const payload = {
    initData: tg.initData,
    name: document.getElementById("stepName").value.trim(),
    email: document.getElementById("stepEmail").value.trim(),
    services: stepperTags,
    socials: document.getElementById("stepSocials").value.trim(),
    business_address: document.getElementById("stepBusinessAddress").value.trim(),
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
  if (capturedLocation) {
    payload.latitude = capturedLocation.latitude;
    payload.longitude = capturedLocation.longitude;
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
  await loadVerificationQueue();
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

async function loadVerificationQueue() {
  const res = await fetch(`/api/admin/verification_queue?initData=${encodeURIComponent(tg.initData)}`);
  const queue = await res.json();
  const container = document.getElementById("verificationQueue");

  if (!res.ok || !queue.length) {
    container.innerHTML = `<p class="field-hint">No pending requests right now.</p>`;
    return;
  }

  container.innerHTML = queue.map((r) => `
    <div class="admin-card">
      <div style="display:flex; gap:10px; align-items:center;">
        ${avatarHtml(r, 40)}
        <div>
          <b>${escapeHtml(r.name)}</b>
          <p class="field-hint" style="margin:2px 0 0;">${escapeHtml(r.phone)} · requested ${r.requested_at?.slice(0, 10)}</p>
        </div>
      </div>
      <button class="btn-primary" data-approve="${r.telegram_id}">✅ Approve</button>
      <button class="btn-secondary danger-text" data-reject="${r.telegram_id}">Reject</button>
    </div>`).join("");

  container.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiPost("/api/admin/resolve_verification", { initData: tg.initData, telegram_id: Number(btn.dataset.approve), approve: true });
      loadVerificationQueue();
    });
  });
  container.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiPost("/api/admin/resolve_verification", { initData: tg.initData, telegram_id: Number(btn.dataset.reject), approve: false });
      loadVerificationQueue();
    });
  });
}

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
