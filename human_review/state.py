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

    # Trust patterns recognized in this hunk (e.g., ["imports:added", "formatting:whitespace"])
    # Empty list means no trustable pattern was recognized (needs review)
    label: list[str] = Field(default_factory=list)

    # Free-form AI explanation of what the change does (always present after labeling)
    reasoning: str | None = None

    # How it was approved - only "review" now (trust is computed dynamically)
    approved_via: Literal["review"] | None = None
    count: int | None = None  # How many hunks matched when labeled (metadata)


class ReviewState(BaseModel):
    """Persisted review state for a comparison."""

    comparison: Comparison
    hunks: dict[str, HunkState] = Field(
        default_factory=dict
    )  # "filepath:hash" -> state
    trust_label: list[str] = Field(default_factory=list)  # Review-level trusted labels
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
            key = f"{base}..{compare}+working-tree"
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
        working_tree = False
        key_to_parse = comparison_key

        if comparison_key.endswith("+working-tree"):
            working_tree = True
            key_to_parse = comparison_key[:-13]  # Remove +working-tree

        if ".." not in key_to_parse:
            raise ValueError(f"Invalid comparison key: {comparison_key}")

        old, new = key_to_parse.split("..", 1)
        return Comparison(
            old=old,
            new=new,
            working_tree=working_tree,
            key=comparison_key,
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

            # Migrate old label to reasoning (label was free-form text)
            if "label" in hunk_data and not isinstance(hunk_data["label"], list):
                if "reasoning" not in hunk_data:
                    hunk_data["reasoning"] = hunk_data["label"]
                del hunk_data["label"]

            # Migrate old "trust" field to "label" (renamed in declarative refactor)
            if "trust" in hunk_data:
                hunk_data["label"] = hunk_data.pop("trust")

            # Ensure label is a list
            if "label" not in hunk_data:
                hunk_data["label"] = []

            # Migrate old "expected_count" to "count" (renamed in declarative refactor)
            if "expected_count" in hunk_data:
                hunk_data["count"] = hunk_data.pop("expected_count")

            # Convert approved_via: "trust" → None (trust is now computed dynamically)
            if hunk_data.get("approved_via") == "trust":
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
        count: int = 1,
    ) -> None:
        """Approve a hunk after manual review.

        Args:
            comparison_key: The comparison key
            hunk_key: The hunk key (filepath:hash)
            count: How many hunks have this key in the current diff
        """
        state = self.load(comparison_key)
        hunk = self._get_or_create_hunk(state, hunk_key)
        if hunk.approved_via is None:
            hunk.approved_via = "review"
            hunk.count = count
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

    def set_hunk_classification(
        self,
        comparison_key: str,
        hunk_key: str,
        label: list[str],
        reasoning: str,
        count: int | None = None,
    ) -> None:
        """Set label patterns and reasoning for a hunk.

        Args:
            comparison_key: The comparison key
            hunk_key: The hunk key (filepath:hash)
            label: List of recognized trust patterns (can be empty)
            reasoning: Free-form explanation of what the change does
            count: Optional count of how many hunks matched when labeled
        """
        state = self.load(comparison_key)
        hunk = self._get_or_create_hunk(state, hunk_key)
        hunk.label = label
        hunk.reasoning = reasoning
        if count is not None:
            hunk.count = count
        self.save(state)

    def set_hunk_classifications(
        self,
        comparison_key: str,
        classifications: dict[str, dict[str, list[str] | str]],
    ) -> None:
        """Set multiple hunk classifications at once.

        Args:
            comparison_key: The comparison key
            classifications: Dict mapping hunk_key to {"label": [...], "reasoning": "..."}
        """
        state = self.load(comparison_key)
        for hunk_key, data in classifications.items():
            hunk = self._get_or_create_hunk(state, hunk_key)
            label = data.get("label", [])
            reasoning = data.get("reasoning", "")
            hunk.label = label if isinstance(label, list) else []
            hunk.reasoning = reasoning if isinstance(reasoning, str) else ""
        self.save(state)

    def set_label(
        self,
        comparison_key: str,
        hunk_key: str,
        label: str,
    ) -> None:
        """Set reasoning for a hunk (uses reasoning field).

        This is the simple interface for setting just reasoning text.
        For full trust+reasoning, use set_hunk_classification.
        """
        state = self.load(comparison_key)
        hunk = self._get_or_create_hunk(state, hunk_key)
        hunk.reasoning = label
        self.save(state)

    def set_labels(self, comparison_key: str, labels: dict[str, str]) -> None:
        """Set reasoning for multiple hunks at once.

        Args:
            comparison_key: The comparison key
            labels: Dict mapping hunk_key to reasoning string
        """
        state = self.load(comparison_key)
        for hunk_key, label in labels.items():
            hunk = self._get_or_create_hunk(state, hunk_key)
            hunk.reasoning = label
        self.save(state)

    def get_hunk_classification(
        self, comparison_key: str, hunk_key: str
    ) -> tuple[list[str], str | None] | None:
        """Get label patterns and reasoning for a hunk.

        Returns:
            (label_patterns, reasoning) tuple, or None if hunk not found.
        """
        state = self.load(comparison_key)
        hunk = state.hunks.get(hunk_key)
        if not hunk:
            return None
        return hunk.label, hunk.reasoning

    def get_label(self, comparison_key: str, hunk_key: str) -> str | None:
        """Get reasoning for a hunk."""
        state = self.load(comparison_key)
        hunk = state.hunks.get(hunk_key)
        if not hunk:
            return None
        return hunk.reasoning

    def get_hunks_by_reasoning(self, comparison_key: str) -> dict[str, list[str]]:
        """Get hunk keys grouped by reasoning.

        Returns:
            Dict mapping reasoning string to list of hunk keys.
            Hunks without reasoning are grouped under empty string key.
        """
        state = self.load(comparison_key)
        result: dict[str, list[str]] = {}
        for hunk_key, hunk in state.hunks.items():
            reasoning = hunk.reasoning or ""
            if reasoning not in result:
                result[reasoning] = []
            result[reasoning].append(hunk_key)
        return result

    def get_hunks_by_label_pattern(self, comparison_key: str) -> dict[str, list[str]]:
        """Get hunk keys grouped by label pattern.

        Returns:
            Dict mapping pattern to list of hunk keys that have that pattern.
            A hunk with multiple patterns appears under each pattern.
        """
        state = self.load(comparison_key)
        result: dict[str, list[str]] = {}
        for hunk_key, hunk in state.hunks.items():
            if hunk.label:
                for pattern in hunk.label:
                    if pattern not in result:
                        result[pattern] = []
                    result[pattern].append(hunk_key)
            else:
                # Hunks with no label patterns go under empty string
                if "" not in result:
                    result[""] = []
                result[""].append(hunk_key)
        return result

    # Legacy method name alias
    def get_hunks_by_label(self, comparison_key: str) -> dict[str, list[str]]:
        """Get hunk keys grouped by label (legacy method).

        Returns:
            Dict mapping label string to list of hunk keys with that label.
            Hunks without a label are grouped under empty string key.
        """
        return self.get_hunks_by_reasoning(comparison_key)

    def clear_classifications(self, comparison_key: str) -> None:
        """Clear all classifications for a comparison (keeps approved_via)."""
        state = self.load(comparison_key)
        for hunk in state.hunks.values():
            hunk.label = []
            hunk.reasoning = None
        self.save(state)

    def clear_labels(self, comparison_key: str) -> None:
        """Clear all classifications for a comparison (keeps approved_via)."""
        self.clear_classifications(comparison_key)

    def add_trust_label(self, comparison_key: str, pattern: str) -> None:
        """Add a pattern to the review-level trust list.

        Args:
            comparison_key: The comparison key
            pattern: Pattern to trust (e.g., "imports:*")
        """
        state = self.load(comparison_key)
        if pattern not in state.trust_label:
            state.trust_label.append(pattern)
            self.save(state)

    def remove_trust_label(self, comparison_key: str, pattern: str) -> bool:
        """Remove a pattern from the review-level trust list.

        Returns True if pattern was found and removed.
        """
        state = self.load(comparison_key)
        if pattern in state.trust_label:
            state.trust_label.remove(pattern)
            self.save(state)
            return True
        return False

    def get_trust_labels(self, comparison_key: str) -> list[str]:
        """Get the review-level trust list."""
        state = self.load(comparison_key)
        return list(state.trust_label)
