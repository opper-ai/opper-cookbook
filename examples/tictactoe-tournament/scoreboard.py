import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional, Dict, Any

logger = logging.getLogger("tictactoe.scoreboard")


@dataclass
class ScoreboardEvent:
    """Event sent from Tournament to Scoreboard for display updates."""

    event_type: str  # "match_completed", "tournament_started", "tournament_finished"
    data: Dict[str, Any]


class LiveScoreboard:
    """Handles live display of tournament progress using Rich (with logging fallback)."""

    def __init__(self, player_names: list[str], event_queue: asyncio.Queue):
        self.player_names = player_names
        self.event_queue = event_queue
        self.scores: defaultdict[str, float] = defaultdict(float)
        self.games_played: defaultdict[str, int] = defaultdict(int)

        # Pre-populate scores
        for name in player_names:
            self.scores[name] = 0.0
            self.games_played[name] = 0

        # Try to use Rich, fallback to logging
        self._use_rich = self._check_rich_availability()
        if not self._use_rich:
            logger.info("Rich not available - using logging fallback for scoreboard")

    def _check_rich_availability(self) -> bool:
        """Check if Rich is available for fancy display."""
        try:
            import rich  # noqa: F401

            return True
        except ModuleNotFoundError:
            return False

    async def run(self, refresh_hz: float = 4.0):
        """Start the scoreboard display loop."""
        if self._use_rich:
            await self._run_rich_display(refresh_hz)
        else:
            await self._run_logging_display()

    async def _run_rich_display(self, refresh_hz: float):
        """Rich-based live display with spinner and table."""
        try:
            from rich.live import Live
            from rich.table import Table
            from rich.console import Console
            from rich.spinner import Spinner
            from rich.layout import Layout
            from rich.panel import Panel
        except ImportError:
            # Fallback if Rich import fails
            await self._run_logging_display()
            return

        console = Console()

        def _make_display():
            # Create the scores table
            table = Table(title="🏆 Live Tournament Scores")
            table.add_column("Player", justify="left")
            table.add_column("Score", justify="right")
            table.add_column("Games", justify="right")

            # Sort by current score (descending)
            for name in sorted(
                self.player_names, key=lambda n: self.scores.get(n, 0.0), reverse=True
            ):
                score = self.scores.get(name, 0.0)
                g_played = self.games_played.get(name, 0)
                table.add_row(name, f"{score:+.1f}", str(g_played))

            # Create spinner with status
            spinner = Spinner("dots", text="Tournament running...", style="cyan")

            # Combine in a layout
            layout = Layout()
            layout.split_column(
                Layout(Panel(spinner, height=3), name="status"),
                Layout(table, name="scores"),
            )

            return layout

        # Refresh frequency in seconds
        interval = 1.0 / max(refresh_hz, 0.1)

        with Live(
            _make_display(),
            refresh_per_second=refresh_hz,
            console=console,
            screen=False,
        ) as live:
            try:
                # Process events and update display
                while True:
                    # Check for new events (non-blocking)
                    try:
                        event = self.event_queue.get_nowait()
                        self._process_event(event)
                        if event.event_type == "tournament_finished":
                            break
                    except asyncio.QueueEmpty:
                        pass

                    live.update(_make_display())
                    await asyncio.sleep(interval)

            except asyncio.CancelledError:
                # Final refresh before exiting
                live.update(_make_display())
                raise

    async def _run_logging_display(self):
        """Fallback logging-based display when Rich is not available."""
        logger.info("=== Tournament Started ===")
        self._log_current_scores()

        try:
            while True:
                try:
                    event = await self.event_queue.get()
                    self._process_event(event)

                    if event.event_type == "match_completed":
                        winner = event.data.get("winner")
                        loser = event.data.get("loser")
                        result = event.data.get("result")

                        if result == "WIN" and winner and loser:
                            logger.info(f"Match: {winner} defeated {loser}")
                        elif result == "TIE":
                            p1, p2 = event.data.get("players", ["?", "?"])
                            logger.info(f"Match: Tie between {p1} and {p2}")
                        elif result == "ILLEGAL":
                            offender = event.data.get("offender")
                            winner = event.data.get("winner")
                            logger.info(
                                f"Match: Illegal move by {offender}, {winner} awarded win"
                            )

                        # Log updated scores every few matches
                        total_games = sum(self.games_played.values())
                        if total_games % 10 == 0:  # Every 10 games
                            self._log_current_scores()

                    elif event.event_type == "tournament_finished":
                        logger.info("=== Tournament Finished ===")
                        self._log_current_scores()
                        break

                except asyncio.CancelledError:
                    logger.info("=== Tournament Cancelled ===")
                    self._log_current_scores()
                    raise

        except Exception as e:
            logger.error(f"Scoreboard error: {e}")

    def _process_event(self, event: ScoreboardEvent):
        """Process an event and update internal state."""
        if event.event_type == "match_completed":
            # Update scores and games played
            result = event.data.get("result")
            winner = event.data.get("winner")
            loser = event.data.get("loser")
            players = event.data.get("players", [])

            if result == "WIN" and winner and loser:
                self.scores[winner] += 1.0
                self.scores[loser] -= 1.0
                self.games_played[winner] += 1
                self.games_played[loser] += 1
            elif result == "TIE" and len(players) == 2:
                # No score change for tie
                self.games_played[players[0]] += 1
                self.games_played[players[1]] += 1
            elif result == "ILLEGAL":
                offender = event.data.get("offender")
                winner = event.data.get("winner")
                if offender and winner:
                    self.scores[offender] -= 1.0
                    self.scores[winner] += 1.0
                    self.games_played[offender] += 1
                    self.games_played[winner] += 1

    def _log_current_scores(self):
        """Log current scores in a readable format."""
        logger.info("Current Scores:")
        sorted_scores = sorted(self.scores.items(), key=lambda x: x[1], reverse=True)
        for i, (name, score) in enumerate(sorted_scores, 1):
            games = self.games_played[name]
            logger.info(f"  {i}. {name}: {score:+.1f} points ({games} games)")
