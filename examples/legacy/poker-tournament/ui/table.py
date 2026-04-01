"""Rich-based poker table visualization."""

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.layout import Layout
from rich.text import Text
from rich.columns import Columns
from rich.align import Align
from game.state import GameState, PlayerState, Card, Action
from agents.schemas import PlayerAction


class RichPokerTable:
    """Rich console-based poker table display."""

    def __init__(self):
        self.console = Console()
        self.action_history = []  # Keep track of recent actions

    def _format_card(self, card: Card) -> Text:
        """Format a card with colored suit."""
        rank_symbol = card.rank.symbol
        suit_symbol = card.suit.value

        # Red suits: hearts, diamonds
        # Black suits: clubs, spades
        if suit_symbol in ["♥", "♦"]:
            return Text(f"{rank_symbol}{suit_symbol}", style="bold red")
        else:
            return Text(f"{rank_symbol}{suit_symbol}", style="bold white")

    def _format_cards(self, cards: list[Card]) -> Text:
        """Format multiple cards with spacing."""
        if not cards:
            return Text("??", style="dim")

        formatted = Text()
        for i, card in enumerate(cards):
            if i > 0:
                formatted.append(" ")
            formatted.append(self._format_card(card))
        return formatted

    def _create_player_panel(
        self,
        player: PlayerState,
        is_current: bool = False,
        is_dealer: bool = False,
        position_label: str = "",
        show_cards: bool = False,
    ) -> Panel:
        """Create a panel for a player."""
        # Player name with badges
        title_parts = []
        if is_dealer:
            title_parts.append("🔘")
        title_parts.append(player.name)
        if position_label:
            title_parts.append(f"({position_label})")

        title = " ".join(title_parts)

        # Content
        content = []

        # Cards (only show if it's their turn or show_cards is True)
        if show_cards and player.hole_cards:
            content.append(self._format_cards(player.hole_cards))
        elif player.is_active:
            content.append(Text("🂠 🂠", style="dim"))
        else:
            content.append(Text("FOLDED", style="dim red"))

        # Chips
        chip_text = Text(f"\n💰 ${player.chips:,}", style="bold green")
        content.append(chip_text)

        # Current bet
        if player.current_bet > 0:
            bet_text = Text(f"Bet: ${player.current_bet:,}", style="yellow")
            content.append(Text("\n"))
            content.append(bet_text)

        if player.is_all_in:
            content.append(Text("\n⚠️  ALL-IN", style="bold red"))

        # Combine content
        panel_content = Text()
        for item in content:
            panel_content.append(item)

        # Style based on status
        border_style = "bold cyan" if is_current else "white"
        if not player.is_active and not player.is_all_in:
            border_style = "dim"

        return Panel(
            Align.center(panel_content),
            title=title,
            border_style=border_style,
            width=20,
        )

    def display_table(
        self,
        game_state: GameState,
        current_player: PlayerState | None = None,
        show_all_cards: bool = False,
        clear_screen: bool = True,
    ):
        """Display the full poker table."""
        if clear_screen:
            self.console.clear()

        # Header
        header = Text()
        header.append("♠️ ♥️ ♣️ ♦️  ", style="bold")
        header.append(f"HAND #{game_state.hand_number}", style="bold cyan")
        header.append("  ♠️ ♥️ ♣️ ♦️", style="bold")
        self.console.print(Align.center(header))
        self.console.print()

        # Community cards
        if game_state.community_cards:
            community_panel = Panel(
                Align.center(self._format_cards(game_state.community_cards)),
                title=f"Community Cards - {game_state.current_round.upper()}",
                border_style="bold yellow",
                width=50,
            )
            self.console.print(Align.center(community_panel))
        else:
            community_panel = Panel(
                Align.center(Text("Pre-flop", style="dim")),
                title="Community Cards",
                border_style="dim",
                width=50,
            )
            self.console.print(Align.center(community_panel))

        self.console.print()

        # Pot
        pot_text = Text(f"💰 POT: ${game_state.pot:,}", style="bold green on black")
        if game_state.current_bet > 0:
            pot_text.append(
                f"  |  Current Bet: ${game_state.current_bet:,}", style="bold yellow"
            )
        self.console.print(Align.center(pot_text))
        self.console.print()

        # Players arranged in a grid (2 rows for 4-5 players)
        dealer_pos = game_state.dealer_position
        sb_pos = (dealer_pos + 1) % len(game_state.players)
        bb_pos = (dealer_pos + 2) % len(game_state.players)

        # Create player panels
        player_panels = []
        for i, player in enumerate(game_state.players):
            position_label = ""
            if i == sb_pos:
                position_label = "SB"
            elif i == bb_pos:
                position_label = "BB"

            is_current = current_player and player.name == current_player.name
            show_cards = show_all_cards or is_current

            panel = self._create_player_panel(
                player=player,
                is_current=is_current,
                is_dealer=(i == dealer_pos),
                position_label=position_label,
                show_cards=show_cards,
            )
            player_panels.append(panel)

        # Display players in rows
        if len(player_panels) <= 3:
            self.console.print(Align.center(Columns(player_panels, padding=2)))
        elif len(player_panels) == 4:
            self.console.print(
                Align.center(Columns(player_panels[:2], padding=2))
            )
            self.console.print()
            self.console.print(
                Align.center(Columns(player_panels[2:], padding=2))
            )
        else:  # 5 players
            self.console.print(
                Align.center(Columns(player_panels[:3], padding=2))
            )
            self.console.print()
            self.console.print(
                Align.center(Columns(player_panels[3:], padding=2))
            )

        self.console.print()

        # Display action history at bottom
        if self.action_history:
            self.console.rule("Recent Actions", style="dim")
            for action_entry in self.action_history[-5:]:  # Show last 5 actions
                self.console.print(action_entry)
            self.console.print()

    def display_action(
        self, player: PlayerState, action: Action, player_action: PlayerAction | None = None
    ):
        """Display a player's action with poker face and conversation."""
        # Build action text
        action_text = Text()
        action_text.append(f"➜ {player.name} ", style="bold cyan")

        if action.action_type == "fold":
            action_text.append("folds", style="red")
        elif action.action_type == "call":
            action_text.append(f"calls ${action.amount:,}", style="yellow")
        elif action.action_type == "raise":
            action_text.append(f"raises to ${action.amount:,}", style="bold green")
        elif action.action_type == "check":
            action_text.append("checks", style="white")
        elif action.action_type == "all-in":
            action_text.append(f"goes ALL-IN for ${action.amount:,}", style="bold red")

        # Store formatted action for history
        full_action_text = action_text.copy()

        # Poker face
        if action.poker_face:
            face_text = Text("\n   😐 ", style="dim")
            face_text.append(action.poker_face, style="italic")
            full_action_text.append(face_text)

        # Conversation
        if action.poker_conversation:
            conv_text = Text("\n   💬 ", style="dim")
            conv_text.append(f'{player.name}: ', style="bold")
            conv_text.append(f'"{action.poker_conversation}"', style="italic cyan")
            full_action_text.append(conv_text)

        # Add to history
        self.action_history.append(full_action_text)

        # Print immediately (won't disappear until next clear)
        self.console.print(full_action_text)
        self.console.print()

    def display_thinking(self, player_name: str):
        """Display thinking indicator."""
        self.console.print(
            Text(f"   🤔 {player_name} is thinking...", style="dim italic")
        )

    def display_winner(self, winners: list[tuple[PlayerState, str]], pot: int):
        """Display winner announcement."""
        self.console.print()
        self.console.rule("🏆 WINNER 🏆", style="bold yellow")
        self.console.print()

        if len(winners) == 1:
            winner, hand_desc = winners[0]
            winner_text = Text()
            winner_text.append(f"{winner.name}", style="bold yellow")
            winner_text.append(f" wins ${pot:,} ", style="bold green")
            winner_text.append(f"with {hand_desc}", style="white")
            self.console.print(Align.center(winner_text))
        else:
            self.console.print(
                Align.center(Text("Split Pot!", style="bold yellow"))
            )
            for winner, hand_desc in winners:
                winner_text = Text()
                winner_text.append(f"{winner.name}", style="bold yellow")
                winner_text.append(f" - {hand_desc}", style="white")
                winner_text.append(f" (${pot // len(winners):,})", style="bold green")
                self.console.print(Align.center(winner_text))

        self.console.print()
        self.console.rule(style="bold yellow")

    def clear_action_history(self):
        """Clear the action history (call this at start of new hand)."""
        self.action_history = []

    def display_game_start(self, players: list[PlayerState], game_id: str):
        """Display game start screen."""
        self.console.clear()

        # Title
        title = Text("🎰 TEXAS HOLD'EM - HIGH STAKES LLM POKER 🎰", style="bold cyan")
        self.console.print()
        self.console.print(Align.center(title))
        self.console.print()
        self.console.print(
            Align.center(Text(f"Game ID: {game_id}", style="dim"))
        )
        self.console.print()

        # Players table
        table = Table(title="Players", show_header=True, header_style="bold cyan")
        table.add_column("#", style="dim", width=3)
        table.add_column("Name", style="bold", width=20)
        table.add_column("Chips", justify="right", style="green", width=15)
        table.add_column("Model", style="dim", width=40)

        for i, player in enumerate(players, 1):
            table.add_row(
                str(i),
                player.name,
                f"${player.chips:,}",
                player.model,
            )

        self.console.print(Align.center(table))
        self.console.print()

        self.console.print(Align.center(Text("Press Enter to start...", style="dim italic")))
        input()

    def display_game_over(self, players: list[PlayerState]):
        """Display game over screen."""
        self.console.clear()
        self.console.rule("🎰 GAME OVER 🎰", style="bold cyan")
        self.console.print()

        # Sort by chips
        sorted_players = sorted(players, key=lambda p: p.chips, reverse=True)

        table = Table(title="Final Standings", show_header=True, header_style="bold cyan")
        table.add_column("Rank", width=6)
        table.add_column("Player", style="bold", width=20)
        table.add_column("Final Chips", justify="right", style="green", width=15)
        table.add_column("Profit/Loss", justify="right", width=15)

        for i, player in enumerate(sorted_players, 1):
            medal = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else ""
            profit = player.chips - 100_000
            profit_style = "green" if profit >= 0 else "red"
            profit_str = f"+${profit:,}" if profit >= 0 else f"-${abs(profit):,}"

            table.add_row(
                f"{medal} {i}",
                player.name,
                f"${player.chips:,}",
                Text(profit_str, style=profit_style),
            )

        self.console.print(Align.center(table))
        self.console.print()
