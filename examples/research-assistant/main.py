"""Research Assistant — sample app exercising the opperai Python SDK."""

import sys
from pathlib import Path
from pydantic import BaseModel

from opperai import Opper


# ── Pydantic models for structured output ────────────────────────────────────

class SearchPlan(BaseModel):
    queries: list[str]


class Entities(BaseModel):
    people: list[str]
    organizations: list[str]
    concepts: list[str]


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python main.py <topic>")
        sys.exit(1)

    topic = " ".join(sys.argv[1:])
    opper = Opper()

    print(f"\n{'='*60}")
    print(f"  Research Assistant — topic: {topic}")
    print(f"{'='*60}\n")

    # ── 1. List models ───────────────────────────────────────────────────────
    print("① Listing available models...")
    models_resp = opper.models.list()
    for m in models_resp.models[:8]:
        print(f"   • {m.name}")
    print(f"   ... ({len(models_resp.models)} total)\n")

    # ── Wrap everything in a top-level trace ─────────────────────────────────
    with opper.trace("research-assistant", meta={"topic": topic}) as root_span:
        print(f"🔍 Trace started: {root_span.trace_id}\n")

        # ── 2. Web search ────────────────────────────────────────────────────
        print("② Searching the web...")
        with opper.trace("web-search"):
            search_results = opper.beta.web.search(query=topic)
            urls = []
            for r in search_results.results[:5]:
                print(f"   • {r.title}")
                print(f"     {r.url}")
                urls.append(r.url)
            print()

        # ── 3. Fetch top pages ───────────────────────────────────────────────
        print("③ Fetching top pages...")
        pages = []
        with opper.trace("web-fetch"):
            for url in urls[:3]:
                try:
                    page = opper.beta.web.fetch(url=url)
                    content = page.content[:3000]  # trim to keep things manageable
                    pages.append({"url": url, "content": content})
                    print(f"   ✓ Fetched {url[:60]}... ({len(page.content)} chars)")
                except Exception as e:
                    print(f"   ✗ Failed {url[:60]}...: {e}")
        print()

        # ── 4. Knowledge base ────────────────────────────────────────────────
        print("④ Setting up knowledge base...")
        with opper.trace("knowledge-base"):
            kb_name = f"research-{topic[:30].replace(' ', '-')}"
            try:
                kb = opper.knowledge.get_by_name(kb_name)
                print(f"   Reusing existing KB: {kb.id} ({kb.count} docs)")
            except Exception:
                kb = opper.knowledge.create(name=kb_name)
                print(f"   Created new KB: {kb.id}")

            for i, page in enumerate(pages):
                opper.knowledge.add(
                    kb.id,
                    content=page["content"],
                    metadata={"source": page["url"], "index": i},
                )
                print(f"   Added doc {i+1}/{len(pages)}")

            # Semantic query
            print(f"\n   Querying KB for: '{topic}'")
            results = opper.knowledge.query(kb.id, query=topic, top_k=3)
            relevant_text = ""
            for r in results:
                print(f"   [{r.score:.3f}] {r.content[:80]}...")
                relevant_text += r.content + "\n\n"
        print()

        # ── 5. Structured entity extraction ──────────────────────────────────
        print("⑤ Extracting entities (Pydantic structured output)...")
        with opper.trace("entity-extraction"):
            entity_result = opper.call(
                "research-extract-entities",
                input={
                    "text": relevant_text[:4000],
                    "instructions": f"Extract all notable entities related to '{topic}' from this text.",
                },
                output_schema=Entities,
                model="anthropic/claude-sonnet-4.6",
            )
            entities = entity_result.data
            print(f"   People:        {entities.people}")
            print(f"   Organizations: {entities.organizations}")
            print(f"   Concepts:      {entities.concepts}")
        print()

        # ── 6. Stream final report ───────────────────────────────────────────
        print("⑥ Streaming research report...\n")
        print("-" * 60)
        with opper.trace("stream-report"):
            full_report = ""
            for chunk in opper.stream(
                "research-write-report",
                input={
                    "topic": topic,
                    "findings": relevant_text[:4000],
                    "entities": entities.model_dump(),
                    "instructions": (
                        f"Write a concise research report about '{topic}' based on the findings. "
                        "Include sections: Overview, Key Players, Core Concepts, and Outlook. "
                        "Use markdown formatting."
                    ),
                },
                model="anthropic/claude-sonnet-4.6",
            ):
                match chunk.type:
                    case "content":
                        print(chunk.delta, end="", flush=True)
                        full_report += chunk.delta
                    case "done":
                        print(f"\n\n   [Tokens: {chunk.usage}]")
                    case "error":
                        print(f"\n   Error: {chunk.error}")
        print("-" * 60)
        print()

        # ── 7. Generate cover image ─────────────────────────────────────────
        print("⑦ Generating cover image...")
        with opper.trace("image-generation"):
            image = opper.generate_image(
                "research-cover-image",
                prompt=f"A professional, abstract illustration representing the concept of '{topic}'. Modern, clean design with subtle technology elements.",
                model="openai/gpt-image-1",
            )
            output_dir = Path("output")
            output_dir.mkdir(exist_ok=True)
            saved_path = image.save(str(output_dir / "cover-image"))
            print(f"   Saved to: {saved_path}")
        print()

        # ── 8. Function management ───────────────────────────────────────────
        print("⑧ Listing auto-created functions...")
        functions = opper.functions.list()
        research_fns = [f for f in functions if f.name.startswith("research-")]
        for fn in research_fns:
            print(f"   • {fn.name} (hits: {fn.hit_count})")
        print()

        # ── 9. Cleanup ──────────────────────────────────────────────────────
        print("⑨ Cleaning up knowledge base...")
        opper.knowledge.delete(kb.id)
        print(f"   Deleted KB {kb.id}")
        print()

    # ── 10. Trace info ───────────────────────────────────────────────────────
    print("⑩ Trace info:")
    print(f"   Trace ID: {root_span.trace_id}")
    print(f"   Root span: {root_span.id}")
    print(f"\n{'='*60}")
    print("  Done!")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
