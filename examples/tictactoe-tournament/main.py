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
    handler.setFormatter(
        logging.Formatter("%(levelname)s: %(message)s")
    )
    app_logger.addHandler(handler)


_setup_logging()

# module-level logger for this file
logger = logging.getLogger("tictactoe.main")

async def main():
    opper = Opper(http_bearer=os.getenv("OPPER_API_KEY"))

    players = [
        # Player("gpt-4.1-nano-zero", "openai/gpt-4.1-nano", Strategy.ZERO_SHOT, 0, opper),
        # Player("gpt-4.1-nano-few", "openai/gpt-4.1-nano", Strategy.FEW_SHOT, 3, opper),
        # Player("gpt-4.1-nano-many", "openai/gpt-4.1-nano", Strategy.FEW_SHOT, 10, opper),
        # Player("gpt-4.1-nano-reason", "openai/gpt-4.1-nano", Strategy.REASONING, 0, opper),
        # Player("gpt-4.1-nano-reason-few", "openai/gpt-4.1-nano", Strategy.REASONING, 3, opper),
        # Player("gpt-4.1-nano-reason-many", "openai/gpt-4.1-nano", Strategy.REASONING, 10, opper),
        # Player("gpt-4.1-nano-reason-few", "openai/gpt-4.1-nano", Strategy.REASONING, 3, opper),
        # Player("gpt-4.1-mini-zero", "openai/gpt-4.1-mini", Strategy.ZERO_SHOT, 0, opper),
        Player("gpt-4.1-mini-few", "openai/gpt-4.1-mini", Strategy.FEW_SHOT, 3, opper),
        # Player("gpt-4.1-mini-many", "openai/gpt-4.1-mini", Strategy.FEW_SHOT, 10, opper),
        # # Player("gpt-4.1-mini-few-2", "openai/gpt-4.1-mini", Strategy.FEW_SHOT, 3, opper),
        # # Player("gpt-4.1-mini-few-3", "openai/gpt-4.1-mini", Strategy.FEW_SHOT, 3, opper),
        # Player("gpt-4.1-mini-reason", "openai/gpt-4.1-mini", Strategy.REASONING, 0, opper),
        # Player("gpt-4.1-mini-reason-few", "openai/gpt-4.1-mini", Strategy.REASONING, 3, opper),
        # Player("gpt-4.1-mini-reason-many", "openai/gpt-4.1-mini", Strategy.REASONING, 10, opper),
        Player("gpt-4.1", "openai/gpt-4.1", Strategy.ZERO_SHOT, 0, opper),
        # Player("gpt-4.1-few", "openai/gpt-4.1", Strategy.FEW_SHOT, 3, opper),
        # Player("gpt-4.1-many", "openai/gpt-4.1", Strategy.FEW_SHOT, 10, opper),
        # Player("gpt-4.1-reason", "openai/gpt-4.1", Strategy.REASONING, 0, opper),
        # Player("gpt-4.1-reason-few", "openai/gpt-4.1", Strategy.REASONING, 3, opper),
        # Player("gpt-4.1-reason-many", "openai/gpt-4.1", Strategy.REASONING, 10, opper),
        
        #Gemini vs Claude
        # Player("gemini-2.5-flash", "gcp/gemini-2.5-flash", Strategy.ZERO_SHOT, 0, opper),
        # Player("claude-sonnet-4", "anthropic/claude-sonnet-4", Strategy.ZERO_SHOT, 0, opper),
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
        rounds=2,
        semaphore=sem,
        schedule=schedule if schedule in {m.value for m in ScheduleMode} else ScheduleMode.SIMULTANEOUS,
        double_rounds=True,
        # warmup_rounds=20,
    )
    await tourney.run()
    logger.info("Leaderboard: %s", tourney.leaderboard())

if __name__ == "__main__":
    asyncio.run(main())