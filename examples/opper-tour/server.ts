/**
 * Opper Tour — server.
 *
 * The architecture is identical to brainstorm-time: the browser opens the
 * realtime WebSocket *directly* against Opper using an ephemeral ticket
 * minted here, and POSTs back to this server for tool execution. This
 * server never sits on the realtime WS, so it never sees audio or
 * transcripts — only the tool calls the agent issues.
 *
 * What's new versus brainstorm-time:
 *
 *   1. Server-side Playwright. Each realtime session gets its own
 *      BrowserContext (see browser-pool.ts), so concurrent users don't
 *      step on each other's pages.
 *
 *   2. Every tool returns a screenshot. The browser renders it into a
 *      viewport pane next to the voice chat. The user *watches* the
 *      tour; they don't drive it.
 *
 *   3. A URL allowlist (tour-knowledge.ts). The agent cannot navigate
 *      to arbitrary URLs — only the curated Opper pages we've described
 *      in the system prompt. That's the security boundary.
 */

import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { createServer as createNetServer } from "net";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { Page } from "playwright";
import { isAllowedUrl, TOUR_INSTRUCTIONS } from "./tour-knowledge.js";
import * as browserPool from "./browser-pool.js";

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

// Model menu. brainstorm-time has the full multi-provider pattern with
// voices + reasoning_effort selectors; opper-tour keeps it simpler — one
// model picker on the landing page, the model's default voice. To add a
// model: append here and update SUPPORTED_MODELS — no other code changes.
//
// Note on image input: the `screenshot` tool fires an `image.input` event
// from the browser to the realtime WS. Opper normalizes this across
// providers — same event name + JSON shape for OpenAI and Gemini Live —
// and translates to each provider's native wire format underneath. The
// only Gemini-specific constraint is that `image_url` must be a `data:`
// URI rather than an `https://` URL, which we already satisfy (the tool
// produces base64 JPEGs). `supportsImage` marks vision-capable models.
type ModelEntry = {
  id: string;
  label: string;
  defaultVoice: string;
  supportsReasoningEffort: boolean;
  supportsImage: boolean;
};
const MODELS: ModelEntry[] = [
  {
    id: "openai/gpt-realtime-2",
    label: "OpenAI GPT Realtime 2",
    defaultVoice: "marin",
    supportsReasoningEffort: true,
    supportsImage: true,
  },
  {
    id: "gemini/gemini-3.1-flash-live-preview",
    label: "Gemini 3.1 Flash Live",
    defaultVoice: "Aoede",
    supportsReasoningEffort: false,
    supportsImage: true,
  },
];
const DEFAULT_MODEL_ID = MODELS[0].id;
const DEFAULT_REASONING_EFFORT = "low";

if (!OPPER_API_KEY) {
  console.error("  OPPER_API_KEY is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// URL allowlist lives in tour-knowledge.ts (domain-based: opper.ai,
// docs.opper.ai, github.com/opper-ai). Anything off-domain returns a
// "not allowed" tool result before Playwright is touched.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tool schemas — what the realtime agent sees. These are bound onto the
// ticket at mint time, so the browser cannot ask for more tools than
// what we authorize.
// ---------------------------------------------------------------------------

const realtimeTools = [
  {
    name: "navigate",
    description:
      "Navigate to any page under opper.ai, docs.opper.ai, or github.com/opper-ai. Off-domain URLs are rejected. Returns a fresh screenshot of the page.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL to navigate to." },
      },
      required: ["url"],
    },
  },
  {
    name: "click",
    description:
      "Click the first element matching the given visible text. Use sparingly — usually navigate() is enough for a tour. If the text isn't on the page, the tool returns a 'not found' message; don't keep retrying.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Visible text of the element to click.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "scroll",
    description: "Scroll the current page up or down.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        amount: {
          type: "string",
          enum: ["page", "half"],
          description: "How far to scroll. Default 'page'.",
        },
      },
      required: ["direction"],
    },
  },
  {
    name: "highlight",
    description:
      "Draw a temporary highlight ring around an element matching the given text. Use to focus the user's attention while you narrate. Returns a screenshot with the highlight visible.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Visible text of the element to highlight.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "read_text",
    description:
      "Return the visible text of the current page (truncated to ~4000 chars). Use when you need to ground your narration in what the page actually says, especially on pages you don't know well. Cheap and exact — prefer this over guessing.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "screenshot",
    description:
      "Send a fresh screenshot of the current page directly to YOU (the model) as image input. Use when you need to see layout, buttons, or images — not just the text. After calling, describe what you see to the user.",
    parameters: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function screenshotJpeg(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: "jpeg", quality: 70 });
  return buf.toString("base64");
}

/**
 * Best-effort cookie-banner dismiss. Most banners persist their choice via
 * localStorage/cookies, so once we click on first navigation the BrowserContext
 * stays clean for the rest of the session. Fail-silent: if no banner is found
 * within a short timeout, the tour keeps going.
 *
 * Candidates are ordered: opper.ai's own banner first, then the common
 * third-party libraries, then a generic role/text fallback.
 */
async function dismissCookieBanner(page: Page): Promise<void> {
  const candidates: Array<() => Promise<boolean>> = [
    // opper.ai uses literally "Yes, Accept" / "No, Reject"
    async () => {
      const btn = page.getByRole("button", { name: /^yes,?\s*accept$/i }).first();
      if (await btn.isVisible({ timeout: 400 })) {
        await btn.click({ timeout: 1000 });
        return true;
      }
      return false;
    },
    // OneTrust
    async () => {
      const btn = page.locator("#onetrust-accept-btn-handler");
      if (await btn.isVisible({ timeout: 200 })) {
        await btn.click({ timeout: 1000 });
        return true;
      }
      return false;
    },
    // Cookiebot
    async () => {
      const btn = page.locator("#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll");
      if (await btn.isVisible({ timeout: 200 })) {
        await btn.click({ timeout: 1000 });
        return true;
      }
      return false;
    },
    // CookieYes
    async () => {
      const btn = page.locator(".cky-btn-accept");
      if (await btn.isVisible({ timeout: 200 })) {
        await btn.click({ timeout: 1000 });
        return true;
      }
      return false;
    },
    // Generic accept-button fallback
    async () => {
      const btn = page.getByRole("button", { name: /^(accept|allow|agree)(\s+all)?$/i }).first();
      if (await btn.isVisible({ timeout: 200 })) {
        await btn.click({ timeout: 1000 });
        return true;
      }
      return false;
    },
  ];
  for (const c of candidates) {
    try {
      if (await c()) return;
    } catch {
      // try the next one
    }
  }
}

type ToolResult = {
  result: string;
  screenshot?: string;
  // When true, the browser will also forward the screenshot as an
  // `image.input` event to the realtime WS so the model sees it.
  // See PR https://github.com/opper-ai/opper/pull/2509 for the wire
  // shape; this field is the trigger on the browser side.
  sendImage?: boolean;
};

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  sessionId: string,
): Promise<ToolResult> {
  const page = await browserPool.getPage(sessionId);

  if (name === "navigate") {
    const url = String(args.url || "");
    if (!isAllowedUrl(url)) {
      // Return a screenshot anyway so the viewport pane doesn't go blank —
      // whatever was last loaded stays visible while the agent explains.
      const screenshot = await safeScreenshot(page);
      return {
        result: `Cannot navigate to "${url}". That URL isn't on the tour's allowlist. Tell the user which page you can't show them and offer the closest match from the site map.`,
        screenshot,
      };
    }
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (err: unknown) {
      const screenshot = await safeScreenshot(page);
      return {
        result: `Navigation to ${url} failed: ${(err as Error).message}`,
        screenshot,
      };
    }
    await dismissCookieBanner(page);
    return { result: `Navigated to ${url}.`, screenshot: await screenshotJpeg(page) };
  }

  if (name === "click") {
    const text = String(args.text || "");
    try {
      await page.getByText(text, { exact: false }).first().click({ timeout: 5000 });
      // Let any post-click navigation settle before the screenshot.
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    } catch (err: unknown) {
      return {
        result: `Couldn't click "${text}" — element not found or not clickable. Try a different label or navigate to a known URL instead.`,
        screenshot: await safeScreenshot(page),
      };
    }
    return { result: `Clicked "${text}".`, screenshot: await screenshotJpeg(page) };
  }

  if (name === "scroll") {
    const direction = String(args.direction || "down");
    const amount = String(args.amount || "page");
    const dir = direction === "up" ? -1 : 1;
    const factor = amount === "half" ? 0.5 : 1;
    const vp = page.viewportSize();
    const h = vp?.height ?? 800;
    await page.mouse.wheel(0, dir * h * factor);
    // Give scroll-triggered content a moment to settle.
    await page.waitForTimeout(150);
    return {
      result: `Scrolled ${direction} by ${amount === "half" ? "half a viewport" : "one viewport"}.`,
      screenshot: await screenshotJpeg(page),
    };
  }

  if (name === "highlight") {
    const text = String(args.text || "");
    try {
      const locator = page.getByText(text, { exact: false }).first();
      const handle = await locator.elementHandle({ timeout: 5000 });
      if (!handle) {
        return {
          result: `Couldn't highlight "${text}" — element not found.`,
          screenshot: await safeScreenshot(page),
        };
      }
      // Apply outline + glow + scroll into view. Stash the prior inline
      // values so we can revert exactly when we're done.
      await handle.evaluate((el: Element) => {
        const e = el as HTMLElement;
        (e as unknown as { __tourPrev?: string }).__tourPrev =
          (e.style.outline || "") + "|" + (e.style.boxShadow || "");
        e.style.outline = "3px solid #f59e0b";
        e.style.boxShadow = "0 0 0 6px rgba(245, 158, 11, 0.30)";
        e.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
      });
      await page.waitForTimeout(200);
      const screenshot = await screenshotJpeg(page);
      await handle.evaluate((el: Element) => {
        const e = el as HTMLElement;
        const prev = (e as unknown as { __tourPrev?: string }).__tourPrev || "|";
        const [prevOutline, prevShadow] = prev.split("|");
        e.style.outline = prevOutline;
        e.style.boxShadow = prevShadow;
        delete (e as unknown as { __tourPrev?: string }).__tourPrev;
      });
      await handle.dispose();
      return { result: `Highlighted "${text}".`, screenshot };
    } catch (err: unknown) {
      return {
        result: `Highlight failed: ${(err as Error).message}`,
        screenshot: await safeScreenshot(page),
      };
    }
  }

  if (name === "read_text") {
    // innerText respects CSS visibility and gives roughly what a human sees,
    // unlike textContent which returns hidden + script content too. Limit
    // to ~4000 chars so we don't blow the realtime context on a long page.
    const MAX_CHARS = 4000;
    try {
      const text = await page.evaluate(() => {
        const main = document.querySelector("main, article, [role='main']");
        return (main instanceof HTMLElement ? main.innerText : document.body.innerText) || "";
      });
      const url = page.url();
      const trimmed = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n…[truncated]" : text;
      return {
        result: `Text content of ${url}:\n\n${trimmed}`,
        screenshot: await safeScreenshot(page),
      };
    } catch (err: unknown) {
      return {
        result: `Couldn't read text from this page: ${(err as Error).message}`,
        screenshot: await safeScreenshot(page),
      };
    }
  }

  if (name === "screenshot") {
    // The browser handles the actual image.input dispatch — we just capture
    // the bytes and mark them for forwarding. The model receives the image
    // out-of-band as a conversation item; the tool result it sees is the
    // result string below.
    const shot = await safeScreenshot(page);
    if (!shot) {
      return { result: "Couldn't capture a screenshot of the current page." };
    }
    return {
      result:
        "Screenshot of the current page sent to you as image input. Describe what you see to the user.",
      screenshot: shot,
      sendImage: true,
    };
  }

  return { result: `Unknown tool: ${name}` };
}

async function safeScreenshot(page: Page): Promise<string | undefined> {
  try {
    return await screenshotJpeg(page);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Ticket mint
// ---------------------------------------------------------------------------

async function mintRealtimeTicket(model: ModelEntry): Promise<{
  clientSecret: string;
  expiresAt: string;
  wsBaseUrl: string;
}> {
  const config: Record<string, unknown> = {
    model: model.id,
    instructions: TOUR_INSTRUCTIONS,
    voice: model.defaultVoice,
    turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 500 },
    tools: realtimeTools,
    input_transcription: true,
    output_transcription: true,
  };
  // reasoning_effort is only meaningful on models that advertise it.
  // Sending it to a model that doesn't accept it gets rejected upstream.
  if (model.supportsReasoningEffort) {
    config.reasoning_effort = DEFAULT_REASONING_EFFORT;
  }
  const body = { config, ttl_seconds: 60 };

  const resp = await fetch(`${OPPER_BASE_URL}/v3/realtime-sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPPER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`mint failed (${resp.status}): ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    client_secret: string;
    expires_at: string;
    ws_url?: string;
  };
  // Strip any ?ticket= the server may have returned on ws_url — the browser
  // carries the ticket in the Sec-WebSocket-Protocol subprotocol header
  // instead, which keeps it out of URLs/access logs/browser history.
  let wsBaseUrl = data.ws_url || `${PUBLIC_WS_BASE}/v3/realtime`;
  wsBaseUrl = wsBaseUrl.replace(/[?&]ticket=[^&]*/g, "").replace(/[?&]$/, "");

  return {
    clientSecret: data.client_secret,
    expiresAt: data.expires_at,
    wsBaseUrl,
  };
}

// ---------------------------------------------------------------------------
// Port discovery
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
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

// Mint a ticket + sessionId, then pre-warm: eagerly open the BrowserContext
// and navigate it to opper.ai so the viewport pane is already showing the
// homepage by the time the agent says "hi". The agent's instructions tell
// it the viewport is loaded, so it greets from there rather than burning
// its first turn on a navigate().
//
// Pre-warm failure is non-fatal — the tour still works with a blank
// viewport; the agent will navigate on its own when asked.
const PRE_WARM_URL = "https://opper.ai/";

// Tiny config endpoint so the landing page can render the model dropdown
// from the same source of truth used at mint time.
app.get("/api/config", (_req: Request, res: Response) => {
  res.json({
    models: MODELS.map((m) => ({ id: m.id, label: m.label })),
    defaultModel: DEFAULT_MODEL_ID,
  });
});

app.post("/api/realtime/session", async (req: Request, res: Response) => {
  try {
    const sessionId = randomUUID();
    const requestedModel = (req.body?.model as string | undefined) || DEFAULT_MODEL_ID;
    const model = MODELS.find((m) => m.id === requestedModel);
    if (!model) {
      return res.status(400).json({
        error: `model "${requestedModel}" not in allowlist`,
        allowed: MODELS.map((m) => m.id),
      });
    }
    const ticket = await mintRealtimeTicket(model);
    console.log(
      `  Minted ticket: model=${model.id}, sessionId=${sessionId.slice(0, 8)}…, expires ${ticket.expiresAt}`,
    );

    let initialScreenshot: string | undefined;
    let initialUrl: string | undefined;
    try {
      const page = await browserPool.getPage(sessionId);
      await page.goto(PRE_WARM_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
      await dismissCookieBanner(page);
      initialScreenshot = await screenshotJpeg(page);
      initialUrl = PRE_WARM_URL;
      console.log(`  Pre-warmed ${PRE_WARM_URL} for ${sessionId.slice(0, 8)}…`);
    } catch (err) {
      console.warn(`  Pre-warm failed (session will start blank): ${(err as Error).message}`);
    }

    res.json({ ...ticket, sessionId, initialScreenshot, initialUrl });
  } catch (err) {
    console.error("  Mint failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Tool runner. Browser receives tool.call from the realtime agent on the WS
// it holds directly with Opper, then POSTs the call here. We run it against
// the per-session Playwright page and return { result, screenshot }.
app.post("/api/tools/:name", async (req: Request, res: Response) => {
  const { sessionId, ...args } = req.body ?? {};
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ result: "Missing sessionId in tool call." });
  }
  try {
    const result = await executeTool(String(req.params.name), args, sessionId);
    res.json(result);
  } catch (err) {
    console.error(`  Tool error (${req.params.name}):`, err);
    res.status(500).json({ result: `Tool error: ${(err as Error).message}` });
  }
});

// Explicit cleanup. The browser fires this via sendBeacon on unload.
// Idempotent — missing sessionId is fine; the reaper will catch it anyway.
app.post("/api/session/end", async (req: Request, res: Response) => {
  const sessionId = req.body?.sessionId;
  if (typeof sessionId === "string") await browserPool.release(sessionId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n  Opper Tour\n");

  await browserPool.start();
  console.log("  Playwright Chromium launched (headless)");

  const port = await findPort(PREFERRED_PORT);
  app.listen(port, () => {
    console.log(`  Ready at http://localhost:${port}`);
    console.log(`  Mint endpoint: POST /api/realtime/session`);
    console.log(`  Realtime WS:   ${PUBLIC_WS_BASE}/v3/realtime  (browser-direct)\n`);
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      console.log(`\n  Shutting down (${sig})…`);
      await browserPool.stop();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
