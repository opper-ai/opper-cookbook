from __future__ import annotations

"""Database models and helpers for persisting tournament data.

This file defines a very small relational schema using SQLite via SQLAlchemy 2.0.
It is completely self-contained – importing it is enough to create the database
file (``tictactoe.db``) in the project root the first time.
"""

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Boolean,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
import datetime as _dt
from datetime import UTC

ENGINE = create_engine("sqlite:///tictactoe.db", echo=False, future=True)
SessionLocal = sessionmaker(bind=ENGINE, expire_on_commit=False, future=True)

Base = declarative_base()


class TournamentORM(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=_dt.datetime.now(UTC), nullable=False)
    rounds = Column(Integer, nullable=False)
    schedule = Column(String, nullable=False)

    matches = relationship(
        "MatchORM", back_populates="tournament", cascade="all, delete-orphan"
    )


class MatchORM(Base):
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=False)
    round_nr = Column(Integer, nullable=False)
    start_ts = Column(DateTime, nullable=False)
    end_ts = Column(DateTime, nullable=False)
    player_x = Column(String, nullable=False)
    player_o = Column(String, nullable=False)
    result = Column(String, nullable=False)  # WIN, TIE, ILLEGAL
    winner_piece = Column(String)  # X | O | NULL
    total_moves = Column(Integer, nullable=False)

    tournament = relationship("TournamentORM", back_populates="matches")
    moves = relationship(
        "MoveORM", back_populates="match", cascade="all, delete-orphan"
    )


class MoveORM(Base):
    __tablename__ = "moves"

    id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.id"), nullable=False)
    move_nr = Column(Integer, nullable=False)
    board_state = Column(String, nullable=False)  # 9-character string
    piece = Column(String, nullable=False)  # X | O
    move_idx = Column(Integer, nullable=False)
    is_winning_move = Column(Boolean, default=False, nullable=False)

    match = relationship("MatchORM", back_populates="moves")


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def init_db() -> None:
    """Create all tables if they do not exist yet."""
    Base.metadata.create_all(ENGINE)


# Run at import time so that simply importing persistence guarantees the DB
# exists.  This is cheap – SQLAlchemy will emit CREATE TABLE IF NOT EXISTS …
init_db()
