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
    new: str  # compare ref (e.g., "HEAD", "feature")
    working_tree: bool = False  # if True, diff against working tree instead of new
    key: str  # full string key for file naming/lookup (e.g., "master..HEAD[working-tree]")


class HunkState(BaseModel):
    """State for a single hunk."""

    label: str | None = None  # Classification label
    approved_via: Literal["trust", "review"] | None = None  # How it was approved
    expected_count: int | None = None  # How many hunks matched when approved


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

    STATE_DIR_NAME = "human-review"
    REVIEWS_DIR_NAME = "reviews"
    CURRENT_FILE_NAME = "current"

    def __init__(self, repo_root: Path, git_common_dir: Path | None = None):
        self.repo_root = repo_root
        self.git_common_dir = git_common_dir or repo_root
        self._cache: dict[str, ReviewState] = {}

    @property
    def state_dir(self) -> Path:
        """Get the reviews state directory.

        Uses git_common_dir so state is shared across worktrees.
        """
        return self.git_common_dir / self.STATE_DIR_NAME / self.REVIEWS_DIR_NAME

    @property
    def current_file(self) -> Path:
        """Get the current comparison file path."""
        return self.git_common_dir / self.STATE_DIR_NAME / self.CURRENT_FILE_NAME

    def ensure_directory(self) -> None:
        """Ensure the state directory exists."""
        self.state_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def sanitize_key(comparison_key: str) -> str:
        """Convert comparison key to filesystem-safe filename."""
        return re.sub(r"[^a-zA-Z0-9._-]", "_", comparison_key)

    @staticmethod
    def make_comparison(
        base: str, compare: str, *, working_tree: bool = False
    ) -> Comparison:
        """Create a Comparison from base and compare refs.

        Args:
            base: The base ref (e.g., "main")
            compare: The compare ref (e.g., "HEAD", "feature")
            working_tree: If True, diff against working tree instead of compare ref

        Note: When working_tree=True, the diff is base vs working tree.
        The compare ref is stored for the comparison key but not used for diffing.
        """
        if working_tree:
            key = f"{base}..{compare}[working-tree]"
            return Comparison(old=base, new=compare, working_tree=True, key=key)
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
        # Handle various working tree indicators (current and legacy formats)
        working_tree = False
        key_to_parse = comparison_key

        if comparison_key.endswith("[working-tree]"):
            working_tree = True
            key_to_parse = comparison_key[:-14]  # Remove [working-tree]
        elif comparison_key.endswith("[uncommitted]"):
            # Legacy format from recent changes
            working_tree = True
            key_to_parse = comparison_key[:-13]  # Remove [uncommitted]
        elif comparison_key.endswith("+"):
            # Legacy format
            working_tree = True
            key_to_parse = comparison_key[:-1]  # Remove +

        if ".." in key_to_parse:
            old, new = key_to_parse.split("..", 1)
            # For legacy keys where new might be empty or same as old
            if not new:
                new = "HEAD"
            return Comparison(
                old=old,
                new=new,
                working_tree=working_tree,
                key=comparison_key,
            )

        # Simple format: just a branch name means compare to working tree
        return Comparison(
            old=key_to_parse, new="HEAD", working_tree=True, key=comparison_key
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
                    hunks[hunk_key] = {"approved_via": "review"}
                else:
                    hunks[hunk_key]["approved_via"] = "review"
            data["hunks"] = hunks

        # Handle old classifications dict (just extract labels)
        if "classifications" in data:
            classifications = data.pop("classifications")
            hunks = data.get("hunks", {})
            for hunk_key, classification in classifications.items():
                if hunk_key not in hunks:
                    hunks[hunk_key] = {}
                hunks[hunk_key]["label"] = classification.get("reason")
            data["hunks"] = hunks

        # Migrate old "reason" field to "label"
        hunks = data.get("hunks", {})
        for hunk_key, hunk_data in hunks.items():
            if "reason" in hunk_data:
                hunk_data["label"] = hunk_data.pop("reason")
        data["hunks"] = hunks

        # Migrate old fields in hunks to new format
        hunks = data.get("hunks", {})
        for hunk_key, hunk_data in hunks.items():
            # Migrate old reviewed: bool to approved_via
            if "reviewed" in hunk_data and "approved_via" not in hunk_data:
                old_reviewed = hunk_data.pop("reviewed")
                if old_reviewed:
                    hunk_data["approved_via"] = "review"
                else:
                    hunk_data["approved_via"] = None

            # Migrate reviewed_by to approved_via
            if "reviewed_by" in hunk_data:
                old_reviewed_by = hunk_data.pop("reviewed_by")
                if "approved_via" not in hunk_data:
                    if old_reviewed_by == "agent":
                        hunk_data["approved_via"] = "trust"
                    elif old_reviewed_by == "human":
                        hunk_data["approved_via"] = "review"
                    else:
                        hunk_data["approved_via"] = None

            # Drop old suggested field (no longer used)
            hunk_data.pop("suggested", None)
            hunk_data.pop("review", None)
            hunk_data.pop("trivial", None)
            hunk_data.pop("human", None)

        # Ensure timestamps exist
        if "created_at" not in data:
            data["created_at"] = now
        if "updated_at" not in data:
            data["updated_at"] = now

        # Ensure comparison is valid
        if "comparison" not in data:
            data["comparison"] = self._parse_comparison_key(comparison_key).model_dump()
        else:
            # Migrate old comparison where new might be None
            comp = data["comparison"]
            if comp.get("new") is None:
                comp["new"] = "HEAD"

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
        """Get the current comparison key from human-review/current."""
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

    def approve_hunk(
        self,
        comparison_key: str,
        hunk_key: str,
        approved_via: Literal["trust", "review"] = "review",
        count: int = 1,
    ) -> None:
        """Approve a hunk.

        Args:
            comparison_key: The comparison key
            hunk_key: The hunk key (filepath:hash)
            approved_via: How the hunk was approved
            count: How many hunks have this key in the current diff
        """
        state = self.load(comparison_key)
        hunk = self._get_or_create_hunk(state, hunk_key)
        if hunk.approved_via is None:
            hunk.approved_via = approved_via
            hunk.expected_count = count
            self.save(state)

    def unapprove_hunk(self, comparison_key: str, hunk_key: str) -> None:
        """Remove approval from a hunk."""
        state = self.load(comparison_key)
        if hunk_key in state.hunks and state.hunks[hunk_key].approved_via is not None:
            state.hunks[hunk_key].approved_via = None
            self.save(state)

    def is_hunk_approved(self, comparison_key: str, hunk_key: str) -> bool:
        """Check if a hunk is approved."""
        state = self.load(comparison_key)
        hunk = state.hunks.get(hunk_key)
        return hunk.approved_via is not None if hunk else False

    def get_approved_hunk_keys(self, comparison_key: str) -> list[str]:
        """Get list of hunk keys that are approved."""
        state = self.load(comparison_key)
        return [
            key for key, hunk in state.hunks.items() if hunk.approved_via is not None
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

    def set_label(
        self,
        comparison_key: str,
        hunk_key: str,
        label: str,
    ) -> None:
        """Set classification label for a hunk."""
        state = self.load(comparison_key)
        hunk = self._get_or_create_hunk(state, hunk_key)
        hunk.label = label
        self.save(state)

    def set_labels(self, comparison_key: str, labels: dict[str, str]) -> None:
        """Set multiple classification labels at once.

        Args:
            comparison_key: The comparison key
            labels: Dict mapping hunk_key to label string
        """
        state = self.load(comparison_key)
        for hunk_key, label in labels.items():
            hunk = self._get_or_create_hunk(state, hunk_key)
            hunk.label = label
        self.save(state)

    def get_label(self, comparison_key: str, hunk_key: str) -> str | None:
        """Get classification label for a hunk."""
        state = self.load(comparison_key)
        hunk = state.hunks.get(hunk_key)
        return hunk.label if hunk else None

    def get_hunks_by_label(self, comparison_key: str) -> dict[str, list[str]]:
        """Get hunk keys grouped by label.

        Returns:
            Dict mapping label string to list of hunk keys with that label.
            Hunks without a label are grouped under empty string key.
        """
        state = self.load(comparison_key)
        result: dict[str, list[str]] = {}
        for hunk_key, hunk in state.hunks.items():
            label = hunk.label or ""
            if label not in result:
                result[label] = []
            result[label].append(hunk_key)
        return result

    def clear_labels(self, comparison_key: str) -> None:
        """Clear all classification labels for a comparison (keeps approved_via)."""
        state = self.load(comparison_key)
        for hunk in state.hunks.values():
            hunk.label = None
        self.save(state)

    def trust_label(
        self,
        comparison_key: str,
        label: str,
        counts: dict[str, int] | None = None,
    ) -> list[str]:
        """Trust a label, approving all hunks with that label.

        Args:
            comparison_key: The comparison key
            label: The label to trust
            counts: Optional dict mapping hunk_key to actual count in current diff

        Returns:
            List of hunk keys that were approved.
        """
        state = self.load(comparison_key)
        approved_keys = []
        for hunk_key, hunk in state.hunks.items():
            if hunk.label == label and hunk.approved_via is None:
                hunk.approved_via = "trust"
                hunk.expected_count = counts.get(hunk_key, 1) if counts else 1
                approved_keys.append(hunk_key)
        if approved_keys:
            self.save(state)
        return approved_keys

    def untrust_label(self, comparison_key: str, label: str) -> list[str]:
        """Remove trust from a label, unapproving all hunks with that label.

        Only unapproves hunks that were approved via trust (not review).

        Returns:
            List of hunk keys that were unapproved.
        """
        state = self.load(comparison_key)
        unapproved_keys = []
        for hunk_key, hunk in state.hunks.items():
            if hunk.label == label and hunk.approved_via == "trust":
                hunk.approved_via = None
                unapproved_keys.append(hunk_key)
        if unapproved_keys:
            self.save(state)
        return unapproved_keys

    def check_hunk_count(
        self, comparison_key: str, hunk_key: str, actual_count: int
    ) -> tuple[bool, int | None]:
        """Check if actual count matches expected.

        Returns (is_ok, expected_count).
        is_ok is True if count matches or decreased, False if increased.
        """
        state = self.load(comparison_key)
        hunk = state.hunks.get(hunk_key)
        if not hunk or hunk.expected_count is None:
            return True, None
        return actual_count <= hunk.expected_count, hunk.expected_count
