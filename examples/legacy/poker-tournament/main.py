"""Main game loop for Texas Hold'em LLM poker."""

import os
import time
from datetime import datetime
from opperai import Opper
from game.engine import PokerEngine
from agents.player import PokerPlayer
from ui.table import RichPokerTable


def run_poker_game(player_configs: list[dict], max_hands: int = 50):
    """
    Run a poker game.

    Args:
        player_configs: List of dicts with 'name' and 'model' keys
        max_hands: Maximum number of hands to play before ending
    """
    # Generate unique game ID based on timestamp
    game_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Initialize Opper client
    opper = Opper(http_bearer=os.getenv("OPPER_API_KEY"))

    # Initialize game engine
    engine = PokerEngine(player_configs)
    ui = RichPokerTable()

    # Create AI players with game_id
    ai_players = {
        player.name: PokerPlayer(player, game_id, opper)
        for player in engine.players
    }

    # Display game start
    ui.display_game_start(engine.players, game_id)

    # Game loop
    hands_played = 0
    while hands_played < max_hands:
        # Check if only one player has chips
        players_with_chips = engine.get_players_still_in_game()
        if len(players_with_chips) <= 1:
            break

        # Start new hand
        game_state = engine.start_new_hand()

        # Clear action history for new hand
        ui.clear_action_history()

        # Create span for this hand
        hand_span = opper.spans.create(
            name=f"hand_{game_state.hand_number}",
            input=f"Hand {game_state.hand_number} - Players: {[p.name for p in game_state.get_active_players()]}"
        )

        # Play through betting rounds
        while game_state.current_round != "showdown":
            # Get first player to act
            current_player = engine.get_first_to_act(game_state)

            # Betting round loop
            players_acted = set()
            while current_player is not None:
                # Check if betting round is complete
                if engine.is_betting_round_complete(game_state):
                    break

                # Check if only one player left
                active_players = game_state.get_active_players()
                if len(active_players) <= 1:
                    break

                # Skip if player already acted and bet is matched
                if (current_player.name in players_acted and
                    current_player.current_bet == game_state.current_bet):
                    current_player = game_state.get_next_player(
                        game_state.get_player_position(current_player.name)
                    )
                    continue

                # Display table with current player highlighted
                # Only clear screen on first action of the round
                is_first_action = len(players_acted) == 0
                ui.display_table(game_state, current_player, clear_screen=is_first_action)
                ui.display_thinking(current_player.name)

                # Small delay for readability
                time.sleep(0.5)

                # Get AI decision
                ai_player = ai_players[current_player.name]
                try:
                    action, player_action = ai_player.make_decision(
                        game_state,
                        parent_span_id=hand_span.id
                    )

                    # Apply action
                    success = engine.apply_action(game_state, current_player, action)
                    if success:
                        ui.display_action(current_player, action, player_action)
                        players_acted.add(current_player.name)
                    else:
                        # Force fold on invalid action
                        from game.state import Action
                        fold_action = Action(
                            player_name=current_player.name,
                            action_type="fold",
                            amount=0
                        )
                        engine.apply_action(game_state, current_player, fold_action)
                        ui.display_action(current_player, fold_action)

                except Exception as e:
                    ui.console.print(f"[red]Error: {e}[/red]")
                    # Force fold on error
                    from game.state import Action
                    fold_action = Action(
                        player_name=current_player.name,
                        action_type="fold",
                        amount=0
                    )
                    engine.apply_action(game_state, current_player, fold_action)
                    ui.display_action(current_player, fold_action)

                # Brief pause to see action
                time.sleep(1.5)

                # Get next player
                current_player = game_state.get_next_player(
                    game_state.get_player_position(current_player.name)
                )

            # Check if only one player remains (everyone else folded)
            active_players = game_state.get_active_players()
            if len(active_players) == 1:
                winner = active_players[0]
                ui.display_table(game_state, clear_screen=False)
                ui.display_winner([(winner, "won by default")], game_state.pot)
                engine.award_pot(game_state, [(winner, "won by default")])
                time.sleep(2)
                break

            # Advance to next round
            engine.advance_to_next_round(game_state)

            # Show table after advancing round (clear screen for new round)
            ui.display_table(game_state, clear_screen=True)
            time.sleep(2)

        # Showdown (if we reached it)
        if game_state.current_round == "showdown":
            # Show all cards (keep action history visible)
            ui.display_table(game_state, show_all_cards=True, clear_screen=False)
            time.sleep(2)

            # Determine winner
            winners = engine.determine_winner(game_state)
            ui.display_winner(winners, game_state.pot)

            # Award pot
            engine.award_pot(game_state, winners)

            time.sleep(3)

        # Update span with result
        opper.spans.update(
            span_id=hand_span.id,
            output=f"Hand complete. Pot: ${game_state.pot}. Winner(s): {[w[0].name for w in (winners if game_state.current_round == 'showdown' else [(game_state.get_active_players()[0], '')])]}"
        )

        # Move dealer button
        engine.move_dealer_button()
        hands_played += 1

    # Game over
    ui.display_game_over(engine.players)

    # Display memory summaries
    ui.console.print()
    ui.console.print(f"[bold cyan]📝 Player Memory Summaries (Game ID: {game_id}):[/bold cyan]")
    for player_name, ai_player in ai_players.items():
        summary = ai_player.get_memory_summary()
        ui.console.print(f"  {player_name}: {summary['total_memories']} memories saved")

    ui.console.print(f"\n[bold green]💾 All game memories saved to: memory/{game_id}/[/bold green]")

    return game_id


def main():
    """Main entry point."""
    # Configure players
    player_configs = [
        {"name": "Sonnet-4.5", "model": "anthropic/claude-sonnet-4.5"},
        {"name": "GPT-5", "model": "openai/gpt-5"},
        {"name": "Grok-4", "model": "xai/grok-4"},
        {"name": "Gemini-2.5", "model": "gcp/gemini-flash-latest"},

    ]

    # Run game
    run_poker_game(player_configs, max_hands=10)


if __name__ == "__main__":
    main()
