# Live Translate

Real-time **speech-to-speech translation** in the browser. You speak in any language; the model speaks it back in the language you picked — a few seconds behind, continuously, the way a human interpreter works. The browser talks **directly to Opper** over WebSocket, authenticated with a short-lived ephemeral ticket. The Node server only mints tickets — it never sits on the audio path.

Powered by Opper's Realtime API and **Gemini 3.5 Live Translate** (`gemini/gemini-3.5-live-translate-preview`), which auto-detects the source language across 70+ languages and preserves the speaker's intonation and pacing.

What it shows:

- **Speech-to-speech translation** over the Realtime WebSocket — audio in, translated audio out, no turns to manage. The model streams continuously.
- **Browser-direct WebSocket** authenticated with a single-use ticket carried in the `Sec-WebSocket-Protocol: opper-ticket.<secret>` subprotocol header — the API key never appears in the browser, URLs, or access logs.
- **Pre-binding** — the model **and the target language** are locked onto the ticket at mint time (`locked_fields`). A leaked ticket can only run the exact translation you authorized; it cannot switch models or change the target language.
- **Live captions** — the streaming translated text, rendered as continuous interpretation alongside the audio. (The source-language transcript also arrives on the wire as `transcript.committed`; the UI uses it only as an utterance boundary and doesn't render it, so the translation reads as one flowing stream.)

## Flow

1. Browser POSTs `/api/realtime/session` with the chosen target language.
2. Node POSTs `/v3/realtime-sessions` to Opper with the API key in `Authorization`, binding `model` + `translation_target_language` onto the ticket. Opper returns a `client_secret` and an expiry.
3. Browser opens `wss://api.opper.ai/v3/realtime` directly, carrying the ticket in the subprotocol header, and sends `session.start` with an empty config (the locked fields are filled server-side).
4. Browser streams microphone audio (`audio.append`); Opper streams back translated audio (`audio.delta`) plus `transcript.committed` (what you said) and `text.delta` (the translation).

The browser **never sees the API key**.

## Setup

```bash
npm install
```

## Run

```bash
OPPER_API_KEY=your-key npm start
```

Open [http://localhost:3000](http://localhost:3000), pick a target language, and start talking.

> **Note — model availability.** This demo needs `gemini/gemini-3.5-live-translate-preview` on the Opper deployment you point at. If it isn't in production yet, run the branch that adds it on a local stack and set `OPPER_BASE_URL` (and, if needed, `OPPER_WS_BASE`) to that stack.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPPER_API_KEY` | (required) | Project-scoped runtime API key |
| `OPPER_BASE_URL` | `https://api.opper.ai` | Override for local development |
| `OPPER_WS_BASE` | derived from `OPPER_BASE_URL` | Public WebSocket origin |
| `PORT` | `3000` | Server port |

### Target-language allowlist

The dropdown is populated from `TARGET_LANGUAGES` in `server.ts`. The browser POSTs its choice; the server validates against this list before binding it onto the ticket and rejects anything off-list with `400`. The model supports 70+ languages — add more rows to widen the menu. That array is the policy boundary in one place.

## Notes on the model

- **Continuous, not turn-based.** Live Translate streams audio without `turnComplete` boundaries, so there's nothing to "send" — just keep the mic open. Barge-in (the speaker talking over the playback) is surfaced as `speech.started`, which clears the playback queue.
- **Captions are best-effort.** The translated-text transcript is emitted sparsely and can be partial — the audio is the primary output. The model generates translated speech directly (speech-to-speech); the transcript is a separate ASR pass layered on top, which is why it can lag or drop.
- **One target per session.** A session translates everything into a single target language. For a two-way conversation, mint a second session in the opposite direction.

## Architecture notes

Browsers cannot set an `Authorization` header on `new WebSocket(...)`, which is the whole reason the ephemeral-ticket pattern exists — see the [Realtime voice guide](https://docs.opper.ai/capabilities/realtime) for the security model and lifecycle. The alternative is a Node WS proxy that forwards frames bidirectionally (heavier backend, full server-side observability); the ticket pattern is the recommended default and what this example uses.
