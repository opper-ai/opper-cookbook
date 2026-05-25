/**
 * Per-session Playwright lifecycle.
 *
 * One shared Chromium process; one BrowserContext (and one Page) per
 * sessionId. The tool runner calls getPage(sessionId) on every request,
 * which lazy-creates a context on first use and stamps lastActivity on
 * every subsequent call.
 *
 * Cleanup is intentionally lazy: the server doesn't sit on the realtime
 * WS (the browser talks to Opper directly), so we don't get a clean
 * "session ended" signal. Instead, the browser SHOULD beacon /api/session/end
 * on unload, and we sweep idle contexts every minute as a safety net.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const REAPER_INTERVAL_MS = 60 * 1000;
const VIEWPORT = { width: 1280, height: 800 };

interface Session {
  context: BrowserContext;
  page: Page;
  lastActivity: number;
}

let browser: Browser | null = null;
const sessions = new Map<string, Session>();
let reaperHandle: NodeJS.Timeout | null = null;

export async function start(): Promise<void> {
  if (browser) return;
  browser = await chromium.launch({ headless: true });
  reaperHandle = setInterval(reap, REAPER_INTERVAL_MS);
  reaperHandle.unref?.();
}

export async function stop(): Promise<void> {
  if (reaperHandle) {
    clearInterval(reaperHandle);
    reaperHandle = null;
  }
  for (const [id] of sessions) await release(id);
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export async function getPage(sessionId: string): Promise<Page> {
  if (!browser) throw new Error("browser pool not started");
  let s = sessions.get(sessionId);
  if (!s) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      // Some sites refuse headless UAs outright. Spoof a recent Chrome on macOS
      // so we look like a real visitor for marketing/docs traffic.
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    s = { context, page, lastActivity: Date.now() };
    sessions.set(sessionId, s);
  } else {
    s.lastActivity = Date.now();
  }
  return s.page;
}

export async function release(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  try {
    await s.context.close();
  } catch {
    // already closed — fine
  }
}

export function size(): number {
  return sessions.size;
}

async function reap(): Promise<void> {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > IDLE_THRESHOLD_MS) {
      console.log(`  Reaping idle session ${id}`);
      await release(id);
    }
  }
}
