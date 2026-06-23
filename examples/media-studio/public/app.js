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
  inputs: {}, // { image: [{file_id, preview}], reference_images: [...] } — per input slot
  sessionCost: 0,
};

const MODALITIES = [
  { id: "image", label: "Image", icon: "▣", live: true },
  { id: "video", label: "Video", icon: "▶", live: true },
  { id: "audio", label: "Audio", icon: "♪", live: true },
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
  $("#picker").addEventListener("click", (e) => {
    if (e.target.id === "picker") closePicker();
  });
  $("#picker-close").addEventListener("click", closePicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeLightbox();
      closePicker();
    }
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
// Gallery picker — choose a stored image as a reference / source
// ---------------------------------------------------------------------------

let pickerOnPick = null;

async function openPicker(onPick) {
  pickerOnPick = onPick;
  const grid = $("#picker-grid");
  grid.replaceChildren();
  $("#picker").hidden = false;
  try {
    const { items } = await (await fetch("/api/gallery")).json();
    const imgs = (items || []).filter((i) => i.kind !== "video");
    if (!imgs.length) {
      grid.innerHTML = '<p class="muted" style="padding:20px">No saved images yet.</p>';
      return;
    }
    grid.replaceChildren(
      ...imgs.map((it) => {
        const b = document.createElement("button");
        b.className = "picker-item";
        b.title = it.prompt || "";
        b.innerHTML = `<img loading="lazy" src="/s/${it.file_id}" alt=""/>`;
        b.addEventListener("click", () => {
          const pick = pickerOnPick;
          closePicker();
          pick?.({ file_id: it.file_id, preview: `/s/${it.file_id}` });
        });
        return b;
      }),
    );
  } catch {
    grid.innerHTML = '<p class="muted" style="padding:20px">Could not load gallery.</p>';
  }
}

function closePicker() {
  $("#picker").hidden = true;
  pickerOnPick = null;
}

/** Animate an image into a video: switch to an image-to-video model with it as the starting frame. */
function animateImage(fileId, src) {
  const i2v = state.catalog.find((m) => m.modality === "video" && m.video && m.video.inputKind !== "t2v");
  if (!i2v) return toast("No image-to-video model available.", true);
  state.modality = "video";
  renderModalities();
  renderModels();
  selectModel(i2v.id); // clears state.inputs
  const slot = inputSlots(i2v).find((s) => s.field === "image");
  if (slot) addInput("image", slot.max, { file_id: fileId, preview: src });
  switchView("studio");
  toast(`Starting image set on ${i2v.label} — adjust options and Generate.`);
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
  if (p.aspect_ratio && m.dimension?.kind === "aspect" && m.dimension.options.includes(p.aspect_ratio)) {
    state.options.aspect_ratio = p.aspect_ratio;
  }
  if (p.size && m.dimension?.kind === "size" && m.dimension.options.includes(p.size)) {
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
  const isAudio = item.kind === "audio";
  const isImage = !isVideo && !isAudio;
  const card = document.createElement("div");
  card.className = "result-card";
  const body = isVideo
    ? `<div class="img-wrap"><video src="${src}" controls playsinline preload="metadata"></video></div>`
    : isAudio
      ? `<div class="audio-wrap"><span class="audio-glyph">♪</span><audio controls src="${src}"></audio></div>`
      : `<div class="img-wrap"><img loading="lazy" src="${src}" alt="${esc(item.prompt || "saved creation")}"/></div>`;
  card.innerHTML = `
    ${body}
    <div class="result-meta">
      <span class="rm-cost" title="${esc(item.prompt || "")}">${esc(item.model || "")}</span>
      <div class="result-actions">
        ${isImage ? '<button class="icon-btn" data-act="remix">⇄ Remix</button>' : ""}
        ${isImage ? '<button class="icon-btn" data-act="animate">🎬 Video</button>' : ""}
        <button class="icon-btn" data-act="share">Share</button>
        <button class="icon-btn" data-act="download">Download</button>
        <button class="icon-btn" data-act="delete" title="Delete file">🗑</button>
      </div>
    </div>`;
  if (isImage) {
    card.querySelector("img").addEventListener("click", () => openLightbox(src));
    card.querySelector('[data-act="remix"]').addEventListener("click", () => {
      remixFromResult({ file_id: fileId }, src);
      switchView("studio");
    });
    card.querySelector('[data-act="animate"]').addEventListener("click", () => animateImage(fileId, src));
  }
  card.querySelector('[data-act="share"]').addEventListener("click", () => copyShareLink(fileId));
  card.querySelector('[data-act="download"]').addEventListener("click", () =>
    isAudio
      ? downloadAudio(src, { file_id: fileId, mime_type: item.mime_type })
      : downloadImage(src, { file_id: fileId, mime_type: isVideo ? "video/mp4" : item.mime_type }),
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
  state.inputs = {};
  renderModalities();
  renderModels();
  selectModel(defaultModelFor(modality).id);
}

function costLabel(m) {
  const n = m.approxCost.toFixed(m.approxCost < 0.01 ? 3 : 2);
  const unit =
    m.costUnit === "second" ? "/s" : m.costUnit === "clip" ? "/clip" : m.costUnit === "1k" ? "/1K" : "";
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
  state.inputs = {};
  document.querySelectorAll(".model-card").forEach((c) => c.classList.toggle("active", c.dataset.id === id));
  $("#advanced-toggle").hidden = false;
  updateComposerForModality();
  renderAdvanced();
  renderReferenceZone();
  updateGenerateEnabled();
}

// The intent bar structures visual prompts; for speech the prompt is the literal
// text to speak, so hide it and relabel the box.
function updateComposerForModality() {
  const mod = state.model?.modality;
  $("#intent-bar").hidden = mod === "audio";
  $("#prompt").placeholder =
    mod === "audio" ? "The text to speak…" : "A prompt… or use the smart bar above to fill everything in.";
}

// ---------------------------------------------------------------------------
// Reference media — upload to /v3/files, reuse as reference / edit source
// ---------------------------------------------------------------------------

// The input-image slots the selected model accepts. A model can offer BOTH a
// "starting image" (→ `image`: the source to edit, or a video's first frame) and
// "references" (→ `reference_images`: subject/style guides) — the API treats them
// as distinct fields, so we render a slot for each. Order: starting image first.
function inputSlots(m) {
  if (!m) return [];
  if (m.modality === "image") {
    const slots = [];
    if (m.supports.imageEdit) slots.push({ field: "image", noun: "starting image", max: 1 });
    if (m.supports.referenceImages) slots.push({ field: "reference_images", noun: "reference", max: 8 });
    return slots;
  }
  if (m.modality === "video") {
    const v = m.video || {};
    const slots = [];
    if (v.inputKind === "i2v" || v.inputKind === "both")
      slots.push({ field: "image", noun: "starting image", max: 1, required: !!v.requiresImage });
    if (v.referenceImages) slots.push({ field: "reference_images", noun: "reference", max: 3 });
    return slots;
  }
  return []; // audio takes no input image
}

function slotItems(field) {
  return state.inputs[field] || (state.inputs[field] = []);
}

/** Add an image (uploaded or picked) to a slot, respecting its max (max 1 replaces). */
function addInput(field, max, ref) {
  const items = slotItems(field);
  if (max === 1) items.length = 0;
  else if (items.length >= max) items.shift();
  items.push(ref);
  renderReferenceZone();
  updateGenerateEnabled();
}

function renderReferenceZone() {
  const zone = $("#reference-zone");
  const slots = inputSlots(state.model);
  // Drop any stored inputs the current model doesn't accept.
  for (const f of Object.keys(state.inputs)) {
    if (!slots.some((s) => s.field === f)) delete state.inputs[f];
  }
  if (!slots.length) {
    zone.hidden = true;
    return;
  }
  zone.hidden = false;
  zone.replaceChildren(...slots.map(renderSlot));
}

function renderSlot(slot) {
  const items = slotItems(slot.field);
  if (items.length > slot.max) items.length = slot.max;

  const group = document.createElement("div");
  group.className = "input-slot";
  const need = slot.required ? " (required)" : "";
  const isImg = slot.field === "image";
  const isVideo = state.model?.modality === "video";
  const title = (isImg ? "Starting image" : "References") + need;
  // The distinction is fuzzy across image models, so spell out what each does.
  const hint = isImg
    ? isVideo
      ? "first frame to animate"
      : "edits this image"
    : isVideo
      ? "keeps this subject consistent"
      : "guides a new image";
  const lab = document.createElement("div");
  lab.className = "input-slot-label";
  lab.innerHTML = `${esc(title)} <span class="input-slot-hint">· ${esc(hint)}</span>`;
  const row = document.createElement("div");
  row.className = "reference-row";

  const thumbs = items.map((ref, i) => {
    const t = document.createElement("div");
    t.className = "ref-thumb";
    t.innerHTML = `<img src="${ref.preview}" alt="${esc(slot.noun)}"/><button class="ref-x" title="Remove">×</button>`;
    t.querySelector(".ref-x").addEventListener("click", () => {
      items.splice(i, 1);
      renderReferenceZone();
      updateGenerateEnabled();
    });
    return t;
  });

  const addBtn = document.createElement("label");
  addBtn.className = "ref-add";
  addBtn.innerHTML = `+ Add ${esc(slot.noun)}<input type="file" accept="image/*" hidden ${slot.max > 1 ? "multiple" : ""}/>`;
  addBtn.querySelector("input").addEventListener("change", (e) => onPickFiles(e.target.files, slot));

  const pickBtn = document.createElement("button");
  pickBtn.className = "ref-pick";
  pickBtn.textContent = "Choose from gallery";
  pickBtn.addEventListener("click", () => openPicker((ref) => addInput(slot.field, slot.max, ref)));

  const controls = items.length >= slot.max ? [] : [addBtn, pickBtn];
  row.replaceChildren(...thumbs, ...controls);
  group.append(lab, row);
  return group;
}

async function onPickFiles(fileList, slot) {
  const items = slotItems(slot.field);
  const files = [...fileList].slice(0, slot.max - items.length);
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
      addInput(slot.field, slot.max, { file_id: data.id, preview });
    } catch (err) {
      toast("Upload failed: " + err.message, true);
    }
  }
}

/** Remix: feed a generated result back in as a reference (no re-upload). */
function remixFromResult(item, src) {
  // Need a model with a references slot — switch to the capable default if not.
  if (!inputSlots(state.model).some((s) => s.field === "reference_images")) {
    const capable = state.catalog.find((m) => m.modality === "image" && m.supports.referenceImages) ?? state.model;
    selectModel(capable.id);
  }
  const slot = inputSlots(state.model).find((s) => s.field === "reference_images");
  if (!slot) return;
  addInput("reference_images", slot.max, { file_id: item.file_id, preview: src });
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
  if (m.modality === "audio") return renderAudioAdvanced(m);

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

// Audio advanced options — voice / format / speed, from the model's audio config.
// Each control writes into state.options (the top-level speech params).
function renderAudioAdvanced(m) {
  const panel = $("#advanced-panel");
  const a = m.audio || {};
  const fields = [];
  if (a.voices?.length) {
    fields.push(
      fieldChips("Voice", a.voices, state.options.voice ?? a.defaultVoice, (v) => {
        state.options.voice = v;
      }),
    );
  }
  if (a.formats?.length) {
    fields.push(
      fieldChips("Format", a.formats, state.options.format, (v) => {
        state.options.format = v;
      }),
    );
  }
  if (a.speed) {
    fields.push(
      fieldChips(
        "Speed",
        [0.5, 0.75, 1, 1.25, 1.5, 2],
        state.options.speed ?? 1,
        (v) => {
          state.options.speed = v;
        },
        (n) => `${n}×`,
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
  const missingRequired = inputSlots(state.model).some(
    (s) => s.required && slotItems(s.field).length === 0,
  );
  const ready = Boolean(state.model && $("#prompt").value.trim()) && !missingRequired;
  $("#generate-btn").disabled = !ready;
}

// Attach any uploaded input images to a payload, one field per filled slot:
// `image` takes a single starting image; `reference_images` takes the list.
function attachInputs(payload) {
  for (const slot of inputSlots(state.model)) {
    const ids = slotItems(slot.field).map((r) => r.file_id);
    if (!ids.length) continue;
    if (slot.field === "image") payload.image = ids[0];
    else payload[slot.field] = ids;
  }
}

async function generate() {
  const prompt = $("#prompt").value.trim();
  if (!state.model || !prompt) return;
  if (state.model.modality === "video") return generateVideo(prompt);
  if (state.model.modality === "audio") return generateAudio(prompt);

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
// Audio — synchronous TTS, like images: one request, one clip back
// ---------------------------------------------------------------------------

async function generateAudio(text) {
  $("#empty-state").hidden = true;
  const card = addLoadingCard();
  setGenerating(true);

  const o = state.options;
  const payload = { model: state.model.id, input: text };
  if (o.voice) payload.voice = o.voice;
  if (o.format) payload.format = o.format;
  if (typeof o.speed === "number" && o.speed !== 1) payload.speed = o.speed;

  try {
    const res = await fetch("/api/speech", {
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
    fillAudioCard(card, data, text);
    if (data.usage?.cost) bumpCost(data.usage.cost);
  } catch (err) {
    clearCard(card);
    toast("Network error: " + err.message, true);
  } finally {
    setGenerating(false);
  }
}

function fillAudioCard(card, data, text) {
  clearInterval(card._timer);
  const audio = data.audio || {};
  const src = audioSrc(audio);
  const cost = data.usage?.cost ? `$${data.usage.cost.toFixed(3)}` : "";
  card.classList.remove("loading");
  card.innerHTML = `
    <div class="audio-wrap"><span class="audio-glyph">♪</span><audio controls src="${src}"></audio></div>
    <div class="result-meta">
      <span class="rm-cost" title="${esc(text)}">${esc(state.model.label)}${cost ? " · " + cost : ""}</span>
      <div class="result-actions">
        <button class="icon-btn" data-act="share">Share</button>
        <button class="icon-btn" data-act="download">Download</button>
      </div>
    </div>`;
  card.querySelector('[data-act="download"]').addEventListener("click", () =>
    downloadAudio(src, { file_id: audio.file_id, mime_type: audio.mime_type }),
  );
  const shareBtn = card.querySelector('[data-act="share"]');
  if (audio.file_id) shareBtn.addEventListener("click", () => copyShareLink(audio.file_id));
  else shareBtn.remove();
}

function audioSrc(audio) {
  if (audio.url) return audio.url;
  if (audio.file_id) return `/s/${audio.file_id}`;
  if (audio.b64_json) return `data:${audio.mime_type || "audio/mpeg"};base64,${audio.b64_json}`;
  return "";
}

function downloadAudio(src, item) {
  const m = item.mime_type || "audio/mpeg";
  const ext = m.includes("wav")
    ? ".wav"
    : m.includes("flac")
      ? ".flac"
      : m.includes("opus") || m.includes("ogg")
        ? ".opus"
        : m.includes("aac")
          ? ".aac"
          : m.includes("pcm")
            ? ".pcm"
            : ".mp3";
  const a = document.createElement("a");
  a.href = src;
  a.download = (item.file_id || "speech") + ext;
  a.target = "_blank";
  a.click();
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
        <button class="icon-btn" data-act="animate">🎬 Video</button>
        <button class="icon-btn" data-act="share">Share</button>
        <button class="icon-btn" data-act="download">Download</button>
      </div>
    </div>`;
  card.querySelector("img").addEventListener("click", () => openLightbox(src));
  card.querySelector('[data-act="download"]').addEventListener("click", () => downloadImage(src, item));
  const remixBtn = card.querySelector('[data-act="remix"]');
  const animateBtn = card.querySelector('[data-act="animate"]');
  const shareBtn = card.querySelector('[data-act="share"]');
  if (item.file_id) {
    remixBtn.addEventListener("click", () => remixFromResult(item, src));
    animateBtn.addEventListener("click", () => animateImage(item.file_id, src));
    shareBtn.addEventListener("click", () => copyShareLink(item.file_id));
  } else {
    // Remix, animate and share all need a stored file_id.
    remixBtn.remove();
    animateBtn.remove();
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
