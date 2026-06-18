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
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

  $("#intent-bar").hidden = false;
  $("#intent-go").addEventListener("click", runIntent);
  $("#intent-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runIntent();
  });

  $("#lightbox").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
}

// ---------------------------------------------------------------------------
// Lightbox — click an image to inspect it full size
// ---------------------------------------------------------------------------

function openLightbox(src) {
  if (!src) return;
  $("#lightbox-img").src = src;
  $("#lightbox").hidden = false;
}

function closeLightbox() {
  $("#lightbox").hidden = true;
  $("#lightbox-img").src = "";
}

// ---------------------------------------------------------------------------
// Intent bar — free text → a control patch (structured output via /v3/call)
// ---------------------------------------------------------------------------

async function runIntent() {
  const text = $("#intent-input").value.trim();
  if (!text) return;
  const btn = $("#intent-go");
  btn.disabled = true;
  btn.textContent = "Thinking…";
  try {
    const res = await fetch("/api/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, model: state.model?.id }),
    });
    const patch = await res.json();
    if (!res.ok) return handleApiError(res.status, patch);
    applyIntentPatch(patch);
  } catch (err) {
    toast("Couldn't set that up: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Set up";
  }
}

function applyIntentPatch(p) {
  // Switch model first — selectModel resets options to the model's happy path,
  // so any dimension/quality from the patch must be applied afterwards.
  if (p.model) {
    const m = state.catalog.find(
      (x) => x.id === p.model || x.label.toLowerCase() === String(p.model).toLowerCase(),
    );
    if (m) selectModel(m.id);
  }
  if (p.prompt) $("#prompt").value = p.prompt;

  const m = state.model;
  if (p.aspect_ratio && m.dimension.kind === "aspect" && m.dimension.options.includes(p.aspect_ratio)) {
    state.options.aspect_ratio = p.aspect_ratio;
  }
  if (p.size && m.dimension.kind === "size" && m.dimension.options.includes(p.size)) {
    state.options.size = p.size;
  }
  if (p.quality && m.qualities?.includes(p.quality)) state.options.quality = p.quality;
  if (p.n && (m.supports.n ?? 1) > 1) state.options.n = Math.min(p.n, m.supports.n);

  renderAdvanced();
  if ($("#advanced-panel").hidden) toggleAdvanced(); // reveal what changed
  updateGenerateEnabled();
  toast("Set up — review and Generate.");
}

// ---------------------------------------------------------------------------
// Views: studio / gallery
// ---------------------------------------------------------------------------

function switchView(view) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $("#view-studio").hidden = view !== "studio";
  $("#view-gallery").hidden = view !== "gallery";
  if (view === "gallery") loadGallery();
}

async function loadGallery() {
  const grid = $("#gallery");
  const empty = $("#gallery-empty");
  grid.replaceChildren();
  empty.hidden = true;
  try {
    const res = await fetch("/api/gallery");
    const data = await res.json();
    if (!res.ok) return handleApiError(res.status, data);
    if (!data.items?.length) {
      empty.hidden = false;
      return;
    }
    grid.replaceChildren(...data.items.map(galleryCard));
  } catch (err) {
    toast("Could not load gallery: " + err.message, true);
  }
}

function galleryCard(item) {
  const fileId = item.file_id;
  const src = `/s/${fileId}`;
  const card = document.createElement("div");
  card.className = "result-card";
  card.innerHTML = `
    <div class="img-wrap"><img loading="lazy" src="${src}" alt="${esc(item.prompt || "saved creation")}"/></div>
    <div class="result-meta">
      <span class="rm-cost" title="${esc(item.prompt || "")}">${esc(item.model || "")}</span>
      <div class="result-actions">
        <button class="icon-btn" data-act="remix">⇄ Remix</button>
        <button class="icon-btn" data-act="share">Share</button>
        <button class="icon-btn" data-act="download">Download</button>
        <button class="icon-btn" data-act="delete" title="Delete file">🗑</button>
      </div>
    </div>`;
  card.querySelector("img").addEventListener("click", () => openLightbox(src));
  card.querySelector('[data-act="remix"]').addEventListener("click", () => {
    remixFromResult({ file_id: fileId }, src);
    switchView("studio");
  });
  card.querySelector('[data-act="share"]').addEventListener("click", () => copyShareLink(fileId));
  card.querySelector('[data-act="download"]').addEventListener("click", () => downloadImage(src, { file_id: fileId, mime_type: item.mime_type }));
  wireDelete(card.querySelector('[data-act="delete"]'), fileId, card);
  return card;
}

// Two-step delete: first click arms ("Sure?"), second within 3s deletes.
function wireDelete(btn, fileId, card) {
  let armed = false;
  let armTimer = null;
  btn.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      btn.textContent = "Sure?";
      btn.classList.add("armed");
      armTimer = setTimeout(() => {
        armed = false;
        btn.textContent = "🗑";
        btn.classList.remove("armed");
      }, 3000);
      return;
    }
    clearTimeout(armTimer);
    btn.disabled = true;
    btn.textContent = "…";
    try {
      const res = await fetch(`/api/files/${fileId}`, { method: "DELETE" });
      if (!res.ok) {
        handleApiError(res.status, await res.json().catch(() => ({})));
        btn.disabled = false;
        btn.textContent = "🗑";
        btn.classList.remove("armed");
        armed = false;
        return;
      }
      card.remove();
      toast("Deleted.");
    } catch (err) {
      toast("Delete failed: " + err.message, true);
      btn.disabled = false;
      btn.textContent = "🗑";
      btn.classList.remove("armed");
      armed = false;
    }
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
      clearCard(card);
      handleApiError(res.status, data);
      return;
    }
    fillResultCard(card, data, prompt);
    if (data.usage?.cost) bumpCost(data.usage.cost);
  } catch (err) {
    clearCard(card);
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
  card.innerHTML = `<div class="img-wrap"><div class="spinner"></div><div class="elapsed">0s</div></div>`;
  $("#results").prepend(card);
  const t0 = Date.now();
  card._timer = setInterval(() => {
    const el = card.querySelector(".elapsed");
    if (el) el.textContent = Math.round((Date.now() - t0) / 1000) + "s";
  }, 1000);
  return card;
}

function clearCard(card) {
  clearInterval(card._timer);
  card.remove();
}

function fillResultCard(card, data, prompt) {
  clearInterval(card._timer);
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
        <button class="icon-btn" data-act="share">Share</button>
        <button class="icon-btn" data-act="download">Download</button>
      </div>
    </div>`;
  card.querySelector("img").addEventListener("click", () => openLightbox(src));
  card.querySelector('[data-act="download"]').addEventListener("click", () => downloadImage(src, item));
  const remixBtn = card.querySelector('[data-act="remix"]');
  const shareBtn = card.querySelector('[data-act="share"]');
  if (item.file_id) {
    remixBtn.addEventListener("click", () => remixFromResult(item, src));
    shareBtn.addEventListener("click", () => copyShareLink(item.file_id));
  } else {
    // Remix and share both need a stored file_id.
    remixBtn.remove();
    shareBtn.remove();
  }
}

async function copyShareLink(fileId) {
  if (!fileId) return toast("No shareable link (image wasn't stored).", true);
  // Copy the public presigned S3 URL — reachable by anyone (expires in ~1h),
  // which is what works when the studio runs locally.
  try {
    const { url } = await (await fetch(`/api/share/${fileId}`)).json();
    if (!url) throw new Error("no url");
    await navigator.clipboard.writeText(url);
    toast("Public link copied — opens for anyone, expires in ~1h.");
  } catch {
    // Fallback: the durable app link (only works when the app is hosted).
    const link = `${location.origin}/s/${fileId}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {}
    toast(link);
  }
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
