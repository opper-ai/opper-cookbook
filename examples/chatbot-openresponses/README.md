# Chatbot with OpenResponses

A chatbot that uses the Opper [OpenResponses](https://docs.opper.ai) endpoint directly via `fetch()` — no chat SDK needed. The model has access to image generation and text-to-speech tools, powered by the Opper TypeScript SDK.

## How it works

```
Browser  ──POST /api/chat──>  Express server  ──fetch()──>  /v3/compat/openresponses
                                    │
                                    ├── Tool call? Execute via Opper SDK
                                    │   ├── opper.beta.web.search()
                                    │   ├── opper.generateImage()
                                    │   └── opper.textToSpeech()
                                    │
                                    └── Feed tool results back, loop until text reply
```

The server implements a simple **agentic loop**: it calls the OpenResponses endpoint, checks if the model wants to use a tool, executes it, feeds the result back, and repeats until the model produces a text response.

## Features demonstrated

- **OpenResponses endpoint** — raw `fetch()` to `/v3/compat/openresponses`, typed request/response
- **Agentic tool loop** — function calling with `function_call` / `function_call_output` items
- **Web search** — `opper.beta.web.search()` for real-time information
- **Image generation** — `opper.generateImage()` via SDK, rendered inline in chat
- **Text-to-speech** — `opper.textToSpeech()` via SDK, playable audio in chat
- **Session tracing** — `X-Opper-Parent-Span-Id` header groups all turns under one trace
- **Conversation history** — localStorage-persisted sidebar with multiple conversations
- **Light/dark theme** — auto-detects system preference

## Prerequisites

- Node.js 18+
- An [Opper](https://opper.ai) API key

## Run

```bash
npm install
OPPER_API_KEY=your-key npx tsx server.ts
```

Open [http://localhost:3000](http://localhost:3000) and start chatting.

## Try these prompts

- "What's the latest news about AI?"
- "Draw me a cat wearing a tiny hat"
- "Say hello in French and read it aloud"
- "Generate an image of a sunset over Tokyo and describe it"
