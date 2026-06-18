// Media Studio — SPA.
// Increment 2: catalog-driven model picker + image happy path (generate → card).
// Advanced options, references, gallery and the intent bar come next.

const $ = (sel) => document.querySelector(sel);

const state = {
  me: null,
  catalog: [],
  model: null, // selected ModelEntry
  options: {}, // current generation options (dimension/quality/n)
  references: [], // [{ file_id, preview }]
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
  $("#advanced-toggle").addEventListener("click", toggleAdvanced);
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
  $("#advanced-toggle").hidden = false;
  renderAdvanced();
  renderReferenceZone();
  updateGenerateEnabled();
}

// ---------------------------------------------------------------------------
// Reference media — upload to /v3/files, reuse as reference / edit source
// ---------------------------------------------------------------------------

function maxRefs(m) {
  if (m.supports.referenceImages) return 8;
  if (m.supports.imageEdit) return 1;
  return 0;
}

function renderReferenceZone() {
  const zone = $("#reference-zone");
  const max = maxRefs(state.model);
  if (max === 0) {
    zone.hidden = true;
    state.references = [];
    return;
  }
  zone.hidden = false;
  if (state.references.length > max) state.references = state.references.slice(0, max);

  const thumbs = state.references.map((ref, i) => {
    const t = document.createElement("div");
    t.className = "ref-thumb";
    t.innerHTML = `<img src="${ref.preview}" alt="reference"/><button class="ref-x" title="Remove">×</button>`;
    t.querySelector(".ref-x").addEventListener("click", () => {
      state.references.splice(i, 1);
      renderReferenceZone();
    });
    return t;
  });

  const addBtn = document.createElement("label");
  addBtn.className = "ref-add";
  const noun = state.model.supports.referenceImages ? "reference" : "image to edit";
  addBtn.innerHTML = `+ Add ${noun}<input type="file" accept="image/*" hidden ${max > 1 ? "multiple" : ""}/>`;
  addBtn.querySelector("input").addEventListener("change", (e) => onPickFiles(e.target.files));
  if (state.references.length >= max) addBtn.style.display = "none";

  zone.replaceChildren(...thumbs, addBtn);
}

async function onPickFiles(fileList) {
  const max = maxRefs(state.model);
  const files = [...fileList].slice(0, max - state.references.length);
  for (const file of files) {
    const preview = URL.createObjectURL(file);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/files", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        handleApiError(res.status, data);
        continue;
      }
      state.references.push({ file_id: data.id, preview });
      renderReferenceZone();
    } catch (err) {
      toast("Upload failed: " + err.message, true);
    }
  }
}

/** Remix: feed a generated result back in as a reference (no re-upload). */
function remixFromResult(item, src) {
  if (maxRefs(state.model) === 0) {
    // Current model can't take references — switch to the capable default.
    const capable = state.catalog.find((m) => m.supports.referenceImages) ?? state.model;
    selectModel(capable.id);
  }
  const max = maxRefs(state.model);
  if (state.references.length >= max) state.references = state.references.slice(0, max - 1);
  state.references.push({ file_id: item.file_id, preview: src });
  renderReferenceZone();
  $("#prompt").focus();
  toast("Added as reference — tweak the prompt and generate.");
}

// ---------------------------------------------------------------------------
// Advanced options — rendered from the selected model's capabilities
// ---------------------------------------------------------------------------

function toggleAdvanced() {
  const panel = $("#advanced-panel");
  const open = panel.hidden;
  panel.hidden = !open;
  $("#advanced-toggle").textContent = (open ? "▾" : "▸") + " Advanced options";
}

function renderAdvanced() {
  const m = state.model;
  const panel = $("#advanced-panel");
  const fields = [];

  // Dimension — size (pixels) or aspect ratio, as chips.
  const dim = m.dimension;
  const dimKey = dim.kind === "size" ? "size" : "aspect_ratio";
  fields.push(
    fieldChips(dim.kind === "size" ? "Size" : "Aspect ratio", dim.options, state.options[dimKey], (v) => {
      state.options[dimKey] = v;
    }),
  );

  // Quality tier.
  if (m.qualities?.length) {
    fields.push(
      fieldChips("Quality", m.qualities, state.options.quality ?? m.qualityDefault, (v) => {
        state.options.quality = v;
      }),
    );
  }

  // Number of images.
  if ((m.supports.n ?? 1) > 1) {
    fields.push(
      fieldNumber("Images", 1, m.supports.n, state.options.n ?? 1, (v) => {
        state.options.n = v;
      }),
    );
  }

  // Seed (provider passthrough).
  if (m.supports.seed) {
    fields.push(
      fieldNumber("Seed (optional)", 0, 2_147_483_647, state.options.parameters?.seed ?? "", (v) => {
        state.options.parameters = { ...(state.options.parameters || {}) };
        if (v === "" || v === null) delete state.options.parameters.seed;
        else state.options.parameters.seed = v;
      }),
    );
  }

  panel.replaceChildren(...fields);
}

function fieldChips(label, options, current, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const lab = document.createElement("label");
  lab.textContent = label;
  const row = document.createElement("div");
  row.className = "chip-row";
  options.forEach((opt) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (opt === current ? " active" : "");
    chip.textContent = opt;
    chip.addEventListener("click", () => {
      onChange(opt);
      row.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    });
    row.appendChild(chip);
  });
  wrap.append(lab, row);
  return wrap;
}

function fieldNumber(label, min, max, value, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const lab = document.createElement("label");
  lab.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = value === "" ? "" : String(value);
  input.addEventListener("input", () => {
    const v = input.value === "" ? "" : Math.max(min, Math.min(max, parseInt(input.value) || min));
    onChange(v);
  });
  wrap.append(lab, input);
  return wrap;
}

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
  if (state.references.length) {
    const ids = state.references.map((r) => r.file_id);
    if (state.model.supports.referenceImages) payload.reference_images = ids;
    else if (state.model.supports.imageEdit) payload.image = ids[0];
  }

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
        <button class="icon-btn" data-act="remix">⇄ Remix</button>
        <button class="icon-btn" data-act="download">Download</button>
      </div>
    </div>`;
  card.querySelector('[data-act="download"]').addEventListener("click", () => downloadImage(src, item));
  const remixBtn = card.querySelector('[data-act="remix"]');
  if (item.file_id) remixBtn.addEventListener("click", () => remixFromResult(item, src));
  else remixBtn.remove(); // remix needs a stored file_id
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
