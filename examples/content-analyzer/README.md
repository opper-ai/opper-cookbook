# Content Analyzer

A TypeScript example that builds a content analysis pipeline using the Opper SDK v3. Given a URL or text, it runs parallel analyses (sentiment, entities, topics), computes embeddings, stores results in a knowledge base, and streams a comprehensive report.

## Features demonstrated

- **Web fetch** — `opper.beta.web.fetch()`
- **Parallel structured analysis** — sentiment, entities, and topic extraction via `Promise.all()`
- **Structured output** — Zod v4 schemas as `output_schema`
- **Embeddings** — computing and comparing embeddings with cosine similarity
- **Knowledge base** — create, add documents, semantic query, delete
- **Streaming** — report generation with `for await...of` and `opper.stream()`
- **Text-to-speech** — `opper.textToSpeech()`
- **Tracing** — nested spans with `opper.traced()` async wrapper
- **Function management** — listing functions and revisions

## Prerequisites

- Node.js 18+
- An [Opper](https://opper.ai) API key (set `OPPER_API_KEY` env var)

## Run

```bash
npm install
npx tsx main.ts "https://example.com/some-article"
```

Or with plain text:

```bash
npx tsx main.ts "The quick brown fox jumps over the lazy dog"
```
