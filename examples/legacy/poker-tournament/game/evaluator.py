"""Poker hand evaluation logic."""

from collections import Counter
from enum import Enum
from dataclasses import dataclass
from game.state import Card, Rank


class HandRank(Enum):
    HIGH_CARD = 1
    PAIR = 2
    TWO_PAIR = 3
    THREE_OF_A_KIND = 4
    STRAIGHT = 5
    FLUSH = 6
    FULL_HOUSE = 7
    FOUR_OF_A_KIND = 8
    STRAIGHT_FLUSH = 9
    ROYAL_FLUSH = 10

    def __lt__(self, other):
        return self.value < other.value

    def __gt__(self, other):
        return self.value > other.value


@dataclass
class HandEvaluation:
    hand_rank: HandRank
    rank_values: list[int]  # For tie-breaking
    description: str

    def __lt__(self, other):
        if self.hand_rank != other.hand_rank:
            return self.hand_rank < other.hand_rank
        return self.rank_values < other.rank_values

    def __gt__(self, other):
        if self.hand_rank != other.hand_rank:
            return self.hand_rank > other.hand_rank
        return self.rank_values > other.rank_values

    def __eq__(self, other):
        return self.hand_rank == other.hand_rank and self.rank_values == other.rank_values


class HandEvaluator:
    @staticmethod
    def evaluate(hole_cards: list[Card], community_cards: list[Card]) -> HandEvaluation:
        """Evaluate the best 5-card hand from 7 cards (2 hole + 5 community)."""
        all_cards = hole_cards + community_cards

        if len(all_cards) < 5:
            # Not enough cards yet, return high card
            sorted_cards = sorted(all_cards, key=lambda c: c.rank.rank_value, reverse=True)
            return HandEvaluation(
                hand_rank=HandRank.HIGH_CARD,
                rank_values=[c.rank.rank_value for c in sorted_cards],
                description=f"High card: {sorted_cards[0].rank.symbol}"
            )

        # Check all possible 5-card combinations
        from itertools import combinations
        best_hand = None

        for five_cards in combinations(all_cards, 5):
            evaluation = HandEvaluator._evaluate_five_cards(list(five_cards))
            if best_hand is None or evaluation > best_hand:
                best_hand = evaluation

        return best_hand

    @staticmethod
    def _evaluate_five_cards(cards: list[Card]) -> HandEvaluation:
        """Evaluate exactly 5 cards."""
        ranks = [card.rank for card in cards]
        suits = [card.suit for card in cards]
        rank_values = sorted([r.rank_value for r in ranks], reverse=True)
        rank_counts = Counter(ranks)

        is_flush = len(set(suits)) == 1
        is_straight = HandEvaluator._is_straight(rank_values)

        # Count pairs, trips, quads
        counts = sorted(rank_counts.values(), reverse=True)
        most_common_ranks = [rank.rank_value for rank, _ in rank_counts.most_common()]

        # Royal Flush
        if is_flush and is_straight and rank_values[0] == 14:  # Ace high
            return HandEvaluation(
                hand_rank=HandRank.ROYAL_FLUSH,
                rank_values=[14],
                description="Royal Flush"
            )

        # Straight Flush
        if is_flush and is_straight:
            return HandEvaluation(
                hand_rank=HandRank.STRAIGHT_FLUSH,
                rank_values=[rank_values[0]],
                description=f"Straight Flush, {Rank(rank_values[0]).symbol} high"
            )

        # Four of a Kind
        if counts[0] == 4:
            quad_rank = most_common_ranks[0]
            kicker = most_common_ranks[1]
            return HandEvaluation(
                hand_rank=HandRank.FOUR_OF_A_KIND,
                rank_values=[quad_rank, kicker],
                description=f"Four of a Kind, {Rank(quad_rank).symbol}s"
            )

        # Full House
        if counts[0] == 3 and counts[1] == 2:
            trip_rank = most_common_ranks[0]
            pair_rank = most_common_ranks[1]
            return HandEvaluation(
                hand_rank=HandRank.FULL_HOUSE,
                rank_values=[trip_rank, pair_rank],
                description=f"Full House, {Rank(trip_rank).symbol}s over {Rank(pair_rank).symbol}s"
            )

        # Flush
        if is_flush:
            return HandEvaluation(
                hand_rank=HandRank.FLUSH,
                rank_values=rank_values,
                description=f"Flush, {Rank(rank_values[0]).symbol} high"
            )

        # Straight
        if is_straight:
            return HandEvaluation(
                hand_rank=HandRank.STRAIGHT,
                rank_values=[rank_values[0]],
                description=f"Straight, {Rank(rank_values[0]).symbol} high"
            )

        # Three of a Kind
        if counts[0] == 3:
            trip_rank = most_common_ranks[0]
            kickers = [r for r in most_common_ranks[1:]]
            return HandEvaluation(
                hand_rank=HandRank.THREE_OF_A_KIND,
                rank_values=[trip_rank] + kickers,
                description=f"Three of a Kind, {Rank(trip_rank).symbol}s"
            )

        # Two Pair
        if counts[0] == 2 and counts[1] == 2:
            high_pair = most_common_ranks[0]
            low_pair = most_common_ranks[1]
            kicker = most_common_ranks[2]
            return HandEvaluation(
                hand_rank=HandRank.TWO_PAIR,
                rank_values=[high_pair, low_pair, kicker],
                description=f"Two Pair, {Rank(high_pair).symbol}s and {Rank(low_pair).symbol}s"
            )

        # One Pair
        if counts[0] == 2:
            pair_rank = most_common_ranks[0]
            kickers = [r for r in most_common_ranks[1:]]
            return HandEvaluation(
                hand_rank=HandRank.PAIR,
                rank_values=[pair_rank] + kickers,
                description=f"Pair of {Rank(pair_rank).symbol}s"
            )

        # High Card
        return HandEvaluation(
            hand_rank=HandRank.HIGH_CARD,
            rank_values=rank_values,
            description=f"High card: {Rank(rank_values[0]).symbol}"
        )

    @staticmethod
    def _is_straight(rank_values: list[int]) -> bool:
        """Check if sorted rank values form a straight."""
        rank_values = sorted(rank_values, reverse=True)

        # Regular straight
        if rank_values[0] - rank_values[4] == 4:
            return True

        # Wheel (A-2-3-4-5)
        if rank_values == [14, 5, 4, 3, 2]:
            return True

        return False
