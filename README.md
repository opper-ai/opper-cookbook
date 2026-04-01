# Opper Cookbook

Examples and guides for building with [Opper](https://opper.ai). PRs are welcome!

## Examples (SDK v3)

| Example | Language | Description |
|---------|----------|-------------|
| [research-assistant](examples/research-assistant/) | Python | Web search, knowledge base, structured output, streaming, image generation, tracing |
| [content-analyzer](examples/content-analyzer/) | TypeScript | Parallel analysis, embeddings, knowledge base, streaming, text-to-speech, tracing |
| [chatbot-openresponses](examples/chatbot-openresponses/) | TypeScript | OpenResponses endpoint via raw fetch(), agentic tool loop, image generation, TTS, web UI |

The SDK examples showcase the full Opper SDK v3 API surface: `opper.call()`, `opper.stream()`, `opper.trace()`, knowledge base operations, and more. The chatbot example demonstrates using the OpenResponses endpoint directly via `fetch()` with an agentic tool loop.

## Legacy examples

Older examples targeting SDK v0.x–v1.x are available under [examples/legacy/](examples/legacy/). These are no longer actively maintained but may still be useful as reference.

## Resources

- [Documentation](https://docs.opper.ai/)
- [Blog](https://opper.ai/blog)
- [Python SDK](https://pypi.org/project/opperai/)
- [TypeScript SDK](https://www.npmjs.com/package/opperai)
