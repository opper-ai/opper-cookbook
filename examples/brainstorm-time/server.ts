/**
 * Brainstorm Time — browser-direct realtime via ephemeral tickets.
 *
 * Flow:
 *   Browser ↔ Opper (direct WS)
 *   Browser ↔ Node REST (tickets + tools)
 *
 * Why:
 *   - Browsers cannot set an Authorization header on `new WebSocket(...)`.
 *   - With ephemeral tickets, the customer's backend authenticates with the
 *     real OPPER_API_KEY at POST /v3/realtime-sessions, returns a single-use
 *     `client_secret`, and the browser opens `wss://api.opper.ai/v3/realtime`
 *     directly, carrying the ticket in the `Sec-WebSocket-Protocol:
 *     opper-ticket.<secret>` subprotocol header.
 *   - Tool execution (web search, image generation) still needs server-side
 *     credentials, so the browser POSTs tool requests back here. Those are
 *     plain REST calls — no WebSocket proxy required.
 *
 * This server is intentionally small: a mint endpoint and a tool-runner
 * endpoint. Everything else lives in the browser.
 *
 * Alternative not shown here: a Node WS proxy that sits between the
 * browser and Opper, forwarding frames bidirectionally. That trades a
 * larger backend for full server-side observability of every frame.
 * The README has a short note about it.
 */

import express from "express";
import { Opper } from "opperai";
import { createServer as createNetServer } from "net";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PREFERRED_PORT = parseInt(process.env.PORT || "3000");
const OPPER_API_KEY = process.env.OPPER_API_KEY;
const OPPER_BASE_URL = process.env.OPPER_BASE_URL || "https://api.opper.ai";
const PUBLIC_WS_BASE =
  process.env.OPPER_WS_BASE ||
  OPPER_BASE_URL.replace(/^http/, "ws").replace(/\/$/, "");

// Allowlist of models the browser is permitted to request. The browser
// POSTs its choice; this server validates against the list before
// passing into the mint config. Anything off-list returns 400. This is
// the policy boundary — adding a new model is one line here. The
// values are pre-bound onto the ticket, so the browser cannot pivot to
// a different model after the ticket is minted.
type ModelEntry = {
  id: string;
  label: string;
  voices: string[];
  defaultVoice: string;
  reasoningEfforts: string[];
};
const MODELS: ModelEntry[] = [
  {
    id: "openai/gpt-realtime-2",
    label: "OpenAI GPT Realtime 2",
    voices: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"],
    defaultVoice: "marin",
    reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
  },
  {
    id: "xai/grok-voice-latest",
    label: "xAI Grok Voice",
    voices: ["ara", "eve", "leo", "rex", "sal"],
    defaultVoice: "ara",
    reasoningEfforts: [],
  },
  {
    id: "gemini/gemini-3.1-flash-live-preview",
    label: "Gemini 3.1 Flash Live",
    voices: ["Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"],
    defaultVoice: "Aoede",
    reasoningEfforts: [],
  },
];
const DEFAULT_MODEL_ID = MODELS[0].id;
const DEFAULT_REASONING_EFFORT = "low";

if (!OPPER_API_KEY) {
  console.error("  OPPER_API_KEY is required");
  process.exit(1);
}

const opper = new Opper();

// ---------------------------------------------------------------------------
// Tool definitions — identical to the proxy variant. The browser sees the
// tool.call event from the realtime agent and POSTs back to /api/tools/:name
// for execution.
// ---------------------------------------------------------------------------

const realtimeTools = [
  {
    name: "generate_image",
    description:
      "Generate an image from a text description. Use when the user asks to visualize, sketch, or picture something during the brainstorm.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed description of the image to generate. Be vivid and specific.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web for current information, inspiration, or to validate an idea. Use when the brainstorm needs real-world data or references.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query.",
        },
      },
      required: ["query"],
    },
  },
  // ---- Client-side board tools. Executed in the browser; the server-side
  // /api/tools/:name handler refuses these so we'd notice if dispatch ever
  // accidentally routed through the server.
  {
    name: "add_idea",
    description:
      "Pin an idea to the shared brainstorm board so it stays visible. Use this proactively whenever a noteworthy idea comes up — yours or the user's. Group related ideas under the same 'column' theme (e.g. 'Concept', 'Concern', 'Action', 'Wild'). Nest a sub-idea under another by passing parent_id.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Short label for the idea (a few words to one sentence)." },
        column: { type: "string", description: "Theme / column the idea belongs to. Reuse existing columns when ideas share a theme." },
        parent_id: { type: "string", description: "Optional. Id of an existing idea to nest this one under." },
      },
      required: ["text"],
    },
  },
  {
    name: "remove_idea",
    description: "Remove an idea from the board by id.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Id of the idea to remove." } },
      required: ["id"],
    },
  },
  {
    name: "clear_board",
    description: "Wipe the entire brainstorm board. Use sparingly — only when starting a fresh topic.",
    parameters: { type: "object", properties: {} },
  },
];

// Tool names handled entirely in the browser. The /api/tools/:name handler
// refuses these so a routing mistake is loud.
const CLIENT_TOOL_NAMES = new Set(["add_idea", "remove_idea", "clear_board"]);

// ---------------------------------------------------------------------------
// System instructions — locked at mint time so the browser can't override.
// ---------------------------------------------------------------------------

const BRAINSTORM_INSTRUCTIONS = `You are BrainstormBot — an enthusiastic, slightly chaotic, and wildly creative brainstorming partner.

Your personality:
- High energy, encouraging, and never dismissive of ideas
- You riff on ideas, suggest unexpected angles, and connect dots nobody else would
- You play devil's advocate when it's useful, but always constructively
- You use vivid metaphors and colorful language
- You keep things moving — punchy responses, not essays

Your tools:
- Use **web_search** to find real-world inspiration, validate concepts, check if something already exists, or find relevant trends
- Use **generate_image** to visualize ideas, create concept sketches, mood boards, or visual metaphors
- Use **add_idea** *liberally* to pin noteworthy ideas onto the shared brainstorm board as they come up — yours or the user's. Group related ideas under the same column theme (e.g. "Concept", "Concern", "Action", "Wild"). Nest a sub-idea under another with parent_id when one elaborates on another.
- Use **remove_idea** if an idea is superseded or wrong. Use **clear_board** only when explicitly starting fresh.

Rules:
- Keep responses conversational and concise — this is a brainstorm, not a lecture
- Build on what the user says — "yes, and..." energy
- If the conversation stalls, throw out a wild tangent or provocative question
- When generating images, craft detailed creative prompts
- Only search the web when it genuinely adds value to the brainstorm
- Capture ideas on the board as you talk — don't make the user ask you to write them down. A good rule of thumb: if you'd want to remember this idea in 5 minutes, add it.`;

// ---------------------------------------------------------------------------
// Server-side tool execution. The browser never gets an Opper API key.
// ---------------------------------------------------------------------------

const mediaDir = join(__dirname, "public", "media");
if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{
  result: string;
  media?: { type: "image"; url: string };
}> {
  const ts = Date.now();

  if (name === "generate_image") {
    console.log(`  Generating image: "${args.prompt}"`);
    const image = await opper.generateImage({
      prompt: args.prompt as string,
      model: "openai/gpt-image-1",
    });
    const filename = `image-${ts}.png`;
    image.save(join(mediaDir, filename));
    return {
      result: `Image generated successfully for: "${args.prompt}"`,
      media: { type: "image", url: `/media/${filename}` },
    };
  }

  if (name === "web_search") {
    console.log(`  Searching web: "${args.query}"`);
    const results = await opper.beta.web.search({
      query: args.query as string,
    });
    const formatted = results.results
      .slice(0, 5)
      .map(
        (r: { title: string; url: string; snippet: string }) =>
          `• ${r.title}\n  ${r.url}\n  ${r.snippet}`,
      )
      .join("\n\n");
    return { result: formatted || "No results found." };
  }

  return { result: `Unknown tool: ${name}` };
}

// ---------------------------------------------------------------------------
// Ticket mint endpoint. Browser hits this to get a single-use `client_secret`
// it then redeems on the realtime WebSocket.
//
// The CRITICAL part is `config`: every field we populate here is bound to
// the ticket — the browser cannot override it on session.start. So a leaked
// ticket can only open the specific session we authorized, never pivot to
// a different model or system prompt.
// ---------------------------------------------------------------------------

async function mintRealtimeTicket(opts: {
  topic?: string;
  topicContext?: string;
  model: ModelEntry;
  voice: string;
  reasoningEffort: string;
}): Promise<{ clientSecret: string; expiresAt: string; wsBaseUrl: string }> {
  const instructions = opts.topic
    ? BRAINSTORM_INSTRUCTIONS +
      `\n\n--- BRAINSTORM TOPIC ---\n` +
      `The user wants to brainstorm about: "${opts.topic}"\n` +
      (opts.topicContext
        ? `\nHere's some web research on the topic to ground the discussion:\n${opts.topicContext}\n`
        : "") +
      `\nWhen the user speaks, dive straight into brainstorming this topic. Reference the research if relevant. Keep your first response short and punchy — ask them a provocative question to get the ideas flowing.`
    : BRAINSTORM_INSTRUCTIONS;

  const config: Record<string, unknown> = {
    model: opts.model.id,
    instructions,
    turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 500 },
    tools: realtimeTools,
    input_transcription: true,
    output_transcription: true,
  };
  if (opts.voice) config.voice = opts.voice;
  // reasoning_effort is only meaningful on models that advertise support.
  // Sending it to a model that doesn't accept it gets rejected upstream.
  if (opts.reasoningEffort && opts.model.reasoningEfforts.length > 0) {
    config.reasoning_effort = opts.reasoningEffort;
  }

  const body = { config, ttl_seconds: 60 };

  const resp = await fetch(`${OPPER_BASE_URL}/v3/realtime-sessions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPPER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
  // The browser will open this URL with the ticket carried in the
  // `Sec-WebSocket-Protocol: opper-ticket.<value>` subprotocol header,
  // not as a query parameter — subprotocol stays out of URL access logs
  // and browser history. Strip any ?ticket= the server may have
  // returned on ws_url so we always hand the browser a clean origin.
  let wsBaseUrl = data.ws_url || `${PUBLIC_WS_BASE}/v3/realtime`;
  wsBaseUrl = wsBaseUrl.replace(/[?&]ticket=[^&]*/g, "").replace(/[?&]$/, "");
  return {
    clientSecret: data.client_secret,
    expiresAt: data.expires_at,
    wsBaseUrl,
  };
}

// ---------------------------------------------------------------------------
// Find available port
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
// Express routes
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

// Expose the curated model allowlist to the browser so the landing page
// can render dropdowns. The browser cannot add to this list — anything
// it posts back gets validated against MODELS on the mint endpoint.
app.get("/api/config", (_req, res) => {
  res.json({
    models: MODELS,
    defaultModel: DEFAULT_MODEL_ID,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
  });
});

// Mint endpoint. Browser POSTs its preferences (topic, model, voice,
// reasoning_effort); this server validates each against the allowlist
// and only then mints a ticket. Off-list values return 400. This is the
// security boundary in pattern 1: customer browsers cannot expand the
// set of models the project will pay for, but they CAN choose from the
// menu the issuer authorized.
app.post("/api/realtime/session", async (req, res) => {
  try {
    const topic = (req.body?.topic as string | undefined)?.trim();
    const requestedModel = (req.body?.model as string | undefined) || DEFAULT_MODEL_ID;
    const requestedVoice = (req.body?.voice as string | undefined) || "";
    const requestedReasoning = (req.body?.reasoning_effort as string | undefined) || DEFAULT_REASONING_EFFORT;

    // Validate model — reject anything off-list.
    const model = MODELS.find((m) => m.id === requestedModel);
    if (!model) {
      return res.status(400).json({
        error: `model "${requestedModel}" not in allowlist`,
        allowed: MODELS.map((m) => m.id),
      });
    }

    // Validate voice — if a voice is supplied, it must belong to the
    // chosen model. Empty falls back to the model's default voice.
    const voice = requestedVoice || model.defaultVoice;
    if (requestedVoice && !model.voices.includes(requestedVoice)) {
      return res.status(400).json({
        error: `voice "${requestedVoice}" not supported by ${model.id}`,
        allowed: model.voices,
      });
    }

    // Validate reasoning_effort — empty allowlist means the model
    // ignores this field anyway, so we just drop the requested value.
    let reasoningEffort = "";
    if (model.reasoningEfforts.length > 0) {
      reasoningEffort = model.reasoningEfforts.includes(requestedReasoning)
        ? requestedReasoning
        : DEFAULT_REASONING_EFFORT;
    }

    let topicContext = "";
    if (topic) {
      console.log(`  Researching topic: "${topic}"`);
      try {
        const results = await opper.beta.web.search({ query: topic });
        const top = results.results.slice(0, 5);
        if (top.length > 0) {
          topicContext = top
            .map(
              (r: { title: string; snippet: string }) =>
                `- ${r.title}: ${r.snippet}`,
            )
            .join("\n");
        }
      } catch (err) {
        console.warn("  Topic search failed (continuing without context):", err);
      }
    }

    const ticket = await mintRealtimeTicket({
      topic,
      topicContext,
      model,
      voice,
      reasoningEffort,
    });
    console.log(
      `  Minted ticket: model=${model.id}, voice=${voice}, reasoning=${reasoningEffort || "—"}, expires ${ticket.expiresAt}`,
    );
    res.json(ticket);
  } catch (err) {
    console.error("  Mint failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Tool runner. Browser receives tool.call from the realtime agent on the WS,
// POSTs the call here, we run it with the real API key, return the result.
app.post("/api/tools/:name", async (req, res) => {
  if (CLIENT_TOOL_NAMES.has(req.params.name)) {
    res.status(400).json({
      error: `${req.params.name} is a client-side tool — handle it in the browser, don't POST it to the server`,
    });
    return;
  }
  try {
    const result = await executeTool(req.params.name, req.body);
    res.json(result);
  } catch (err) {
    console.error(`  Tool error (${req.params.name}):`, err);
    res.status(500).json({ result: `Tool error: ${err}` });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n  ⚡ Brainstorm Time\n");

  const port = await findPort(PREFERRED_PORT);
  app.listen(port, () => {
    console.log(`  Ready at http://localhost:${port}`);
    console.log(`  Mint endpoint: POST /api/realtime/session`);
    console.log(`  Realtime WS:   ${PUBLIC_WS_BASE}/v3/realtime  (browser-direct)\n`);
  });
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
