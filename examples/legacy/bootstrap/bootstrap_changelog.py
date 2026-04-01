#!/usr/bin/env python3
"""Bootstrap examples for changelog generation.

Usage:
    export OPPER_API_KEY='your_api_key'
    python bootstrap_changelog.py
"""

from opperai import Opper
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import sys
from engine import BootstrapEngine


# ============================================================================
# SCHEMAS
# ============================================================================

class GitCommit(BaseModel):
    """A git commit with its metadata."""
    hash: str = Field(description="Commit hash (short or full)")
    author: str = Field(description="Author name and email")
    date: str = Field(description="Commit date")
    message: str = Field(description="Full commit message")
    files_changed: List[str] = Field(description="List of files changed in the commit")
    stats: Optional[dict] = Field(default=None, description="Optional stats like insertions/deletions")


class CommitInput(BaseModel):
    """Input containing multiple git commits."""
    commits: List[GitCommit] = Field(description="List of git commits to generate changelog from")
    version: Optional[str] = Field(default=None, description="Optional version tag/name for this changelog entry")


class ChangelogOutput(BaseModel):
    """Markdown-formatted changelog."""
    thoughts: str = Field(description="Summarize the key thing to take into account when generating the changelog entry from the commits.")
    changelog: str = Field(description="A well-formatted markdown changelog organized by commit type, with clear sections and proper formatting.")


INPUT_SCHEMA = CommitInput
OUTPUT_SCHEMA = ChangelogOutput


# ============================================================================
# CALL DEFINITION
# ============================================================================

def make_call(opper, input_data, examples=None):
    """Define your opper.call() here - write it just like in your app."""
    return opper.call(
        name="generate_changelog",
        instructions="""Generate a professional markdown changelog from a list of git commits.""",
        input_schema=INPUT_SCHEMA,
        output_schema=OUTPUT_SCHEMA,
        input=input_data,
        examples=examples,
        configuration={
            "invocation.few_shot.count": 3,
        },
    )


REFINEMENT_MODEL = "anthropic/claude-sonnet-4.5"


# ============================================================================
# INPUT CASES
# ============================================================================
# Define the input cases you want to iterate on

INPUT_CASES = [
    {
        "commits": [
            {
                "hash": "a1b2c3d",
                "author": "Alice Developer <alice@example.com>",
                "date": "2024-01-15 10:30:00",
                "message": "feat(api): add user profile endpoint\n\nImplement GET /api/users/:id endpoint\nwith full profile information including\npreferences and activity history.",
                "files_changed": ["src/api/users.py", "src/models/user.py", "tests/test_users.py"],
                "stats": {"insertions": 142, "deletions": 8}
            },
            {
                "hash": "e4f5g6h",
                "author": "Bob Engineer <bob@example.com>",
                "date": "2024-01-15 14:20:00",
                "message": "fix(auth): resolve token refresh race condition\n\nThe token refresh could fail when multiple\nrequests happened simultaneously. Added\nmutex locking to prevent race conditions.",
                "files_changed": ["src/auth/token_manager.py", "src/auth/refresh.py"],
                "stats": {"insertions": 23, "deletions": 12}
            },
            {
                "hash": "i7j8k9l",
                "author": "Charlie Dev <charlie@example.com>",
                "date": "2024-01-16 09:15:00",
                "message": "docs: update installation instructions\n\nUpdated README with new dependency\nrequirements and Docker setup guide.",
                "files_changed": ["README.md", "docs/installation.md"],
                "stats": {"insertions": 45, "deletions": 12}
            }
        ],
        "version": "1.2.0"
    },
    {
        "commits": [
            {
                "hash": "m1n2o3p",
                "author": "David Maintainer <david@example.com>",
                "date": "2024-01-20 11:00:00",
                "message": "refactor(database): migrate to async queries\n\nBREAKING CHANGE: All database client methods\nnow return coroutines and must be awaited.\nUpdate all call sites accordingly.",
                "files_changed": ["src/db/connection.py", "src/db/queries.py"],
                "stats": {"insertions": 201, "deletions": 156}
            },
            {
                "hash": "q4r5s6t",
                "author": "Eve Optimizer <eve@example.com>",
                "date": "2024-01-20 16:45:00",
                "message": "perf: optimize image processing pipeline\n\nReduced image processing time by 60% through\nbetter caching and parallel processing.",
                "files_changed": ["src/image/processor.py", "src/image/utils.py"],
                "stats": {"insertions": 89, "deletions": 43}
            }
        ],
        "version": "2.0.0"
    },
    {
        "commits": [
            {
                "hash": "u7v8w9x",
                "author": "Frank Frontend <frank@example.com>",
                "date": "2024-01-25 13:30:00",
                "message": "feat(ui): add dark mode toggle\n\nImplement dark mode with theme persistence\nand system preference detection.",
                "files_changed": ["src/components/ThemeToggle.tsx", "src/hooks/useTheme.ts", "src/styles/dark.css"],
                "stats": {"insertions": 234, "deletions": 0}
            },
            {
                "hash": "y1z2a3b",
                "author": "Grace Tester <grace@example.com>",
                "date": "2024-01-25 15:20:00",
                "message": "test: add E2E tests for checkout flow\n\nComprehensive end-to-end tests covering\npayment processing and order confirmation.",
                "files_changed": ["tests/e2e/checkout.test.ts", "tests/fixtures/checkout.json"],
                "stats": {"insertions": 312, "deletions": 0}
            },
            {
                "hash": "c4d5e6f",
                "author": "Henry Fixer <henry@example.com>",
                "date": "2024-01-26 10:10:00",
                "message": "fix: prevent memory leak in event handlers\n\nEvent listeners were not being properly\nremoved, causing memory leaks over time.",
                "files_changed": ["src/core/event_bus.py"],
                "stats": {"insertions": 12, "deletions": 8}
            },
            {
                "hash": "g7h8i9j",
                "author": "Iris Maintainer <iris@example.com>",
                "date": "2024-01-26 14:00:00",
                "message": "chore(deps): update dependencies to latest\n\nUpdate all npm and pip dependencies to\nlatest stable versions with security fixes.",
                "files_changed": ["package.json", "requirements.txt", "package-lock.json"],
                "stats": {"insertions": 45, "deletions": 38}
            }
        ],
        "version": "1.3.0"
    },
]


# ============================================================================
# MAIN
# ============================================================================

def main():
    api_key = os.getenv("OPPER_API_KEY", "")
    if not api_key:
        print("\n✗ Error: OPPER_API_KEY environment variable not set")
        print("Please set your API key: export OPPER_API_KEY='your_key_here'")
        sys.exit(1)
    
    try:
        opper = Opper(http_bearer=api_key)
    except Exception as e:
        print(f"\n✗ Error initializing Opper client: {e}")
        sys.exit(1)
    
    # Option 1: Use provided synthetic inputs (current approach)
    #engine = BootstrapEngine(
    #    make_call_func=make_call,
    #    synthetic_inputs=INPUT_CASES,
    #    input_schema=INPUT_SCHEMA,
    #    output_schema=OUTPUT_SCHEMA,
    #    refinement_model=REFINEMENT_MODEL
    #)
    
    # Option 2: Auto-generate synthetic inputs from schema (alternative)
    engine = BootstrapEngine(
        make_call_func=make_call,
        input_schema=INPUT_SCHEMA,
        output_schema=OUTPUT_SCHEMA,
        auto_generate_inputs=True,  # Enable on-demand auto-generation from instructions and schemas
        refinement_model=REFINEMENT_MODEL
    )
    
    engine.run(opper, title="Changelog Generator - Example Bootstrapper")


if __name__ == "__main__":
    main()

