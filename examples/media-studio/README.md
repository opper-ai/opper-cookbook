# Media Studio

A click-first **media generation studio** built on Opper. Log in, pick what to make, pick a
model, and get a great result on the happy path — "Advanced options" stay tucked away until
you want them. Images, video, and speech today; one catalog drives them all.

It showcases a lot of Opper in one small app:

- **`/v3/images`** — synchronous image generation across many providers (OpenAI, Google,
  xAI, Pruna, Black Forest Labs, fal.ai, Reve) from one catalog.
- **`/v3/videos`** — asynchronous text/image-to-video (ByteDance Seedance, Alibaba HappyHorse,
  xAI, Pruna, Veo): submit a job, poll, then play the clip inline.
- **`/v3/audio/speech`** — synchronous text-to-speech (OpenAI, xAI, Google, ElevenLabs) with
  voice / format / speed controls.
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

The server resolves a key the same way the Opper CLI / reachy agent do, in order:
**`OPPER_API_KEY`** (env / `.env`) → **`~/.opper/config.json`** (so if you've run `opper login`
it just works) → Login-with-Opper OAuth (below).

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
| `GET /api/gallery` | Images you generated *in this app* (local per-account index) |
| `GET /api/share/:id` | A fresh public S3 link for an image (reachable by anyone, ~1h) |
| `DELETE /api/files/:id` | → `DELETE /v3/files/{id}` and drop it from the local index |
| `GET /s/:fileId` | Presigns `/v3/files/{id}/content` (cached) and redirects — backs thumbnails |
| `POST /api/intent` | → `POST /v3/call` with `output_schema` (free text → settings patch) |

**Sharing.** Presigned file URLs only live ~1 hour, so a `/s/:fileId` link mints a fresh one
on each request and redirects. The same route backs gallery thumbnails (`<img src="/s/:id">`).

**Remix.** Because stored results come back with a `file_id`, "Remix" feeds a result straight
back in as a `reference_images` / edit input — no re-upload.

**Gallery scoping.** The `/v3/files` API has no tags/metadata and its list can't be filtered,
so to show only images made *in this app* the server keeps a small local index
(`data/creations.json`, gitignored) of the `file_id`s it generated, keyed by a hash of the
account's API key. That also lets the gallery show each image's model and prompt.

## The model catalog

Everything the UI shows — the picker, the advanced drawer, the input slots — is generated
from `catalog.ts`. Each entry declares its dimension style (pixel `size` vs `aspect` ratio),
quality tiers, input support, and a `happyPath` of great defaults. **Adding a model is a
data edit**, not a UI change.

### Starting image vs. references

Two kinds of image input are distinct fields on the API, and a model can take **both**:

- **Starting image** (`image`) — the source the model works *from*: the picture to edit, or a
  video's first frame (image-to-video). Single image.
- **References** (`reference_images`) — subject/style guides the model is *influenced by*
  without reproducing them as a frame. Up to several.

A catalog entry opts into each slot independently (`supports.imageEdit` → starting image,
`supports.referenceImages` → references for images; `video.inputKind` + `video.referenceImages`
for video). Models that support both — e.g. GPT Image, the Gemini image models, Reve, Seedance,
Veo — render both slots, so you can animate *this* frame while keeping *that* character
consistent. The studio sends each filled slot as its own field.

## Video

Video uses the same catalog/picker/gallery shell as images, with one difference: it's
**asynchronous**. `POST /v3/videos` returns a job id, the client polls
`GET /v3/artifacts/{id}/status` until `completed`, and the clip plays inline. Unlike images,
video's per-model knobs (duration, resolution, aspect) aren't top-level fields — they go in
`parameters`, and the **keys and values are provider-specific** (Veo uses `durationSeconds` /
`aspectRatio`; HappyHorse wants `resolution: "720P"` uppercase). Each catalog entry's `video`
block carries the right keys, and `happyPath` is the baseline `parameters` object.

Image-to-video models reuse the same input slots as images (starting image + references); ones
that *require* a starting image (e.g. HappyHorse i2v) gate Generate until you add one.

> The default video model (HappyHorse text-to-video) and Seedance 2.0 image-to-video are
> live-verified. The other video entries follow the model specs but aren't all individually
> verified — provider param casing is fiddly, so check the server log if one fails (errors are
> relayed verbatim).

## Audio

Audio (text-to-speech) reuses the same catalog/picker/gallery shell as images — it's
**synchronous**, like `/v3/images`. The prompt box becomes "the text to speak", the advanced
panel offers **voice / format / speed** (from each model's `audio` config in `catalog.ts`), and
`POST /v3/audio/speech` returns the clip, which plays inline and is stored to `/v3/files` so it
lands in the gallery and shares like everything else. The intent bar is hidden here — speech
text is literal, not a visual prompt to structure.

Each `modality: "audio"` catalog entry declares its `voices`, `formats`, and whether it takes a
`speed` knob; voice/format are validated server-side against the model. Providers that use
account-scoped voice ids (ElevenLabs) omit `voices` and use the account default.

## Extending to transcription (STT)

The other half of audio — speech-to-text — is `POST /v3/audio/transcriptions` (audio in, text
out). It inverts the prompt→media shell (you upload audio and get a transcript), so it'd be a
small dedicated flow rather than another catalog entry. Not wired yet.

## Notes

- Generated images are stored by default (`store: true`) so they get a `file_id`. On
  zero-data-retention projects storage degrades silently and the studio falls back to the
  inline base64 image (remix/share are then unavailable for that result).
- Per-generation cost comes from the `/v3/images` response (`usage.cost`); the header shows a
  running session total.
- Click any image to inspect it full size.
- **Serving cost.** Image bytes come straight from S3 via presigned URLs, not from Opper's API
  (generation is the real cost; delivery is ~100× cheaper S3 egress). Presigned URLs rotate and
  expire (~1h), so the server caches each file's URL for ~50 min: `/s/:fileId` re-issues that
  stable URL on every request (collapsing repeat presign calls), and the browser caches the
  actual image *bytes* by that URL. The redirect itself is `no-store` — caching it would pin a
  thumbnail to one URL that later expires (→ broken image). At larger scale the bigger lever is
  platform-side (a CDN / stable URLs in front of the bucket), which the client can't do.
