# Brainstorm Time

Realtime voice brainstorming where the **browser talks directly to Opper** over WebSocket, authenticated with a short-lived ephemeral ticket. The Node server only mints tickets and runs tools — it doesn't sit on the WebSocket path.

What it shows:

- **Multi-provider realtime** — OpenAI GPT Realtime 2, xAI Grok Voice, and Gemini 3.1 Flash Live, swappable from the landing-page dropdown.
- **Browser-direct WebSocket** authenticated with a single-use ticket carried in the `Sec-WebSocket-Protocol: opper-ticket.<secret>` subprotocol header — credentials never appear in URLs, access logs, or browser history.
- **Pre-binding** — model, voice, instructions, and tools are locked onto the ticket at mint time. A leaked ticket can only open the session the issuer authorized; it cannot pivot to a different model.
- **Tools** — server-side `generate_image` and `web_search`, plus three client-side board tools (`add_idea`, `remove_idea`, `clear_board`) that the model uses to populate a live mind-map / sticky board next to the chat.

## Flow

1. Browser POSTs `/api/realtime/session` with the user's topic and model choice.
2. Node runs a quick web search on the topic to ground the brainstorm, then POSTs `/v3/realtime-sessions` to Opper with the API key in `Authorization`. Opper returns a `client_secret` plus an expiry.
3. Browser opens `wss://api.opper.ai/v3/realtime` directly, carrying the ticket in the subprotocol header.
4. Realtime agent streams audio + transcripts to the browser.
5. On `tool.call`, the browser dispatches: client-side tools (board) run synchronously in the browser; server-side tools (image, web search) POST to `/api/tools/:name` and the result comes back over the WS as `tool.result`.

The browser **never sees the API key**.

## Setup

```bash
npm install
```

## Run

```bash
OPPER_API_KEY=your-key npm start
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPPER_API_KEY` | (required) | Project-scoped runtime API key |
| `OPPER_BASE_URL` | `https://api.opper.ai` | Override for local development |
| `OPPER_WS_BASE` | derived from `OPPER_BASE_URL` | Public WebSocket origin |
| `PORT` | `3000` | Server port |

### Model allowlist

The browser dropdowns are populated from `MODELS` in `server.ts`. The browser POSTs its choice; the server validates against this list before passing into the mint config and rejects anything off-list with `400`. To add a model, edit the `MODELS` array — that's the policy boundary in one place.

## Keyboard shortcuts

- **Space** — toggle microphone (when not typing)
- **Enter** — send text message

## Architecture notes

The whole reason the ticket pattern exists is that browsers cannot set an `Authorization` header on `new WebSocket(...)` — see the [Realtime voice guide](https://docs.opper.ai/capabilities/realtime) for the security model and lifecycle.

A different pattern is to run a Node WS proxy that sits between the browser and Opper, forwarding frames bidirectionally. That trades a heavier backend (server holds the long-lived WS for every session) for full server-side observability of every frame. Not shown here to keep the example lean; the ticket pattern is the recommended default for new applications.
