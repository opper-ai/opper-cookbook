"""Results and visualisation helpers for the Tic-Tac-Toe tournaments.

Run as a small CLI:

    python results.py scores        # cumulative scores line plot
    python results.py heatmap       # head-to-head heat-map
    python results.py replay --match 42  # textual board replay

The module can also be imported – key helpers:

    cumulative_scores() -> pd.DataFrame
    head_to_head_matrix() -> pd.DataFrame
    replay(match_id)  # IPython / Jupyter interactive widget

Dependencies (already common in DS stacks): pandas, matplotlib, seaborn, ipywidgets (for replay).
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from typing import Dict, List, Tuple

import pandas as pd

# Optional plotting libraries – keep runtime requirements mild.
try:
    import matplotlib.pyplot as plt
except ModuleNotFoundError:
    plt = None

try:
    import seaborn as sns
except ModuleNotFoundError:
    sns = None


# Data helpers
_DB_PATH = "tictactoe.db"


def _fetch_matches(
    con: sqlite3.Connection | None = None, tournament_id: int | None = None
) -> pd.DataFrame:
    """Return the *matches* table as a DataFrame, optionally filtered by tournament_id."""
    own_con = con is None
    if con is None:
        con = sqlite3.connect(_DB_PATH)
    try:
        if tournament_id is not None:
            return pd.read_sql(
                "SELECT * FROM matches WHERE tournament_id = ?",
                con,
                params=(tournament_id,),
            )
        else:
            return pd.read_sql("SELECT * FROM matches", con)
    finally:
        if own_con:
            con.close()


def _scoring_rows(matches: pd.DataFrame) -> List[Dict[str, float]]:
    """Return a list where each element is a dict{player: points} for one match."""
    rows: List[Dict[str, float]] = []
    for _, r in matches.iterrows():
        if r.result == "WIN":
            winner = r.player_x if r.winner_piece == "X" else r.player_o
            loser = r.player_o if winner == r.player_x else r.player_x
            rows.append({winner: 1.0, loser: -1.0})
        elif r.result == "TIE":
            rows.append({r.player_x: 0.0, r.player_o: 0.0})
        elif r.result == "ILLEGAL":
            offender = r.player_x if r.winner_piece == "X" else r.player_o
            other = r.player_o if offender == r.player_x else r.player_x
            rows.append({offender: -1.0, other: 1.0})
        else:  # – safeguard future values
            rows.append({})
    return rows


def cumulative_scores(
    tournament_id: int | None = None, max_rounds: int | None = None
) -> pd.DataFrame:
    """Return cumulative score per player after each round.

    Index = round_nr; Columns = player names; Values = cumulative score.
    """
    matches = _fetch_matches(tournament_id=tournament_id)
    if matches.empty:
        raise ValueError(
            "No matches found in the database – have you run a tournament yet?"
        )

    # Compute per-match points first
    scoring_rows = _scoring_rows(matches)

    # Create a list of records for easier aggregation
    records = []
    for idx, (_, match) in enumerate(matches.iterrows()):
        points_dict = scoring_rows[idx]
        for player, points in points_dict.items():
            records.append(
                {"round_nr": match["round_nr"], "player": player, "points": points}
            )

    if not records:
        raise ValueError("No scoring records found")

    # Convert to DataFrame and aggregate by round and player
    scores_df = pd.DataFrame(records)
    per_round = (
        scores_df.groupby(["round_nr", "player"])["points"]
        .sum()
        .unstack(fill_value=0)
        .sort_index()
    )

    # Cumulative sum over rounds
    cum = per_round.cumsum()

    # Optionally limit to the first *max_rounds* rounds
    if max_rounds is not None:
        cum = cum.loc[:max_rounds]

    cum.index.name = "round_nr"
    return cum


def head_to_head_matrix(tournament_id: int | None = None) -> pd.DataFrame:
    """Return a DataFrame (index & columns = players) of total points scored *against* each opponent."""
    m = _fetch_matches(tournament_id=tournament_id)
    players = sorted(set(m.player_x) | set(m.player_o))
    mat = pd.DataFrame(0.0, index=players, columns=players)

    for _, r in m.iterrows():
        if r.result == "WIN":
            winner = r.player_x if r.winner_piece == "X" else r.player_o
            loser = r.player_o if winner == r.player_x else r.player_x
            mat.loc[winner, loser] += 1
            mat.loc[loser, winner] -= 1  # loser loses a point
        elif r.result == "TIE":
            # zero points awarded for a tie in zero-sum scheme – nothing to record
            pass
        elif r.result == "ILLEGAL":
            offender = r.player_x if r.winner_piece == "X" else r.player_o
            other = r.player_o if offender == r.player_x else r.player_x
            mat.loc[other, offender] += 1  # other player gains the point
            mat.loc[offender, other] -= 1  # offender loses one
    return mat


# ---------------------------------------------------------------------------
# first_move_advantage helper
# ---------------------------------------------------------------------------


def first_move_advantage(tournament_id: int | None = None) -> pd.Series:
    """Return basic stats on whether the starting side (X) wins more often.

    Series keys:
        X_wins, O_wins – absolute win counts for each piece
        total_wins     – total decisive games (ties & illegals excluded)
        X_win_rate     – fraction of decisive games won by X
        O_win_rate     – fraction of decisive games won by O
    """
    m = _fetch_matches(tournament_id=tournament_id)
    if m.empty:
        raise ValueError(
            "No matches found in the database – have you run a tournament yet?"
        )

    decisive = m[m.result == "WIN"]
    x_wins = len(decisive[decisive.winner_piece == "X"])
    o_wins = len(decisive[decisive.winner_piece == "O"])
    total = x_wins + o_wins

    return pd.Series(
        {
            "X_wins": x_wins,
            "O_wins": o_wins,
            "total_wins": total,
            "X_win_rate": (x_wins / total) if total else float("nan"),
            "O_win_rate": (o_wins / total) if total else float("nan"),
        }
    )


# Opper color palette
PLOT_COLORS = [
    "#1B2E40",  # Blue Whale
    "#3C3CAF",  # Savoy Purple
    "#8CF0DC",  # Water Leaf
    "#FFD7D7",  # Translucent Silk
    "#D3D3D3",  # Light Grey
    "#8CECF2",  # Cotton Candy (light blue-green)
]


def plot_cumulative_scores(cum: pd.DataFrame, *, title: str | None = None) -> None:
    if plt is None:
        raise RuntimeError(
            "matplotlib is required for plotting – install it via `pip install matplotlib`. "
        )

    title = title or "Cumulative tournament score"

    # Use our custom color palette
    colors = PLOT_COLORS[: len(cum.columns)]
    if len(cum.columns) > len(PLOT_COLORS):
        # If we have more players than colors, cycle through the palette
        colors = (PLOT_COLORS * ((len(cum.columns) // len(PLOT_COLORS)) + 1))[
            : len(cum.columns)
        ]

    ax = cum.plot(marker="o", figsize=(10, 6), color=colors, linewidth=2.5)
    plt.title(title, fontsize=16, fontweight="bold", pad=20)
    plt.xlabel("Round", fontsize=12)
    plt.ylabel("Score", fontsize=12)
    plt.grid(True, linestyle=":", alpha=0.3)

    # Improve legend
    plt.legend(bbox_to_anchor=(1.05, 1), loc="upper left", frameon=False)

    # Set background color
    ax.set_facecolor("#FAFAFA")
    plt.gcf().patch.set_facecolor("white")

    plt.tight_layout()
    plt.show()


def plot_heatmap(mat: pd.DataFrame, *, title: str | None = None) -> None:
    if sns is None:
        raise RuntimeError(
            "seaborn is required for heat-map – install via `pip install seaborn`. "
        )

    plt.figure(figsize=(8, 6))

    # Create a custom colormap using our palette colors
    from matplotlib.colors import LinearSegmentedColormap

    colors_for_heatmap = [
        "#F8F8F8",
        "#8CF0DC",
        "#3C3CAF",
        "#1B2E40",
    ]  # Light to dark progression
    custom_cmap = LinearSegmentedColormap.from_list("custom", colors_for_heatmap)

    sns.heatmap(
        mat,
        annot=True,
        fmt=".1f",
        cmap=custom_cmap,
        cbar=True,
        square=True,
        linewidths=0.5,
        linecolor="white",
        annot_kws={"fontsize": 10, "fontweight": "bold"},
    )

    plt.title(title or "Head-to-head points", fontsize=16, fontweight="bold", pad=20)
    plt.xlabel("Opponent", fontsize=12)
    plt.ylabel("Player", fontsize=12)

    # Rotate labels for better readability
    plt.xticks(rotation=45, ha="right")
    plt.yticks(rotation=0)

    plt.tight_layout()
    plt.show()


# ---------------------------------------------------------------------------
# Interactive replay (not used in CLI – but handy in notebooks)
# ---------------------------------------------------------------------------

try:
    import ipywidgets as widgets
    from IPython.display import display, HTML

    def _pretty_board(board_state: str) -> str:
        b = list(board_state)
        rows = [b[i : i + 3] for i in range(0, 9, 3)]
        to_cell = lambda c: c if c != " " else "&nbsp;"
        return "<br>".join(" | ".join(map(to_cell, r)) for r in rows)

    def replay(match_id: int):  # type: ignore
        """Display an IPython slider widget to scrub through *match_id* moves."""
        con = sqlite3.connect(_DB_PATH)
        moves = pd.read_sql(
            "SELECT move_nr, board_state FROM moves WHERE match_id = ? ORDER BY move_nr",
            con,
            params=(match_id,),
        )
        if moves.empty:
            raise ValueError(f"No moves found for match id {match_id}.")

        slider = widgets.IntSlider(min=1, max=len(moves), step=1, description="Move")
        out = widgets.Output()

        def _update(change):
            out.clear_output()
            board_html = _pretty_board(
                moves.loc[moves.move_nr == change["new"], "board_state"].iloc[0]
            )
            with out:
                display(HTML(f"<pre style='font-size:24px'>{board_html}</pre>"))

        slider.observe(_update, names="value")
        _update({"new": 1})  # initialise
        display(slider, out)

except ModuleNotFoundError:
    # ipywidgets or IPython not available – silently skip definition
    pass


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------


def _cli() -> None:
    p = argparse.ArgumentParser("results.py – tournament visualisation helpers")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub_scores = sub.add_parser("scores", help="Show cumulative score line chart")
    sub_scores.add_argument(
        "--no-plot", action="store_true", help="Only print the table – no chart"
    )
    sub_scores.add_argument(
        "--tournament",
        type=int,
        help="Tournament ID to analyze (default: all tournaments)",
    )
    sub_scores.add_argument(
        "--rounds", type=int, metavar="N", help="Only consider the first N rounds"
    )

    sub_hm = sub.add_parser("heatmap", help="Show head-to-head heat-map")
    sub_hm.add_argument(
        "--tournament",
        type=int,
        help="Tournament ID to analyze (default: all tournaments)",
    )

    sub_first = sub.add_parser(
        "firstmove",
        help="Show win-rate for the starting player (piece X) versus second player (O)",
    )
    sub_first.add_argument(
        "--tournament",
        type=int,
        help="Tournament ID to analyze (default: all tournaments)",
    )

    sub_replay = sub.add_parser("replay", help="Textual replay of a match")
    sub_replay.add_argument(
        "--match", type=int, required=True, help="Match ID to replay"
    )

    sub_list = sub.add_parser("list", help="List available tournaments")

    args = p.parse_args()

    if args.cmd == "scores":
        cum = cumulative_scores(tournament_id=args.tournament, max_rounds=args.rounds)
        if args.no_plot or plt is None:
            print(cum)
        else:
            plot_cumulative_scores(cum)

    elif args.cmd == "heatmap":
        mat = head_to_head_matrix(tournament_id=args.tournament)
        if sns is None or plt is None:
            print(mat)
        else:
            plot_heatmap(mat)

    elif args.cmd == "firstmove":
        stats = first_move_advantage(tournament_id=args.tournament)
        print(stats.to_string())

    elif args.cmd == "replay":
        match_id = args.match
        # textual replay – prints board after each move
        con = sqlite3.connect(_DB_PATH)
        moves = pd.read_sql(
            "SELECT move_nr, board_state, piece, move_idx FROM moves WHERE match_id = ? ORDER BY move_nr",
            con,
            params=(match_id,),
        )
        if moves.empty:
            print(f"No moves found for match id {match_id}.")
            sys.exit(1)

        def _board_to_lines(board_state: str) -> List[str]:
            b = list(board_state)
            lines = []
            for i in range(0, 9, 3):
                row = " | ".join(c if c != " " else " " for c in b[i : i + 3])
                lines.append(row)
            return lines

        for _, mv in moves.iterrows():
            print(f"\nMove {mv.move_nr} | Player: {mv.piece} | Index: {mv.move_idx}")
            for ln in _board_to_lines(mv.board_state):
                print(" " * 4 + ln)

    elif args.cmd == "list":
        con = sqlite3.connect(_DB_PATH)
        tournaments = pd.read_sql(
            "SELECT id, created_at, rounds, schedule FROM tournaments ORDER BY id", con
        )
        if tournaments.empty:
            print("No tournaments found in the database.")
        else:
            print("Available tournaments:")
            print(tournaments.to_string(index=False))

    else:
        p.error(f"Unexpected command {args.cmd}")


if __name__ == "__main__":
    _cli()
