"""Texas Hold'em game engine and betting logic."""

from game.state import GameState, PlayerState, Action, Deck, BettingRound
from game.evaluator import HandEvaluator


class PokerEngine:
    def __init__(self, player_configs: list[dict]):
        """
        Initialize a poker game.

        Args:
            player_configs: List of dicts with 'name' and 'model' keys
        """
        self.players = [
            PlayerState(
                name=config["name"],
                chips=100_000,  # Starting stack
                hole_cards=[],
                model=config["model"]
            )
            for config in player_configs
        ]
        self.deck = Deck()
        self.hand_number = 0
        self.dealer_position = 0
        self.small_blind = 500
        self.big_blind = 1000

    def start_new_hand(self) -> GameState:
        """Start a new hand of poker."""
        self.hand_number += 1
        self.deck.reset()

        # Reset player states
        for player in self.players:
            player.hole_cards = []
            player.is_active = player.chips > 0  # Only players with chips can play
            player.is_all_in = False
            player.current_bet = 0
            player.total_bet = 0

        # Deal hole cards
        for player in self.players:
            if player.is_active:
                player.hole_cards = self.deck.deal(2)

        # Create initial game state
        game_state = GameState(
            players=self.players,
            community_cards=[],
            pot=0,
            current_bet=0,
            dealer_position=self.dealer_position,
            current_round="pre-flop",
            round_actions=[],
            hand_number=self.hand_number,
            small_blind=self.small_blind,
            big_blind=self.big_blind
        )

        # Post blinds
        self._post_blinds(game_state)

        return game_state

    def _post_blinds(self, game_state: GameState):
        """Post small and big blinds."""
        active_players = game_state.get_active_players()
        if len(active_players) < 2:
            return

        # Small blind is next to dealer
        sb_position = (game_state.dealer_position + 1) % len(self.players)
        sb_player = self.players[sb_position]

        # Big blind is after small blind
        bb_position = (game_state.dealer_position + 2) % len(self.players)
        bb_player = self.players[bb_position]

        # Post small blind
        sb_amount = min(self.small_blind, sb_player.chips)
        sb_player.chips -= sb_amount
        sb_player.current_bet = sb_amount
        sb_player.total_bet = sb_amount
        game_state.pot += sb_amount

        if sb_amount == sb_player.chips:
            sb_player.is_all_in = True

        game_state.round_actions.append(Action(
            player_name=sb_player.name,
            action_type="blind",
            amount=sb_amount
        ))

        # Post big blind
        bb_amount = min(self.big_blind, bb_player.chips)
        bb_player.chips -= bb_amount
        bb_player.current_bet = bb_amount
        bb_player.total_bet = bb_amount
        game_state.pot += bb_amount
        game_state.current_bet = bb_amount

        if bb_amount == bb_player.chips:
            bb_player.is_all_in = True

        game_state.round_actions.append(Action(
            player_name=bb_player.name,
            action_type="blind",
            amount=bb_amount
        ))

    def get_first_to_act(self, game_state: GameState) -> PlayerState | None:
        """Get the first player to act in the current round."""
        active_players = game_state.get_active_players()
        if len(active_players) <= 1:
            return None

        if game_state.current_round == "pre-flop":
            # First to act pre-flop is after big blind
            first_position = (game_state.dealer_position + 3) % len(self.players)
        else:
            # Post-flop, first to act is after dealer
            first_position = (game_state.dealer_position + 1) % len(self.players)

        # Find first active player from that position
        for i in range(len(self.players)):
            pos = (first_position + i) % len(self.players)
            player = self.players[pos]
            if player.is_active and not player.is_all_in:
                return player

        return None

    def is_betting_round_complete(self, game_state: GameState) -> bool:
        """Check if the current betting round is complete."""
        active_players = [p for p in game_state.get_active_players() if not p.is_all_in]

        if len(active_players) <= 1:
            return True

        # All active players must have acted and matched the current bet
        for player in active_players:
            if player.current_bet < game_state.current_bet:
                return False

        # Check that everyone has had a chance to act
        # (at least one action per active player, excluding blinds for pre-flop)
        if game_state.current_round == "pre-flop":
            non_blind_actions = [a for a in game_state.round_actions if a.action_type != "blind"]
            return len(non_blind_actions) >= len(active_players)
        else:
            return len(game_state.round_actions) >= len(active_players)

    def advance_to_next_round(self, game_state: GameState):
        """Advance to the next betting round."""
        # Reset current bets for next round
        for player in game_state.players:
            player.current_bet = 0

        game_state.current_bet = 0
        game_state.round_actions = []

        # Deal community cards based on round
        if game_state.current_round == "pre-flop":
            # Deal flop (3 cards)
            game_state.community_cards = self.deck.deal(3)
            game_state.current_round = "flop"
        elif game_state.current_round == "flop":
            # Deal turn (1 card)
            game_state.community_cards.extend(self.deck.deal(1))
            game_state.current_round = "turn"
        elif game_state.current_round == "turn":
            # Deal river (1 card)
            game_state.community_cards.extend(self.deck.deal(1))
            game_state.current_round = "river"
        elif game_state.current_round == "river":
            game_state.current_round = "showdown"

    def apply_action(self, game_state: GameState, player: PlayerState, action: Action) -> bool:
        """
        Apply a player's action to the game state.

        Returns True if action is valid, False otherwise.
        """
        if action.action_type == "fold":
            player.is_active = False
            game_state.round_actions.append(action)
            return True

        elif action.action_type == "check":
            # Can only check if current bet matches player's bet
            if player.current_bet == game_state.current_bet:
                game_state.round_actions.append(action)
                return True
            return False

        elif action.action_type == "call":
            call_amount = game_state.current_bet - player.current_bet
            actual_amount = min(call_amount, player.chips)

            player.chips -= actual_amount
            player.current_bet += actual_amount
            player.total_bet += actual_amount
            game_state.pot += actual_amount

            if player.chips == 0:
                player.is_all_in = True
                action.action_type = "all-in"

            action.amount = actual_amount
            game_state.round_actions.append(action)
            return True

        elif action.action_type == "raise":
            # Raise to the specified amount
            total_to_add = action.amount - player.current_bet
            if total_to_add > player.chips:
                # Convert to all-in
                actual_amount = player.chips
                player.chips = 0
                player.current_bet += actual_amount
                player.total_bet += actual_amount
                player.is_all_in = True
                game_state.pot += actual_amount
                game_state.current_bet = player.current_bet
                action.action_type = "all-in"
                action.amount = actual_amount
            else:
                player.chips -= total_to_add
                player.current_bet = action.amount
                player.total_bet += total_to_add
                game_state.pot += total_to_add
                game_state.current_bet = action.amount

            game_state.round_actions.append(action)
            return True

        elif action.action_type == "all-in":
            all_in_amount = player.chips
            player.chips = 0
            player.current_bet += all_in_amount
            player.total_bet += all_in_amount
            player.is_all_in = True
            game_state.pot += all_in_amount
            game_state.current_bet = max(game_state.current_bet, player.current_bet)

            action.amount = all_in_amount
            game_state.round_actions.append(action)
            return True

        return False

    def determine_winner(self, game_state: GameState) -> list[tuple[PlayerState, str]]:
        """
        Determine the winner(s) of the hand.

        Returns list of (player, hand_description) tuples.
        """
        active_players = [p for p in game_state.players if p.is_active or p.is_all_in]

        if len(active_players) == 1:
            return [(active_players[0], "won by default")]

        # Evaluate all hands
        evaluations = []
        for player in active_players:
            if player.is_active or player.is_all_in:  # Only evaluate players still in
                eval_result = HandEvaluator.evaluate(player.hole_cards, game_state.community_cards)
                evaluations.append((player, eval_result))

        # Find best hand(s)
        best_eval = max(evaluations, key=lambda x: x[1])[1]
        winners = [(p, e.description) for p, e in evaluations if e == best_eval]

        return winners

    def award_pot(self, game_state: GameState, winners: list[tuple[PlayerState, str]]):
        """Award the pot to the winner(s)."""
        pot_share = game_state.pot // len(winners)

        for winner, _ in winners:
            winner.chips += pot_share

        game_state.pot = 0

    def move_dealer_button(self):
        """Move dealer button to next player with chips."""
        for i in range(1, len(self.players) + 1):
            next_pos = (self.dealer_position + i) % len(self.players)
            if self.players[next_pos].chips > 0:
                self.dealer_position = next_pos
                break

    def get_players_still_in_game(self) -> list[PlayerState]:
        """Get players who still have chips."""
        return [p for p in self.players if p.chips > 0]
