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
    instructions=(
        "Complete a Tic Tac Toe move prediction task. "
        "Given the current board_state and next_player, "
        "determine the optimal move."
    ),
    input_type=TicTacToeInput,
    output_type=TicTacToeOutput,
)
```

### Task Completion Schema

```python
class TicTacToeInput(BaseModel):
    board_state: list[list[str]]  # Current 3x3 board
    next_player: str              # Who moves next: 'X' or 'O'

class TicTacToeOutput(BaseModel):
    thoughts: str                 # Reasoning behind task completion
    predicted_move: list[int]     # Task completion result
```

We define task completion criteria rather than programming game logic.

### Task Completion with Improvement

```python
# Task completion with few-shot learning from successful examples
result, _ = await opper.call(
    name=function.path,
    input=current_position,
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
for move in your_winning_game:
    dataset.add({
        "input": {
            "board_state": position_before_move,
            "next_player": your_symbol
        },
        "output": {
            "thoughts": "How I successfully completed this task...",
            "predicted_move": your_successful_move
        }
    })
```

Each example shows the system how to more successfully complete the move prediction task.

### Task Completion vs Traditional Programming

**Traditional Approach**:
```python
def choose_move(board, player):
    if can_win(board, player):
        return winning_move(board, player)
    elif opponent_can_win(board):
        return blocking_move(board)
    # ... dozens more programmed rules
```

**Task Completion Approach**:
```python
# Define task completion criteria
instructions = "Complete the move prediction task successfully"

# System improves task completion through examples
result = await opper.call(task_input)
```

## Key Benefits

### 1. Focus on Completion, Not Implementation
No Tic Tac Toe strategy programming required. The system learns how to complete the task better through successful examples.

### 2. Built-in Improvement Mechanisms
```python
few_shot=CallConfiguration.Invocation.FewShot(count=5)
```
System automatically finds and uses relevant successful completions.

### 3. Automatic Pattern Recognition
The system identifies patterns in successful task completions:
- Blocking moves lead to successful outcomes
- Center moves often result in success
- Fork creation improves completion rates

### 4. Self-Improving Performance
Each human victory provides more examples, automatically improving future task completion.

## Code Simplicity

The entire system in 180 lines:

- Task completion definition: ~20 lines
- Core game logic: ~50 lines
- Task improvement system: ~40 lines  
- Task completion loop: ~70 lines

### Broader Applications
This approach generalizes to other domains:
- Chess move prediction task completion
- Code review task completion
- Content generation task completion
- Data analysis task completion

## Try It

```bash
pip install opperai python-dotenv
export OPPER_API_KEY="your_key"
python main.py
```

## Conclusion

This experiment demonstrates task completion APIs with automatic improvement mechanisms. Instead of programming algorithms, we:

1. Defined task completion criteria
2. Provided examples of successful completion  
3. Let the system improve through pattern recognition
4. Achieved expert performance without strategy code

The approach focuses on what constitutes successful task completion, letting the system learn to complete tasks better over time.

---

*Built with [Opper](https://opper.ai) - task completion API with built-in improvement mechanisms.*
