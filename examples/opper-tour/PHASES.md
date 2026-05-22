# opper-tour — phased design

*Created 2026-05-22.*

A voice-driven support agent that walks users through Opper's web properties (opper.ai, docs.opper.ai, platform.opper.ai) by driving a browser they can watch. Three phases, each independently shippable. The cookbook itself is the progress tracker — each phase merges to `main` and updates the README before the next begins.

## End goal

A Chrome-extension companion that lets a realtime voice agent drive the user's real browser via vision, including their logged-in session at platform.opper.ai. Phases 0–1 land as a self-contained cookbook entry; Phase 2 is a separate repo + blog post because the extension install breaks the cookbook flow.

## Phase map

| Phase | Cookbook | Vision | Auth | Sites |
|---|---|---|---|---|
| **0 — Foundation** | yes (new entry) | no — pre-baked site knowledge | no | opper.ai, docs.opper.ai |
| **1 — Vision + full tour** | yes (extends Phase 0) | yes — screenshots fed back into model | no | opper.ai, docs.opper.ai |
| **2 — Real browser via extension** | no — separate repo + blog | yes | yes — user's real session | + platform.opper.ai |

---

## Phase 0 — Foundation

### Goal

Smallest cookbook-shippable version: realtime voice agent narrates a tour, driving a headless Chromium via server-side Playwright. Each tool call returns a screenshot that streams into a viewport pane in the browser. Agent uses pre-baked knowledge of the Opper site structure — no vision, no auth.

### Non-goals

- Vision input (Phase 1)
- Form filling, search interaction (Phase 1)
- platform.opper.ai (Phase 2 — needs real session)
- Animated cursor / highlight rings (Phase 1)
- Multi-tab (Phase 1)
- Multiple voice providers — single provider for focus

### Architecture

Reuses brainstorm-time's auth pattern: browser-direct realtime WS to Opper via ephemeral ticket. Node server mints tickets and runs tools. Only new piece versus brainstorm-time is **Playwright + screenshot return**.

```
Browser ─── WS (Opper realtime) ──────────────── Opper
   │                                                │
   │ ◀────── tool.call ─────────────────────────────│
   │
   ├── POST /api/tools/:name  { sessionId, args } ──▶ Node server
   │                                                  │
   │                                                  ├── Playwright BrowserContext (per sessionId)
   │                                                  ├── page.goto / getByText.click / scroll
   │                                                  └── screenshot → JPEG q70 base64
   │
   │ ◀──── tool.result { result, screenshot } ─────────│
   │
   └── render screenshot into viewport pane
```

**Session keying.** `/api/realtime/session` mints both the realtime ticket and a `sessionId` (UUID). The browser holds the `sessionId` for the life of the page and includes it on every `POST /api/tools/:name` body. The server keeps a `Map<sessionId, BrowserContext>` and lazy-creates the context on first tool call.

**Lifecycle.** Idle reaper sweeps every minute and closes any context whose last activity (= last tool call) was more than 5 minutes ago. Browser may also send `POST /api/session/end { sessionId }` on `beforeunload` for prompt cleanup, but this is best-effort, not required. One Chromium process shared across contexts.

### Tool surface

Four tools, all server-side. All return `{ result: string, screenshot: string }` (base64 JPEG, ~50KB each).

| Tool | Args | Implementation |
|---|---|---|
| `navigate` | `url: string` | `page.goto(url, { waitUntil: "domcontentloaded" })`. `url` must match the URL allowlist. |
| `click` | `text: string` | `page.getByText(text, { exact: false }).first().click()` |
| `scroll` | `direction: "up"\|"down"`, `amount?: "page"\|"half"` (default `"page"`) | `page.mouse.wheel(0, ±height)` |
| `highlight` | `text: string` | inject temporary outline ring → screenshot → remove ring |

**URL allowlist** is the security boundary, mirroring brainstorm-time's model allowlist. Hand-curated list of ~15 opper.ai + docs.opper.ai URLs. Off-list navigation returns 400 from the tool runner.

**Errors** return as `{ result: "Couldn't find text 'Foo' on this page" }` so the agent can recover in narration. No server-side retries.

### UX

Two-pane single-page app:

- **Left (40%)** — voice chat (transcript stream, mic indicator, connect button). Same vibe as brainstorm-time.
- **Right (60%)** — viewport pane: latest screenshot, soft crossfade on update, small URL badge top-left.

The pane is display-only. User interaction with the page comes in Phase 1+.

### File layout

```
examples/opper-tour/
  server.ts            # express + Playwright + ticket mint + tool runner
  tour-knowledge.ts    # URL allowlist + site descriptions for the system prompt
  public/
    index.html
    app.js             # WS handling, screenshot rendering, voice UI
    style.css
  package.json         # adds: playwright, opperai, express
  README.md
  tsconfig.json
  PHASES.md            # this file
```

### Decisions locked

- **Voice provider**: OpenAI GPT Realtime 2. Best documented vision-input support, which Phase 1 depends on. Single provider for focus.
- **Example name**: `opper-tour`.
- **Click mechanism**: text-targeting via Playwright `getByText`. Evolves to Phase 1's `click(description)` (vision resolves descriptor → bounding box) and Phase 2's CDP-dispatched click on the same descriptor. Curated selectors would have to be thrown away in Phase 1.
- **Knowledge scope**: ~15 URLs covering homepage, pricing, blog, quickstart, each capability page, each SDK reference. Hand-curated in `tour-knowledge.ts`.
- **Screenshot format**: JPEG quality 70, base64 in `tool.result`. ~50KB per shot, fine over WS.

### Cookbook README outline

The example's README explains: what it shows (realtime voice + server-side tools + Playwright screenshot streaming), how to run it, the security model (ticket-based auth, URL allowlist), and signposts to Phase 1 ("the next version adds vision-driven navigation").

---

## Phase 1 — Vision + full tour (sketch)

Full design comes when we're ready to start. Same backbone as Phase 0; changes:

- Every screenshot fed back into the realtime model as image input
- Drop pre-baked site knowledge from the system prompt
- Tool surface expands: `click(description)`, `type_text(target, text)`, `wait_for(condition)`, `scroll_to_text(text)`, `read_visible_text()`
- Viewport polish: animated cursor that floats to target before click, highlight rings
- Multi-tab support (agent can hold docs and marketing in parallel)

Same cookbook entry — extends `examples/opper-tour`.

---

## Phase 2 — Real browser via extension (sketch)

Full design comes when we're ready to start. Replace server-side Playwright with a Chrome extension using [`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger). Same tool surface. Drives the user's real browser including logged-in session at platform.opper.ai.

Lives in a separate repo (e.g. `opper-tour-extension`) and a blog post — not the cookbook. The extension install + distribution story breaks the cookbook flow.
