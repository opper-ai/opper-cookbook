# LangGraph Deep Research Pipeline

A rigorous AI-powered research pipeline built with [LangGraph](https://langchain-ai.github.io/langgraph/) and [Opper](https://opper.ai). This pipeline performs comprehensive web research by generating search queries, fetching web content, extracting facts, and synthesizing findings into well-cited reports.

## 🚀 Features

- **Multi-stage Research Pipeline**: Systematic approach with planning, searching, synthesis, and reporting
- **Intelligent Query Generation**: AI-powered creation of targeted search queries
- **Web Content Extraction**: Fetches full web page content and extracts relevant facts using AI
- **Iterative Refinement**: Identifies knowledge gaps and performs additional targeted searches
- **Citation Management**: Automatic source citation with inline references
- **Full Traceability**: Complete observability through Opper's tracing system
- **CLI Interface**: Multiple ways to interact with the pipeline

## 📁 Project Structure

```
examples/langgraph/
├── cli.py              # Command-line interface
├── research.py         # Main research orchestrator
├── pipeline.py         # LangGraph workflow definition
├── schemas.py          # Pydantic data models
├── nodes/              # Pipeline stage implementations
│   ├── planning.py     # Question analysis & query generation
│   ├── search.py       # Web search execution
│   ├── synthesis.py    # Result analysis & gap identification
│   ├── decision.py     # Continue/complete decision logic
│   └── reporting.py    # Final report generation
├── utils/              # Utility functions
│   └── web_search.py   # Search & content extraction
└── pyproject.toml      # Dependencies
```

## Example output

```

✅ Research Complete!
------------------------------------------------------------
📊 Trace ID: 0b75639f-8706-4155-8b43-d05daa8ffcfb
🔗 View trace at: https://platform.opper.ai/traces/0b75639f-8706-4155-8b43-d05daa8ffcfb

📋 Summary:
Opper.ai is a developer-focused AI infrastructure platform that enables reliable AI application development through a structured Task Completion API. Founded in 2023 by the engineering team behind Unomaly [10, 11], Opper has raised €2.5-3 million in pre-seed funding [10, 11, 12] and positions itself as making 'AI infrastructure as reliable as Stripe is for payments' [12]. The platform integrates with 80-100+ AI models [4, 5] and allows developers to define tasks using structured JSON rather than traditional prompt engineering [5, 10].

🔍 Key Findings:
Opper.ai is fundamentally a developer platform providing a Task Completion API for building reliable AI applications [4, 8]. The platform's core innovation is its structured approach to AI task completion, where developers define tasks using JSON specifications rather than crafting fragile prompts [5, 10]. This method improves reliability, consistency, and observability of AI-powered systems [10].

The company represents a significant technical background, having been founded in 2023 by the engineering team behind Unomaly, a machine learning observability platform that was acquired by LogicMonitor [10, 11]. Opper is headquartered in Stockholm, Sweden, and has secured substantial pre-seed funding totaling €2.5-3 million from venture capital investors [10, 11, 12].

From a technical perspective, Opper integrates with 80-100+ AI models while providing centralized billing and customization options for developers [4, 5]. They offer SDKs in Python and Node.js, complemented by comprehensive tools for quality assurance and evaluation to ensure robust performance in production environments [3, 7]. Their Task Completion API handles the complexities of prompting, retries, fallbacks, and evaluation processes [4].

Opper's target audience consists of developers who are building production-grade AI assistants, agents, and backend features requiring high reliability [8, 10, 13]. The platform aims to provide infrastructure that makes AI applications as dependable as Stripe makes payment processing [12].

💡 Conclusions:
Opper.ai addresses a critical gap in the current AI ecosystem by providing structured, reliable alternatives to traditional prompt engineering approaches. By abstracting away complexity through structured JSON task definitions, the platform enables developers to build more consistent and maintainable AI applications [5, 10].

With experienced founding leadership from Unomaly and substantial early funding, Opper demonstrates strong market positioning in the AI infrastructure space [10, 11, 12]. Their comprehensive approach—integrating model access, evaluation tools, production-ready capabilities—positions them as a complete solution for developers struggling with the fragility of current AI development paradigms.

As the AI industry matures toward enterprise adoption, platforms like Opper that solve foundational infrastructure challenges will likely play increasingly important roles in enabling reliable, production-grade AI applications. Their focus on reliability and structured development suggests a promising approach to overcoming current limitations in LLM-based systems [10].

📚 Citations:
  [1] Indexing Documents with Opper GitHub Actions
      https://docs.opper.ai/guides/index-docs-using-github-actions
      Accessed: 2025-09-01 09:22:50

  [2] Markdown version of docs - Opper AI
      https://docs.opper.ai/apis/ai-editors
      Accessed: 2025-09-01 09:22:50

  [3] opper.ai GitHub repository
      https://github.com/opper-ai
      Accessed: 2025-09-01 09:22:50

  [4] Opper Official Website
      https://opper.ai/
      Accessed: 2025-09-01 09:22:54

  [5] Opper AI: Stripe-Like Reliable AI Infrastructure
      https://futureteknow.com/opper-ai-reliable-ai-infrastructure/
      Accessed: 2025-09-01 09:22:54

  [6] Opper AI Crunchbase Profile
      https://www.crunchbase.com/organization/opper-ai
      Accessed: 2025-09-01 09:23:00

  [7] Tests and evals Documentation
      https://docs.opper.ai/capabilities/evaluations
      Accessed: 2025-09-01 09:23:00

  [8] Opper AI: 10 Key Things You Must Know
      https://zoonop.com/articles/opper-ai
      Accessed: 2025-09-01 09:23:14

  [9] Opper AI Introduces Structured Task API After $3M Pre-Seed Investment
      https://n24.com.tr/en/opper-ai-introduces-structured-task-api-after-3m-pre-seed-investment
      Accessed: 2025-09-01 09:23:14

  [10] Swedish startup Opper AI raises €2.5 million to make AI infrastructure as reliable as Stripe
      https://www.eu-startups.com/2025/07/swedish-startup-opper-ai-raises-e2-5-million-to-make-ai-infrastructure-as-reliable-as-stripe-is-for-payments/
      Accessed: 2025-09-01 09:23:14

  [11] Opper 2025 Company Profile: Valuation, Funding & Investors
      https://pitchbook.com/profiles/company/595964-53
      Accessed: 2025-09-01 09:23:20

📊 Research Statistics:
  Total sources cited: 11
  Successful fact extractions: 11/18
  Total facts extracted: 132
  Average facts per source: 7

✅ Research completed successfully!
📊 Quick Stats:
  • Sources found: 18
  • Citations: 11
```

## 🛠️ Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd opper-cookbook/examples/langgraph
   ```

2. **Install dependencies:**
   ```bash
   # Using uv (recommended)
   uv sync
   
   # Or using pip
   pip install -e .
   ```

3. **Set up your Opper API key:**
   ```bash
   export OPPER_API_KEY="your_api_key_here"
   ```
   
   Get your API key from [Opper Platform](https://platform.opper.ai)

## 🎯 Usage

### CLI Interface

The pipeline provides a flexible CLI with multiple input methods:

#### 1. Direct Question
```bash
python3 cli.py --question "What are the benefits of renewable energy?"
```

#### 2. Interactive Mode
```bash
python3 cli.py --interactive
```
Allows you to ask multiple questions in sequence.

#### 3. Stdin Input
```bash
echo "What is the current state of AI research?" | python3 cli.py --stdin
```

#### 4. Default Prompt
```bash
python3 cli.py
```
Prompts you to enter a question interactively.

### Python API

You can also use the research function directly in your Python code:

```python
from research import research

result = research("What are the latest developments in quantum computing?")

if result["step"] == "complete":
    print("Research completed!")
    print(f"Report: {result['final_report']['executive_summary']}")
    print(f"Citations: {len(result['final_report']['citations'])}")
    print(f"Trace: https://platform.opper.ai/traces/{result['span_id']}")
```

## 🔄 Pipeline Flow

The research pipeline follows this systematic approach:

1. **Planning** (`planning.py`)
   - Analyzes the research question
   - Generates targeted search queries
   - Creates research profile

2. **Search** (`search.py`)
   - Executes web searches using DuckDuckGo
   - Fetches full page content from results
   - Extracts relevant facts using AI

3. **Synthesis** (`synthesis.py`)
   - Analyzes all gathered information
   - Identifies knowledge gaps
   - Prepares sources for citation

4. **Decision** (`decision.py`)
   - Determines if additional research is needed
   - Routes to additional search or final reporting

5. **Reporting** (`reporting.py`)
   - Generates comprehensive research report
   - Includes inline citations and bibliography
   - Provides executive summary and key findings

## 📊 Output Format

The pipeline generates structured research reports including:

- **Executive Summary**: Concise overview of findings
- **Key Findings**: Main insights with citations
- **Supporting Evidence**: Detailed information and data
- **Citations**: Numbered references with URLs and access dates
- **Methodology Notes**: Search queries and source statistics

Example output structure:
```python
{
    "step": "complete",
    "final_report": {
        "executive_summary": "...",
        "key_findings": ["...", "..."],
        "supporting_evidence": ["...", "..."],
        "citations": [
            {
                "number": 1,
                "title": "Source Title",
                "url": "https://...",
                "accessed_date": "2024-01-15"
            }
        ]
    },
    "search_results": [...],
    "span_id": "trace_id_for_observability"
}
```

## 🔍 Observability

All pipeline operations are fully traced using Opper's tracing system:

- **Main Trace**: Overall research session
- **Planning Spans**: Question analysis and query generation
- **Search Spans**: Web search and content extraction phases
- **Fact Extraction Spans**: AI-powered fact extraction from each source
- **Synthesis Spans**: Information analysis and gap identification
- **Reporting Spans**: Final report generation

Access traces at: `https://platform.opper.ai/traces/{span_id}`

## ⚙️ Configuration

### Models Used

The pipeline uses different models optimized for each task:
- **Query Generation**: `fireworks/glm-4.5-air`
- **Fact Extraction**: `gcp/gemini-2.0-flash`
- **Synthesis & Reporting**: `fireworks/glm-4.5-air`

### Search Parameters

- **Max Results per Query**: 3 sources
- **Content Length Limit**: 10,000 characters per page
- **Fact Extraction**: Key facts, supporting data, and relevant quotes
- **Additional Search**: Up to 2 sources per knowledge gap

## 🧪 Examples

### Climate Research
```bash
python3 cli.py -q "What are the main causes and effects of climate change?"
```

### Technology Trends
```bash
python3 cli.py -q "What are the latest trends in artificial intelligence for 2024?"
```

### Health & Medicine
```bash
python3 cli.py -q "What are the benefits and risks of intermittent fasting?"
```

## 🔧 Development

### Running Tests
```bash
# Test the pipeline with a simple question
python3 simple_example.py
```

### Adding New Features

1. **New Pipeline Stage**: Add to `nodes/` directory
2. **Update Pipeline**: Modify `pipeline.py` to include new stage
3. **Update Schemas**: Add any new data models to `schemas.py`
4. **Update CLI**: Enhance `cli.py` for new functionality

### Debugging

- Use the trace URL provided in output to debug pipeline execution
- Enable debug prints by modifying individual node files
- Check Opper platform for detailed span information

## 📝 Dependencies

Key dependencies include:
- `langgraph`: Workflow orchestration
- `opperai`: AI calls and tracing
- `ddgs`: DuckDuckGo search
- `requests`: Web content fetching
- `beautifulsoup4`: HTML parsing
- `pydantic`: Data validation

See `pyproject.toml` for complete dependency list.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is part of the Opper Cookbook and follows its licensing terms.

---

For questions or issues, please refer to the [Opper Documentation](https://docs.opper.ai) or raise an issue in the repository.
