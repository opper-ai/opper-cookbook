"""Player agent with LLM integration via Opper."""

import os
from opperai import Opper
from agents.schemas import PokerContext, PlayerAction, OpponentInfo, RecentAction
from agents.memory import PlayerMemory
from game.state import GameState, PlayerState, Action


class PokerPlayer:
    """An AI poker player powered by an LLM."""

    def __init__(self, player_state: PlayerState, game_id: str, opper_client: Opper | None = None):
        self.player_state = player_state
        self.memory = PlayerMemory(player_name=player_state.name, game_id=game_id)

        # Use provided Opper client or create new one
        self.opper = opper_client or Opper(http_bearer=os.getenv("OPPER_API_KEY"))

    def make_decision(
        self,
        game_state: GameState,
        parent_span_id: str | None = None
    ) -> tuple[Action, PlayerAction]:
        """
        Make a decision for the current game state.

        Returns:
            tuple of (Action for game engine, PlayerAction with full details)
        """
        # Build context
        context = self._build_context(game_state)

        # Call LLM
        result = self.opper.call(
            name="poker_decision",
            instructions=(
                "You are an expert poker player playing Texas Hold'em. "
                "Analyze your hand, position, pot odds, and opponent behaviors. "
                "Make strategic decisions to maximize your winnings over time. "
                "Use your poker face and conversation to influence opponents. "
                "Take notes in memory_note to track opponent patterns."
            ),
            input_schema=PokerContext,
            output_schema=PlayerAction,
            input=context,
            model=self.player_state.model,
            parent_span_id=parent_span_id
        )

        player_action = PlayerAction(**result.json_payload)

        # Save memory if provided
        if player_action.memory_note:
            self.memory.add_memory(
                hand_number=game_state.hand_number,
                note=player_action.memory_note,
                context=f"{game_state.current_round}, pot: ${game_state.pot}"
            )

        # Convert to game engine Action
        action = self._convert_to_action(player_action, game_state)

        return action, player_action

    def _build_context(self, game_state: GameState) -> PokerContext:
        """Build the input context for the LLM."""
        # Format hole cards
        hole_cards_str = " ".join(str(card) for card in self.player_state.hole_cards)

        # Format community cards
        community_cards_str = " ".join(str(card) for card in game_state.community_cards)
        if not community_cards_str:
            community_cards_str = "None (pre-flop)"

        # Determine position
        position = self._determine_position(game_state)

        # Calculate min raise
        big_blind = game_state.big_blind
        if game_state.current_bet == 0:
            min_raise = big_blind
        else:
            # Minimum raise is current bet + size of last raise (or big blind)
            min_raise = game_state.current_bet + big_blind

        min_raise = max(min_raise, game_state.current_bet + big_blind)

        # Build opponent info
        opponents = []
        for player in game_state.players:
            if player.name != self.player_state.name and (player.is_active or player.chips > 0):
                last_action = None
                poker_face = None
                conversation = None

                # Find most recent action by this player
                for action in reversed(game_state.round_actions):
                    if action.player_name == player.name:
                        last_action = str(action)
                        poker_face = action.poker_face
                        conversation = action.poker_conversation
                        break

                opponents.append(OpponentInfo(
                    name=player.name,
                    chips=player.chips,
                    last_action=last_action,
                    poker_face=poker_face,
                    recent_conversation=conversation
                ))

        # Build recent actions
        recent_actions = []
        for action in game_state.round_actions:
            if action.action_type != "blind":  # Skip blind posts in action history
                recent_actions.append(RecentAction(
                    player=action.player_name,
                    action=str(action),
                    poker_face=action.poker_face,
                    conversation=action.poker_conversation
                ))

        # Get relevant memories
        relevant_memories = self.memory.get_recent_memories(limit=10)

        return PokerContext(
            hole_cards=hole_cards_str,
            position=position,
            your_chips=self.player_state.chips,
            current_round=game_state.current_round,
            community_cards=community_cards_str,
            pot_size=game_state.pot,
            current_bet=game_state.current_bet,
            your_current_bet=self.player_state.current_bet,
            min_raise=min_raise,
            opponents=opponents,
            recent_actions=recent_actions,
            relevant_memories=relevant_memories,
            hand_number=game_state.hand_number
        )

    def _determine_position(self, game_state: GameState) -> str:
        """Determine the player's position descriptor."""
        player_pos = game_state.get_player_position(self.player_state.name)
        dealer_pos = game_state.dealer_position

        if player_pos == dealer_pos:
            return "dealer (button)"
        elif player_pos == (dealer_pos + 1) % len(game_state.players):
            return "small blind"
        elif player_pos == (dealer_pos + 2) % len(game_state.players):
            return "big blind"
        else:
            # Determine early/middle/late
            active_count = len(game_state.get_active_players())
            relative_pos = (player_pos - dealer_pos) % len(game_state.players)

            if relative_pos <= active_count // 3:
                return "early position"
            elif relative_pos <= 2 * active_count // 3:
                return "middle position"
            else:
                return "late position"

    def _convert_to_action(self, player_action: PlayerAction, game_state: GameState) -> Action:
        """Convert PlayerAction to game engine Action."""
        action_type = player_action.action

        # Validate and adjust action if needed
        call_amount = game_state.current_bet - self.player_state.current_bet

        if action_type == "check":
            # Can only check if no bet to call
            if call_amount > 0:
                # Convert to call if there's a bet
                action_type = "call"

        if action_type == "call":
            # If call amount exceeds chips, convert to all-in
            if call_amount >= self.player_state.chips:
                action_type = "all-in"

        amount = 0
        if action_type == "raise":
            amount = player_action.raise_amount or (game_state.current_bet + game_state.big_blind)
            # Ensure raise is valid
            if amount <= game_state.current_bet:
                amount = game_state.current_bet + game_state.big_blind
            # If raise amount exceeds chips, convert to all-in
            if (amount - self.player_state.current_bet) >= self.player_state.chips:
                action_type = "all-in"
        elif action_type == "call":
            amount = min(call_amount, self.player_state.chips)
        elif action_type == "all-in":
            amount = self.player_state.chips

        return Action(
            player_name=self.player_state.name,
            action_type=action_type,
            amount=amount,
            poker_face=player_action.poker_face,
            poker_conversation=player_action.poker_conversation
        )

    def get_memory_summary(self) -> dict:
        """Get summary of player's memory."""
        return self.memory.get_memory_summary()
