# Bootstrap Example Generator

An interactive CLI tool for bootstrapping training examples for AI tasks using Opper's in-context learning capabilities.

## Overview

This tool helps you quickly create quality training examples by:

1. **Generating synthetic examples** from your input cases
2. **Collecting your feedback** with ratings (1-5) and comments
3. **Refining examples** based on your feedback using AI
4. **Saving perfect examples (5/5)** automatically

## Architecture

- **`engine.py`** - Reusable bootstrapping engine (no changes needed)
- **`bootstrap_*.py`** - Your invocation scripts (one per task)
  - Define your call (`make_call` function)
  - Define your input cases (`INPUT_CASES`)
  - Define schemas and helper functions
  - Run the engine

## Quick Start

1. Create your invocation script (copy `bootstrap_changelog.py` as a template):

```python
from engine import BootstrapEngine
from opperai import Opper
from pydantic import BaseModel, Field
# ... your schemas ...

# Define your call
def make_call(opper, input_data, examples=None):
    return opper.call(
        name="your_task",  # This function name will be used to save examples to its dataset
        instructions="Your instructions...",
        input_schema=YourInputSchema,
        output_schema=YourOutputSchema,
        input=input_data,
        examples=examples,
    )

# Define your input cases
INPUT_CASES = [
    {"field": "value1"},
    {"field": "value2"},
    # ... more cases ...
]

# Helper functions
def convert_input(raw_input) -> dict:
    return raw_input

def format_output(output: dict) -> str:
    return str(output)

# Run
engine = BootstrapEngine(
    make_call_func=make_call,
    synthetic_inputs=INPUT_CASES,
    ...,
    function_name="your_task"  # Optional: explicitly set function name
)
engine.run(opper)
```

**Note:** The function must exist in Opper (created via `opper.functions.create()` or automatically via the first `opper.call()`). Examples rated 5/5 will be automatically saved to the function's dataset.

2. Set your API key:
```bash
export OPPER_API_KEY='your_api_key'
```

3. Run it:
```bash
python bootstrap_your_task.py
```

## Example

See `bootstrap_changelog.py` for a complete example that:
- Takes git commits as input
- Generates markdown changelogs
- Includes all schemas, calls, and input cases in one file

### Running the changelog example

1. **Install dependencies** (from the repo root, if you haven't already):

```bash
pip install -e .
```

2. **Set your API key**:

```bash
export OPPER_API_KEY="your_api_key"
```

3. **Run the changelog bootstrapper**:

```bash
cd examples/bootstrap
python bootstrap_changelog.py
```

The CLI will:

- Auto-generate synthetic commit histories from the `CommitInput` / `GitCommit` schemas  
- Call the `generate_changelog` function using Opper  
- Show you each generated example and ask for a **1–5 rating** and optional comments  
- Save only the **5/5 examples** back to the function dataset in Opper

## Features

- 🤖 AI-powered example generation
- 💬 Interactive feedback collection
- 🔄 Automatic refinement based on feedback
- 💾 Automatic saving of approved examples (5/5 only)
- 📊 Few-shot learning ready (examples will be used in production calls)

## Customization

In your invocation script, customize:

1. **Schemas**: Define `INPUT_SCHEMA` and `OUTPUT_SCHEMA`
2. **Call**: Write your `make_call()` function with your `opper.call()`
3. **Input Cases**: List your `INPUT_CASES` - these are randomly selected during bootstrapping
4. **Helpers**: Adjust `convert_input`, `format_output`, `save_input`, `save_output` as needed

The engine handles all the interactive logic automatically!
