"""Pydantic schemas for player agent input/output."""

from pydantic import BaseModel, Field
from typing import Literal


class OpponentInfo(BaseModel):
    name: str = Field(description="The opponent's name")
    chips: int = Field(description="The opponent's current chip stack")
    last_action: str | None = Field(default=None, description="The opponent's most recent action in this hand")
    poker_face: str | None = Field(default=None, description="The opponent's most recent poker face expression")
    recent_conversation: str | None = Field(default=None, description="What the opponent recently said at the table")


class RecentAction(BaseModel):
    player: str = Field(description="The player who took the action")
    action: str = Field(description="The action taken (e.g., 'raises to $2000', 'calls', 'folds')")
    poker_face: str | None = Field(default=None, description="The poker face shown with this action")
    conversation: str | None = Field(default=None, description="What was said with this action")


class PokerContext(BaseModel):
    """Input context for a player's decision."""

    # Your cards and situation
    hole_cards: str = Field(description="Your two hole cards, e.g., 'A♠ K♥'")
    position: str = Field(description="Your position at the table (e.g., 'dealer', 'small blind', 'big blind', 'early', 'middle', 'late')")
    your_chips: int = Field(description="Your current chip stack in dollars")

    # Game state
    current_round: Literal["pre-flop", "flop", "turn", "river"] = Field(description="The current betting round")
    community_cards: str = Field(description="The community cards visible (empty for pre-flop)")
    pot_size: int = Field(description="Current pot size in dollars")
    current_bet: int = Field(description="The current bet amount you need to call")
    your_current_bet: int = Field(description="How much you've already bet this round")
    min_raise: int = Field(description="The minimum amount you can raise to")

    # Opponents
    opponents: list[OpponentInfo] = Field(description="Information about other players")

    # Recent actions this round
    recent_actions: list[RecentAction] = Field(description="Actions taken in this betting round, in chronological order")

    # Memory context
    relevant_memories: list[str] = Field(
        default_factory=list,
        description="Your relevant memories from past hands about opponents and patterns"
    )

    # Hand number
    hand_number: int = Field(description="The current hand number in the game")


class PlayerAction(BaseModel):
    """Output schema for player's decision."""

    thoughts: str = Field(
        description="Your internal reasoning about the hand, the situation, and why you're taking this action. Consider your cards, position, pot odds, and opponent behaviors."
    )

    poker_face: str = Field(
        description="Description of your facial expression and demeanor shown to other players. Be creative and specific. Examples: 'confident smirk with a slight lean forward', 'nervous glance at chips followed by a deep breath', 'stone-faced stare directly at the opponent', 'relaxed lean back with a casual smile', 'furrowed brow with hand on chin, appearing conflicted'"
    )

    poker_conversation: str | None = Field(
        default=None,
        description="Optional table talk. Use this to engage in banter, try to intimidate opponents, or create false tells. Can be witty, aggressive, friendly, or strategic. Leave empty if you prefer to stay silent."
    )

    action: Literal["fold", "call", "raise", "check", "all-in"] = Field(
        description="Your chosen action. 'fold' = give up the hand, 'call' = match current bet, 'raise' = increase the bet, 'check' = pass action if no bet to call, 'all-in' = bet all remaining chips"
    )

    raise_amount: int | None = Field(
        default=None,
        description="If action is 'raise', this is the TOTAL amount you're raising to (not the additional amount). Must be at least min_raise from context. Only provide if action is 'raise'."
    )

    memory_note: str | None = Field(
        default=None,
        description="Optional note to remember about this hand or opponents for future rounds. Examples: 'Bob seems to bluff when he talks a lot', 'Alice raised 3x with weak cards on hand 5', 'When Charlie goes quiet, he usually has a strong hand'. These memories will be provided to you in future hands."
    )
