# Opper Cookbook

Examples and guides for building with [Opper](https://opper.ai). PRs are welcome!

## Examples (SDK v3)

| Example | Language | Description |
|---------|----------|-------------|
| [research-assistant](examples/research-assistant/) | Python | Web search, knowledge base, structured output, streaming, image generation, tracing |
| [content-analyzer](examples/content-analyzer/) | TypeScript | Parallel analysis, embeddings, knowledge base, streaming, text-to-speech, tracing |
| [chatbot-openresponses](examples/chatbot-openresponses/) | TypeScript | OpenResponses endpoint via raw fetch(), agentic tool loop, image generation, TTS, web UI |
| [brainstorm-time](examples/brainstorm-time/) | TypeScript | Realtime voice brainstorming — browser-direct WebSocket via ephemeral tickets, mic input, image generation, web search, live idea board |
| [live-translate](examples/live-translate/) | TypeScript | Realtime speech-to-speech translation — browser-direct WebSocket via ephemeral tickets, model + target language locked on the ticket, live captions (Gemini 3.5 Live Translate) |
| [opper-tour](examples/opper-tour/) | TypeScript | Realtime voice tour guide that drives a server-side Playwright Chromium and streams screenshots back to the browser — pre-baked Opper site map, URL allowlist, per-session BrowserContext |
| [server-tools-compare](examples/server-tools-compare/) | TypeScript | Side-by-side web search: same question fanned out to Anthropic, OpenAI, and Google server-side tools through Opper compat — answer, cost, latency per provider |
| [login-with-opper-web](examples/login-with-opper-web/) | JavaScript | OAuth login flow, token exchange, inference — Express web app with branded button |
| [login-with-opper-cli](examples/login-with-opper-cli/) | JavaScript | Device Authorization Flow for CLI apps — code-based login, polling, inference |

The SDK examples showcase the full Opper SDK v3 API surface: `opper.call()`, `opper.stream()`, `opper.trace()`, knowledge base operations, and more. The chatbot example demonstrates using the OpenResponses endpoint directly via `fetch()`; the brainstorm example demonstrates the Realtime API with bidirectional voice streaming via browser-direct WebSocket and ephemeral tickets.

## Legacy examples

Older examples targeting SDK v0.x–v1.x are available under [examples/legacy/](examples/legacy/). These are no longer actively maintained but may still be useful as reference.

## Resources

- [Documentation](https://docs.opper.ai/)
- [Blog](https://opper.ai/blog)
- [Python SDK](https://pypi.org/project/opperai/)
- [TypeScript SDK](https://www.npmjs.com/package/opperai)
