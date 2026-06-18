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
import { randomUUID, randomBytes } from "crypto";
import { createServer } from "net";
import multer from "multer";
import { CATALOG } from "./catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PREFERRED_PORT = parseInt(process.env.PORT || "3000");
const OPPER_BASE_URL = (process.env.OPPER_BASE_URL || "https://api.opper.ai").replace(/\/$/, "");
const ENV_API_KEY = process.env.OPPER_API_KEY?.trim() || "";

const CLIENT_ID = process.env.CLIENT_ID?.trim() || "";
const CLIENT_SECRET = process.env.CLIENT_SECRET?.trim() || "";
const OAUTH_ENABLED = Boolean(CLIENT_ID && CLIENT_SECRET);

if (!ENV_API_KEY && !OAUTH_ENABLED) {
  console.error(
    "\nMissing config. Set OPPER_API_KEY for quick start, or CLIENT_ID + CLIENT_SECRET\n" +
      "for Login with Opper. Copy .env.example to .env and fill it in.\n",
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
  if (!OAUTH_ENABLED && ENV_API_KEY) {
    return { apiKey: ENV_API_KEY, user: { name: "Local (env key)" } };
  }
  return undefined;
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

  try {
    const upstream = await opperFetch(session, "/v3/files", { method: "POST", body: fd });
    if (!upstream.ok) return relayError(res, upstream);
    res.json(await upstream.json());
  } catch (err: any) {
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

  try {
    const upstream = await opperFetch(session, "/v3/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) return relayError(res, upstream);
    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
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
  const models = CATALOG.map((m) => ({
    id: m.id,
    label: m.label,
    dimension_kind: m.dimension.kind,
    dimension_options: m.dimension.options,
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

  try {
    const upstream = await opperFetch(session, "/v3/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) return relayError(res, upstream);
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

/** Your saved creations — list generated images from /v3/files. */
app.get("/api/gallery", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ code: "disconnected", error: "Not logged in." });
  const limit = Math.min(parseInt(String(req.query.limit ?? "40")) || 40, 100);
  try {
    const upstream = await opperFetch(session, `/v3/files?limit=${limit}&offset=0`);
    if (!upstream.ok) return relayError(res, upstream);
    const list = await upstream.json();
    const items = (list.data ?? [])
      .filter((f: any) => f.purpose === "generated_image" || String(f.mime_type).startsWith("image/"))
      .map((f: any) => ({ id: f.id, mime_type: f.mime_type, bytes: f.bytes, created_at: f.created_at }));
    res.json({ items });
  } catch (err: any) {
    res.status(502).json({ code: "network", error: err?.message || "Failed to reach Opper." });
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
    const upstream = await opperFetch(session, `/v3/files/${encodeURIComponent(req.params.fileId)}/content`);
    if (!upstream.ok) return res.status(upstream.status).send("File not available.");
    const { url } = await upstream.json();
    if (!url) return res.status(404).send("No content URL.");
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
  console.log(`  Auth: ${OAUTH_ENABLED ? "Login with Opper (OAuth)" : "OPPER_API_KEY (env)"}\n`);
});
