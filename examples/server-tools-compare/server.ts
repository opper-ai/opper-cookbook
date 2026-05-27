/**
 * Server-tools compare: fans the same question out to Anthropic, OpenAI,
 * and Google server-side web search through Opper's compat endpoints,
 * then returns the three answers + citations + costs side by side.
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

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "anthropic/claude-sonnet-4-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "openai/gpt-5";
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

interface ProviderResult {
  answer: string;
  cost: number | null;       // dollars, from X-Opper-Cost
  ms: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Anthropic — POST /v3/compat/v1/messages with web_search_20250305
// ---------------------------------------------------------------------------

async function askAnthropic(question: string): Promise<ProviderResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${OPPER_BASE_URL}/v3/compat/v1/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPPER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: question }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      }),
    });
    const cost = parseCostHeader(res.headers);
    const body = await res.json() as any;
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);

    const answer = (body.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    return { answer, cost, ms: Date.now() - started };
  } catch (err: any) {
    return { answer: "", cost: null, ms: Date.now() - started, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// OpenAI — POST /v3/compat/responses with {type:"web_search"}
// ---------------------------------------------------------------------------

async function askOpenAI(question: string): Promise<ProviderResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${OPPER_BASE_URL}/v3/compat/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPPER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: question,
        tools: [{ type: "web_search" }],
      }),
    });
    const cost = parseCostHeader(res.headers);
    const body = await res.json() as any;
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);

    const answer = body.output_text
      || (body.output || [])
        .flatMap((item: any) => item.type === "message" ? (item.content || []) : [])
        .filter((p: any) => p.type === "output_text")
        .map((p: any) => p.text || "")
        .join("");
    return { answer, cost, ms: Date.now() - started };
  } catch (err: any) {
    return { answer: "", cost: null, ms: Date.now() - started, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Google — POST /v3/compat/v1beta/models/{model}:generateContent with googleSearch
// ---------------------------------------------------------------------------

async function askGoogle(question: string): Promise<ProviderResult> {
  const started = Date.now();
  try {
    const url = `${OPPER_BASE_URL}/v3/compat/v1beta/models/${encodeURIComponent(GOOGLE_MODEL)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPPER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: question }] }],
        tools: [{ googleSearch: {} }],
      }),
    });
    const cost = parseCostHeader(res.headers);
    const body = await res.json() as any;
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);

    const answer = (body.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || "")
      .join("");
    return { answer, cost, ms: Date.now() - started };
  } catch (err: any) {
    return { answer: "", cost: null, ms: Date.now() - started, error: err.message };
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

// ---------------------------------------------------------------------------
// Express plumbing
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.post("/api/ask", async (req, res) => {
  const question: string = (req.body?.question || "").toString().trim();
  if (!question) return res.status(400).json({ error: "question is required" });

  const [anthropic, openai, google] = await Promise.all([
    askAnthropic(question),
    askOpenAI(question),
    askGoogle(question),
  ]);

  res.json({ anthropic, openai, google });
});

const PORT = await findPort(PREFERRED_PORT);
app.listen(PORT, () => {
  console.log(`server-tools-compare listening on http://localhost:${PORT}`);
});
