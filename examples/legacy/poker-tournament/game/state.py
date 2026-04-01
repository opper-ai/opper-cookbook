"""Core poker game state components: Cards, Deck, and basic structures."""

from enum import Enum
from dataclasses import dataclass
import random
from typing import Literal


class Suit(Enum):
    HEARTS = "♥"
    DIAMONDS = "♦"
    CLUBS = "♣"
    SPADES = "♠"


class Rank(Enum):
    TWO = (2, "2")
    THREE = (3, "3")
    FOUR = (4, "4")
    FIVE = (5, "5")
    SIX = (6, "6")
    SEVEN = (7, "7")
    EIGHT = (8, "8")
    NINE = (9, "9")
    TEN = (10, "T")
    JACK = (11, "J")
    QUEEN = (12, "Q")
    KING = (13, "K")
    ACE = (14, "A")

    def __init__(self, rank_value: int, symbol: str):
        self._rank_value = rank_value
        self._symbol = symbol

    @property
    def rank_value(self) -> int:
        return self._rank_value

    @property
    def symbol(self) -> str:
        return self._symbol

    def __lt__(self, other):
        return self._rank_value < other._rank_value

    def __le__(self, other):
        return self._rank_value <= other._rank_value

    def __gt__(self, other):
        return self._rank_value > other._rank_value

    def __ge__(self, other):
        return self._rank_value >= other._rank_value


@dataclass
class Card:
    rank: Rank
    suit: Suit

    def __str__(self):
        return f"{self.rank.symbol}{self.suit.value}"

    def __repr__(self):
        return str(self)

    def to_dict(self):
        return {"rank": self.rank.symbol, "suit": self.suit.value}


class Deck:
    def __init__(self):
        self.cards = [Card(rank, suit) for rank in Rank for suit in Suit]
        self.shuffle()

    def shuffle(self):
        random.shuffle(self.cards)

    def deal(self, count: int = 1) -> list[Card]:
        if count > len(self.cards):
            raise ValueError(f"Not enough cards in deck. Requested: {count}, Available: {len(self.cards)}")
        dealt_cards = self.cards[:count]
        self.cards = self.cards[count:]
        return dealt_cards

    def reset(self):
        self.cards = [Card(rank, suit) for rank in Rank for suit in Suit]
        self.shuffle()


@dataclass
class PlayerState:
    name: str
    chips: int
    hole_cards: list[Card]
    is_active: bool = True  # Still in the hand
    is_all_in: bool = False
    current_bet: int = 0  # Amount bet in current betting round
    total_bet: int = 0  # Total amount bet in this hand
    model: str = "anthropic/claude-3.7-sonnet"

    def __str__(self):
        return f"{self.name} (${self.chips:,})"


BettingRound = Literal["pre-flop", "flop", "turn", "river", "showdown"]


@dataclass
class Action:
    player_name: str
    action_type: Literal["fold", "call", "raise", "check", "all-in", "blind"]
    amount: int
    poker_face: str | None = None
    poker_conversation: str | None = None

    def __str__(self):
        if self.action_type == "raise":
            return f"{self.player_name} raises to ${self.amount}"
        elif self.action_type == "call":
            return f"{self.player_name} calls ${self.amount}"
        elif self.action_type == "fold":
            return f"{self.player_name} folds"
        elif self.action_type == "check":
            return f"{self.player_name} checks"
        elif self.action_type == "all-in":
            return f"{self.player_name} goes all-in for ${self.amount}"
        elif self.action_type == "blind":
            return f"{self.player_name} posts ${self.amount}"
        return f"{self.player_name}: {self.action_type}"


@dataclass
class GameState:
    players: list[PlayerState]
    community_cards: list[Card]
    pot: int
    current_bet: int
    dealer_position: int
    current_round: BettingRound
    round_actions: list[Action]
    hand_number: int = 1
    small_blind: int = 500
    big_blind: int = 1000

    def get_active_players(self) -> list[PlayerState]:
        """Get players still in the hand."""
        return [p for p in self.players if p.is_active and p.chips > 0]

    def get_next_player(self, current_position: int) -> PlayerState | None:
        """Get the next active player after current_position."""
        active_players = self.get_active_players()
        if len(active_players) <= 1:
            return None

        # Find next active player
        for i in range(1, len(self.players)):
            next_pos = (current_position + i) % len(self.players)
            player = self.players[next_pos]
            if player.is_active and not player.is_all_in:
                return player
        return None

    def get_player_position(self, player_name: str) -> int:
        """Get the position index of a player."""
        for i, player in enumerate(self.players):
            if player.name == player_name:
                return i
        return -1
