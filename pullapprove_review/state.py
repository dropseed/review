"""Review state model and persistence."""

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


class Comparison(BaseModel):
    """Structured comparison key."""

    old: str  # base branch (e.g., "master")
    new: str | None = None  # compare ref, None if comparing to working tree directly
    working_tree: bool = False  # whether uncommitted changes are included
    key: str  # full string key for file naming/lookup (e.g., "master..feature+")


class HunkState(BaseModel):
    """State for a single hunk."""

    suggested: Literal["human", "agent", "undecided"] | None = (
        None  # Classification: who should review
    )
    reviewed_by: Literal["human", "agent"] | None = (
        None  # Who actually marked it as reviewed
    )
    reason: str | None = None  # Classification reason


class ReviewState(BaseModel):
    """Persisted review state for a comparison."""

    comparison: Comparison
    hunks: dict[str, HunkState] = Field(
        default_factory=dict
    )  # "filepath:hash" -> state
    notes: str = ""
    created_at: str = ""
    updated_at: str = ""


def _now_iso() -> str:
    """Return current time as ISO 8601 string."""
    return datetime.now(UTC).isoformat()


class ReviewStateService:
    """Service for managing review state persistence."""

    STATE_DIR_NAME = ".pullapprove"
    REVIEWS_DIR_NAME = "reviews"
    CURRENT_FILE_NAME = "current"

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self._cache: dict[str, ReviewState] = {}

    @property
    def state_dir(self) -> Path:
        """Get the reviews state directory."""
        return self.repo_root / self.STATE_DIR_NAME / self.REVIEWS_DIR_NAME

    @property
    def current_file(self) -> Path:
        """Get the current comparison file path."""
        return self.repo_root / self.STATE_DIR_NAME / self.CURRENT_FILE_NAME

    def ensure_directory(self) -> None:
        """Ensure the state directory exists with .gitignore."""
        self.state_dir.mkdir(parents=True, exist_ok=True)

        # Create .gitignore in .pullapprove dir to ignore its contents
        gitignore_path = self.repo_root / self.STATE_DIR_NAME / ".gitignore"
        if not gitignore_path.exists():
            gitignore_path.write_text("*\n")

    @staticmethod
    def sanitize_key(comparison_key: str) -> str:
        """Convert comparison key to filesystem-safe filename."""
        return re.sub(r"[^a-zA-Z0-9.+-]", "_", comparison_key)

    @staticmethod
    def make_comparison(
        base: str, compare: str | None, current_branch: str | None = None
    ) -> Comparison:
        """Create a Comparison from base and compare refs.

        Args:
            base: The base ref (e.g., "main")
            compare: The compare ref, or None for working tree
            current_branch: Current branch name (used for working tree comparisons)
        """
        if compare is None:
            # Working tree comparison - use + suffix
            branch = current_branch or "HEAD"
            key = f"{base}..{branch}+"
            return Comparison(old=base, new=branch, working_tree=True, key=key)
        else:
            key = f"{base}..{compare}"
            return Comparison(old=base, new=compare, working_tree=False, key=key)

    def get_file_path(self, comparison_key: str) -> Path:
        """Get the file path for a comparison key."""
        sanitized = self.sanitize_key(comparison_key)
        return self.state_dir / f"{sanitized}.json"

    def load(self, comparison_key: str) -> ReviewState:
        """Load state for a comparison key, creating empty if not exists."""
        # Check cache
        if comparison_key in self._cache:
            return self._cache[comparison_key]

        file_path = self.get_file_path(comparison_key)
        if file_path.exists():
            try:
                data = json.loads(file_path.read_text())
                state = self._migrate_state(data, comparison_key)
                self._cache[comparison_key] = state
                return state
            except (json.JSONDecodeError, ValueError):
                pass

        # Return empty state
        now = _now_iso()
        # Parse comparison key to create Comparison object
        comparison = self._parse_comparison_key(comparison_key)
        state = ReviewState(comparison=comparison, created_at=now, updated_at=now)
        return state

    def _parse_comparison_key(self, comparison_key: str) -> Comparison:
        """Parse a comparison key string into a Comparison object."""
        working_tree = comparison_key.endswith("+")
        key_without_plus = comparison_key.rstrip("+")

        if ".." in key_without_plus:
            old, new = key_without_plus.split("..", 1)
            return Comparison(
                old=old,
                new=new if new else None,
                working_tree=working_tree or not new,
                key=comparison_key,
            )

        # Simple format: just a branch name means compare to working tree
        return Comparison(
            old=key_without_plus, new=None, working_tree=True, key=comparison_key
        )

    def _migrate_state(self, data: dict, comparison_key: str) -> ReviewState:
        """Migrate old state formats to current format."""
        now = _now_iso()

        # Handle old format with comparisonKey (string) instead of comparison (dict)
        if "comparisonKey" in data and "comparison" not in data:
            data["comparison"] = self._parse_comparison_key(
                data.pop("comparisonKey")
            ).model_dump()

        # Handle old format with reviewedHunks list instead of hunks dict
        if "reviewedHunks" in data or "reviewed_hunks" in data:
            old_reviewed = data.pop("reviewedHunks", []) or data.pop(
                "reviewed_hunks", []
            )
            hunks = data.get("hunks", {})
            for hunk_key in old_reviewed:
                if hunk_key not in hunks:
                    hunks[hunk_key] = {"reviewed_by": "human"}
                else:
                    hunks[hunk_key]["reviewed_by"] = "human"
            data["hunks"] = hunks

        # Handle old classifications dict
        if "classifications" in data:
            classifications = data.pop("classifications")
            hunks = data.get("hunks", {})
            for hunk_key, classification in classifications.items():
                if hunk_key not in hunks:
                    hunks[hunk_key] = {}
                # Migrate trivial -> suggested: trivial=true -> "agent", trivial=false -> "human"
                old_trivial = classification.get("trivial")
                if old_trivial is True:
                    hunks[hunk_key]["suggested"] = "agent"
                elif old_trivial is False:
                    hunks[hunk_key]["suggested"] = "human"
                else:
                    hunks[hunk_key]["suggested"] = None
                hunks[hunk_key]["reason"] = classification.get("reason")
            data["hunks"] = hunks

        # Migrate old fields in hunks to new format
        hunks = data.get("hunks", {})
        for hunk_key, hunk_data in hunks.items():
            # Migrate old reviewed: bool to reviewed_by
            if "reviewed" in hunk_data and "reviewed_by" not in hunk_data:
                old_reviewed = hunk_data.pop("reviewed")
                if old_reviewed:
                    hunk_data["reviewed_by"] = (
                        "human"  # Assume human for old reviewed hunks
                    )
                else:
                    hunk_data["reviewed_by"] = None

            # Migrate old review field to suggested
            if "review" in hunk_data and "suggested" not in hunk_data:
                hunk_data["suggested"] = hunk_data.pop("review")

            # Migrate trivial field
            if "trivial" in hunk_data and "suggested" not in hunk_data:
                old_trivial = hunk_data.pop("trivial")
                if old_trivial is True:
                    hunk_data["suggested"] = "agent"
                elif old_trivial is False:
                    hunk_data["suggested"] = "human"
                else:
                    hunk_data["suggested"] = None

            # Migrate human field (from intermediate format)
            if "human" in hunk_data and "suggested" not in hunk_data:
                old_human = hunk_data.pop("human")
                if old_human == "required":
                    hunk_data["suggested"] = "human"
                elif old_human in ("optional", "auto"):
                    hunk_data["suggested"] = "agent"
                elif old_human == "undecided":
                    hunk_data["suggested"] = "undecided"
                else:
                    hunk_data["suggested"] = None

        # Ensure timestamps exist
        if "created_at" not in data:
            data["created_at"] = now
        if "updated_at" not in data:
            data["updated_at"] = now

        # Ensure comparison is valid
        if "comparison" not in data:
            data["comparison"] = self._parse_comparison_key(comparison_key).model_dump()

        return ReviewState(**data)

    def save(self, state: ReviewState) -> None:
        """Save state to disk."""
        state.updated_at = _now_iso()
        self._cache[state.comparison.key] = state
        self.ensure_directory()
        file_path = self.get_file_path(state.comparison.key)
        file_path.write_text(json.dumps(state.model_dump(), indent=2) + "\n")

    def clear(self, comparison_key: str) -> None:
        """Clear state for a comparison key."""
        self._cache.pop(comparison_key, None)
        file_path = self.get_file_path(comparison_key)
        if file_path.exists():
            file_path.unlink()

    def get_current_comparison(self) -> str | None:
        """Get the current comparison key from .pullapprove/current."""
        if self.current_file.exists():
            return self.current_file.read_text().strip() or None
        return None

    def set_current_comparison(self, comparison_key: str) -> None:
        """Set the current comparison key."""
        self.ensure_directory()
        self.current_file.write_text(comparison_key + "\n")

    def clear_current_comparison(self) -> None:
        """Clear the current comparison."""
        if self.current_file.exists():
            self.current_file.unlink()

    def _get_or_create_hunk(self, state: ReviewState, hunk_key: str) -> HunkState:
        """Get existing hunk state or create a new one."""
        if hunk_key not in state.hunks:
            state.hunks[hunk_key] = HunkState()
        return state.hunks[hunk_key]

    def mark_hunk(
        self,
        comparison_key: str,
        hunk_key: str,
        reviewed_by: Literal["human", "agent"] = "human",
    ) -> None:
        """Mark a hunk as reviewed."""
        state = self.load(comparison_key)
        hunk = self._get_or_create_hunk(state, hunk_key)
        if hunk.reviewed_by is None:
            hunk.reviewed_by = reviewed_by
            self.save(state)

    def unmark_hunk(self, comparison_key: str, hunk_key: str) -> None:
        """Unmark a hunk as reviewed."""
        state = self.load(comparison_key)
        if hunk_key in state.hunks and state.hunks[hunk_key].reviewed_by is not None:
            state.hunks[hunk_key].reviewed_by = None
            self.save(state)

    def is_hunk_reviewed(self, comparison_key: str, hunk_key: str) -> bool:
        """Check if a hunk is marked as reviewed."""
        state = self.load(comparison_key)
        hunk = state.hunks.get(hunk_key)
        return hunk.reviewed_by is not None if hunk else False

    def get_reviewed_hunk_keys(self, comparison_key: str) -> list[str]:
        """Get list of hunk keys that are reviewed."""
        state = self.load(comparison_key)
        return [
            key for key, hunk in state.hunks.items() if hunk.reviewed_by is not None
        ]

    def update_notes(self, comparison_key: str, notes: str) -> None:
        """Update the notes for a comparison."""
        state = self.load(comparison_key)
        state.notes = notes
        self.save(state)

    def append_notes(self, comparison_key: str, text: str) -> None:
        """Append text to the notes for a comparison."""
        state = self.load(comparison_key)
        if state.notes:
            state.notes = state.notes.rstrip() + "\n\n" + text
        else:
            state.notes = text
        self.save(state)

    def set_classification(
        self,
        comparison_key: str,
        hunk_key: str,
        suggested: Literal["human", "agent", "undecided"],
        reason: str,
    ) -> None:
        """Set classification for a hunk."""
        state = self.load(comparison_key)
        hunk = self._get_or_create_hunk(state, hunk_key)
        hunk.suggested = suggested
        hunk.reason = reason
        self.save(state)

    def set_classifications(
        self, comparison_key: str, classifications: dict[str, dict]
    ) -> None:
        """Set multiple classifications at once."""
        state = self.load(comparison_key)
        for hunk_key, data in classifications.items():
            hunk = self._get_or_create_hunk(state, hunk_key)
            hunk.suggested = data.get("suggested", data.get("review", "agent"))
            hunk.reason = data.get("reason", "")
        self.save(state)

    def get_classification(
        self, comparison_key: str, hunk_key: str
    ) -> HunkState | None:
        """Get classification for a hunk."""
        state = self.load(comparison_key)
        hunk = state.hunks.get(hunk_key)
        if hunk and hunk.suggested is not None:
            return hunk
        return None

    def get_agent_hunk_keys(self, comparison_key: str) -> list[str]:
        """Get list of hunk keys that can be marked by agent (suggested == 'agent')."""
        state = self.load(comparison_key)
        return [
            hunk_key
            for hunk_key, hunk in state.hunks.items()
            if hunk.suggested == "agent"
        ]

    def clear_classifications(self, comparison_key: str) -> None:
        """Clear all classifications for a comparison (keeps reviewed_by)."""
        state = self.load(comparison_key)
        for hunk in state.hunks.values():
            hunk.suggested = None
            hunk.reason = None
        self.save(state)
