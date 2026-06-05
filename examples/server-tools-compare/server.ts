/**
 * Server-tools compare: renders the same question across model + engine
 * combinations to show how Opper's compat endpoints route web_search.
 *
 * Two demo modes the UI toggles between:
 *
 *  - Providers preset (default, matches the original demo): three panels,
 *    one per provider, each sending its own native server-tool block
 *    (Anthropic web_search_20250305, OpenAI web_search, Google
 *    googleSearch).
 *  - Engine presets: one model, multiple engine selectors (native, auto,
 *    opper, jina, exa). Shows the same question routed through the
 *    different web_search engines — auto picks native when the routed
 *    model declares server_tools.web_search=native, falls back to the
 *    opper agentic loop otherwise. opper/jina/exa force the agentic loop
 *    with the named backend.
 *
 * Regardless of which engine ran, the response wire shape matches the
 * endpoint's provider native shape, so the parsers below are uniform.
 */

import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createServer } from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PREFERRED_PORT = parseInt(process.env.PORT || "3000");
const OPPER_API_KEY = process.env.OPPER_API_KEY;
const OPPER_BASE_URL = process.env.OPPER_BASE_URL || "https://api.opper.ai";

if (!OPPER_API_KEY) {
  console.error("OPPER_API_KEY is required");
  process.exit(1);
}

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "anthropic/claude-haiku-4-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "openai/gpt-5.5";
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || "gemini-2.5-flash";

async function findPort(start: number, end = start + 20): Promise<number> {
  for (let port = start; port <= end; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, () => { srv.close(() => resolve(true)); });
    });
    if (available) return port;
  }
  return start;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Engine = "native" | "auto" | "opper" | "jina" | "exa";
type EndpointKind = "messages" | "responses" | "generateContent";

interface Citation {
  title: string;
  url?: string; // optional — compact mode strips Google groundingChunk URIs
}

interface Result {
  answer: string;
  queries: string[];
  citations: Citation[];
  cost: number | null;
  bytes: number;
  ms: number;
  error?: string;
}

interface AskRequest {
  model: string;
  engine: Engine;
  question: string;
  compact: boolean;
}

// ---------------------------------------------------------------------------
// Endpoint + request derivation
// ---------------------------------------------------------------------------

function endpointFor(model: string): { kind: EndpointKind; url: string } {
  if (model.startsWith("anthropic/")) {
    return { kind: "messages", url: `${OPPER_BASE_URL}/v3/compat/v1/messages` };
  }
  if (model.startsWith("openai/")) {
    return { kind: "responses", url: `${OPPER_BASE_URL}/v3/compat/responses` };
  }
  if (model.startsWith("gemini") || model.startsWith("vertexai/gemini")) {
    return {
      kind: "generateContent",
      // The model id can contain '/', which is part of the catalog slug
      // (gemini/gemini-2.5-flash, vertexai/gemini-2.5-flash). The Go
      // handler's wildcard route preserves it verbatim, so do NOT
      // encodeURIComponent the slashes — only the action separator.
      url: `${OPPER_BASE_URL}/v3/compat/v1beta/models/${model}:generateContent`,
    };
  }
  throw new Error(`unsupported model prefix: ${model}`);
}

// Bounds the per-request search budget so the demo finishes quickly
// across all engines. Applied to surfaces that honor it (Anthropic
// native web_search_20250305 and the canonical opper:web_search entry).
// OpenAI native web_search and Google googleSearch don't expose a
// max_uses control — they cap implicitly via reasoning effort / model
// behavior. 4 is a balance: enough that complex questions can do a
// couple of refining queries, low enough that demo latency stays
// reasonable.
const MAX_SEARCHES = 4;

function toolBlockFor(kind: EndpointKind, engine: Engine): unknown {
  if (engine === "native") {
    // The original demo path — provider's own server-tool entry. Each
    // compat endpoint round-trips this verbatim to the upstream.
    switch (kind) {
      case "messages":        return { type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES };
      case "responses":       return { type: "web_search" };
      case "generateContent": return { googleSearch: {} };
    }
  }
  // For every non-native engine, the canonical Opper entry carries the
  // selector. The server's resolver routes it: auto → native when the
  // model declares server_tools.web_search=native and the endpoint matches,
  // opper/jina/exa → server-side agentic loop with the named backend.
  return { type: "opper:web_search", engine, max_uses: MAX_SEARCHES };
}

function buildBody(kind: EndpointKind, model: string, question: string, tool: unknown): unknown {
  switch (kind) {
    case "messages":
      return {
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: question }],
        tools: [tool],
      };
    case "responses":
      return {
        model,
        input: question,
        tools: [tool],
        max_output_tokens: 1024,
      };
    case "generateContent":
      // model is in the URL, not the body
      return {
        contents: [{ role: "user", parts: [{ text: question }] }],
        tools: [tool],
      };
  }
}

// ---------------------------------------------------------------------------
// Response parsing — one per endpoint kind, engine-agnostic
//
// The opper route synthesizes native-shape blocks on responses
// (synthesizeAnthropicWebSearchBlocks etc. in the Go handlers), so the
// same parser works regardless of which engine ran. The X-Opper-Cost
// header diverges across engines (native = upstream surcharge, opper-
// route = Opper's search-backend rate), which is the demo's point.
// ---------------------------------------------------------------------------

interface Parsed {
  answer: string;
  queries: string[];
  citations: Citation[];
}

function parseMessages(body: any): Parsed {
  let answer = "";
  const queries: string[] = [];
  const citations: Citation[] = [];

  for (const block of body?.content || []) {
    if (block.type === "text") {
      answer += block.text || "";
      for (const c of block.citations || []) {
        if (c.url) citations.push({ title: c.title || c.url, url: c.url });
      }
    } else if (block.type === "server_tool_use" && block.name === "web_search") {
      const q = block.input?.query;
      if (typeof q === "string") queries.push(q);
    } else if (block.type === "tool_use" && block.name === "opper_web_search") {
      // Opper route emits a function tool call when the loop hits
      // max_tokens / max_uses before reaching a final text turn. Surface
      // the attempted query so the panel still shows the search ran.
      const q = block.input?.query;
      if (typeof q === "string") queries.push(q);
    }
  }
  return { answer, queries, citations };
}

function parseResponses(body: any): Parsed {
  let answer = "";
  const queries: string[] = [];
  const citations: Citation[] = [];

  for (const item of body?.output || []) {
    if (item.type === "web_search_call") {
      // Both shapes: action.queries (array, native multi-query call) and
      // action.query (scalar, per-search emitted by some routes). Braces
      // are mandatory — without them the `else` binds to the inner `if`,
      // not the outer Array.isArray check, and synthesized blocks with
      // only action.query fall through silently.
      const qs = item.action?.queries;
      const q = item.action?.query;
      if (Array.isArray(qs)) {
        for (const qq of qs) {
          if (typeof qq === "string") queries.push(qq);
        }
      } else if (typeof q === "string") {
        queries.push(q);
      }
    } else if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === "output_text") {
          answer += part.text || "";
          for (const a of part.annotations || []) {
            if (a.type === "url_citation" && a.url) {
              citations.push({ title: a.title || a.url, url: a.url });
            }
          }
        }
      }
    }
  }
  return { answer, queries, citations };
}

function parseGenerateContent(body: any): Parsed {
  const candidate = body?.candidates?.[0];
  const answer = (candidate?.content?.parts || [])
    .map((p: any) => p.text || "")
    .join("");
  const gm = candidate?.groundingMetadata || {};
  const queries: string[] = Array.isArray(gm.webSearchQueries)
    ? gm.webSearchQueries.filter((q: any) => typeof q === "string")
    : [];
  const citations: Citation[] = [];
  for (const chunk of gm.groundingChunks || []) {
    const web = chunk?.web;
    if (!web) continue;
    const title = web.title || web.uri;
    if (!title) continue;
    citations.push(web.uri ? { title, url: web.uri } : { title });
  }
  return { answer, queries, citations };
}

const PARSERS: Record<EndpointKind, (body: any) => Parsed> = {
  messages: parseMessages,
  responses: parseResponses,
  generateContent: parseGenerateContent,
};

// ---------------------------------------------------------------------------
// One dispatch
// ---------------------------------------------------------------------------

async function ask(req: AskRequest): Promise<Result> {
  const started = Date.now();
  try {
    const { kind, url } = endpointFor(req.model);
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${OPPER_API_KEY}`,
      "Content-Type": "application/json",
    };
    if (req.compact) headers["X-Opper-Compact-Response"] = "true";

    const tool = toolBlockFor(kind, req.engine);
    const body = buildBody(kind, req.model, req.question, tool);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const cost = parseCostHeader(res.headers);
    const raw = await res.text();
    let json: any;
    try { json = JSON.parse(raw); } catch { json = {}; }

    if (!res.ok) {
      const message =
        json?.error?.message ||
        (typeof json?.error === "string" ? json.error : null) ||
        `HTTP ${res.status}`;
      return {
        answer: "",
        queries: [],
        citations: [],
        cost,
        bytes: raw.length,
        ms: Date.now() - started,
        error: message,
      };
    }

    const parsed = PARSERS[kind](json);
    return {
      ...parsed,
      citations: dedupeCitations(parsed.citations),
      cost,
      bytes: raw.length,
      ms: Date.now() - started,
    };
  } catch (err: any) {
    return {
      answer: "", queries: [], citations: [],
      cost: null, bytes: 0, ms: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCostHeader(h: Headers): number | null {
  const v = h.get("X-Opper-Cost") || h.get("x-opper-cost");
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter(c => {
    const key = c.url || c.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// The page reads this on load to render the right model labels in the
// preset switcher without hardcoding env values in the HTML.
app.get("/api/defaults", (_req, res) => {
  res.json({
    anthropic: ANTHROPIC_MODEL,
    openai: OPENAI_MODEL,
    google: GOOGLE_MODEL,
    engines: ["native", "auto", "opper", "jina", "exa"],
  });
});

const VALID_ENGINES: Engine[] = ["native", "auto", "opper", "jina", "exa"];

app.post("/api/ask", async (req, res) => {
  const model: string = (req.body?.model || "").toString().trim();
  const engine: string = (req.body?.engine || "native").toString().trim();
  const question: string = (req.body?.question || "").toString().trim();
  if (!model)    return res.status(400).json({ error: "model is required" });
  if (!question) return res.status(400).json({ error: "question is required" });
  if (!VALID_ENGINES.includes(engine as Engine)) {
    return res.status(400).json({ error: `unknown engine: ${engine}` });
  }
  res.json(await ask({
    model,
    engine: engine as Engine,
    question,
    compact: !!req.body?.compact,
  }));
});

const PORT = await findPort(PREFERRED_PORT);
app.listen(PORT, () => {
  console.log(`server-tools-compare listening on http://localhost:${PORT}`);
});
