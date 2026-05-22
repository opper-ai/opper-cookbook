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
import { URL_ALLOWLIST, TOUR_INSTRUCTIONS } from "./tour-knowledge.js";
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

// Single-provider for this example. brainstorm-time shows the multi-provider
// menu pattern; this example keeps the focus on Playwright + screenshot tools.
const MODEL_ID = "openai/gpt-realtime-2";
const VOICE = "marin";
const REASONING_EFFORT = "low";

if (!OPPER_API_KEY) {
  console.error("  OPPER_API_KEY is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// URL allowlist — normalized once. The agent passes a raw URL string;
// we canonicalize (strip trailing slash) and exact-match against this set.
// ---------------------------------------------------------------------------

const canonicalUrl = (u: string) => u.trim().replace(/\/+$/, "");
const ALLOWED_URLS = new Set(URL_ALLOWLIST.map(canonicalUrl));
function isAllowedUrl(u: string): boolean {
  return ALLOWED_URLS.has(canonicalUrl(u));
}

// ---------------------------------------------------------------------------
// Tool schemas — what the realtime agent sees. These are bound onto the
// ticket at mint time, so the browser cannot ask for more tools than
// what we authorize.
// ---------------------------------------------------------------------------

const realtimeTools = [
  {
    name: "navigate",
    description:
      "Navigate to one of the allowlisted Opper URLs. The url must exactly match a URL from the site map in your instructions. Returns a fresh screenshot of the page.",
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
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function screenshotJpeg(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: "jpeg", quality: 70 });
  return buf.toString("base64");
}

type ToolResult = { result: string; screenshot?: string };

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

async function mintRealtimeTicket(): Promise<{
  clientSecret: string;
  expiresAt: string;
  wsBaseUrl: string;
}> {
  const config = {
    model: MODEL_ID,
    instructions: TOUR_INSTRUCTIONS,
    voice: VOICE,
    reasoning_effort: REASONING_EFFORT,
    turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 500 },
    tools: realtimeTools,
    input_transcription: true,
    output_transcription: true,
  };
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

// Mint a ticket + sessionId. The sessionId is *ours*, not Opper's — it
// keys the BrowserContext we lazy-create on first tool call.
app.post("/api/realtime/session", async (_req: Request, res: Response) => {
  try {
    const sessionId = randomUUID();
    const ticket = await mintRealtimeTicket();
    console.log(
      `  Minted ticket: sessionId=${sessionId.slice(0, 8)}…, expires ${ticket.expiresAt}`,
    );
    res.json({ ...ticket, sessionId });
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
