import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass
from enum import Enum
from typing import Tuple, List
from schemas import TicTacToeInput, TicTacToeOutput, TicTacToeOutputReasoning
from opperai import Opper
import random
import datetime as _dt
from datetime import UTC
import contextlib
from scoreboard import LiveScoreboard, ScoreboardEvent

# random.seed(42)

try:
    from persistence import SessionLocal, TournamentORM, MatchORM, MoveORM
except ModuleNotFoundError:
    SessionLocal = None
    TournamentORM = MatchORM = MoveORM = None

try:
    from opperai.errors import BadRequestError
except Exception:
    BadRequestError = Exception

logger = logging.getLogger("tictactoe.game")

WIN_LINES = [
    (0, 1, 2),
    (3, 4, 5),
    (6, 7, 8),
    (0, 3, 6),
    (1, 4, 7),
    (2, 5, 8),
    (0, 4, 8),
    (2, 4, 6),
]


@dataclass(slots=True, frozen=True)
class Board:
    state: Tuple[str, ...] = (" ",) * 9

    def with_move(self, idx: int, piece: str) -> "Board":
        if self.state[idx] != " ":
            raise ValueError(f"Square {idx} already occupied.")
        new = list(self.state)
        new[idx] = piece
        return Board(tuple(new))

    @property
    def empty_squares(self) -> List[int]:
        return [i for i, v in enumerate(self.state) if v == " "]

    def winner(self) -> str | None:
        for a, b, c in WIN_LINES:
            if self.state[a] != " " and {
                self.state[a],
                self.state[b],
                self.state[c],
            } == {self.state[a]}:
                return self.state[a]
        return None

    def __str__(self):
        s = "\n".join(
            f"{self.state[i]}|{self.state[i + 1]}|{self.state[i + 2]}   {i} {i + 1} {i + 2}"
            for i in (0, 3, 6)
        )
        return s


class Strategy(Enum):
    ZERO_SHOT = "no-examples"
    FEW_SHOT = "few-shot"
    REASONING = "cot"


@dataclass
class Player:
    name: str
    model: str
    strategy: Strategy
    few_shot_count: int
    opper: Opper
    function_id: str | None = None
    # Opper automatically creates a dataset per function – we keep its id here
    dataset_id: str | None = None

    # API helpers

    async def add_example(
        self,
        ttt_in: TicTacToeInput,
        ttt_out: TicTacToeOutput,
        comment: str = "",
    ) -> None:
        """Append a few-shot example to this player's dataset (if any).

        Non few-shot players have *few_shot_count == 0* and therefore no dataset –
        the call becomes a no-op for them.
        """

        # Skip if player is not configured for few-shot or we missed the dataset id
        if self.few_shot_count == 0 or self.dataset_id is None:
            return

        try:
            await self.opper.datasets.create_entry_async(
                dataset_id=self.dataset_id,
                input=ttt_in.model_dump(),
                output=ttt_out.model_dump(),
                comment=comment,
            )
        except Exception as e:
            logger.warning("Could not add example for %s: %s", self.name, e)

    async def build(self) -> None:
        instructions = (
            "You are a Tic-Tac-Toe player.\n"
            "Return the index (0-8) of your move.\n"
            "Board layout is shown with indices as follows:\n\n"
            " 0 | 1 | 2\n"
            "---+---+---\n"
            " 3 | 4 | 5\n"
            "---+---+---\n"
            " 6 | 7 | 8\n\n"
            "Use this index reference to decide your move."
        )
        out_schema = (
            TicTacToeOutputReasoning
            if self.strategy == Strategy.REASONING
            else TicTacToeOutput
        )

        # try getting the function first
        try:
            fn = await self.opper.functions.get_by_name_async(name=self.name)
            logger.debug("Function %s already exists", self.name)
            self.function_id = fn.id
            # every function has an attached dataset – cache its id for later use
            self.dataset_id = getattr(fn, "dataset_id", None)
            return
        except Exception as e:
            logger.debug("Function %s doesn't exist, creating it: %s", self.name, e)

        # if function doesn't exist, create it
        try:
            fn = await self.opper.functions.create_async(
                name=self.name,
                model=self.model,
                instructions=instructions,
                input_schema=TicTacToeInput.model_json_schema(),
                output_schema=out_schema.model_json_schema(),
                configuration={
                    "invocation.few_shot.count": self.few_shot_count,
                    "beta.evaluation.enabled": False,
                },  # If you want to disable evaluation
            )
            self.function_id = fn.id
            self.dataset_id = getattr(fn, "dataset_id", None)
        except Exception as e:
            logger.debug("Error creating function %s: %s", self.name, e)
            raise e

    async def move(
        self, board: Board, piece: str, *, parent_span_id: str | None = None
    ) -> int:
        assert self.function_id, "call build() first"
        payload = TicTacToeInput(board=board.state, player_piece=piece)
        try:
            # build kwargs dynamically to avoid sending None which Opper may reject
            _kwargs = {
                "function_id": self.function_id,
                "input": payload,
            }
            if parent_span_id is not None:
                _kwargs["parent_span_id"] = parent_span_id

            response = await self.opper.functions.call_async(**_kwargs)
        except BadRequestError as e:
            # Model returned invalid / non-schema response – count as illegal move
            logger.warning("Bad request / malformed response from %s: %s", self.name, e)
            raise IllegalMove(f"Malformed response from {self.name}") from e
        except Exception as e:
            # Any other failure while obtaining a move is also treated as illegal
            logger.warning("Error while obtaining move from %s: %s", self.name, e)
            raise IllegalMove(f"Error during move by {self.name}") from e
        logger.debug("Response from %s: %s", self.name, response.json_payload)
        idx = response.json_payload["move"]
        if idx not in board.empty_squares:
            raise IllegalMove(f"Illegal move {idx} by {self.name}")
        return idx


class IllegalMove(Exception):
    """Raised when a player proposes an illegal move."""


class Game:
    def __init__(self, p1: Player, p2: Player, *, parent_span_id: str | None = None):
        self.board = Board()
        self.players = (p1, p2)  # p1 = "X", p2 = "O"
        self.parent_span_id = parent_span_id  # 👈 keep reference for nested calls
        self.history: list[tuple[Board, int, str]] = []
        self.start_ts = _dt.datetime.now(UTC)

    async def play(self) -> tuple[str, str | None]:
        """Play a single game.

        Returns a tuple (result_tag, winner_piece)

        result_tag ∈ {"WIN", "TIE", "ILLEGAL"}
        winner_piece is "X" | "O" when someone wins,
        None when the game ends in a tie, and the *offender*'s piece
        when the game ends due to an illegal move.
        """
        turn = 0
        while True:
            player = self.players[turn % 2]
            piece = "X" if turn % 2 == 0 else "O"  # p1 = "X", p2 = "O"

            try:
                idx = await player.move(
                    self.board, piece, parent_span_id=self.parent_span_id
                )
            except IllegalMove:
                # offending player's piece determines who made the error
                return ("ILLEGAL", piece)

            self.board = self.board.with_move(idx, piece)
            self.history.append((self.board, idx, piece))

            winner_piece = self.board.winner()
            if winner_piece:
                logger.debug("Game over, winner is %s", winner_piece)
                return ("WIN", winner_piece)

            if not self.board.empty_squares:
                logger.debug("Game over, tie")
                return ("TIE", None)

            turn += 1


class ScheduleMode(Enum):
    SIMULTANEOUS = "simultaneous"
    BY_ROUND = "by_round"


class Tournament:
    def __init__(
        self,
        players: list[Player],
        rounds: int = 20,
        *,
        warmup_rounds: int = 0,  # ⬅️  additional warm-up rounds (only these add examples)
        double_rounds: bool = True,  # play both "home" and "away" legs (X & O)
        semaphore: asyncio.Semaphore | None = None,
        schedule: ScheduleMode | str = ScheduleMode.SIMULTANEOUS,
        persist: bool = True,
    ):
        """Create a new tournament.

        Parameters
        ----------
        players: list[Player]
            The participants.
        rounds: int, default 20
            How many iterations of the selected *schedule* to play.
        warmup_rounds: int, default **0**
            Number of *warm-up* rounds played *before* the main tournament.  Winning
            moves from these rounds are stored as few-shot examples.  Set to *0* to
            disable additional training.
        double_rounds: bool, default **True**
            If *True* every pairing is played **twice** per round, once with
            each player starting ("home-and-away",   "double round-robin").
            Set to *False* to play only a single game per pairing.
        semaphore: asyncio.Semaphore | None, optional
            Limits total concurrent games.  When *None* (default) no limit
            is applied.
        schedule: ScheduleMode | str
            "simultaneous" (default) – run every possible pairing in every
            round concurrently.
            "by_round" – in each round pair neighbouring players (``1 vs 2``,
            ``3 vs 4`` …) and wait until those games finish before advancing
            to the next round.  Accepts either the enum member or its value
            as a string for convenience.
        persist: bool, default True
            Whether to persist tournament results to the database.
        """

        self.players = players

        # Store warm-up configuration.  We keep both counts separately but expose
        # ``self.rounds`` as the **total** number of iterations so the rest of the
        # code continues to work unchanged.
        self._warmup_rounds = max(0, warmup_rounds)
        self.rounds = rounds + self._warmup_rounds
        # normalise schedule to enum
        if isinstance(schedule, str):
            schedule = ScheduleMode(schedule)
        self.schedule = schedule
        self._double_rounds = double_rounds
        self._sem = semaphore
        self._persist = (
            persist and SessionLocal is not None
        )  # disable if no DB available
        self._tournament_id: int | None = None

        self.scores: defaultdict[str, float] = defaultdict(float)  # key = player.name

        # Pre-populate scores so every player shows up from the start
        for pl in players:
            self.scores[pl.name] = 0.0

        # Event queue for scoreboard communication
        self._scoreboard_queue: asyncio.Queue[ScoreboardEvent] | None = None

    async def build_functions(self):
        await asyncio.gather(*(p.build() for p in self.players))

    async def run(self):
        """Run the tournament according to the selected schedule."""
        await self.build_functions()

        # Create DB tournament row if persistence is enabled
        if self._persist:
            with SessionLocal() as session:
                t = TournamentORM(rounds=self.rounds, schedule=self.schedule.value)
                session.add(t)
                session.commit()
                self._tournament_id = t.id

        logger.info(
            f"Running tournament with id {self._tournament_id} and {self.rounds} rounds"
        )

        # ----------------------------------------------------------
        # Start live scoreboard
        # ----------------------------------------------------------
        self._scoreboard_queue = asyncio.Queue()
        player_names = [p.name for p in self.players]
        scoreboard = LiveScoreboard(player_names, self._scoreboard_queue)
        scoreboard_task = asyncio.create_task(scoreboard.run())

        # Signal tournament start
        await self._send_scoreboard_event("tournament_started", {})

        if self.schedule is ScheduleMode.SIMULTANEOUS:
            tasks: list[asyncio.Task] = []
            for round_idx in range(self.rounds):
                for i, p1 in enumerate(self.players):
                    for p2 in self.players[i + 1 :]:
                        # first leg: p1 starts
                        tasks.append(self._run_match(p1, p2, round_nr=round_idx))
                        # second leg: p2 starts (if enabled)
                        if self._double_rounds:
                            tasks.append(self._run_match(p2, p1, round_nr=round_idx))
            await asyncio.gather(*tasks)

        elif self.schedule is ScheduleMode.BY_ROUND:
            # play neighbours only, wait for results between rounds
            for round_idx in range(self.rounds):
                shuffled = self.players[:]
                random.shuffle(shuffled)
                tasks = []
                for i in range(0, len(shuffled) - 1, 2):
                    a, b = shuffled[i], shuffled[i + 1]
                    tasks.append(self._run_match(a, b, round_nr=round_idx))
                    if self._double_rounds:
                        tasks.append(self._run_match(b, a, round_nr=round_idx))
                if tasks:
                    await asyncio.gather(*tasks)

        # Stop live scoreboard and tidy up
        await self._send_scoreboard_event("tournament_finished", {})
        if scoreboard_task:
            # Let the scoreboard process the event and exit gracefully
            await scoreboard_task

    async def _run_match(self, p1: Player, p2: Player, *, round_nr: int):
        """Run a single match between *p1* and *p2*.

        To add variability we randomly decide who plays X and who plays O by
        swapping the player order 50 % of the time.  From this point on
        *x_player* is guaranteed to be the one using "X", *o_player* uses "O".
        """

        # Randomly assign symbols once per match
        if random.choice([True, False]):
            x_player, o_player = p1, p2
        else:
            x_player, o_player = p2, p1

        # Opper tracing – one span per match so the entire game is traceable

        match_span = x_player.opper.spans.create(name="tictactoe-match")
        span_id = match_span.id

        # Create the game with the chosen order (first player is X)
        game = Game(x_player, o_player, parent_span_id=span_id)
        if self._sem is None:
            result, piece = await game.play()
        else:
            async with self._sem:
                result, piece = await game.play()

        game_end_time = _dt.datetime.now(
            _dt.timezone.utc
        )  # Capture actual match end time

        if result == "WIN":
            winner = x_player if piece == "X" else o_player
            loser = (
                o_player if winner is x_player else x_player
            )  # new → identify loser explicitly
            self.scores[winner.name] += 1.0
            self.scores[loser.name] -= 1.0  # new → loser loses one point

            # Send scoreboard event
            await self._send_scoreboard_event(
                "match_completed",
                {
                    "result": "WIN",
                    "winner": winner.name,
                    "loser": loser.name,
                    "players": [x_player.name, o_player.name],
                },
            )

            # Add winning side's moves as few-shot examples **only during warm-up**
            if round_nr < self._warmup_rounds:
                await self._record_winning_examples(game, piece, (x_player, o_player))

        elif result == "TIE":
            # zero-sum scoring: 0 points for a tie – no score change
            await self._send_scoreboard_event(
                "match_completed",
                {"result": "TIE", "players": [x_player.name, o_player.name]},
            )

        elif result == "ILLEGAL":
            offender = x_player if piece == "X" else o_player
            other = o_player if offender is x_player else x_player
            self.scores[offender.name] -= 1.0
            self.scores[other.name] += 1.0  # adjusted: full point to opponent

            # Send scoreboard event
            await self._send_scoreboard_event(
                "match_completed",
                {
                    "result": "ILLEGAL",
                    "offender": offender.name,
                    "winner": other.name,
                    "players": [x_player.name, o_player.name],
                },
            )

        # Persist match + moves if enabled and SQLAlchemy is available
        if self._persist:
            self._save_match(round_nr, x_player, o_player, result, piece, game)

        # Finalise span – store the full history + result + metric
        def _board_to_lines(board_state: tuple[str, ...]) -> list[str]:
            return [
                " | ".join(c if c != " " else " " for c in board_state[i : i + 3])
                for i in range(0, 9, 3)
            ]

        history_blocks: list[str] = []
        for mv_nr, (board_after, idx_played, piece_played) in enumerate(
            game.history, start=1
        ):
            header = f"Move {mv_nr} | Player: {piece_played} | Index: {idx_played}"
            body = "\n".join(" " * 4 + ln for ln in _board_to_lines(board_after.state))
            history_blocks.append(f"{header}\n{body}")

        history_text = "\n\n".join(history_blocks)
        span_input = f"{x_player.name} (X) vs {o_player.name} (O) | Round {round_nr}"
        # span_status_map = {"WIN": "victory", "TIE": "tie", "ILLEGAL": "illegal"}
        # span_status = span_status_map.get(result, "unknown")

        try:
            # Update span with outcome & history
            x_player.opper.spans.update(
                span_id=span_id,
                end_time=game_end_time,
                input=span_input,
                output=history_text,
            )

            # Record metric – number of moves played
            x_player.opper.span_metrics.create_metric(
                span_id=span_id,
                dimension="n_moves",
                value=len(game.history),
            )

            # Record metric - winner
            # decide winner metric value
            if result == "WIN":
                winner_value = 0 if piece == "X" else 1  # X wins → 0, O wins → 1
                comment = f"Winner: {x_player.name if piece == 'X' else o_player.name}"
            elif result == "TIE":
                winner_value = 0.5
                comment = "Tie"
            elif result == "ILLEGAL":
                # piece == offender; winner is the *other* side
                winner_value = 1 if piece == "X" else 0  # offender X → O wins → 1
                offender = x_player if piece == "X" else o_player
                other = o_player if offender is x_player else x_player
                comment = f"Illegal move by {offender.name}; {other.name} awarded win"
            else:  # shouldn't happen, but stay safe
                winner_value = None
                comment = f"Unexpected result: {result}"
            # only emit metric if we have a numeric value
            if winner_value is not None:
                x_player.opper.span_metrics.create_metric(
                    span_id=span_id,
                    dimension="winner",
                    value=winner_value,  # 0 = P1(X), 1 = P2(O), 0.5 = tie
                    comment=comment,
                )

        except Exception as e:
            # Don't fail the whole tournament if the Opper call fails
            logger.warning("Could not finalise span %s: %s", span_id, e)

    def _save_match(
        self,
        round_nr: int,
        p1: Player,
        p2: Player,
        result: str,
        winner_piece: str | None,
        game: "Game",
    ) -> None:
        if SessionLocal is None:
            return

        with SessionLocal() as session:
            match = MatchORM(
                tournament_id=self._tournament_id,
                round_nr=round_nr,
                start_ts=game.start_ts,
                end_ts=_dt.datetime.utcnow(),
                player_x=p1.name,
                player_o=p2.name,
                result=result,
                winner_piece=winner_piece,
                total_moves=len(game.history),
            )
            session.add(match)
            session.flush()  # ensure match.id is available

            for move_nr, (board, idx, piece) in enumerate(game.history, start=1):
                session.add(
                    MoveORM(
                        match_id=match.id,
                        move_nr=move_nr,
                        board_state="".join(board.state),
                        piece=piece,
                        move_idx=idx,
                        is_winning_move=(
                            move_nr == len(game.history) and result == "WIN"
                        ),
                    )
                )
            session.commit()

    def leaderboard(self):
        return sorted(self.scores.items(), key=lambda kv: kv[1], reverse=True)

    # Few-shot example recording helpers

    async def _record_winning_examples(
        self,
        game: "Game",
        winner_piece: str,
        participants: tuple[Player, Player],
    ) -> None:
        """Turn each winning move into a training example for both players."""

        async def _board_before_move(board_after: Board, idx: int) -> Board:
            """Return a *new* board representing the state *before* the move."""
            s = list(board_after.state)
            s[idx] = " "
            return Board(tuple(s))

        tasks: list[asyncio.Task] = []
        for board_after, idx, piece in game.history:
            if piece != winner_piece:
                continue  # only consider moves by the winner

            board_before = await _board_before_move(board_after, idx)
            ttt_in = TicTacToeInput(board=board_before.state, player_piece=piece)
            ttt_out = TicTacToeOutput(move=idx)

            comment = f"Winning move {idx} in game started {game.start_ts.isoformat()}"

            # both players (even the loser) learn from the example
            for pl in participants:
                tasks.append(
                    asyncio.create_task(pl.add_example(ttt_in, ttt_out, comment))
                )

        if tasks:
            await asyncio.gather(*tasks)

    # ------------------------------------------------------------------
    # Scoreboard communication
    # ------------------------------------------------------------------
    async def _send_scoreboard_event(self, event_type: str, data: dict):
        """Send an event to the scoreboard for display updates."""
        if self._scoreboard_queue is not None:
            event = ScoreboardEvent(event_type=event_type, data=data)
            await self._scoreboard_queue.put(event)
