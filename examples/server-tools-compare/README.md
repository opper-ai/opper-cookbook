# server-tools-compare

Side-by-side comparison of Anthropic, OpenAI, and Google **server-side web search** through Opper's compat endpoints.

One question gets fanned out to three providers in parallel; each provider runs its own search internally (no client-side tool round trip) and returns the final answer plus the actual search queries it issued and citation URLs for every source it grounded on. The UI shows answer, queries, citations, latency, cost, and response size per provider.

## What this demonstrates

- **Server-side tools across all three providers** on a single API key
  - Anthropic `web_search_20250305` → `POST /v3/compat/v1/messages`
  - OpenAI `web_search` → `POST /v3/compat/responses`
  - Google `googleSearch` → `POST /v3/compat/v1beta/models/{model}:generateContent`
- **No tool-result round trip** — the model invokes the tool, the provider runs it, you get the answer back in one response
- **Full provider-native response fidelity** — every endpoint round-trips its provider's server-tool blocks verbatim (Anthropic `server_tool_use` + `web_search_tool_result` + text `citations[]`; OpenAI `web_search_call` + `url_citation` annotations; Google `groundingMetadata`)
- **Surcharge billing** surfaced live via the `X-Opper-Cost` response header — token cost plus the per-provider server-tool surcharge (e.g. $0.01/search for Anthropic web_search, $0.035/prompt for Google grounding)
- **Compact-response toggle** — flip the checkbox to enable `X-Opper-Compact-Response: true` and watch the Anthropic response shrink ~90% (encrypted_content stripped, citation URLs preserved). Tradeoff documented inline.

## Run

```bash
cd examples/server-tools-compare
npm install
export OPPER_API_KEY=sk-op-...
npm start
```

Open http://localhost:3000.

### Environment

| Var | Default | What it does |
| --- | --- | --- |
| `OPPER_API_KEY` | (required) | Opper key — get one at https://opper.ai |
| `OPPER_BASE_URL` | `https://api.opper.ai` | Override for staging / local stack |
| `ANTHROPIC_MODEL` | `anthropic/claude-sonnet-4-6` | Any Claude model with `web_search_*` support |
| `OPENAI_MODEL` | `openai/gpt-5.5` | Any OpenAI model with Responses API support |
| `GOOGLE_MODEL` | `gemini-2.5-flash` | Any Gemini model with grounding support |

## How it works

`server.ts` has three short adapter functions — one per provider — each making a single `fetch` to the corresponding compat endpoint. Request bodies use the provider's native shape; Opper forwards them verbatim. Each adapter walks the provider-specific response envelope to pull out:

- **Answer text** — `content[].text` for Anthropic, `output_text` for OpenAI, `candidates[].content.parts[].text` for Google
- **Queries** — `server_tool_use.input.query` for Anthropic, `web_search_call.action.queries[]` for OpenAI, `groundingMetadata.webSearchQueries[]` for Google
- **Citations** — text-block `citations[]` for Anthropic, `output_text.annotations[]` (url_citation) for OpenAI, `groundingMetadata.groundingChunks[].web` for Google
- **Cost** — `X-Opper-Cost` response header (the same Opper-billed cost in all three cases)

The frontend is a single HTML page that POSTs the question to `/api/ask`, then renders the three providers in a grid with skeleton loaders while requests run. A checkbox toggles the `X-Opper-Compact-Response: true` header on or off so you can see the response size difference live.

## Notes

- The cost shown is what Opper bills you per request — token cost plus the provider-specific server-tool surcharge.
- If you don't have access to a particular provider on your Opper key, that column will show the upstream error inline; the other two still work.
- In **compact mode**, Google's `groundingChunks` keep titles but drop the (long signed redirect) URIs — those citations render as plain text since there's nothing to link to. Anthropic compact strips `encrypted_content` from search results but preserves the citation URLs.
- Compact-mode responses **cannot be replayed in multi-turn conversation** to extend a cited turn, because Anthropic's citation continuity needs the `encrypted_content` / `encrypted_index` blobs that compact mode strips. That's the documented contract.
