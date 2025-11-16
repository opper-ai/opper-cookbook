## Chat with Feedback

This example shows a minimal **chat loop** that:

- **Calls an Opper function** (`chat_with_feedback`) with a conversation history
- **Displays the assistant answer** to the user
- **Asks the user if they liked the answer**
- **Saves liked answers** back to the function dataset as training examples

### How it works

- `ChatInput` / `ChatOutput` are defined with Pydantic, including a `thoughts` field in the output.
- `chat_call()` wraps a single `opper.call()`:
  - `name="chat_with_feedback"`
  - `input_schema=ChatInput`
  - `output_schema=ChatOutput`
  - `configuration={"invocation.few_shot.count": 3}`
- The first call **creates the function automatically** in Opper.
- When the user likes an answer, the example is saved via `opper.datasets.create_entry(...)`.

### Run the example

1. **Set your API key**:

```bash
export OPPER_API_KEY="your_api_key"
```

2. **Run the script**:

```bash
cd examples/chat-with-feedback
python main.py
```

3. **Chat**:
   - Type your messages at the `You:` prompt.
   - Read the assistant answer.
   - When prompted, type `y` if you liked the answer, `n` otherwise.
   - Liked answers are stored as dataset entries and can later be used as examples.


