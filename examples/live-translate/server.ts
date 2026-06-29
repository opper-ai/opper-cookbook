/**
 * Live Translate — browser-direct real-time speech-to-speech translation.
 *
 * Flow:
 *   Browser ↔ Opper (direct WS, carries the live audio)
 *   Browser ↔ Node REST (mints the ticket only)
 *
 * Why a ticket:
 *   - Browsers cannot set an Authorization header on `new WebSocket(...)`.
 *   - The Node server authenticates with the real OPPER_API_KEY at
 *     POST /v3/realtime-sessions, binds the model + target language onto a
 *     single-use `client_secret`, and the browser opens
 *     `wss://api.opper.ai/v3/realtime` directly with the ticket in the
 *     `Sec-WebSocket-Protocol: opper-ticket.<secret>` subprotocol header.
 *   - The API key never reaches the browser.
 *
 * Unlike a chat agent, the translation model has no tools and no system
 * prompt — it just listens in any language and speaks the bound target
 * language. So this server is tiny: one mint endpoint, nothing on the WS
 * path.
 *
 * Model: gemini/gemini-3.5-live-translate-preview. Source language is
 * auto-detected across 70+ languages; only the TARGET is configured, and
 * we bind it onto the ticket so a leaked ticket can't repurpose the
 * session into a different language.
 */

import express from "express";
import { createServer as createNetServer } from "net";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PREFERRED_PORT = parseInt(process.env.PORT || "3000");
const OPPER_API_KEY = process.env.OPPER_API_KEY;
// Default to production. The Live Translate model must be available on the
// target deployment — point OPPER_BASE_URL at a local stack running the
// branch that adds gemini-3.5-live-translate-preview if it isn't in prod yet.
const OPPER_BASE_URL = process.env.OPPER_BASE_URL || "https://api.opper.ai";
const PUBLIC_WS_BASE =
  process.env.OPPER_WS_BASE ||
  OPPER_BASE_URL.replace(/^http/, "ws").replace(/\/$/, "");

// The translation models the browser may pick. Like the language menu, this
// is the policy boundary — the browser POSTs a choice, the server validates
// it against this allowlist and binds it onto the ticket via locked_fields.
// Both are speech-to-speech translation models that auto-detect the source
// language; they differ on the wire (different providers) but the gateway
// normalizes that, and the client reads each model's audio sample rate from
// session.started, so no per-model client logic is needed.
type Model = {
  id: string;
  label: string;
  // Source-language captions. Free on Gemini (folds into the audio-token
  // meter). On OpenAI realtime-translate, source transcripts need a separate
  // gpt-realtime-whisper sub-mode (extra per-minute cost) and the gateway
  // adapter doesn't surface source-transcript deltas yet, so we leave it off
  // there — translated (target) captions still work via output_transcription.
  inputTranscription: boolean;
};
const MODELS: Model[] = [
  {
    id: "gemini/gemini-3.5-live-translate-preview",
    label: "Gemini 3.5 Live Translate",
    inputTranscription: true,
  },
  {
    id: "openai/gpt-realtime-translate",
    label: "OpenAI GPT Realtime Translate",
    inputTranscription: false,
  },
];
const DEFAULT_MODEL = MODELS[0].id;

// The languages the browser may pick as a translation target. The browser
// POSTs its choice; this server validates against the list before binding
// it onto the ticket. BCP-47 codes the Live Translate model accepts.
// This is the policy boundary — the browser cannot translate into a
// language not on this menu. (The model supports 70+; this is a curated
// subset for the demo dropdown.)
type Language = { code: string; label: string };
const TARGET_LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "nl", label: "Dutch" },
  { code: "sv", label: "Swedish" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh-Hans", label: "Chinese (Simplified)" },
];
const DEFAULT_TARGET = "es";

if (!OPPER_API_KEY) {
  console.error("  OPPER_API_KEY is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Ticket mint. The CRITICAL part is `config`: every field we set is bound
// to the ticket, so the browser cannot override it on session.start. A
// leaked ticket can only run the exact translation session we authorized —
// it cannot switch models or change the target language.
// ---------------------------------------------------------------------------

async function mintTranslateTicket(targetLanguage: string, model: Model): Promise<{
  clientSecret: string;
  expiresAt: string;
  wsBaseUrl: string;
}> {
  const config: Record<string, unknown> = {
    model: model.id,
    translation_target_language: targetLanguage,
    // Translated (target-language) captions — what the model speaks. Drives
    // the on-screen subtitles; supported on every translation model.
    output_transcription: true,
  };
  // Source-language captions only when the model supports them cheaply
  // (see Model.inputTranscription).
  if (model.inputTranscription) config.input_transcription = true;

  const resp = await fetch(`${OPPER_BASE_URL}/v3/realtime-sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPPER_API_KEY}`,
      "Content-Type": "application/json",
    },
    // Lock the model and the target language so the browser can't change
    // them. translation_target_language is force-applied via locked_fields
    // so even an empty/edited browser value can't unset it.
    body: JSON.stringify({
      config,
      locked_fields: ["model", "translation_target_language"],
      ttl_seconds: 60,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`mint failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    client_secret: string;
    expires_at: string;
    ws_url?: string;
  };
  // Hand the browser a clean WS origin; it carries the ticket in the
  // subprotocol header, not the URL, so the secret stays out of access
  // logs and browser history.
  let wsBaseUrl = data.ws_url || `${PUBLIC_WS_BASE}/v3/realtime`;
  wsBaseUrl = wsBaseUrl.replace(/[?&]ticket=[^&]*/g, "").replace(/[?&]$/, "");
  return {
    clientSecret: data.client_secret,
    expiresAt: data.expires_at,
    wsBaseUrl,
  };
}

// ---------------------------------------------------------------------------
// Find an available port
// ---------------------------------------------------------------------------

async function findPort(start: number, end = start + 20): Promise<number> {
  for (let port = start; port <= end; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = createNetServer();
      s.once("error", () => resolve(false));
      s.listen(port, () => s.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  return start;
}

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(join(__dirname, "public")));

// Expose the curated language menu so the landing page can render the
// dropdown. The browser cannot add to this list — anything it posts back
// is validated against TARGET_LANGUAGES before the ticket is minted.
app.get("/api/config", (_req, res) => {
  res.json({
    languages: TARGET_LANGUAGES,
    defaultTarget: DEFAULT_TARGET,
    models: MODELS.map((m) => ({ id: m.id, label: m.label })),
    defaultModel: DEFAULT_MODEL,
  });
});

// Mint endpoint. Browser POSTs its chosen target language; we validate
// against the allowlist and only then mint a ticket bound to that target.
app.post("/api/realtime/session", async (req, res) => {
  try {
    const requested = (req.body?.target as string | undefined) || DEFAULT_TARGET;
    const lang = TARGET_LANGUAGES.find((l) => l.code === requested);
    if (!lang) {
      return res.status(400).json({
        error: `target "${requested}" not in allowlist`,
        allowed: TARGET_LANGUAGES.map((l) => l.code),
      });
    }

    const requestedModel = (req.body?.model as string | undefined) || DEFAULT_MODEL;
    const model = MODELS.find((m) => m.id === requestedModel);
    if (!model) {
      return res.status(400).json({
        error: `model "${requestedModel}" not in allowlist`,
        allowed: MODELS.map((m) => m.id),
      });
    }

    const ticket = await mintTranslateTicket(lang.code, model);
    console.log(`  Minted translate ticket: model=${model.id}, target=${lang.code} (${lang.label}), expires ${ticket.expiresAt}`);
    res.json({ ...ticket, target: lang.code, targetLabel: lang.label, model: model.id });
  } catch (err) {
    console.error("  Mint failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n  🗣️  Live Translate\n");
  const port = await findPort(PREFERRED_PORT);
  app.listen(port, () => {
    console.log(`  Ready at http://localhost:${port}`);
    console.log(`  Models:      ${MODELS.map((m) => m.id).join(", ")}`);
    console.log(`  Mint:        POST /api/realtime/session`);
    console.log(`  Realtime WS: ${PUBLIC_WS_BASE}/v3/realtime  (browser-direct)\n`);
  });
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
