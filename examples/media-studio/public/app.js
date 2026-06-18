// Media Studio — SPA.
// Increment 2: catalog-driven model picker + image happy path (generate → card).
// Advanced options, references, gallery and the intent bar come next.

const $ = (sel) => document.querySelector(sel);

const state = {
  me: null,
  catalog: [],
  model: null, // selected ModelEntry
  options: {}, // current generation options (dimension/quality/n)
  sessionCost: 0,
};

// Modalities — only image is live today; the rest signal where this grows.
const MODALITIES = [
  { id: "image", label: "Image", icon: "▣", live: true },
  { id: "video", label: "Video", icon: "▶", live: false },
  { id: "audio", label: "Audio", icon: "♪", live: false },
];

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  showLoginError();
  try {
    state.me = await (await fetch("/api/me")).json();
  } catch {
    state.me = { authMode: "env", loggedIn: false, user: null };
  }

  if (!state.me.loggedIn) {
    $("#gate").hidden = false;
    $("#studio").hidden = true;
    return;
  }

  $("#gate").hidden = true;
  $("#studio").hidden = false;
  renderUserChip();

  const { models } = await (await fetch("/api/catalog")).json();
  state.catalog = models;
  renderModalities();
  renderModels();
  selectModel((models.find((m) => m.default) ?? models[0]).id);

  $("#generate-btn").addEventListener("click", generate);
  $("#prompt").addEventListener("input", updateGenerateEnabled);
  $("#prompt").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
  });
}

// ---------------------------------------------------------------------------
// Rail: modalities + models
// ---------------------------------------------------------------------------

function renderModalities() {
  const host = $("#modality-list");
  host.replaceChildren(
    ...MODALITIES.map((m) => {
      const el = document.createElement("div");
      el.className = "modality" + (m.live ? "" : " disabled") + (m.id === "image" ? " active" : "");
      el.innerHTML = `<span>${m.icon}</span><span>${m.label}</span>` + (m.live ? "" : `<span class="soon">soon</span>`);
      return el;
    }),
  );
}

function renderModels() {
  const host = $("#model-list");
  host.replaceChildren(
    ...state.catalog.map((m) => {
      const card = document.createElement("button");
      card.className = "model-card";
      card.dataset.id = m.id;
      card.innerHTML = `
        <div class="mc-top">
          <span class="mc-label">${esc(m.label)}</span>
          <span class="mc-cost">~$${m.approxCost.toFixed(m.approxCost < 0.01 ? 3 : 2)}</span>
        </div>
        <div class="mc-provider">${esc(m.provider)}</div>
        <div class="mc-blurb">${esc(m.blurb)}</div>`;
      card.addEventListener("click", () => selectModel(m.id));
      return card;
    }),
  );
}

function selectModel(id) {
  const model = state.catalog.find((m) => m.id === id);
  if (!model) return;
  state.model = model;
  state.options = { ...model.happyPath };
  document.querySelectorAll(".model-card").forEach((c) => c.classList.toggle("active", c.dataset.id === id));
  renderAdvanced(); // no-op until increment 3
  updateGenerateEnabled();
}

// ---------------------------------------------------------------------------
// Advanced options — filled in increment 3
// ---------------------------------------------------------------------------

function renderAdvanced() {}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

function updateGenerateEnabled() {
  const ready = Boolean(state.model && $("#prompt").value.trim());
  $("#generate-btn").disabled = !ready;
}

async function generate() {
  const prompt = $("#prompt").value.trim();
  if (!state.model || !prompt) return;

  $("#empty-state").hidden = true;
  const card = addLoadingCard();
  setGenerating(true);

  const payload = { model: state.model.id, prompt, ...state.options };

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      card.remove();
      handleApiError(res.status, data);
      return;
    }
    fillResultCard(card, data, prompt);
    if (data.usage?.cost) bumpCost(data.usage.cost);
  } catch (err) {
    card.remove();
    toast("Network error: " + err.message, true);
  } finally {
    setGenerating(false);
  }
}

function setGenerating(on) {
  const btn = $("#generate-btn");
  btn.disabled = on;
  btn.textContent = on ? "Generating…" : "Generate";
  if (!on) updateGenerateEnabled();
}

// ---------------------------------------------------------------------------
// Result cards
// ---------------------------------------------------------------------------

function addLoadingCard() {
  const card = document.createElement("div");
  card.className = "result-card loading";
  card.innerHTML = `<div class="img-wrap"><div class="spinner"></div></div>`;
  $("#results").prepend(card);
  return card;
}

function fillResultCard(card, data, prompt) {
  const item = data.data?.[0];
  if (!item) {
    card.remove();
    toast("No image returned.", true);
    return;
  }
  const src = imageSrc(item);
  const cost = data.usage?.cost ? `$${data.usage.cost.toFixed(3)}` : "";
  card.classList.remove("loading");
  card.innerHTML = `
    <div class="img-wrap"><img alt="${esc(prompt).slice(0, 80)}" src="${src}" /></div>
    <div class="result-meta">
      <span class="rm-cost">${state.model.label} · ${cost}</span>
      <div class="result-actions">
        <button class="icon-btn" data-act="download">Download</button>
      </div>
    </div>`;
  card.querySelector('[data-act="download"]').addEventListener("click", () => downloadImage(src, item));
}

function imageSrc(item) {
  if (item.url) return item.url;
  if (item.b64_json) return `data:${item.mime_type || "image/png"};base64,${item.b64_json}`;
  return "";
}

function downloadImage(src, item) {
  const a = document.createElement("a");
  a.href = src;
  a.download = (item.file_id || "image") + (item.mime_type === "image/jpeg" ? ".jpg" : ".png");
  a.target = "_blank";
  a.click();
}

// ---------------------------------------------------------------------------
// Cost + errors
// ---------------------------------------------------------------------------

function bumpCost(amount) {
  state.sessionCost += amount;
  $("#session-cost").textContent = `$${state.sessionCost.toFixed(3)}`;
}

function handleApiError(status, data) {
  if (data?.code === "disconnected") {
    toast("Disconnected from Opper. Please reconnect.", true);
    if (state.me?.authMode === "oauth") setTimeout(() => (location.href = "/login"), 1500);
    return;
  }
  if (data?.code === "balance") {
    toast("Opper Wallet is empty. Top up to keep generating.", true);
    return;
  }
  toast(data?.error || `Error ${status}`, true);
}

// ---------------------------------------------------------------------------
// Auth chrome + helpers
// ---------------------------------------------------------------------------

function renderUserChip() {
  const chip = $("#user-chip");
  chip.textContent = state.me?.user?.name ?? "";
  if (state.me?.authMode === "oauth") {
    chip.style.cursor = "pointer";
    chip.title = "Log out";
    chip.onclick = async () => {
      await fetch("/api/logout", { method: "POST" });
      location.reload();
    };
  }
}

function showLoginError() {
  const err = new URLSearchParams(location.search).get("login_error");
  if (!err) return;
  const el = $("#gate-error");
  el.textContent = err;
  el.hidden = false;
}

let toastTimer = null;
function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

window.studio = { state, toast };

boot();
