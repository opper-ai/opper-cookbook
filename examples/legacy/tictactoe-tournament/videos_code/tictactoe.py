from opperai import Opper
from pydantic import BaseModel, Field
from typing import Literal
import copy
import os

opper = Opper(
    http_bearer=os.getenv("OPPER_TICTACTOE_KEY")
)  # Your API key as environment variable

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


# Call the model

move = opper.call(
    name="gpt-4.1-mini-examples",
    model="openai/gpt-4.1-mini",
    instructions=instructions,
    input=TicTacToeInput(board=["", "", "", "", "", "", "", "", ""], player_piece="X"),
    output_schema=TicTacToeOutput,
    examples=[
        {
            "input": TicTacToeInput(
                board=["", "", "", "", "", "", "", "", ""], player_piece="X"
            ),
            "output": TicTacToeOutput(move=4),
        },
    ],
).json_payload["move"]


print(move)

# Store good samples

function = opper.functions.create(
    name="gpt-4.1-mini-with-examples",
    model="openai/gpt-4.1-mini",
    instructions=instructions,
    input_schema=TicTacToeInput.model_json_schema(),
    output_schema=TicTacToeOutput.model_json_schema(),
    configuration={"invocation.few_shot.count": 3},  # how many examples to use
)

dataset_id = "4c5b6448-dbd1-4157-b728-efbe8329f53c"
opper.datasets.create_entry(
    dataset_id=dataset_id,
    input=TicTacToeInput(board=["", "", "", "", "", "", "", "", ""], player_piece="X"),
    output=TicTacToeOutput(move=4),
)
function_id ="bbebfced-18e1-4cc1-8e96-bcc1159e4c25"

move = opper.functions.call(
    function_id=function_id,
    input=TicTacToeInput(board=["", "", "", "", "", "", "", "", ""], player_piece="X"),
).json_payload["move"]
print(move)

