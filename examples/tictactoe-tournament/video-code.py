from opperai import Opper
from pydantic import BaseModel, Field
from typing import Literal
import copy
import os

opper = Opper(http_bearer=os.getenv("OPPER_TICTACTOE_KEY")) # Your API key as environment variable

instructions = (
    "You are a Tic-Tac-Toe player.\n"
    "Return the index (0-8) of your move.\n"
    "Board layout is shown with indices as follows:\n\n"
    " 0 | 1 | 2\n"
    "---+---+---\n"
    " 3 | 4 | 5\n"
    "---+---+---\n"
    " 6 | 7 | 8\n\n"
    "Use this index reference to decide your move."
)

class TicTacToeInput(BaseModel):
    board: list[str] = Field(
        description="Nine-item list representing the board, index 0-8."
    )
    player_piece: Literal["X", "O"] = Field(
        description="The game piece representing the player who is about to play."
    )

MoveIndex = Literal[0, 1, 2, 3, 4, 5, 6, 7, 8]
class TicTacToeOutput(BaseModel):
    move: MoveIndex = Field(description="The index of where to place the marker")

def create_player(model:str):

    player_name = f"play-tic-tac-toe-{model.split('/')[-1]}" # Remove the provider from the model name
    player = opper.functions.create(
        name=player_name,
        model=model,
        instructions=instructions,
        input_schema=TicTacToeInput,
        output_schema=TicTacToeOutput,
    )
    print(f"Player {player.name} created! with id {player.id}")
    return {"id": player.id, "name": player.name}

print("Building players...") # Store them as a dict
player_gpt_4o = create_player("openai/gpt-4o")
player_sonnet_4 = create_player("anthropic/claude-sonnet-4")

def make_move(player_id:str, board:list[str], player_piece:Literal["X", "O"], match_span_id:str):
    move = opper.functions.call(
        function_id=player_id,
        input=TicTacToeInput(board=board, player_piece=player_piece),
        parent_span_id=match_span_id,
    )
    return move.json_payload["move"]

# Create a parent span
match_span = opper.spans.create(
    name="Tic-Tac-Toe-match",
)

# Pretty board print:
def format_board(board):
    lines = []
    for i in range(0, 9, 3):
        lines.append(" " + " | ".join(board[i:i+3]))
        if i < 6:
            lines.append("---+---+---")
    return "\n".join(lines)

# Start game
board = [" ", " ", " ", " ", " ", " ", " ", " ", " "]
player_piece = "X"

moves = []
board_states = []
formatted_boards = []

# First move
move = make_move(player_gpt_4o["id"], board, player_piece, match_span.id)
board[move] = player_piece
player_piece = "O" if player_piece == "X" else "X"
formatted = format_board(board)
print(f"Move {len(moves)+1} | Player: {player_piece} | Index: {move}")
print(formatted)
print()

moves.append(move)
board_states.append(copy.deepcopy(board))
formatted_boards.append(f"Move {len(moves)} | Player: {player_piece} | Index: {move}\n{formatted}")

# Second move
move = make_move(player_sonnet_4["id"], board, player_piece, match_span.id)
board[move] = player_piece
player_piece = "O" if player_piece == "X" else "X"
formatted = format_board(board)
print(f"Move {len(moves)+1} | Player: {player_piece} | Index: {move}")
print(formatted)
print()

moves.append(move)
board_states.append(copy.deepcopy(board))
formatted_boards.append(f"Move {len(moves)} | Player: {player_piece} | Index: {move}\n{formatted}")

# Third move
move = make_move(player_gpt_4o["id"], board, player_piece, match_span.id)
board[move] = player_piece
player_piece = "O" if player_piece == "X" else "X"
formatted = format_board(board)
print(f"Move {len(moves)+1} | Player: {player_piece} | Index: {move}")
print(formatted)
print()

moves.append(move)
board_states.append(copy.deepcopy(board))
formatted_boards.append(f"Move {len(moves)} | Player: {player_piece} | Index: {move}\n{formatted}")


opper.spans.update(
    span_id=match_span.id,
    input=f"Match between {player_gpt_4o['name'].split('-toe-')[-1]} and {player_sonnet_4['name'].split('-toe-')[-1]}",
    output=f"The match was won by {player_gpt_4o['name'].split('-toe-')[-1]}, with the following moves and board states:\n\n" + "\n\n".join(formatted_boards)
)

total_moves = len(moves)
opper.span_metrics.create_metric(span_id=match_span.id, dimension="total_moves", value=total_moves, comment="Total moves in the match")