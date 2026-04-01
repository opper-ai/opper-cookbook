/**
 * Content Analyzer — sample app exercising the opperai TypeScript SDK.
 *
 * Uses Zod schemas for structured output.
 * BUG: SDK does `import("zod")` but `toJSONSchema` is at `zod/v4`.
 * See FINDINGS.md for details.
 */

import { Opper } from "opperai";
import { z } from "zod";

// ── Zod schemas for structured output ───────────────────────────────────────

const SentimentSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral", "mixed"]),
  confidence: z.number(),
  reasoning: z.string(),
});

const EntitiesSchema = z.object({
  people: z.array(z.string()),
  organizations: z.array(z.string()),
  locations: z.array(z.string()),
});

const TopicsSchema = z.object({
  topics: z.array(z.string()),
  primaryTopic: z.string(),
});

const EmbeddingSchema = z.object({
  embedding: z.array(z.number()),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.log("Usage: npx tsx main.ts <url-or-text>");
    process.exit(1);
  }

  const opper = new Opper();
  const isUrl = input.startsWith("http://") || input.startsWith("https://");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Content Analyzer — input: ${input.slice(0, 50)}${input.length > 50 ? "..." : ""}`);
  console.log(`${"=".repeat(60)}\n`);

  // ── 1. List models ──────────────────────────────────────────────────────
  console.log("① Listing available models...");
  const modelsResp = await opper.models.listModels();
  for (const m of modelsResp.models.slice(0, 8)) {
    console.log(`   • ${m.name}`);
  }
  console.log(`   ... (${modelsResp.models.length} total)\n`);

  // ── Wrap everything in a traced session ─────────────────────────────────
  await opper.traced(
    { name: "content-analyzer", meta: { input: input.slice(0, 200) } },
    async (rootSpan) => {
      console.log(`🔍 Trace started: ${rootSpan.traceId}\n`);

      // ── 2. Get content ────────────────────────────────────────────────
      let content: string;
      if (isUrl) {
        console.log("② Fetching URL content...");
        const page = await opper.beta.web.fetch({ url: input });
        content = page.content.slice(0, 5000);
        console.log(`   Fetched ${page.content.length} chars from ${input}`);
      } else {
        console.log("② Using provided text...");
        content = input;
      }
      console.log();

      // ── 3. Parallel analysis ──────────────────────────────────────────
      console.log("③ Running parallel analyses...\n");

      const [sentimentResult, entitiesResult, topicsResult] = await Promise.all([
        opper.traced("sentiment-analysis", async () => {
          return opper.call("analyzer-sentiment", {
            input: {
              text: content,
              instructions:
                "Analyze the sentiment of this text. Provide the overall sentiment, your confidence (0-1), and brief reasoning.",
            },
            output_schema: SentimentSchema,
            model: "anthropic/claude-sonnet-4.6",
          });
        }),

        opper.traced("entity-extraction", async () => {
          return opper.call("analyzer-entities", {
            input: {
              text: content,
              instructions: "Extract all notable people, organizations, and locations from this text.",
            },
            output_schema: EntitiesSchema,
            model: "anthropic/claude-sonnet-4.6",
          });
        }),

        opper.traced("topic-classification", async () => {
          return opper.call("analyzer-topics", {
            input: {
              text: content,
              instructions:
                "Classify the topics discussed in this text. List all topics and identify the primary one.",
            },
            output_schema: TopicsSchema,
            model: "anthropic/claude-sonnet-4.6",
          });
        }),
      ]);

      const sentiment = sentimentResult.data;
      const entities = entitiesResult.data;
      const topics = topicsResult.data;

      console.log("   Sentiment:");
      console.log(`     ${sentiment.sentiment} (confidence: ${sentiment.confidence})`);
      console.log(`     "${sentiment.reasoning}"\n`);

      console.log("   Entities:");
      console.log(`     People: ${entities.people.join(", ") || "none"}`);
      console.log(`     Orgs:   ${entities.organizations.join(", ") || "none"}`);
      console.log(`     Places: ${entities.locations.join(", ") || "none"}\n`);

      console.log("   Topics:");
      console.log(`     Primary: ${topics.primaryTopic}`);
      console.log(`     All: ${topics.topics.join(", ")}\n`);

      // ── 4. Embeddings + similarity ────────────────────────────────────
      console.log("④ Computing embeddings & similarity...");
      await opper.traced("embeddings", async () => {
        const summaries = [
          `Sentiment: ${sentiment.sentiment} — ${sentiment.reasoning}`,
          `Entities: ${[...entities.people, ...entities.organizations].join(", ")}`,
          `Topics: ${topics.topics.join(", ")}`,
        ];

        const embeddings: number[][] = [];
        for (const text of summaries) {
          const r = await opper.call("analyzer-embed", {
            input: { text },
            output_schema: EmbeddingSchema,
            model: "openai/text-embedding-3-small",
          });
          embeddings.push(r.data.embedding);
        }

        const labels = ["Sentiment", "Entities", "Topics"];
        for (let i = 0; i < embeddings.length; i++) {
          for (let j = i + 1; j < embeddings.length; j++) {
            const sim = cosineSimilarity(embeddings[i], embeddings[j]);
            console.log(`   ${labels[i]} ↔ ${labels[j]}: ${sim.toFixed(4)}`);
          }
        }
      });
      console.log();

      // ── 5. Knowledge base ─────────────────────────────────────────────
      console.log("⑤ Setting up knowledge base...");
      const kbName = `analyzer-content`;
      let kb: { id: string };
      try {
        kb = await opper.knowledge.getByName(kbName);
        console.log(`   Reusing existing KB: ${kb.id}`);
      } catch {
        kb = await opper.knowledge.create({ name: kbName });
        console.log(`   Created new KB: ${kb.id}`);
      }

      await opper.traced("knowledge-base", async () => {
        await opper.knowledge.add(kb.id, {
          content: JSON.stringify(sentiment),
          metadata: { type: "sentiment" },
        });
        await opper.knowledge.add(kb.id, {
          content: JSON.stringify(entities),
          metadata: { type: "entities" },
        });
        await opper.knowledge.add(kb.id, {
          content: JSON.stringify(topics),
          metadata: { type: "topics" },
        });
        console.log("   Added 3 analysis documents");

        const results = await opper.knowledge.query(kb.id, {
          query: "What are the main themes and notable people?",
          top_k: 3,
        });
        console.log("   Query results:");
        for (const r of results) {
          console.log(`     [${r.score.toFixed(3)}] ${r.content.slice(0, 80)}...`);
        }
      });
      console.log();

      // ── 6. Stream comprehensive report ────────────────────────────────
      console.log("⑥ Streaming analysis report...\n");
      console.log("-".repeat(60));
      await opper.traced("stream-report", async () => {
        for await (const chunk of opper.stream("analyzer-report", {
          input: {
            content: content.slice(0, 3000),
            sentiment,
            entities,
            topics,
            instructions:
              "Write a concise content analysis report. Include sections: Summary, Sentiment Analysis, Key Entities, Topics & Themes, and Conclusion. Use markdown.",
          },
          model: "anthropic/claude-sonnet-4.6",
        })) {
          if (chunk.type === "content") {
            process.stdout.write(chunk.delta);
          }
          if (chunk.type === "done") {
            console.log(`\n\n   [Tokens: ${JSON.stringify(chunk.usage)}]`);
          }
          if (chunk.type === "error") {
            console.error(`\n   Error: ${chunk.error}`);
          }
        }
      });
      console.log("-".repeat(60));
      console.log();

      // ── 7. Text-to-Speech ─────────────────────────────────────────────
      console.log("⑦ Generating audio summary...");
      await opper.traced("text-to-speech", async () => {
        const spokenSummary = `Content analysis complete. The overall sentiment is ${sentiment.sentiment}. The primary topic is ${topics.primaryTopic}. Key entities include ${entities.people.slice(0, 3).join(", ") || entities.organizations.slice(0, 3).join(", ") || "various subjects"}.`;

        const tts = await opper.textToSpeech("analyzer-tts", {
          text: spokenSummary,
        });
        const savedPath = tts.save("output/analysis-summary");
        console.log(`   Saved audio to: ${savedPath}`);
      });
      console.log();

      // ── 8. Function management ────────────────────────────────────────
      console.log("⑧ Listing auto-created functions...");
      const funcsResp = await opper.functions.listFunctions();
      const analyzerFns = funcsResp.functions.filter((f: any) => f.name?.startsWith("analyzer-"));
      for (const fn of analyzerFns) {
        console.log(`   • ${fn.name} (hits: ${fn.hit_count})`);
      }

      if (analyzerFns.length > 0) {
        const first = analyzerFns[0];
        const revisionsResp = await opper.functions.listRevisions(first.name);
        console.log(`\n   Revisions for '${first.name}':`);
        for (const rev of revisionsResp.revisions) {
          console.log(`     rev ${rev.revision_id} (current: ${rev.is_current})`);
        }
      }
      console.log();

      // ── 9. Cleanup ────────────────────────────────────────────────────
      console.log("⑨ Cleaning up knowledge base...");
      await opper.knowledge.deleteKnowledgeBase(kb.id);
      console.log(`   Deleted KB ${kb.id}\n`);

      // ── 10. Trace info ────────────────────────────────────────────────
      console.log("⑩ Trace info:");
      console.log(`   Trace ID: ${rootSpan.traceId}`);
      console.log(`   Root span: ${rootSpan.id}`);
    }
  );

  console.log(`\n${"=".repeat(60)}`);
  console.log("  Done!");
  console.log(`${"=".repeat(60)}\n`);
}

main().catch(console.error);
