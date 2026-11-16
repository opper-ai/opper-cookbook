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
        relevant_text = "\n\n".join(page["content"] for page in pages)
        print()

        # ── 4. Structured entity extraction ──────────────────────────────────
        print("④ Extracting entities (Pydantic structured output)...")
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

        # ── 5. Stream final report ───────────────────────────────────────────
        print("⑤ Streaming research report...\n")
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

        # ── 6. Generate cover image ─────────────────────────────────────────
        print("⑥ Generating cover image...")
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

        # ── 7. Function management ───────────────────────────────────────────
        print("⑦ Listing auto-created functions...")
        functions = opper.functions.list()
        research_fns = [f for f in functions if f.name.startswith("research-")]
        for fn in research_fns:
            print(f"   • {fn.name} (hits: {fn.hit_count})")
        print()

    # ── 8. Trace info ────────────────────────────────────────────────────────
    print("⑧ Trace info:")
    print(f"   Trace ID: {root_span.trace_id}")
    print(f"   Root span: {root_span.id}")
    print(f"\n{'='*60}")
    print("  Done!")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
