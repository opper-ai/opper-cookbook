/**
 * Server-tools compare: fans the same question out to Anthropic, OpenAI,
 * and Google server-side web search through Opper's compat endpoints,
 * then returns the three answers + queries + citations + costs side by side.
 *
 * Each provider runs its tool internally — no client-side round trip —
 * so this is a tight demo of what server-side tools actually buy you
 * vs the function-tool pattern.
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

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "anthropic/claude-sonnet-4-6";
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
// Response shape returned to the browser
// ---------------------------------------------------------------------------

interface Citation {
  title: string;
  url?: string; // optional — compact mode strips Google groundingChunk URIs
}

interface ProviderResult {
  answer: string;
  queries: string[];     // search queries the provider actually issued
  citations: Citation[]; // sources the answer is grounded in
  cost: number | null;   // dollars, from X-Opper-Cost
  bytes: number;         // size of the upstream response body
  ms: number;
  error?: string;
}

interface AskOptions {
  compact: boolean;
}

function compatHeaders(opts: AskOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${OPPER_API_KEY}`,
    "Content-Type": "application/json",
  };
  if (opts.compact) headers["X-Opper-Compact-Response"] = "true";
  return headers;
}

// ---------------------------------------------------------------------------
// Anthropic — POST /v3/compat/v1/messages with web_search_20250305
//
// Response shape (post phase-2):
//   content: [
//     { type:"server_tool_use", name:"web_search", input:{query} },
//     { type:"web_search_tool_result", content:[{type:"web_search_result", url, title, ...}] },
//     { type:"text", text, citations?:[{type:"web_search_result_location", url, title, cited_text, ...}] },
//     ...
//   ]
// ---------------------------------------------------------------------------

async function askAnthropic(question: string, opts: AskOptions): Promise<ProviderResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${OPPER_BASE_URL}/v3/compat/v1/messages`, {
      method: "POST",
      headers: compatHeaders(opts),
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: question }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      }),
    });
    const cost = parseCostHeader(res.headers);
    const raw = await res.text();
    const body = JSON.parse(raw) as any;
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);

    let answer = "";
    const queries: string[] = [];
    const citations: Citation[] = [];

    for (const block of body.content || []) {
      if (block.type === "text") {
        answer += block.text || "";
        for (const c of block.citations || []) {
          if (c.url) citations.push({ title: c.title || c.url, url: c.url });
        }
      } else if (block.type === "server_tool_use" && block.name === "web_search") {
        const q = block.input?.query;
        if (typeof q === "string") queries.push(q);
      }
    }
    return { answer, queries, citations: dedupeCitations(citations), cost, bytes: raw.length, ms: Date.now() - started };
  } catch (err: any) {
    return { answer: "", queries: [], citations: [], cost: null, bytes: 0, ms: Date.now() - started, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// OpenAI — POST /v3/compat/responses with {type:"web_search"}
//
// Response shape (post phase-2):
//   output: [
//     { type:"web_search_call", action:{type:"search", queries:[...]} },
//     { type:"message", content:[{type:"output_text", text, annotations:[
//         { type:"url_citation", url, title, start_index, end_index }
//       ]}] },
//   ]
// ---------------------------------------------------------------------------

async function askOpenAI(question: string, opts: AskOptions): Promise<ProviderResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${OPPER_BASE_URL}/v3/compat/responses`, {
      method: "POST",
      headers: compatHeaders(opts),
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: question,
        tools: [{ type: "web_search" }],
      }),
    });
    const cost = parseCostHeader(res.headers);
    const raw = await res.text();
    const body = JSON.parse(raw) as any;
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);

    let answer = "";
    const queries: string[] = [];
    const citations: Citation[] = [];

    for (const item of body.output || []) {
      if (item.type === "web_search_call") {
        const qs = item.action?.queries;
        if (Array.isArray(qs)) for (const q of qs) if (typeof q === "string") queries.push(q);
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
    return { answer, queries, citations: dedupeCitations(citations), cost, bytes: raw.length, ms: Date.now() - started };
  } catch (err: any) {
    return { answer: "", queries: [], citations: [], cost: null, bytes: 0, ms: Date.now() - started, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Google — POST /v3/compat/v1beta/models/{model}:generateContent with googleSearch
//
// Response shape (post phase-2):
//   candidates: [{
//     content: { parts: [{text}, ...] },
//     groundingMetadata: {
//       webSearchQueries: [...],
//       groundingChunks: [{web:{uri, title}}, ...],
//       searchEntryPoint: {...},
//     }
//   }]
// ---------------------------------------------------------------------------

async function askGoogle(question: string, opts: AskOptions): Promise<ProviderResult> {
  const started = Date.now();
  try {
    const url = `${OPPER_BASE_URL}/v3/compat/v1beta/models/${encodeURIComponent(GOOGLE_MODEL)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: compatHeaders(opts),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: question }] }],
        tools: [{ googleSearch: {} }],
      }),
    });
    const cost = parseCostHeader(res.headers);
    const raw = await res.text();
    const body = JSON.parse(raw) as any;
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);

    const candidate = body.candidates?.[0];
    const answer = (candidate?.content?.parts || [])
      .map((p: any) => p.text || "")
      .join("");
    const gm = candidate?.groundingMetadata || {};
    const queries: string[] = Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.filter((q: any) => typeof q === "string") : [];
    const citations: Citation[] = [];
    for (const chunk of gm.groundingChunks || []) {
      const web = chunk.web;
      if (!web) continue;
      const title = web.title || web.uri;
      if (!title) continue;
      citations.push(web.uri ? { title, url: web.uri } : { title });
    }
    return { answer, queries, citations: dedupeCitations(citations), cost, bytes: raw.length, ms: Date.now() - started };
  } catch (err: any) {
    return { answer: "", queries: [], citations: [], cost: null, bytes: 0, ms: Date.now() - started, error: err.message };
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
// Express plumbing
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// One endpoint per provider so the browser can fire all three in parallel
// and paint each column the moment its provider finishes — no waiting on
// the slowest. The shape of every response is the same ProviderResult JSON.
const ASKERS: Record<string, (q: string, o: AskOptions) => Promise<ProviderResult>> = {
  anthropic: askAnthropic,
  openai: askOpenAI,
  google: askGoogle,
};

app.post("/api/ask/:provider", async (req, res) => {
  const asker = ASKERS[req.params.provider];
  if (!asker) return res.status(404).json({ error: `unknown provider: ${req.params.provider}` });
  const question: string = (req.body?.question || "").toString().trim();
  if (!question) return res.status(400).json({ error: "question is required" });
  const opts: AskOptions = { compact: !!req.body?.compact };
  res.json(await asker(question, opts));
});

const PORT = await findPort(PREFERRED_PORT);
app.listen(PORT, () => {
  console.log(`server-tools-compare listening on http://localhost:${PORT}`);
});
