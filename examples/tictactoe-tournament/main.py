import os
import asyncio
import logging
from opperai import Opper
from game import Player, Strategy, Tournament, ScheduleMode


def _setup_logging() -> None:
    logging.getLogger().setLevel(logging.WARNING)

    app_logger = logging.getLogger("tictactoe")
    if app_logger.handlers:
        return

    app_logger.setLevel(logging.INFO)

    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    app_logger.addHandler(handler)


_setup_logging()

# module-level logger for this file
logger = logging.getLogger("tictactoe.main")


async def main():
    opper = Opper(http_bearer=os.getenv("OPPER_API_KEY"))

    players = [
        Player("gpt-4.1-mini-few", "openai/gpt-4.1-mini", Strategy.FEW_SHOT, 3, opper),
        Player("gpt-4.1-mini-zero", "openai/gpt-4.1-mini", Strategy.ZERO_SHOT, 0, opper),
        Player("claude-sonnet-4-zero", "anthropic/claude-sonnet-4", Strategy.ZERO_SHOT, 0, opper),
        Player("gpt-4.1-zero", "openai/gpt-4.1", Strategy.ZERO_SHOT, 0, opper),
        Player("grok-4-zero", "xai/grok-4", Strategy.ZERO_SHOT, 0, opper),
        Player("gemini-2.5-pro-zero", "gcp/gemini-2.5-pro", Strategy.ZERO_SHOT, 0, opper),
        Player("o3-zero", "openai/o3", Strategy.ZERO_SHOT, 0, opper),
    ]

    # Global concurrency limit (can be overridden via env var)
    max_concurrency = int(os.getenv("MAX_CONCURRENCY", "15"))
    sem = asyncio.Semaphore(max_concurrency)

    # Select schedule: "by_round" uses warm-up style round-robin; fall back to
    # full simultaneous scheduling otherwise.
    schedule = os.getenv("TOURNEY_SCHEDULE", "simultaneous")
    # schedule = "by_round"

    tourney = Tournament(
        players,
        rounds=15,
        semaphore=sem,
        schedule=(
            schedule
            if schedule in {m.value for m in ScheduleMode}
            else ScheduleMode.SIMULTANEOUS
        ),
        double_rounds=True,
        # warmup_rounds=20,
    )
    await tourney.run()
    logger.info("Leaderboard: %s", tourney.leaderboard())


if __name__ == "__main__":
    asyncio.run(main())
