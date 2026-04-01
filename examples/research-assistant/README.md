# Research Assistant

A Python example that builds an AI-powered research assistant using the Opper SDK v3. Given a topic, it searches the web, fetches pages, stores them in a knowledge base, extracts entities, and streams a final research report.

## Features demonstrated

- **Web search & fetch** — `opper.beta.web.search()` and `opper.beta.web.fetch()`
- **Knowledge base** — create, add documents, semantic query, delete
- **Structured output** — Pydantic models as `output_schema`
- **Streaming** — token-by-token report generation with `opper.stream()`
- **Image generation** — `opper.generate_image()`
- **Tracing** — nested spans with `opper.trace()` context manager
- **Function management** — listing auto-created functions

## Prerequisites

- Python 3.10+
- An [Opper](https://opper.ai) API key (set `OPPER_API_KEY` env var)

## Run

```bash
uv run main.py "artificial intelligence safety"
```

Or with pip:

```bash
pip install -e .
python main.py "artificial intelligence safety"
```
