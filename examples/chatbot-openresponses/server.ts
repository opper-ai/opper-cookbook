/**
 * Chatbot server using the Opper OpenResponses endpoint directly via fetch(),
 * with image generation and text-to-speech tools powered by the Opper SDK.
 */

import express from "express";
import { Opper } from "opperai";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, existsSync } from "fs";
import { createServer } from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PREFERRED_PORT = parseInt(process.env.PORT || "3000");

/** Find the first available port starting from `start`. */
async function findPort(start: number, end = start + 20): Promise<number> {
  for (let port = start; port <= end; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, () => { srv.close(() => resolve(true)); });
    });
    if (available) return port;
  }
  return start; // fallback
}
const OPPER_API_KEY = process.env.OPPER_API_KEY;
const OPPER_BASE_URL = process.env.OPPER_BASE_URL || "https://api.opper.ai";
const MODEL = process.env.MODEL || "anthropic/claude-sonnet-4.6";

if (!OPPER_API_KEY) {
  console.error("OPPER_API_KEY is required");
  process.exit(1);
}

// Opper SDK — only used for media generation tools
const opper = new Opper();

// Ensure media output directory exists
const mediaDir = join(__dirname, "public", "media");
if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

// ---------------------------------------------------------------------------
// OpenResponses types (matching the /v3/compat/openresponses API spec)
// ---------------------------------------------------------------------------

interface InputItem {
  type: "message" | "function_call" | "function_call_output";
  role?: "user" | "assistant" | "system" | "developer";
  content?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

interface Tool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

interface ORRequest {
  model: string;
  instructions: string;
  input: InputItem[];
  tools: Tool[];
  stream: boolean;
  temperature?: number;
}

interface OutputItem {
  type: "message" | "function_call" | "reasoning";
  id?: string;
  role?: string;
  status?: string;
  content?: Array<{ type: string; text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
}

interface ORResponse {
  id: string;
  status: string;
  model: string;
  output: OutputItem[];
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  error?: { message: string; type: string };
}

// ---------------------------------------------------------------------------
// Tool definitions for the LLM
// ---------------------------------------------------------------------------

const tools: Tool[] = [
  {
    type: "function",
    name: "generate_image",
    description:
      "Generate an image from a text description. Use this when the user asks you to create, draw, generate, or visualize an image.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed description of the image to generate. Be specific about style, composition, colors, and mood.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    type: "function",
    name: "web_search",
    description:
      "Search the web for current information. Use this when the user asks about recent events, facts you're unsure about, or anything that benefits from up-to-date information.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "text_to_speech",
    description:
      "Convert text to spoken audio. Use this when the user asks you to read something aloud, speak, or generate audio.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to convert to speech.",
        },
      },
      required: ["text"],
    },
  },
];

// ---------------------------------------------------------------------------
// Session tracing — one root span per conversation, all turns nest under it
// ---------------------------------------------------------------------------

async function createSessionSpan(): Promise<{ spanId: string; traceId: string }> {
  const res = await fetch(`${OPPER_BASE_URL}/v3/spans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPPER_API_KEY}`,
    },
    body: JSON.stringify({ name: "chatbot-session" }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create session span: ${res.status}`);
  }

  const { data } = (await res.json()) as {
    data: { id: string; trace_id: string };
  };
  return { spanId: data.id, traceId: data.trace_id };
}

// ---------------------------------------------------------------------------
// Tool execution via Opper SDK
// ---------------------------------------------------------------------------

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  parentSpanId?: string,
): Promise<{ result: string; media?: { type: "image" | "audio"; url: string } }> {
  const timestamp = Date.now();

  if (name === "generate_image") {
    const image = await opper.generateImage({
      prompt: args.prompt as string,
      model: "openai/gpt-image-1",
      ...(parentSpanId && { parent_span_id: parentSpanId }),
    });
    const filename = `image-${timestamp}.png`;
    image.save(join(mediaDir, filename));
    return {
      result: `Image generated successfully.`,
      media: { type: "image", url: `/media/${filename}` },
    };
  }

  if (name === "web_search") {
    const results = await opper.beta.web.search({ query: args.query as string });
    const formatted = results.results.slice(0, 5).map(
      (r: { title: string; url: string; snippet: string }) =>
        `**${r.title}**\n${r.url}\n${r.snippet}`
    ).join("\n\n");
    return { result: formatted || "No results found." };
  }

  if (name === "text_to_speech") {
    const speech = await opper.textToSpeech({
      text: args.text as string,
      ...(parentSpanId && { parent_span_id: parentSpanId }),
    });
    const filename = `speech-${timestamp}.mp3`;
    speech.save(join(mediaDir, filename));
    return {
      result: `Audio generated successfully.`,
      media: { type: "audio", url: `/media/${filename}` },
    };
  }

  return { result: `Unknown tool: ${name}` };
}

// ---------------------------------------------------------------------------
// OpenResponses API call (non-streaming, used for the agentic loop)
// ---------------------------------------------------------------------------

async function callOpenResponses(
  input: InputItem[],
  sessionSpanId?: string,
): Promise<ORResponse> {
  const body: ORRequest = {
    model: MODEL,
    instructions:
      "You are a friendly, creative assistant. You can search the web, generate images, and speak text aloud using your tools. " +
      "Only use web search when the user explicitly asks you to look something up, or when you genuinely don't know the answer and current information is needed. " +
      "Do not search the web for general knowledge, greetings, or creative tasks — just answer directly. " +
      "When generating images, craft detailed prompts for the best results. " +
      "When using text-to-speech, pick the most relevant text to speak. " +
      "Keep your text responses concise and conversational.",
    input,
    tools,
    stream: false,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPPER_API_KEY}`,
    "X-Opper-Name": "chatbot-openresponses",
  };
  if (sessionSpanId) {
    headers["X-Opper-Parent-Span-Id"] = sessionSpanId;
  }

  const res = await fetch(`${OPPER_BASE_URL}/v3/compat/openresponses`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenResponses API error ${res.status}: ${text}`);
  }

  return (await res.json()) as ORResponse;
}

// ---------------------------------------------------------------------------
// Agentic loop — calls OpenResponses, executes tools, loops until text reply
// ---------------------------------------------------------------------------

async function agentLoop(
  conversationItems: InputItem[],
  sessionSpanId?: string,
): Promise<{ text: string; media: Array<{ type: "image" | "audio"; url: string }> }> {
  const items = [...conversationItems];
  const media: Array<{ type: "image" | "audio"; url: string }> = [];
  const maxIterations = 5;

  for (let i = 0; i < maxIterations; i++) {
    const response = await callOpenResponses(items, sessionSpanId);

    if (response.error) {
      throw new Error(`API error: ${response.error.message}`);
    }

    // Collect tool calls and text from this response
    const toolCalls = response.output.filter((o) => o.type === "function_call");
    const messages = response.output.filter((o) => o.type === "message");

    // No tool calls — return the text response
    if (toolCalls.length === 0) {
      const text = messages
        .flatMap((m) => m.content || [])
        .filter((c) => c.type === "output_text" && c.text)
        .map((c) => c.text!)
        .join("");
      return { text: text || "I'm not sure how to respond to that.", media };
    }

    // Execute tool calls and append results to conversation
    for (const tc of toolCalls) {
      // Add the function_call to conversation history
      items.push({
        type: "function_call",
        call_id: tc.call_id,
        name: tc.name,
        arguments: tc.arguments,
      });

      // Execute the tool
      let toolResult: Awaited<ReturnType<typeof executeTool>>;
      try {
        const args = JSON.parse(tc.arguments || "{}");
        toolResult = await executeTool(tc.name!, args, sessionSpanId);
      } catch (err) {
        toolResult = { result: `Tool error: ${err}` };
      }

      if (toolResult.media) {
        media.push(toolResult.media);
      }

      // Add function_call_output to conversation history
      items.push({
        type: "function_call_output",
        call_id: tc.call_id,
        output: JSON.stringify({ result: toolResult.result }),
      });
    }

    // Loop continues — the model will see the tool results and respond
  }

  return { text: "I ran out of steps trying to help. Please try again.", media };
}

// ---------------------------------------------------------------------------
// Express server
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Create a new session (returns a session ID for tracing)
app.post("/api/session", async (_req, res) => {
  try {
    const session = await createSessionSpan();
    console.log(`  New session: trace=${session.traceId} span=${session.spanId}`);
    res.json({ sessionId: session.spanId });
  } catch (err) {
    console.error("Session error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, sessionId } = req.body as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      sessionId?: string;
    };

    // Convert chat messages to OpenResponses input items
    const items: InputItem[] = messages.map((m) => ({
      type: "message" as const,
      role: m.role,
      content: m.content,
    }));

    const result = await agentLoop(items, sessionId);
    res.json(result);
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: String(err) });
  }
});

findPort(PREFERRED_PORT).then((port) => {
  app.listen(port, () => {
    console.log(`\n  Chatbot running at http://localhost:${port}\n`);
  });
});
