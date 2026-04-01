"""Local memory management for poker players."""

import json
import os
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Any
from datetime import datetime


@dataclass
class MemoryEntry:
    hand_number: int
    note: str
    context: str  # Brief context about when this was noted


class PlayerMemory:
    """Manages local memory storage for a player."""

    def __init__(self, player_name: str, game_id: str, memory_dir: str = "memory"):
        self.player_name = player_name
        self.game_id = game_id

        # Create game-specific directory
        self.memory_dir = Path(memory_dir) / game_id
        self.memory_file = self.memory_dir / f"{player_name}_memory.json"
        self.memories: list[MemoryEntry] = []

        # Create memory directory if it doesn't exist
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        # Start fresh for each game (don't load old memories)
        # Each game session is independent


    def _save_memories(self):
        """Save memories to disk."""
        try:
            with open(self.memory_file, 'w') as f:
                data = [asdict(memory) for memory in self.memories]
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Warning: Could not save memories for {self.player_name}: {e}")

    def add_memory(self, hand_number: int, note: str, context: str = ""):
        """Add a new memory."""
        memory = MemoryEntry(
            hand_number=hand_number,
            note=note,
            context=context
        )
        self.memories.append(memory)
        self._save_memories()

    def get_recent_memories(self, limit: int = 10) -> list[str]:
        """
        Get the most recent memories.

        Returns list of formatted memory strings.
        """
        recent = self.memories[-limit:] if len(self.memories) > limit else self.memories
        return [
            f"Hand {m.hand_number}: {m.note}" + (f" ({m.context})" if m.context else "")
            for m in recent
        ]

    def get_all_memories(self) -> list[MemoryEntry]:
        """Get all memories."""
        return self.memories

    def search_memories(self, keyword: str, limit: int = 5) -> list[str]:
        """
        Search memories for a keyword.

        Returns matching memories as formatted strings.
        """
        matches = [
            m for m in self.memories
            if keyword.lower() in m.note.lower() or keyword.lower() in m.context.lower()
        ]
        recent_matches = matches[-limit:] if len(matches) > limit else matches
        return [
            f"Hand {m.hand_number}: {m.note}" + (f" ({m.context})" if m.context else "")
            for m in recent_matches
        ]

    def clear_memories(self):
        """Clear all memories (useful for starting fresh)."""
        self.memories = []
        self._save_memories()

    def get_memory_summary(self) -> dict[str, Any]:
        """Get a summary of memory statistics."""
        return {
            "player_name": self.player_name,
            "total_memories": len(self.memories),
            "memory_file": str(self.memory_file),
            "oldest_hand": self.memories[0].hand_number if self.memories else None,
            "newest_hand": self.memories[-1].hand_number if self.memories else None
        }
