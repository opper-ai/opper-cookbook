# Training a Generative AI to Master Tic Tac Toe: A Real-Time Learning Experiment

We built a Tic Tac Toe AI that learns from every game you play, getting smarter with each victory through task completion improvement.

## The Core Concept: Task Completion with Built-in Improvement

Most AI game implementations require programming complex algorithms and decision trees. Our approach leverages task completion APIs with an automatic improvement mechanisms.

Instead of coding "if this board state, then do that move," we define:
- **Task**: "Complete the move prediction task"  
- **Improvement**: "Get better at this task through past successful examples"

The process:
1. Define a task completion function using Opper's API
2. Human plays against the AI attempting to complete its task
3. When human wins, feed successful completions back into the improvement system
4. AI progressively improves at completing the move prediction task

## The Task Completion Architecture

### Defining Task Completion

```python
# Task completion definition
function = await opper.functions.create(
    name="tic_tac_toe_predictor",
    instructions="You are a Tic Tac Toe move predictor. Your task is to analyze the board and predict the best move for the `next_player`."
    input_type=TicTacToeInput,
    output_type=TicTacToeOutput,
)
```

### Task Completion Schema

```python
class TicTacToeInput(BaseModel):
    board_state: list[list[str]] = Field(description="The current 3x3 board state where ' ' = empty, 'X' = X player, 'O' = O player.")
    next_player: str = Field(description="Which player has the next move: 'X' or 'O'.")

class TicTacToeOutput(BaseModel):
    thoughts: str = Field(description="Analysis of the board for the current player and why the predicted move is optimal.")
    predicted_move: list[int] = Field(description="The predicted best move for the player whose turn it is, as [row, col] coordinates.")
```

We define task completion criteria rather than programming game logic.

### Task Completion with Improvement

```python
# Task completion with few-shot learning from successful examples
result, _ = await opper.call(
    name=function._function.path,
    instructions=function._function.instructions,
    output_type=TicTacToeOutput,
    input_type=TicTacToeInput,
    input=input_data.model_dump(),
    configuration=CallConfiguration(
        invocation=CallConfiguration.Invocation(
            few_shot=CallConfiguration.Invocation.FewShot(count=5)
        )
    )
)
```

The API provides mechanisms for completing tasks and improving through successful examples.

## Improving Task Completion: Learning from Success

When you win a game, we create successful task completion examples:

```python
# Save human winning moves to dataset for AI learning
dataset = function.dataset()

for i, record in enumerate(game_history):
    is_final_move = (i == len(game_history) - 1)
    
    if is_final_move:
        thought = f"This winning move ({record['human_move'][0]},{record['human_move'][1]}) secured victory for {human_symbol}."
    else:
        thought = f"Strategic move ({record['human_move'][0]},{record['human_move'][1]}) as part of a winning game plan."
    
    example_data = {
        "input": {
            "board_state": record["board_state_before"],
            "next_player": human_symbol
        },
        "output": {
            "thoughts": thought,
            "predicted_move": list(record["human_move"])
        }
    }
    
    await dataset.add(DatasetEntry(
        input=json.dumps(example_data["input"]),
        output=json.dumps(example_data["output"])
    ))
```

Each example shows the system how to more successfully complete the move prediction task.

## Key Benefits

### 1. Focus on Completion, Not Implementation
No Tic Tac Toe strategy programming required. The system learns how to complete the task better through successful examples.

### 2. Built-in Improvement Mechanisms
```python
few_shot=CallConfiguration.Invocation.FewShot(count=5)
```
System automatically finds and uses relevant successful completions.

### 3. Self-Improving Performance
Each human victory provides more examples, automatically improving future task completion.

## Try It

```bash
pip install opperai python-dotenv
export OPPER_API_KEY="your_key"
python main.py
```
