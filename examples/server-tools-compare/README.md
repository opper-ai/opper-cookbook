# server-tools-compare

Side-by-side comparison of Anthropic, OpenAI, and Google **server-side web search** through Opper's compat endpoints.

One question gets fanned out to three providers in parallel; each provider runs its own search internally (no client-side tool round trip) and returns a final answer. The UI shows answer, latency, and Opper-reported cost per provider — making it easy to see how each provider trades off speed, citation style, and price on the same query.

## What this demonstrates

- **Server-side tools across all three providers** on a single API key
  - Anthropic `web_search_20250305` → `POST /v3/compat/v1/messages`
  - OpenAI `web_search` → `POST /v3/compat/responses`
  - Google `googleSearch` → `POST /v3/compat/v1beta/models/{model}:generateContent`
- **No tool-result round trip** — the model invokes the tool, the provider runs it, you get the answer back in one response
- **Surcharge billing** surfaced live via the `X-Opper-Cost` response header — token cost plus the per-provider server-tool surcharge (e.g. $0.01/search for Anthropic web_search, $0.035/prompt for Google grounding)
- **Citation styles** — each provider cites sources inline as markdown links the UI renders

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
| `ANTHROPIC_MODEL` | `anthropic/claude-sonnet-4-5` | Any Claude model with `web_search_*` support |
| `OPENAI_MODEL` | `openai/gpt-5` | Any OpenAI model with Responses API support |
| `GOOGLE_MODEL` | `gemini-2.5-flash` | Any Gemini model with grounding support |

## How it works

`server.ts` has three short adapter functions — one per provider — each making a single `fetch` to the corresponding compat endpoint. Request bodies use the provider's native shape; Opper forwards them verbatim. Each adapter pulls answer text out of the provider-specific response envelope (`content[].text` for Anthropic, `output_text` for OpenAI, `candidates[].content.parts[].text` for Google) and reads the `X-Opper-Cost` response header for billed cost.

The frontend is a single HTML page that POSTs the question to `/api/ask` and renders the three providers in a grid. Inline markdown link citations from each provider get rendered as clickable links.

## Notes

- The cost shown is what Opper bills you per request — token cost plus the provider-specific server-tool surcharge.
- If you don't have access to a particular provider on your Opper key, that column will show the upstream error inline; the other two still work.
- Opper's compat layer normalizes the response envelope and drops some of the structured server-tool metadata (e.g. Anthropic's `web_search_tool_result` blocks, Google's `groundingChunks`). What you see in this demo is what a typical compat-API consumer gets back.
