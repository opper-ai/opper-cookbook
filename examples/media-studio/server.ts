/**
 * Media Studio — server.
 *
 * A thin Express backend for a click-first media generation studio. It:
 *   - keeps the user's Opper API key server-side (the browser never sees it),
 *   - supports two auth modes: a single OPPER_API_KEY (quick start) or
 *     "Login with Opper" OAuth (each visitor pays from their own Wallet),
 *   - proxies generation + file calls to the Opper REST API.
 *
 * Generation/file/intent routes are added in later increments; this file
 * starts with config, sessions, auth, and static serving.
 */

import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID, randomBytes, createHash } from "crypto";
import { createServer } from "net";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import multer from "multer";
import { CATALOG } from "./catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load a local .env if present (no dependency — Node 20.12+ built-in). Values
// already set in the shell environment win, so exporting OPPER_API_KEY works too.
const envFile = join(__dirname, ".env");
if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envFile);
  } catch {}
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PREFERRED_PORT = parseInt(process.env.PORT || "3000");
const OPPER_BASE_URL = (process.env.OPPER_BASE_URL || "https://api.opper.ai").replace(/\/$/, "");
const API_HOST = (() => {
  try {
    return new URL(OPPER_BASE_URL).host;
  } catch {
    return OPPER_BASE_URL;
  }
})();
const CLIENT_ID = process.env.CLIENT_ID?.trim() || "";
const CLIENT_SECRET = process.env.CLIENT_SECRET?.trim() || "";
const OAUTH_ENABLED = Boolean(CLIENT_ID && CLIENT_SECRET);

/**
 * Local key resolution, mirroring the Opper CLI / reachy order:
 *   1. OPPER_API_KEY (env / .env)
 *   2. ~/.opper/config.json default slot (i.e. you ran `opper login`)
 * Falls through to Login-with-Opper OAuth when CLIENT_ID/SECRET are set.
 */
function readOpperCliSlot(): { apiKey: string; user?: { email?: string; name?: string } } | null {
  try {
    const home = process.env.OPPER_HOME || join(homedir(), ".opper");
    const cfg = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    const key = cfg.defaultKey || "default";
    const slot = cfg.keys?.[key];
    if (slot?.apiKey) return { apiKey: slot.apiKey, user: slot.user };
  } catch {}
  return null;
}

const ENV_API_KEY = process.env.OPPER_API_KEY?.trim() || "";
const cliSlot = ENV_API_KEY ? null : readOpperCliSlot();
const LOCAL_KEY = ENV_API_KEY || cliSlot?.apiKey || "";
const LOCAL_USER: User = ENV_API_KEY
  ? { name: API_HOST }
  : cliSlot
    ? { name: cliSlot.user?.email || cliSlot.user?.name || API_HOST, email: cliSlot.user?.email }
    : { name: API_HOST };
const LOCAL_SOURCE = ENV_API_KEY
  ? "OPPER_API_KEY (env)"
  : cliSlot
    ? `Opper CLI ~/.opper (${LOCAL_USER.name})`
    : "";

if (!LOCAL_KEY && !OAUTH_ENABLED) {
  console.error(
    "\nNo Opper credentials found. Either:\n" +
      "  - set OPPER_API_KEY in env / .env, or\n" +
      "  - run `opper login` (the CLI stores a key this app reads), or\n" +
      "  - set CLIENT_ID + CLIENT_SECRET for Login with Opper.\n",
  );
  process.exit(1);
}

/** Find the first available port starting from `start`. */
async function findPort(start: number, end = start + 20): Promise<number> {
  for (let port = start; port <= end; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, () => srv.close(() => resolve(true)));
    });
    if (available) return port;
  }
  return start;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
// In-memory session store keyed by an opaque cookie token. Fine for a demo;
// a real deployment would use a signed cookie or a shared store. Each session
// holds the Opper API key it should generate with and a display user.

type User = { name: string; email?: string };
type Session = { apiKey: string; user: User; portalUrl?: string };

const sessions = new Map<string, Session>();
const COOKIE = "ms_session";

function readCookie(req: express.Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function setSessionCookie(res: express.Response, token: string) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24}`,
  );
}

function newSession(session: Session): string {
  const token = randomBytes(24).toString("base64url");
  sessions.set(token, session);
  return token;
}

/**
 * Resolve the active session for a request. In env-key mode there is an
 * implicit, always-available session so the studio is usable with no login.
 */
function getSession(req: express.Request): Session | undefined {
  const token = readCookie(req, COOKIE);
  if (token && sessions.has(token)) return sessions.get(token);
  if (!OAUTH_ENABLED && LOCAL_KEY) {
    return { apiKey: LOCAL_KEY, user: LOCAL_USER };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Creations index
// ---------------------------------------------------------------------------
// The /v3/files list can't be filtered or tagged, so to scope the gallery to
// images made *in this app* we keep a small local index of the file_ids we
// generated, per Opper account. Survives restarts; also lets the gallery show
// the model + prompt, which the raw files list doesn't carry.

type Creation = {
  account: string;
  file_id: string;
  model: string;
  prompt: string;
  created: number;
  kind: "image" | "video" | "audio";
};

const DATA_DIR = join(__dirname, "data");
const CREATIONS_FILE = join(DATA_DIR, "creations.json");

/** Stable per-account id (never the raw key). */
function accountId(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
}

function loadCreations(): Creation[] {
  try {
    return JSON.parse(readFileSync(CREATIONS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function addCreations(entries: Creation[]): void {
  if (!entries.length) return;
  const all = loadCreations();
  all.push(...entries);
  writeCreations(all);
}

function removeCreation(apiKey: string, fileId: string): void {
  const acct = accountId(apiKey);
  const all = loadCreations();
  const next = all.filter((c) => !(c.account === acct && c.file_id === fileId));
  if (next.length !== all.length) writeCreations(next);
}

function writeCreations(all: Creation[]): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CREATIONS_FILE, JSON.stringify(all));
  } catch (err) {
    console.warn("could not persist creations:", (err as Error)?.message);
  }
}

// ---------------------------------------------------------------------------
// Login with Opper (lazy — only imported when OAuth is configured)
// ---------------------------------------------------------------------------

let oauthClient: any = null;
async function getOAuthClient(redirectUri: string) {
  if (oauthClient) return oauthClient;
  const { OpperLogin } = await import("@opperai/login");
  oauthClient = new OpperLogin({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri,
    opperUrl: OPPER_BASE_URL,
  });
  return oauthClient;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

/** Bootstrap info for the SPA: who's logged in and what auth mode we're in. */
app.get("/api/me", (req, res) => {
  const session = getSession(req);
  res.json({
    authMode: OAUTH_ENABLED ? "oauth" : "env",
    loggedIn: Boolean(session),
    user: session?.user ?? null,
    portalUrl: session?.portalUrl ?? null,
  });
});

/** Kick off the OAuth flow. */
app.get("/login", async (req, res) => {
  if (!OAUTH_ENABLED) return res.redirect("/");
  const state = randomUUID();
  const redirectUri = `${req.protocol}://${req.get("host")}/callback`;
  const url =
    `${OPPER_BASE_URL}/oauth/authorize?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  res.redirect(url);
});

/** OAuth callback — exchange the code for an API key and open a session. */
app.get("/callback", async (req, res) => {
  if (!OAUTH_ENABLED) return res.redirect("/");
  const { code, error } = req.query as Record<string, string>;
  if (error) return res.redirect(`/?login_error=${encodeURIComponent(error)}`);
  if (!code) return res.status(400).send("Missing authorization code");
  try {
    const redirectUri = `${req.protocol}://${req.get("host")}/callback`;
    const client = await getOAuthClient(redirectUri);
    const { apiKey, user } = await client.exchangeCode(code);
    const token = newSession({
      apiKey,
      user: { name: user?.name || user?.email || "Opper user", email: user?.email },
      portalUrl: typeof client.getPortalUrl === "function" ? client.getPortalUrl() : undefined,
    });
    setSessionCookie(res, token);
    res.redirect("/");
  } catch (err: any) {
    res.redirect(`/?login_error=${encodeURIComponent(err?.message || "login failed")}`);
  }
});

/** End the session. */
app.post("/api/logout", (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Opper proxy helpers
// ---------------------------------------------------------------------------

/** Call the Opper REST API with the session's key. Returns the raw Response. */
function opperFetch(session: Session, path: string, init: RequestInit = {}) {
  return fetch(`${OPPER_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
      ...(init.headers || {}),
    },
  });
}

/** Map upstream auth/billing errors to a small, actionable shape for the SPA. */
async function relayError(res: express.Response, upstream: Response) {
  let detail = "";
  try {
    detail = await upstream.text();
  } catch {}
  if (upstream.status === 401) {
    return res.status(401).json({ code: "disconnected", error: "Session is no longer connected to Opper." });
  }
  if (upstream.status === 402) {
    return res.status(402).json({ code: "balance", error: "Opper Wallet balance is empty." });
  }
  let message = detail;
  try {
    message = JSON.parse(detail)?.error?.message || JSON.parse(detail)?.detail || detail;
  } catch {}
  return res.status(upstream.status).json({ code: "upstream", error: message || `Opper error ${upstream.status}` });
}

// Presigned-URL cache. Presigning hits Opper + S3 on every call and rotates the
// signature each time (so browsers can't cache the bytes). Caching the URL per
// file for just under its ~1h lifetime collapses N presign calls into one and
// keeps the redirect target stable, so the browser can cache the image.
const presignCache = new Map<string, { url: string; exp: number }>();
const PRESIGN_TTL_MS = 50 * 60 * 1000;

async function presignedUrl(session: Session, fileId: string): Promise<string | null> {
  const key = `${accountId(session.apiKey)}:${fileId}`;
  const hit = presignCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const upstream = await opperFetch(session, `/v3/files/${encodeURIComponent(fileId)}/content`);
  if (!upstream.ok) return null;
  const { url } = await upstream.json();
  if (url) presignCache.set(key, { url, exp: Date.now() + PRESIGN_TTL_MS });
  return url ?? null;
}

// ---------------------------------------------------------------------------
// Studio API
// ---------------------------------------------------------------------------

/** The curated model catalog the UI renders from. */
app.get("/api/catalog", (_req, res) => res.json({ models: CATALOG }));

/** Upload a reference image — proxy to POST /v3/files, returns a reusable file_id. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.post("/api/files", upload.single("file"), async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });
  if (!req.file) return res.status(400).json({ code: "bad_request", error: "No file uploaded." });

  const fd = new FormData();
  const bytes = new Uint8Array(req.file.buffer);
  fd.append("file", new Blob([bytes], { type: req.file.mimetype }), req.file.originalname);
  fd.append("purpose", "reference_media");

  console.log(`→ upload  ${req.file.originalname}  (${Math.round(req.file.size / 1024)}kb)`);
  try {
    const upstream = await opperFetch(session, "/v3/files", { method: "POST", body: fd });
    if (!upstream.ok) return relayError(res, upstream);
    const data = await upstream.json();
    console.log(`✓ upload  ${data.id}`);
    res.json(data);
  } catch (err: any) {
    console.error(`✗ upload  ${err?.message}`);
    res.status(502).json({ code: "network", error: err?.message || "Upload failed." });
  }
});

/** Generate images — proxy to POST /v3/images. */
app.post("/api/generate", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });

  const b = req.body ?? {};
  if (!b.model || !b.prompt) {
    return res.status(400).json({ code: "bad_request", error: "model and prompt are required." });
  }

  // Forward only the fields /v3/images understands; default to storing so each
  // result comes back with a reusable file_id and a presigned url.
  const body: Record<string, unknown> = {
    model: b.model,
    prompt: b.prompt,
    store: true,
    n: b.n ?? 1,
  };
  if (b.size) body.size = b.size;
  if (b.aspect_ratio) body.aspect_ratio = b.aspect_ratio;
  if (b.quality) body.quality = b.quality;
  if (b.image) body.image = b.image;
  if (b.mask) body.mask = b.mask;
  if (Array.isArray(b.reference_images) && b.reference_images.length) body.reference_images = b.reference_images;
  if (b.parameters && typeof b.parameters === "object") body.parameters = b.parameters;

  const started = Date.now();
  const extra = Array.isArray(body.reference_images)
    ? ` +${body.reference_images.length} ref`
    : body.image
      ? " +edit"
      : "";
  console.log(`→ images  ${body.model}${extra}  "${String(body.prompt).slice(0, 50)}"`);
  try {
    const upstream = await opperFetch(session, "/v3/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) {
      console.warn(`✗ images  ${body.model}  ${upstream.status}  (${Date.now() - started}ms)`);
      return relayError(res, upstream);
    }
    const data = await upstream.json();
    console.log(`✓ images  ${body.model}  ${Date.now() - started}ms  $${data.usage?.cost ?? "?"}`);
    // Record stored results so the gallery can scope to this app.
    const acct = accountId(session.apiKey);
    addCreations(
      (data.data ?? [])
        .filter((d: any) => d.file_id)
        .map((d: any) => ({
          account: acct,
          file_id: d.file_id as string,
          model: String(body.model),
          prompt: String(body.prompt),
          created: Date.now(),
          kind: "image" as const,
        })),
    );
    res.json(data);
  } catch (err: any) {
    console.error(`✗ images  ${body.model}  ${err?.message}`);
    res.status(502).json({ code: "network", error: err?.message || "Failed to reach Opper." });
  }
});

/** Generate speech (TTS) — proxy to POST /v3/audio/speech (synchronous, like images). */
app.post("/api/speech", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });

  const b = req.body ?? {};
  if (!b.model || !b.input) {
    return res.status(400).json({ code: "bad_request", error: "model and input are required." });
  }

  // Forward only the fields /v3/audio/speech understands; store by default so each
  // clip comes back with a reusable file_id and a presigned url.
  const body: Record<string, unknown> = { model: b.model, input: b.input, store: true };
  if (b.voice) body.voice = b.voice;
  if (b.format) body.format = b.format;
  if (typeof b.speed === "number") body.speed = b.speed;
  if (b.parameters && typeof b.parameters === "object") body.parameters = b.parameters;

  const started = Date.now();
  console.log(`→ speech  ${body.model}  "${String(b.input).slice(0, 50)}"`);
  try {
    const upstream = await opperFetch(session, "/v3/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) {
      console.warn(`✗ speech  ${body.model}  ${upstream.status}  (${Date.now() - started}ms)`);
      return relayError(res, upstream);
    }
    const data = await upstream.json();
    console.log(`✓ speech  ${body.model}  ${Date.now() - started}ms  $${data.usage?.cost ?? "?"}`);
    if (data.audio?.file_id) {
      addCreations([
        {
          account: accountId(session.apiKey),
          file_id: data.audio.file_id as string,
          model: String(body.model),
          prompt: String(b.input),
          created: Date.now(),
          kind: "audio" as const,
        },
      ]);
    }
    res.json(data);
  } catch (err: any) {
    console.error(`✗ speech  ${body.model}  ${err?.message}`);
    res.status(502).json({ code: "network", error: err?.message || "Failed to reach Opper." });
  }
});

/**
 * Intent bar — turn a freeform request into a settings patch via a structured
 * /v3/call. This is the one place the studio uses an LLM, and it doubles as a
 * structured-output demo: the model picks a catalog model id and fills in
 * dimension / quality / count from natural language.
 */
const INTENT_MODEL = process.env.INTENT_MODEL || "anthropic/claude-sonnet-4.6";

app.post("/api/intent", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ code: "bad_request", error: "Empty request." });

  // Compact catalog summary so the model only proposes valid ids/values.
  const models = CATALOG.filter((m) => m.modality === "image").map((m) => ({
    id: m.id,
    label: m.label,
    dimension_kind: m.dimension?.kind ?? null,
    dimension_options: m.dimension?.options ?? [],
    qualities: m.qualities ?? [],
    max_images: m.supports.n ?? 1,
  }));

  const output_schema = {
    type: "object",
    properties: {
      prompt: { type: ["string", "null"], description: "A cleaned, vivid image prompt." },
      model: { type: ["string", "null"], description: "One model id from the list, or null to keep current." },
      aspect_ratio: { type: ["string", "null"], description: "e.g. 16:9 — only if the chosen model is aspect-based." },
      size: { type: ["string", "null"], description: "e.g. 1024x1024 — only if the chosen model is size-based." },
      quality: { type: ["string", "null"] },
      n: { type: ["integer", "null"], description: "Number of images, if asked for." },
    },
    required: ["prompt", "model", "aspect_ratio", "size", "quality", "n"],
    additionalProperties: false,
  };

  const body = {
    name: "media-studio-intent",
    instructions:
      "You set up an image generation. Turn the user's request into a clean image prompt and " +
      "choose the best model id from available_models. Set aspect_ratio OR size only with a value " +
      "valid for the chosen model's dimension_options; set quality only from that model's qualities. " +
      "Leave a field null when the user didn't imply it. Keep current_model unless another clearly fits.",
    input: { request: text, current_model: req.body?.model ?? null, available_models: models },
    output_schema,
    model: INTENT_MODEL,
  };

  const started = Date.now();
  console.log(`→ intent  "${text.slice(0, 50)}"`);
  try {
    const upstream = await opperFetch(session, "/v3/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) return relayError(res, upstream);
    console.log(`✓ intent  ${INTENT_MODEL}  ${Date.now() - started}ms`);
    const data = await upstream.json();
    // Structured result lands in `data`; fall back to parsing meta.message.
    let patch = data.data;
    if (!patch && typeof data.meta?.message === "string") {
      try {
        patch = JSON.parse(data.meta.message);
      } catch {}
    }
    res.json(patch ?? {});
  } catch (err: any) {
    res.status(502).json({ code: "network", error: err?.message || "Failed to reach Opper." });
  }
});

// Video is async: submit returns a job id, then the client polls. We remember
// each job's model/prompt so we can record the creation when it completes.
const videoJobs = new Map<string, { account: string; model: string; prompt: string }>();

/** Submit a video generation job — proxy to POST /v3/videos. */
app.post("/api/video", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });
  const b = req.body ?? {};
  if (!b.model || !b.prompt) {
    return res.status(400).json({ code: "bad_request", error: "model and prompt are required." });
  }
  const body: Record<string, unknown> = { model: b.model, prompt: b.prompt, store: true };
  if (b.image) body.image = b.image;
  if (Array.isArray(b.reference_images) && b.reference_images.length) body.reference_images = b.reference_images;
  if (b.parameters && typeof b.parameters === "object") body.parameters = b.parameters;

  console.log(`→ video   ${b.model}  "${String(b.prompt).slice(0, 50)}"`);
  try {
    const upstream = await opperFetch(session, "/v3/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) {
      console.warn(`✗ video   ${b.model}  submit ${upstream.status}`);
      return relayError(res, upstream);
    }
    const data = await upstream.json(); // { id, status_url }
    if (data.id) {
      videoJobs.set(data.id, { account: accountId(session.apiKey), model: String(b.model), prompt: String(b.prompt) });
    }
    res.json({ id: data.id });
  } catch (err: any) {
    console.error(`✗ video   ${b.model}  ${err?.message}`);
    res.status(502).json({ code: "network", error: err?.message || "Failed to reach Opper." });
  }
});

/** Poll a video job — proxy GET /v3/artifacts/{id}/status; record on completion. */
app.get("/api/video/:id", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });
  const id = req.params.id;
  try {
    const upstream = await opperFetch(session, `/v3/artifacts/${encodeURIComponent(id)}/status`);
    if (!upstream.ok) return relayError(res, upstream);
    const data = await upstream.json();
    if (data.status === "completed") {
      const job = videoJobs.get(id);
      if (data.file_id && job) {
        addCreations([
          { account: job.account, file_id: data.file_id, model: job.model, prompt: job.prompt, created: Date.now(), kind: "video" },
        ]);
      }
      videoJobs.delete(id);
      console.log(`✓ video   ${job?.model ?? id}  done`);
    } else if (data.status === "failed") {
      videoJobs.delete(id);
      console.warn(`✗ video   ${id}  ${data.error ?? "failed"}`);
    }
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ code: "network", error: err?.message || "Failed to reach Opper." });
  }
});

/** Your saved creations — images generated in this app (scoped to your account). */
app.get("/api/gallery", (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });
  const acct = accountId(session.apiKey);
  const items = loadCreations()
    .filter((c) => c.account === acct)
    .sort((a, b) => b.created - a.created)
    .slice(0, 60)
    .map((c) => ({ file_id: c.file_id, model: c.model, prompt: c.prompt, created: c.created, kind: c.kind ?? "image" }));
  res.json({ items });
});

/**
 * Return a fresh public S3 link for a file. Unlike `/s/:fileId` (which points
 * at this server, so only works when the app is hosted somewhere reachable),
 * the presigned URL is a public AWS link anyone can open — it just expires in
 * ~1h. That's the right thing to "Share" from a locally-run studio.
 */
app.delete("/api/files/:fileId", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });
  const fileId = req.params.fileId;
  try {
    const upstream = await opperFetch(session, `/v3/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    if (!upstream.ok) return relayError(res, upstream);
    removeCreation(session.apiKey, fileId);
    presignCache.delete(`${accountId(session.apiKey)}:${fileId}`);
    console.log(`✓ delete  ${fileId}`);
    res.json(await upstream.json().catch(() => ({ deleted: true })));
  } catch (err: any) {
    console.error(`✗ delete  ${fileId}  ${err?.message}`);
    res.status(502).json({ code: "network", error: err?.message || "Failed to reach Opper." });
  }
});

app.get("/api/share/:fileId", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });
  try {
    const url = await presignedUrl(session, req.params.fileId);
    if (!url) return res.status(404).json({ error: "File not available." });
    res.json({ url });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || "Failed to reach Opper." });
  }
});

/**
 * Share / thumbnail route. Presigned file URLs only live ~1h, so we mint a
 * fresh one on each request and redirect. A `/s/:fileId` link stays valid
 * indefinitely (as long as the file exists), and <img src="/s/:id"> works as a
 * gallery thumbnail.
 */
app.get("/s/:fileId", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).send("Not logged in.");
  try {
    const url = await presignedUrl(session, req.params.fileId);
    if (!url) return res.status(404).send("File not available.");
    // Never cache the *redirect* — that would pin a thumbnail to one presigned
    // URL that expires in ~1h (→ broken image later). Always re-issue from the
    // server-side presign cache (≤50min), which keeps the target URL stable, so
    // the browser still caches the actual image *bytes* by that URL.
    res.set("Cache-Control", "no-store");
    res.redirect(url);
  } catch {
    res.status(502).send("Failed to reach Opper.");
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const PORT = await findPort(PREFERRED_PORT);
app.listen(PORT, () => {
  console.log(`\n  Media Studio`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  API:  ${OPPER_BASE_URL}`);
  console.log(`  Auth: ${OAUTH_ENABLED ? "Login with Opper (OAuth)" : LOCAL_SOURCE}\n`);
});
