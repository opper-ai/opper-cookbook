# opper-tour Phase 0 — implementation plan

*Created 2026-05-22. Scope: Phase 0 only (per `PHASES.md`).*

Steps are ordered so the app is runnable end-to-end as early as possible. Each step has a clear definition-of-done; check it before moving on.

## Step 1 — Scaffold

Create the example directory contents.

**Changes**
- `examples/opper-tour/package.json` — deps: `express`, `opperai`, `playwright`, `@types/express`, `tsx`, `typescript`. Scripts: `start` (`tsx server.ts`), `postinstall` (`playwright install chromium`).
- `examples/opper-tour/tsconfig.json` — copy from `brainstorm-time/tsconfig.json`.
- `examples/opper-tour/public/index.html` — empty shell `<html>` for now.
- `examples/opper-tour/server.ts` — empty `console.log("ok")` for now.

**Done when**
- `cd examples/opper-tour && npm install` succeeds and Chromium downloads.
- `npm start` prints `ok` and exits.

## Step 2 — Tour knowledge

Curate the site map that the agent uses to navigate.

**Changes**
- `examples/opper-tour/tour-knowledge.ts` exporting:
  - `URL_ALLOWLIST: string[]` — ~15 entries across opper.ai (homepage, pricing, blog, about) and docs.opper.ai (quickstart, each /capabilities/* page, /sdks/node, /sdks/python, /api-reference).
  - `SITE_MAP_FOR_PROMPT: string` — a human-readable map of those URLs with one-line descriptions, ready to interpolate into the system prompt.
  - `TOUR_INSTRUCTIONS: string` — agent personality (warm, narrating guide), behavioral rules ("ask first what they want to explore", "narrate as you click"), and the site map.

**Done when**
- File compiles. `URL_ALLOWLIST` and `SITE_MAP_FOR_PROMPT` agree on the same URLs.

## Step 3 — Server: static + ticket mint

The server's smallest useful surface: static serving + the realtime ticket endpoint.

**Changes**
- `server.ts`: Port the express skeleton from `brainstorm-time/server.ts`. Drop the multi-provider menu — hardcode `openai/gpt-realtime-2` with voice `marin` and reasoning_effort `low`.
- `POST /api/realtime/session` — mints ticket via `POST /v3/realtime-sessions` with `tools: [navigate, click, scroll, highlight]` and `instructions: TOUR_INSTRUCTIONS`. Also mints a `sessionId` (`crypto.randomUUID()`) and returns it alongside `clientSecret`/`expiresAt`/`wsBaseUrl`.
- Tool schemas defined inline (same shape as the brainstorm-time `realtimeTools` array — JSON Schema, OpenAI-style).

**Done when**
- `curl -X POST http://localhost:3000/api/realtime/session` returns `{ clientSecret, expiresAt, wsBaseUrl, sessionId }`.

## Step 4 — Server: browser context manager

A small module that owns Playwright lifecycle.

**Changes**
- `examples/opper-tour/browser-pool.ts` exporting:
  - `getContext(sessionId): Promise<{ page: Page, lastActivity: number }>` — lazy-creates a `BrowserContext` (one `Page` per context) on first call. Updates `lastActivity` on every access.
  - `releaseContext(sessionId): Promise<void>` — closes the context if present.
  - Internal: shared `chromium.launch({ headless: true })`, viewport `1280x800`. Map keyed by sessionId. Idle reaper interval = 60s, idle threshold = 5min.
- `server.ts` calls `browserPool.start()` on boot.

**Done when**
- Unit-test it manually from a `node -e` snippet or a tiny script: call `getContext('a')`, navigate, screenshot, then `releaseContext('a')`. No leaks.

## Step 5 — Server: tool runner

The four tools.

**Changes**
- `server.ts` adds `POST /api/tools/:name` accepting `{ sessionId, ...args }`.
- Tool handlers (each returns `{ result: string, screenshot: string /* base64 jpeg */ }`):
  - `navigate({ url })`: validate `url` against `URL_ALLOWLIST` (exact match — no globs in Phase 0). `await page.goto(url, { waitUntil: "domcontentloaded" })`. Capture screenshot. On allowlist miss return HTTP 400.
  - `click({ text })`: `await page.getByText(text, { exact: false }).first().click({ timeout: 5000 })`. Catch `TimeoutError` and return `{ result: "Couldn't find text '<text>'…" }` (no throw — agent should narrate the failure).
  - `scroll({ direction, amount = "page" })`: `await page.mouse.wheel(0, sign * viewportHeight * (amount === "half" ? 0.5 : 1))`.
  - `highlight({ text })`: locate via `getByText`, scroll into view, `evaluate` to add `outline: 3px solid #f5a` + `box-shadow` to the element, screenshot, then remove.
- Helper `screenshotJpeg(page)` returning base64 JPEG quality 70.

**Done when**
- `curl -X POST http://localhost:3000/api/tools/navigate -d '{"sessionId":"test","url":"https://opper.ai"}' -H content-type:application/json` returns `{ result: "...", screenshot: "<base64>" }`. Decoded JPEG is a real screenshot of opper.ai.

## Step 6 — Server: session cleanup

Explicit teardown.

**Changes**
- `server.ts` adds `POST /api/session/end` accepting `{ sessionId }`, calls `browserPool.releaseContext(sessionId)`. Idempotent — missing sessionId returns 200.

**Done when**
- Calling end after a navigate releases the context (verify via a `browserPool.size()` debug log).

## Step 7 — Browser UI scaffold

Two-pane layout, no realtime yet.

**Changes**
- `public/index.html`: two-column flex layout. Left pane: title, "Connect" button, status text, transcript area. Right pane: `<img id="viewport">` with a "URL badge" overlay.
- `public/style.css`: dark theme matching brainstorm-time's vibe. Soft crossfade utility class for the viewport image.

**Done when**
- Loading `http://localhost:3000` shows the two-pane shell.

## Step 8 — Browser: voice + WS

Port the realtime client logic.

**Changes**
- `public/app.js`:
  - On Connect click: `POST /api/realtime/session` → `{ clientSecret, wsBaseUrl, sessionId }`. Store `sessionId` on `window.__tour`.
  - Open WS to `wsBaseUrl` with subprotocol `opper-ticket.<clientSecret>`. Wire mic stream, transcript events, etc. — port from brainstorm-time, drop the multi-provider/board logic.
  - On `beforeunload`: `navigator.sendBeacon('/api/session/end', JSON.stringify({ sessionId }))`.

**Done when**
- Connecting opens the WS, mic input streams, agent speaks. (No tools wired yet — agent will narrate but can't navigate.)

## Step 9 — Browser: tool dispatch + screenshot render

Close the loop.

**Changes**
- `app.js` `onToolCall(event)`: `POST /api/tools/${event.name}` with `{ sessionId, ...event.args }`. Get `{ result, screenshot }` back. Send `tool.result` over WS with the `result` string only (no screenshot — Opper doesn't need it). Update `<img id="viewport">.src = "data:image/jpeg;base64," + screenshot` with the crossfade class toggled to retrigger animation. Update the URL badge.

**Done when**
- Connect, say "show me the docs homepage," watch the agent call `navigate`, hear it narrate, see the screenshot appear in the right pane.

## Step 10 — README

Document it.

**Changes**
- `examples/opper-tour/README.md` covering:
  - One-paragraph what it is + what makes it different from brainstorm-time
  - Run instructions: `npm install` (notes Chromium download size), `OPPER_API_KEY=... npm start`
  - Architecture diagram (ASCII, copy from PHASES.md)
  - Tool surface table
  - Security model (ticket + URL allowlist + per-session BrowserContext)
  - Signpost to Phase 1 ("the next version of this example adds vision-driven navigation — see `PHASES.md`")
- Add `examples/opper-tour` to the root `README.md` examples list.

**Done when**
- README renders cleanly. Cookbook root README links to it.

## Step 11 — End-to-end smoke

Manual verification.

**Done when**, in a fresh `npm install && npm start`, all five of these work in one session:
1. Connect, hear greeting
2. "Take me to the quickstart" → navigate to docs.opper.ai/quickstart, screenshot lands
3. "Scroll down" → page scrolls, fresh screenshot
4. "Click the Functions link" (or whatever's visible) → `click(text)` succeeds, narration matches
5. "What's on Opper's homepage?" → navigate to opper.ai, agent narrates from the prompt's site map

If a tool errors (e.g. `getByText` misses), confirm the agent recovers gracefully via the returned error string, not a console crash.

---

## Out of scope for this plan

Anything in PHASES.md's Phase 1 or Phase 2 sketches. If the work uncovers something that wants vision, animated cursor, multi-tab, etc. — write it down and defer to the Phase 1 plan.
