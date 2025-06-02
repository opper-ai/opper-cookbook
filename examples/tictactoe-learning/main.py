import random
import asyncio
import os
import json
from pydantic import BaseModel, Field
from opperai import AsyncOpper, trace
from opperai.types.datasets import DatasetEntry
from opperai.types import CallConfiguration
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Opper client
opper = AsyncOpper()

# Pydantic models for Opper function
class TicTacToeInput(BaseModel):
    board_state: list[list[str]] = Field(description="The current 3x3 board state where ' ' = empty, 'X' = X player, 'O' = O player.")
    next_player: str = Field(description="Which player has the next move: 'X' or 'O'.")

class TicTacToeOutput(BaseModel):
    thoughts: str = Field(description="Analysis of the board for the current player and why the predicted move is optimal.")
    predicted_move: list[int] = Field(description="The predicted best move for the player whose turn it is, as [row, col] coordinates.")

def print_board(board):
    """Prints the Tic Tac Toe board."""
    print("\nBoard:")
    for r_idx in range(3):
        row_str = []
        for c_idx in range(3):
            cell = board[r_idx][c_idx]
            if cell == " ":
                row_str.append(str(r_idx * 3 + c_idx))
            else:
                row_str.append(cell)
        print(" | ".join(row_str))
        if r_idx < 2:
            print("---------")
    print()

def check_winner(board, player):
    # Check rows, columns, and diagonals
    for row in board:
        if all(s == player for s in row):
            return True
    for col in range(3):
        if all(board[r][col] == player for r in range(3)):
            return True
    if all(board[i][i] == player for i in range(3)):
        return True
    if all(board[i][2 - i] == player for i in range(3)):
        return True
    return False

def is_board_full(board):
    return all(all(cell != " " for cell in row) for row in board)

def get_empty_cells(board):
    empty = []
    for r_idx in range(3):
        for c_idx in range(3):
            if board[r_idx][c_idx] == " ":
                empty.append((r_idx, c_idx))
    return empty

def player_move(board):
    while True:
        try:
            move_str = input("Enter your move (0-8): ")
            cell_num = int(move_str)
            if not (0 <= cell_num <= 8):
                print("Please enter a number between 0-8.")
                continue
            row, col = divmod(cell_num, 3)
            
            if board[row][col] == " ":
                return row, col
            else:
                print("Cell is already taken. Try again.")
        except ValueError:
            print("Please enter a valid number (0-8).")

async def setup_ai_function():
    """Setup the Tic Tac Toe AI function."""
    function_name = "tic_tac_toe_predictor"
    
    try:
        function = await opper.functions.get(name=function_name)
        if function:
            return function
    except:
        pass
    
    # Create new function
    function = await opper.functions.create(
        name=function_name,
        instructions=(
            "You are a Tic Tac Toe move predictor. Your task is to analyze the board and predict the best move for the `next_player`. "
            "GOAL: Given the current `board_state` and `next_player`, determine the optimal move for `next_player`. "
            "INPUT: You receive the current board state where ' ' represents empty cells, 'X' represents X moves, 'O' represents O moves, and `next_player` indicates whose turn it is. "
            "OUTPUT: Return your analysis in `thoughts` and the `predicted_move` for `next_player` as [row, col] coordinates (0-indexed). "
            "CONSTRAINTS: `predicted_move` MUST be a valid empty cell on the board. "
            "Your `thoughts` should explain why this is the best move for `next_player` considering the current board and strategy (win, block, fork, strategic)."
        ),
        input_type=TicTacToeInput,
        output_type=TicTacToeOutput,
    )
    return function

async def save_winning_moves(function, game_history, human_symbol):
    """Save human winning moves to dataset for AI learning."""
    try:
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
        
        print(f"🧠 Saved {len(game_history)} winning moves to AI dataset!")
        
    except Exception as e:
        print(f"⚠️ Could not save to dataset: {e}")

async def ai_move(board, ai_symbol, function):
    """AI makes a move using Opper prediction."""
    empty_cells = get_empty_cells(board)
    if not empty_cells:
        return None

    input_data = TicTacToeInput(
        board_state=board,
        next_player=ai_symbol
    )

    try:
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
        
        chosen_move = result.predicted_move
        print(f"AI thinks: {result.thoughts}")

        # Validate the move
        if (isinstance(chosen_move, list) and len(chosen_move) == 2 and 
            0 <= chosen_move[0] < 3 and 0 <= chosen_move[1] < 3 and
            board[chosen_move[0]][chosen_move[1]] == " "):
            return tuple(chosen_move)
        else:
            print(f"AI predicted invalid move: {chosen_move}")
            return None

    except Exception as e:
        print(f"AI error: {e}")
        return None

@trace(name="play_game")
async def play_game():
    board = [[" " for _ in range(3)] for _ in range(3)]
    
    # Randomize who goes first
    if random.choice([True, False]):
        human_symbol = "X"
        ai_symbol = "O"
        current_player = "human"
        print("🎲 You go first as X!")
    else:
        human_symbol = "O"
        ai_symbol = "X"
        current_player = "ai"
        print("🎲 AI goes first as X!")

    print(f"🎮 Tic Tac Toe - You: {human_symbol}, AI: {ai_symbol}")

    # Setup AI function
    function = await setup_ai_function()
    if not function:
        print("❌ Could not setup AI function")
        return

    # Track human moves for learning
    game_history = []

    while True:
        print_board(board)

        if current_player == "human":
            print(f"Your turn ({human_symbol}):")
            
            # Record board state before human move
            board_before_move = [row[:] for row in board]
            
            row, col = player_move(board)
            board[row][col] = human_symbol
            
            # Record the human move
            game_history.append({
                "board_state_before": board_before_move,
                "human_move": (row, col)
            })
            
            if check_winner(board, human_symbol):
                print_board(board)
                print("🎉 You won!")
                await save_winning_moves(function, game_history, human_symbol)
                break
        else:
            print(f"AI's turn ({ai_symbol}):")
            move = await ai_move(board, ai_symbol, function)
            
            if move:
                board[move[0]][move[1]] = ai_symbol
                print(f"AI chose position: {move[0] * 3 + move[1]}")
                
                if check_winner(board, ai_symbol):
                    print_board(board)
                    print("🤖 AI wins!")
                    break
            else:
                print("❌ AI failed to make a valid move")
                break

        if is_board_full(board):
            print_board(board)
            print("🤝 It's a draw!")
            break

        current_player = "ai" if current_player == "human" else "human"

if __name__ == "__main__":
    if not os.getenv("OPPER_API_KEY"):
        print("Please set OPPER_API_KEY in your .env file")
        exit(1)
    
    asyncio.run(play_game())
