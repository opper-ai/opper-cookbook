# Media Studio

A click-first **media generation studio** built on Opper. Log in, pick what to make, pick a
model, and get a great result on the happy path — "Advanced options" stay tucked away until
you want them. Images today; the app is structured to grow into video and audio.

It showcases a lot of Opper in one small app:

- **`/v3/images`** — synchronous image generation across many providers (OpenAI, Google,
  xAI, Pruna, Black Forest Labs) from one catalog.
- **`/v3/files`** — every result is stored, so it's reusable as a reference and shareable.
- **`/v3/call`** with `output_schema` — the smart "intent bar" turns a sentence into
  prefilled settings (a structured-output demo).
- **Login with Opper** — optional OAuth so each visitor pays from their own Opper Wallet.

## Why a studio, not a chatbot

The artifact is the hero. Image generation is a *configuration* task ("9:16, high quality,
from this reference") rather than a conversation, so the studio is click-first. The one bit of
chat — the intent bar — is a one-shot input that *fills the form* and gets out of the way; it
never becomes a transcript.

## Quick start

```bash
cd examples/media-studio
cp .env.example .env       # paste your OPPER_API_KEY
npm install
npm start                  # http://localhost:3000
```

Get an API key at [platform.opper.ai](https://platform.opper.ai). In this mode every
generation is billed to your own key.

## Login with Opper (optional)

To let visitors sign in and pay from their own Opper Wallet instead of your single key, set
`CLIENT_ID` and `CLIENT_SECRET` in `.env`. The studio then shows a **Login with Opper** button
and keeps each visitor's key server-side in a session. The app handles the two states a
partner app must always handle: **401** (disconnected → reconnect) and **402** (Wallet empty →
top up).

## How it works

The browser never sees an Opper key. A thin Express server (`server.ts`) holds the key and
proxies to the Opper REST API:

| Route | Does |
|---|---|
| `GET /api/catalog` | The curated model list the UI renders from |
| `POST /api/generate` | → `POST /v3/images` (stores results, returns `file_id` + url) |
| `POST /api/files` | → `POST /v3/files` (upload a reference image) |
| `GET /api/gallery` | → `GET /v3/files` (your saved creations) |
| `GET /s/:fileId` | Re-presigns `/v3/files/{id}/content` and redirects — a durable share link |
| `POST /api/intent` | → `POST /v3/call` with `output_schema` (free text → settings patch) |

**Sharing.** Presigned file URLs only live ~1 hour, so a `/s/:fileId` link mints a fresh one
on each request and redirects. The same route backs gallery thumbnails (`<img src="/s/:id">`).

**Remix.** Because stored results come back with a `file_id`, "Remix" feeds a result straight
back in as a `reference_images` / edit input — no re-upload.

## The model catalog

Everything the UI shows — the picker, the advanced drawer, the reference slots — is generated
from `catalog.ts`. Each entry declares its dimension style (pixel `size` vs `aspect` ratio),
quality tiers, reference support, and a `happyPath` of great defaults. **Adding a model is a
data edit**, not a UI change.

## Extending to video / audio

The seams are already in place:

1. Add entries to `catalog.ts` with `modality: "video"` (or `"audio"`) and flip the modality
   to `live: true` in `public/app.js` (`MODALITIES`).
2. Video on Opper is **asynchronous** (`POST /v3/videos` returns a job to poll) — add a poller
   alongside `/api/generate` and render progress on the result card. Audio (`/v3/audio/speech`)
   is synchronous like images.
3. The picker, advanced options, gallery, and share routes all work unchanged — they're driven
   by the catalog and the files API, both modality-agnostic.

## Notes

- Generated images are stored by default (`store: true`) so they get a `file_id`. On
  zero-data-retention projects storage degrades silently and the studio falls back to the
  inline base64 image (remix/share are then unavailable for that result).
- Per-generation cost comes from the `/v3/images` response (`usage.cost`); the header shows a
  running session total.
