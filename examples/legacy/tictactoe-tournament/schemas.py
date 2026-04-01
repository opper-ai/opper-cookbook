from pydantic import BaseModel, Field, field_validator
from typing import Literal, Tuple


MoveIndex = Literal[0, 1, 2, 3, 4, 5, 6, 7, 8]


class TicTacToeInput(BaseModel):
    board: Tuple[str, ...] = Field(
        description="Nine-item tuple representing the board, index 0-8."
    )
    player_piece: Literal["X", "O"] = Field(
        description="The game piece representing the player who is about to play."
    )

    @field_validator("board")
    @classmethod
    def _board_len(cls, v):
        if len(v) != 9:
            raise ValueError("Board must have 9 squares.")
        for c in v:
            if c not in {"X", "O", " "}:
                raise ValueError("Squares must be X, O or space.")
        return v


class TicTacToeOutput(BaseModel):
    move: MoveIndex = Field(description="The index of where to place the marker")


class TicTacToeOutputReasoning(BaseModel):
    explanation: str = Field(description="The reasoning for the move")
    move: MoveIndex = Field(description="The index of where to place the marker")
