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

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const PORT = await findPort(PREFERRED_PORT);
app.listen(PORT, () => {
  console.log(`\n  Media Studio`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Auth: ${OAUTH_ENABLED ? "Login with Opper (OAuth)" : "OPPER_API_KEY (env)"}\n`);
});
