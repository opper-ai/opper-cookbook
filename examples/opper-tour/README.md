# Opper Tour

A realtime voice agent that walks you through Opper's web properties by **driving a headless Chromium on the server** and streaming the screenshots back to the browser. You talk; it navigates, scrolls, and highlights the parts of the page it's talking about.

Currently at Phase 0.5 of a multi-phase project. See [`PHASES.md`](./PHASES.md) for the full roadmap (vision-driven navigation → real-browser-via-extension).

## Demo

https://github.com/user-attachments/assets/cf743441-c701-462d-94f4-07a64a8f2550

## What it shows

- **Realtime voice + server-driven browser**. The voice agent's tool calls (`navigate`, `click`, `scroll`, `highlight`, `read_text`, `screenshot`) execute against a real Chromium instance running on the Node server via [Playwright](https://playwright.dev). Each tool returns a fresh JPEG screenshot that the browser renders in a viewport pane next to the chat.
- **Vision input (opt-in)**. The `screenshot` tool also forwards the JPEG to the realtime model as an `image.input` event, so the agent can *see* the page when the description matters. (Gated on [opper-ai/opper#2509](https://github.com/opper-ai/opper/pull/2509); the tool ships pre-wired for the moment the platform lands the event.)
- **Browser-direct WebSocket** with ephemeral tickets, same security pattern as [`brainstorm-time`](../brainstorm-time/). Credentials never appear in URLs, access logs, or browser history.
- **Per-session BrowserContext isolation**. Concurrent users don't share Playwright pages — each realtime session keys its own `BrowserContext` on the server, lazily created and reaped after 5 minutes idle.
- **Domain allowlist as the security boundary**. The agent can navigate anywhere under `opper.ai`, `docs.opper.ai`, and `github.com/opper-ai`. Anywhere else is rejected before Playwright is ever called.

## Flow

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

1. Browser POSTs `/api/realtime/session`. Node mints a single-use realtime ticket against Opper and a `sessionId` of its own, returning both.
2. Browser opens `wss://api.opper.ai/v3/realtime` directly, carrying the ticket in the `Sec-WebSocket-Protocol: opper-ticket.<secret>` subprotocol header.
3. Agent streams audio + transcripts to the browser. The system prompt (in `tour-knowledge.ts`) tells the agent which Opper pages it can visit and what each one is about.
4. On `tool.call`, the browser POSTs `/api/tools/:name` with `{ sessionId, ...args }`. Node looks up the per-session `BrowserContext`, runs the action against the Page, returns `{ result, screenshot }`.
5. Browser renders the screenshot into the viewport pane and ships only the `result` string back to Opper as `tool.result` (the screenshot is display-only).

## Setup

```bash
npm install
```

This downloads Chromium (~90 MB) via the `postinstall` hook.

## Run

```bash
OPPER_API_KEY=your-key npm start
```

Open [http://localhost:3000](http://localhost:3000), click **Start the tour**, allow microphone access, and ask the guide to take you somewhere. Try:

- *"What's on the homepage?"*
- *"Show me the realtime docs."*
- *"Scroll down."*
- *"Take me to the model catalogue."*

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPPER_API_KEY` | (required) | Project-scoped runtime API key |
| `OPPER_BASE_URL` | `https://api.opper.ai` | Override for local development |
| `OPPER_WS_BASE` | derived from `OPPER_BASE_URL` | Public WebSocket origin |
| `PORT` | `3000` | Server port |

## Tool surface

All six tools are server-side; each returns `{ result: string, screenshot?: string, sendImage?: boolean }` (the screenshot is base64 JPEG, quality 70).

| Tool | Args | Behaviour |
|---|---|---|
| `navigate` | `url: string` | `page.goto(url, { waitUntil: "domcontentloaded" })`. URL must satisfy the domain allowlist in `tour-knowledge.ts#isAllowedUrl`, otherwise the tool returns a "not allowed" message and the agent is expected to explain the limit to the user. |
| `click` | `text: string` | `page.getByText(text, { exact: false }).first().click()`. Returns a "couldn't find" message on miss so the agent can recover narratively. |
| `scroll` | `direction: "up" \| "down"`, `amount?: "page" \| "half"` | `page.mouse.wheel(0, ±height)`. |
| `highlight` | `text: string` | Injects a temporary outline + glow on the matching element, screenshots, then removes the styling. |
| `read_text` | — | `page.innerText("main, article, body")`, truncated to ~4000 chars. Returns the visible page text so the agent can ground narration in what the page actually says. |
| `screenshot` | — | Captures a JPEG and sets `sendImage: true`. The browser then dispatches an `image.input` event to the realtime WS before forwarding the `tool.result`, so the model receives the screenshot as image input. |

## Security model

Two boundaries:

1. **Ephemeral ticket**, minted server-side and bound to model, voice, instructions, and tool list. A leaked ticket can only open the specific session the issuer authorized — it cannot pivot to a different model or unlock new tools.
2. **Domain allowlist**, enforced on the tool runner before any Playwright call. Hostname must be `opper.ai`, `docs.opper.ai`, or `github.com` (the GitHub case is further restricted to `/opper-ai/*`). The agent cannot drive the browser to any other site. The allowlist lives in `tour-knowledge.ts` (`isAllowedUrl`) so the boundary is one function in one file.

## What's next

[`PHASES.md`](./PHASES.md) lays out the road from here:

- **Phase 1** flips vision from opt-in to default — every action's screenshot feeds back into the model, the pre-baked site map goes away, and the agent navigates by what it sees. Adds `type_text`, `wait_for`, `scroll_to_text`.
- **Phase 2** replaces server-side Playwright with a **Chrome extension** driving the user's real browser via the `chrome.debugger` API, which unlocks logged-in flows at `platform.opper.ai`. That phase lives outside this cookbook because the extension install breaks the clone-and-go flow.
