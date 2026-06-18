// Media Studio — SPA.
// Increment 2: catalog-driven model picker + image happy path (generate → card).
// Advanced options, references, gallery and the intent bar come next.

const $ = (sel) => document.querySelector(sel);

const state = {
  me: null,
  catalog: [],
  modality: "image", // which media type the picker is showing
  model: null, // selected ModelEntry
  options: {}, // image: top-level options; video: the `parameters` object
  references: [], // [{ file_id, preview }]
  sessionCost: 0,
};

// Modalities. Audio is the next one to light up.
const MODALITIES = [
  { id: "image", label: "Image", icon: "▣", live: true },
  { id: "video", label: "Video", icon: "▶", live: true },
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
  selectModel(defaultModelFor(state.modality).id);

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
  const isVideo = item.kind === "video";
  const card = document.createElement("div");
  card.className = "result-card";
  const media = isVideo
    ? `<video src="${src}" controls playsinline preload="metadata"></video>`
    : `<img loading="lazy" src="${src}" alt="${esc(item.prompt || "saved creation")}"/>`;
  card.innerHTML = `
    <div class="img-wrap">${media}</div>
    <div class="result-meta">
      <span class="rm-cost" title="${esc(item.prompt || "")}">${esc(item.model || "")}</span>
      <div class="result-actions">
        ${isVideo ? "" : '<button class="icon-btn" data-act="remix">⇄ Remix</button>'}
        <button class="icon-btn" data-act="share">Share</button>
        <button class="icon-btn" data-act="download">Download</button>
        <button class="icon-btn" data-act="delete" title="Delete file">🗑</button>
      </div>
    </div>`;
  if (!isVideo) {
    card.querySelector("img").addEventListener("click", () => openLightbox(src));
    card.querySelector('[data-act="remix"]').addEventListener("click", () => {
      remixFromResult({ file_id: fileId }, src);
      switchView("studio");
    });
  }
  card.querySelector('[data-act="share"]').addEventListener("click", () => copyShareLink(fileId));
  card.querySelector('[data-act="download"]').addEventListener("click", () =>
    downloadImage(src, { file_id: fileId, mime_type: isVideo ? "video/mp4" : item.mime_type }),
  );
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

function defaultModelFor(modality) {
  const inMod = state.catalog.filter((m) => m.modality === modality);
  return inMod.find((m) => m.default) ?? inMod[0];
}

function renderModalities() {
  const host = $("#modality-list");
  host.replaceChildren(
    ...MODALITIES.map((m) => {
      const el = document.createElement("div");
      el.className = "modality" + (m.live ? "" : " disabled") + (m.id === state.modality ? " active" : "");
      el.innerHTML = `<span>${m.icon}</span><span>${m.label}</span>` + (m.live ? "" : `<span class="soon">soon</span>`);
      if (m.live) el.addEventListener("click", () => switchModality(m.id));
      return el;
    }),
  );
}

function switchModality(modality) {
  if (modality === state.modality) return;
  state.modality = modality;
  state.references = [];
  renderModalities();
  renderModels();
  selectModel(defaultModelFor(modality).id);
}

function costLabel(m) {
  const n = m.approxCost.toFixed(m.approxCost < 0.01 ? 3 : 2);
  const unit = m.costUnit === "second" ? "/s" : m.costUnit === "clip" ? "/clip" : "";
  return `~$${n}${unit}`;
}

function renderModels() {
  const host = $("#model-list");
  host.replaceChildren(
    ...state.catalog
      .filter((m) => m.modality === state.modality)
      .map((m) => {
        const card = document.createElement("button");
        card.className = "model-card";
        card.dataset.id = m.id;
        card.innerHTML = `
        <div class="mc-top">
          <span class="mc-label">${esc(m.label)}</span>
          <span class="mc-cost">${costLabel(m)}</span>
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

// What input images (if any) the selected model takes, and how they're sent.
function inputSpec(m) {
  if (!m) return { max: 0 };
  if (m.modality === "image") {
    if (m.supports.referenceImages) return { max: 8, field: "reference_images", noun: "reference" };
    if (m.supports.imageEdit) return { max: 1, field: "image", noun: "image to edit" };
    return { max: 0 };
  }
  // video
  const v = m.video || {};
  if (v.referenceImages) return { max: 3, field: "reference_images", noun: "reference" };
  if (v.inputKind === "i2v" || v.inputKind === "both") {
    return { max: 1, field: "image", noun: "source image", required: !!v.requiresImage };
  }
  return { max: 0 };
}

function maxRefs(m) {
  return inputSpec(m).max;
}

function renderReferenceZone() {
  const zone = $("#reference-zone");
  const spec = inputSpec(state.model);
  if (spec.max === 0) {
    zone.hidden = true;
    state.references = [];
    return;
  }
  zone.hidden = false;
  if (state.references.length > spec.max) state.references = state.references.slice(0, spec.max);

  const thumbs = state.references.map((ref, i) => {
    const t = document.createElement("div");
    t.className = "ref-thumb";
    t.innerHTML = `<img src="${ref.preview}" alt="reference"/><button class="ref-x" title="Remove">×</button>`;
    t.querySelector(".ref-x").addEventListener("click", () => {
      state.references.splice(i, 1);
      renderReferenceZone();
      updateGenerateEnabled();
    });
    return t;
  });

  const addBtn = document.createElement("label");
  addBtn.className = "ref-add";
  const need = spec.required ? " (required)" : "";
  addBtn.innerHTML = `+ Add ${spec.noun}${need}<input type="file" accept="image/*" hidden ${spec.max > 1 ? "multiple" : ""}/>`;
  addBtn.querySelector("input").addEventListener("change", (e) => onPickFiles(e.target.files));
  if (state.references.length >= spec.max) addBtn.style.display = "none";

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
      updateGenerateEnabled();
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
  if (m.modality === "video") return renderVideoAdvanced(m);

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

// Video advanced options — provider-specific keys live in the model's video
// config; each control writes into state.options (the `parameters` object).
function renderVideoAdvanced(m) {
  const panel = $("#advanced-panel");
  const v = m.video || {};
  const fields = [];
  if (v.resolutions) {
    fields.push(
      fieldChips("Resolution", v.resolutions.options, state.options[v.resolutions.key], (val) => {
        state.options[v.resolutions.key] = val;
      }),
    );
  }
  if (v.aspectRatios) {
    fields.push(
      fieldChips("Aspect ratio", v.aspectRatios.options, state.options[v.aspectRatios.key], (val) => {
        state.options[v.aspectRatios.key] = val;
      }),
    );
  }
  if (v.durations) {
    fields.push(
      fieldChips(
        "Duration (s)",
        v.durations.options,
        state.options[v.durations.key],
        (val) => {
          state.options[v.durations.key] = val;
        },
        (n) => `${n}s`,
      ),
    );
  }
  panel.replaceChildren(...fields);
}

function fieldChips(label, options, current, onChange, fmt) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const lab = document.createElement("label");
  lab.textContent = label;
  const row = document.createElement("div");
  row.className = "chip-row";
  options.forEach((opt) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (opt === current ? " active" : "");
    chip.textContent = fmt ? fmt(opt) : opt;
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
  const spec = inputSpec(state.model);
  const needsImage = spec.required && state.references.length === 0;
  const ready = Boolean(state.model && $("#prompt").value.trim()) && !needsImage;
  $("#generate-btn").disabled = !ready;
}

// Attach any uploaded input images to a payload per the model's input spec.
function attachInputs(payload) {
  if (!state.references.length) return;
  const ids = state.references.map((r) => r.file_id);
  const spec = inputSpec(state.model);
  if (spec.field === "reference_images") payload.reference_images = ids;
  else if (spec.field === "image") payload.image = ids[0];
}

async function generate() {
  const prompt = $("#prompt").value.trim();
  if (!state.model || !prompt) return;
  if (state.model.modality === "video") return generateVideo(prompt);

  $("#empty-state").hidden = true;
  const card = addLoadingCard();
  setGenerating(true);

  const payload = { model: state.model.id, prompt, ...state.options };
  attachInputs(payload);
  // Route generation-vs-edit models (e.g. Pruna) to their edit variant when a source image is present.
  if (payload.image && state.model.editModel) payload.model = state.model.editModel;

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
// Video — async: submit a job, then poll until the clip is ready
// ---------------------------------------------------------------------------

async function generateVideo(prompt) {
  const model = state.model;
  $("#empty-state").hidden = true;
  const card = addLoadingCard();
  setGenerating(true);

  const payload = { model: model.id, prompt, parameters: { ...state.options } };
  attachInputs(payload); // image / reference_images at top level

  try {
    const res = await fetch("/api/video", {
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
    toast("Video queued — this can take a few minutes.");
    pollVideo(data.id, card, prompt, model);
  } catch (err) {
    clearCard(card);
    toast("Network error: " + err.message, true);
  } finally {
    // Job is queued; free the button so more can be started while it renders.
    setGenerating(false);
  }
}

async function pollVideo(id, card, prompt, model) {
  try {
    const res = await fetch(`/api/video/${id}`);
    const data = await res.json();
    if (!res.ok) {
      clearCard(card);
      handleApiError(res.status, data);
      return;
    }
    if (data.status === "completed") return fillVideoCard(card, data, prompt, model);
    if (data.status === "failed") {
      clearCard(card);
      toast("Video failed: " + (data.error || "unknown error"), true);
      return;
    }
    setTimeout(() => pollVideo(id, card, prompt, model), 4000);
  } catch {
    setTimeout(() => pollVideo(id, card, prompt, model), 5000); // transient — keep trying
  }
}

function fillVideoCard(card, data, prompt, model) {
  clearInterval(card._timer);
  const src = data.url || (data.file_id ? `/s/${data.file_id}` : "");
  card.classList.remove("loading");
  card.innerHTML = `
    <div class="img-wrap"><video src="${src}" controls playsinline></video></div>
    <div class="result-meta">
      <span class="rm-cost" title="${esc(prompt)}">${esc(model.label)}</span>
      <div class="result-actions">
        <button class="icon-btn" data-act="share">Share</button>
        <button class="icon-btn" data-act="download">Download</button>
      </div>
    </div>`;
  card.querySelector('[data-act="download"]').addEventListener("click", () =>
    downloadImage(src, { file_id: data.file_id, mime_type: data.mime_type || "video/mp4" }),
  );
  const shareBtn = card.querySelector('[data-act="share"]');
  if (data.file_id) shareBtn.addEventListener("click", () => copyShareLink(data.file_id));
  else shareBtn.remove();
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
  const ext = item.mime_type?.includes("mp4")
    ? ".mp4"
    : item.mime_type === "image/jpeg"
      ? ".jpg"
      : item.mime_type?.startsWith("video/")
        ? ".mp4"
        : ".png";
  const a = document.createElement("a");
  a.href = src;
  a.download = (item.file_id || "media") + ext;
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
