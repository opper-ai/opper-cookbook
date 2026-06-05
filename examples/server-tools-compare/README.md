# server-tools-compare

Side-by-side comparison of how Opper's compat endpoints route **server-side web search**, across providers and across engines for the same model.

One question fans out to N panels in parallel; each panel runs its own search internally (no client-side tool round trip) and returns the final answer plus the actual search queries it issued and citation URLs for every source it grounded on. The UI shows answer, queries, citations, latency, cost, and response size per panel.

## Presets

Switch between presets via the tabs at the top of the page:

- **Providers (native)** — the original demo. Three panels, each provider calling its own native server-tool block.
  - Anthropic `web_search_20250305` → `POST /v3/compat/v1/messages`
  - OpenAI `web_search` → `POST /v3/compat/responses`
  - Google `googleSearch` → `POST /v3/compat/v1beta/models/{model}:generateContent`
- **Claude — all engines**, **GPT-5.5 — all engines**, **Gemini — all engines** — five panels for the same model, one per engine selector. Shows the same question routed through:
  - `native` — provider's own server-tool block (same as the Providers preset)
  - `auto` — `{type:"opper:web_search", engine:"auto"}`. Server resolver routes to native when the model declares `server_tools.web_search=native` on this endpoint, otherwise falls back to the opper agentic loop
  - `opper` — forces the opper server-side agentic loop regardless of native capability
  - `jina` / `exa` — opper agentic loop with the named search backend

## What this demonstrates

- **Server-side tools across providers** on a single API key — no client-side tool loop, the model invokes the tool, the provider (or Opper) runs it, you get the final answer back in one response.
- **Engine routing is one selector** — drop `{type:"opper:web_search", engine:"<engine>"}` into your tools array. The same request body works on every compat endpoint; what changes is who actually executes the search.
- **Full wire-shape fidelity** — every endpoint returns its provider's native server-tool blocks verbatim (Anthropic `server_tool_use` + `web_search_tool_result` + text `citations[]`; OpenAI `web_search_call` + `url_citation` annotations; Google `groundingMetadata`). The opper route synthesizes the same shape, so client parsing stays uniform.
- **Surcharge billing** surfaced live via the `X-Opper-Cost` response header — token cost plus the per-engine surcharge (e.g. $0.01/search for Anthropic native, $0.035/prompt for Google grounding, Jina/Exa rates for opper-route backends). The cost diverges between presets, which is the demo's point.
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
| `OPENAI_MODEL` | `openai/gpt-5.5` | Any OpenAI model with Responses-API `web_search` support |
| `GOOGLE_MODEL` | `gemini-2.5-flash` | Any Gemini model with `google_search` grounding support |

## How it works

`server.ts` exposes one endpoint: `POST /api/ask` with `{model, engine, question, compact}`. The server derives the compat endpoint from the model prefix (`anthropic/` → `/v1/messages`, `openai/` → `/responses`, `gemini`/`vertexai/gemini` → `/v1beta/models/{model}:generateContent`), builds the request body with either the provider's native tool block (engine `native`) or the canonical `opper:web_search` entry (every other engine), and parses the response with a per-endpoint parser:

- **Answer text** — `content[].text` for Messages, `output_text` for Responses, `candidates[].content.parts[].text` for generateContent
- **Queries** — `server_tool_use.input.query` for Messages (also `tool_use.opper_web_search` when the opper route hits its budget mid-loop), `web_search_call.action.queries[]` for Responses, `groundingMetadata.webSearchQueries[]` for generateContent
- **Citations** — text-block `citations[]` for Messages, `output_text.annotations[]` (`url_citation`) for Responses, `groundingMetadata.groundingChunks[].web` for generateContent
- **Cost** — `X-Opper-Cost` response header

The frontend is a single HTML page that fetches `/api/defaults` for the model labels, renders the chosen preset's panels into a CSS-grid layout (`auto-fit, minmax(280px, 1fr)` — adapts cleanly from 3 panels to 5), then fans out one `/api/ask` per panel in parallel and paints each cell as it finishes.

## Notes

- Cost shown is what Opper bills you per request — token cost plus the engine's per-call surcharge. In the engine presets, you'll see Native vs Auto match on a model whose YAML declares `server_tools.web_search=native` (because Auto resolves to Native), and Opper/Jina/Exa diverge to the agentic-loop rate.
- If your Opper key doesn't have access to a particular provider, that panel will show the upstream error inline; the rest still work.
- **Compact mode**: Google's `groundingChunks` keep titles but drop the (long signed redirect) URIs — those citations render as plain text since there's nothing to link to. Anthropic compact strips `encrypted_content` from search results but preserves citation URLs. Compact-mode responses **cannot be replayed in multi-turn conversation** to extend a cited turn (Anthropic's citation continuity needs the encrypted blobs); the contract is documented.
- Engine `auto` is the recommended selector for production agents — let Opper pick native when available, fall back to the opper agentic loop otherwise.
