/*
  app.js
  ------
  This runs inside Telegram's built-in browser when someone opens the Mini App.
  `tg` is Telegram's bridge object — it's how this webpage talks to the
  Telegram app around it (theme colors, native alert boxes, and — importantly —
  tg.initData, a signed proof of who the user is, which we send to our own
  backend so it can trust the request came from a real logged-in Telegram user.
*/

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand(); // use the full screen height instead of a small popup

// ---- Theme: match the user's own Telegram appearance ----
function applyTheme() {
  const p = tg.themeParams || {};
  const root = document.documentElement.style;
  root.setProperty("--bg", p.bg_color || "#ffffff");
  root.setProperty("--text", p.text_color || "#000000");
  root.setProperty("--hint", p.hint_color || "#999999");
  root.setProperty("--button", p.button_color || "#2481cc");
  root.setProperty("--button-text", p.button_text_color || "#ffffff");
  root.setProperty("--secondary-bg", p.secondary_bg_color || "#f0f0f0");
}
applyTheme();
tg.onEvent("themeChanged", applyTheme);

// ---- Tab switching ----
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "profile") loadProfile();
  });
});

// ---- Browse tab ----
async function loadServices() {
  const res = await fetch("/api/services");
  const services = await res.json();
  const container = document.getElementById("serviceChips");
  container.innerHTML = "";
  services.forEach((s) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = `${s.name} (${s.entrepreneur_count})`;
    chip.onclick = () => searchService(s.name);
    container.appendChild(chip);
  });
}

async function searchService(query) {
  const res = await fetch(`/api/find?service=${encodeURIComponent(query)}`);
  const results = await res.json();
  renderResults(results, query);
}

function renderResults(results, query) {
  const container = document.getElementById("results");
  if (!results.length) {
    container.innerHTML = `<p class="hint">No entrepreneurs found for "${escapeHtml(query)}".</p>`;
    return;
  }
  container.innerHTML = results
    .map(
      (r) => `
    <div class="card">
      <h3>${escapeHtml(r.name)}</h3>
      <p class="service">${escapeHtml(r.service)}</p>
      <p class="rating">${r.avg_rating ? "⭐ " + r.avg_rating + " (" + r.rating_count + " ratings)" : "No ratings yet"}</p>
      <p class="contact">${escapeHtml(r.socials)}</p>
    </div>`
    )
    .join("");
}

// Basic escaping so a mischievous entrepreneur name/socials field can't break the page
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.getElementById("searchInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  if (q.length > 1) {
    searchService(q);
  } else {
    document.getElementById("results").innerHTML = "";
  }
});

loadServices();

// ---- Profile tab ----
async function loadProfile() {
  const view = document.getElementById("profileView");
  const unregBtn = document.getElementById("unregisterBtn");

  const res = await fetch(`/api/profile?initData=${encodeURIComponent(tg.initData)}`);

  if (res.status === 401) {
    view.innerHTML = `<p class="hint">Couldn't verify your Telegram account. Try reopening the app from the bot's /app command.</p>`;
    return;
  }

  const profile = await res.json();

  if (profile) {
    view.innerHTML = `
      <div class="card">
        <h3>${escapeHtml(profile.name)}</h3>
        <p class="service">${escapeHtml(profile.services.join(", "))}</p>
        <p class="contact">${escapeHtml(profile.socials)}</p>
      </div>`;
    document.getElementById("regName").value = profile.name;
    document.getElementById("regServices").value = profile.services.join(", ");
    document.getElementById("regSocials").value = profile.socials;
    unregBtn.style.display = "block";
  } else {
    view.innerHTML = `<p class="hint">You're not registered yet — fill in the form below to get listed.</p>`;
    unregBtn.style.display = "none";
  }
}

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("regName").value.trim();
  const services = document
    .getElementById("regServices")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const socials = document.getElementById("regSocials").value.trim();

  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: tg.initData, name, services, socials }),
  });

  if (res.ok) {
    tg.showAlert("Saved! You're listed.");
    loadServices();
    loadProfile();
  } else {
    tg.showAlert("Something went wrong saving your profile. Please try again.");
  }
});

document.getElementById("unregisterBtn").addEventListener("click", () => {
  tg.showConfirm("Remove your listing? This can't be undone.", async (confirmed) => {
    if (!confirmed) return;
    await fetch("/api/unregister", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData }),
    });
    tg.showAlert("You've been removed from the list.");
    document.getElementById("registerForm").reset();
    loadProfile();
    loadServices();
  });
});
