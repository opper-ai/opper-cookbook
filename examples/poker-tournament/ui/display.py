"""Console UI for poker game display."""

from game.state import GameState, PlayerState, Action, Card
from agents.schemas import PlayerAction


class PokerUI:
    """Handles console display for poker game."""

    @staticmethod
    def display_game_start(players: list[PlayerState]):
        """Display game start information."""
        print("\n" + "=" * 80)
        print("🎰 TEXAS HOLD'EM - HIGH STAKES LLM POKER 🎰".center(80))
        print("=" * 80)
        print("\nPlayers:")
        for i, player in enumerate(players, 1):
            print(f"  {i}. {player.name:20} ${player.chips:>10,}  [{player.model}]")
        print("\n" + "=" * 80 + "\n")

    @staticmethod
    def display_hand_start(game_state: GameState):
        """Display start of a new hand."""
        print("\n" + "─" * 80)
        print(f"🎴 HAND #{game_state.hand_number} 🎴".center(80))
        print("─" * 80)

        # Show dealer position
        dealer = game_state.players[game_state.dealer_position]
        print(f"Dealer: {dealer.name}")

        # Show blinds
        sb_pos = (game_state.dealer_position + 1) % len(game_state.players)
        bb_pos = (game_state.dealer_position + 2) % len(game_state.players)
        print(f"Small Blind: {game_state.players[sb_pos].name} (${game_state.small_blind})")
        print(f"Big Blind: {game_state.players[bb_pos].name} (${game_state.big_blind})")
        print()

    @staticmethod
    def display_player_stacks(game_state: GameState):
        """Display current chip stacks."""
        print("\n💰 Chip Stacks:")
        for player in game_state.players:
            status = "🟢" if player.is_active else "🔴"
            if player.is_all_in:
                status = "⚠️"
            print(f"  {status} {player.name:20} ${player.chips:>10,}")

    @staticmethod
    def display_betting_round(round_name: str):
        """Display betting round header."""
        print("\n" + "┈" * 80)
        print(f"  {round_name.upper()}")
        print("┈" * 80)

    @staticmethod
    def display_community_cards(cards: list[Card]):
        """Display community cards."""
        if not cards:
            return
        cards_str = "  ".join(str(card) for card in cards)
        print(f"\n🃏 Community Cards: {cards_str}")

    @staticmethod
    def display_pot(pot: int):
        """Display current pot."""
        print(f"💰 Pot: ${pot:,}")

    @staticmethod
    def display_player_turn(player: PlayerState, game_state: GameState):
        """Display whose turn it is."""
        call_amount = game_state.current_bet - player.current_bet
        print(f"\n👤 {player.name}'s turn")
        print(f"   Chips: ${player.chips:,}")
        if game_state.current_bet > 0:
            print(f"   To call: ${call_amount:,}")

    @staticmethod
    def display_player_action(
        player: PlayerState,
        action: Action,
        player_action: PlayerAction | None = None
    ):
        """Display a player's action with poker face and conversation."""
        # Action line
        print(f"\n   ➜ {action}")

        # Poker face
        if action.poker_face:
            print(f"   😐 {action.poker_face}")

        # Conversation
        if action.poker_conversation:
            print(f"   💬 {player.name}: \"{action.poker_conversation}\"")

    @staticmethod
    def display_showdown(game_state: GameState):
        """Display showdown information."""
        print("\n" + "=" * 80)
        print("🎲 SHOWDOWN 🎲".center(80))
        print("=" * 80)

        # Show community cards
        cards_str = "  ".join(str(card) for card in game_state.community_cards)
        print(f"\n🃏 Community Cards: {cards_str}\n")

        # Show active players' hands
        from game.evaluator import HandEvaluator
        for player in game_state.players:
            if player.is_active or player.is_all_in:
                hole_cards_str = "  ".join(str(card) for card in player.hole_cards)
                evaluation = HandEvaluator.evaluate(player.hole_cards, game_state.community_cards)
                print(f"{player.name}:")
                print(f"  Cards: {hole_cards_str}")
                print(f"  Hand: {evaluation.description}")
                print()

    @staticmethod
    def display_winner(winners: list[tuple[PlayerState, str]], pot: int):
        """Display hand winner(s)."""
        print("\n" + "🏆" * 40)
        if len(winners) == 1:
            winner, hand_desc = winners[0]
            print(f"Winner: {winner.name}")
            print(f"Hand: {hand_desc}")
            print(f"Wins: ${pot:,}")
        else:
            print(f"Split Pot between:")
            for winner, hand_desc in winners:
                print(f"  - {winner.name} ({hand_desc})")
            print(f"Each wins: ${pot // len(winners):,}")
        print("🏆" * 40)

    @staticmethod
    def display_hand_summary(game_state: GameState):
        """Display summary at end of hand."""
        print("\n📊 Hand Summary:")
        for player in game_state.players:
            print(f"  {player.name:20} ${player.chips:>10,}")

    @staticmethod
    def display_game_over(final_standings: list[PlayerState]):
        """Display game over screen."""
        print("\n\n" + "=" * 80)
        print("🎰 GAME OVER 🎰".center(80))
        print("=" * 80)
        print("\nFinal Standings:")

        # Sort by chips (descending)
        sorted_players = sorted(final_standings, key=lambda p: p.chips, reverse=True)

        for i, player in enumerate(sorted_players, 1):
            medal = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else "  "
            profit = player.chips - 100_000
            profit_str = f"+${profit:,}" if profit >= 0 else f"-${abs(profit):,}"
            print(f"  {medal} {i}. {player.name:20} ${player.chips:>10,}  ({profit_str})")

        print("\n" + "=" * 80 + "\n")

    @staticmethod
    def display_thinking(player_name: str):
        """Display thinking indicator."""
        print(f"\n   🤔 {player_name} is thinking...")

    @staticmethod
    def display_error(message: str):
        """Display error message."""
        print(f"\n❌ Error: {message}")

    @staticmethod
    def display_fold_and_win(winner: PlayerState, pot: int):
        """Display when everyone folds and one player wins."""
        print("\n" + "🏆" * 40)
        print(f"Everyone folded! {winner.name} wins ${pot:,}")
        print("🏆" * 40)
