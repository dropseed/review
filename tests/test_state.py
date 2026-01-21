"""Tests for state module."""

import json
from pathlib import Path

import pytest
from pullapprove_review.state import (
    Comparison,
    HunkState,
    ReviewState,
    ReviewStateService,
)


@pytest.fixture
def temp_repo(tmp_path: Path) -> Path:
    """Create a temporary directory to act as a repo root."""
    return tmp_path


@pytest.fixture
def state_service(temp_repo: Path) -> ReviewStateService:
    """Create a state service for the temp repo."""
    return ReviewStateService(temp_repo)


def make_comparison(key: str = "main..feature") -> Comparison:
    """Helper to create a Comparison object for tests."""
    if ".." in key:
        old, new = key.split("..", 1)
        working_tree = key.endswith("+")
        return Comparison(
            old=old, new=new.rstrip("+") or None, working_tree=working_tree, key=key
        )
    return Comparison(old=key, new=None, working_tree=True, key=key)


class TestReviewState:
    def test_default_values(self) -> None:
        state = ReviewState(comparison=make_comparison())
        assert state.comparison.key == "main..feature"
        assert state.hunks == {}
        assert state.notes == ""

    def test_with_values(self) -> None:
        state = ReviewState(
            comparison=make_comparison(),
            hunks={"src/foo.py:abc123": HunkState(reviewed_by="human")},
            notes="Some notes",
        )
        assert state.comparison.key == "main..feature"
        assert "src/foo.py:abc123" in state.hunks
        assert state.hunks["src/foo.py:abc123"].reviewed_by == "human"
        assert state.notes == "Some notes"


class TestReviewStateService:
    def test_state_dir(
        self, state_service: ReviewStateService, temp_repo: Path
    ) -> None:
        assert state_service.state_dir == temp_repo / ".pullapprove" / "reviews"

    def test_current_file(
        self, state_service: ReviewStateService, temp_repo: Path
    ) -> None:
        assert state_service.current_file == temp_repo / ".pullapprove" / "current"

    def test_sanitize_key(self) -> None:
        assert ReviewStateService.sanitize_key("main..feature") == "main..feature"
        assert (
            ReviewStateService.sanitize_key("main..feature/test")
            == "main..feature_test"
        )
        assert (
            ReviewStateService.sanitize_key("origin/main..HEAD+")
            == "origin_main..HEAD+"
        )

    def test_make_comparison_branch(self) -> None:
        comp = ReviewStateService.make_comparison("main", "feature")
        assert comp.key == "main..feature"
        assert comp.old == "main"
        assert comp.new == "feature"
        assert comp.working_tree is False

    def test_make_comparison_working_tree(self) -> None:
        comp = ReviewStateService.make_comparison("main", None, "feature")
        assert comp.key == "main..feature+"
        assert comp.old == "main"
        assert comp.new == "feature"
        assert comp.working_tree is True

    def test_make_comparison_working_tree_no_branch(self) -> None:
        comp = ReviewStateService.make_comparison("main", None, None)
        assert comp.key == "main..HEAD+"
        assert comp.old == "main"
        assert comp.new == "HEAD"
        assert comp.working_tree is True

    def test_ensure_directory_creates_gitignore(
        self, state_service: ReviewStateService, temp_repo: Path
    ) -> None:
        state_service.ensure_directory()
        gitignore_path = temp_repo / ".pullapprove" / ".gitignore"
        assert gitignore_path.exists()
        assert gitignore_path.read_text() == "*\n"

    def test_load_returns_empty_state(self, state_service: ReviewStateService) -> None:
        state = state_service.load("main..feature")
        assert state.comparison.key == "main..feature"
        assert state.hunks == {}
        assert state.notes == ""

    def test_save_and_load(self, state_service: ReviewStateService) -> None:
        state = ReviewState(
            comparison=make_comparison(),
            hunks={"src/foo.py:abc123": HunkState(reviewed_by="human")},
            notes="Test notes",
        )
        state_service.save(state)

        loaded = state_service.load("main..feature")
        assert loaded.comparison.key == "main..feature"
        assert "src/foo.py:abc123" in loaded.hunks
        assert loaded.hunks["src/foo.py:abc123"].reviewed_by == "human"
        assert loaded.notes == "Test notes"

    def test_clear(self, state_service: ReviewStateService) -> None:
        state = ReviewState(comparison=make_comparison(), notes="Test")
        state_service.save(state)

        file_path = state_service.get_file_path("main..feature")
        assert file_path.exists()

        state_service.clear("main..feature")
        assert not file_path.exists()

    def test_mark_hunk(self, state_service: ReviewStateService) -> None:
        state_service.mark_hunk("main..feature", "src/foo.py:abc123")
        state = state_service.load("main..feature")
        assert "src/foo.py:abc123" in state.hunks
        assert state.hunks["src/foo.py:abc123"].reviewed_by == "human"

    def test_mark_hunk_by_agent(self, state_service: ReviewStateService) -> None:
        state_service.mark_hunk("main..feature", "src/foo.py:abc123", "agent")
        state = state_service.load("main..feature")
        assert "src/foo.py:abc123" in state.hunks
        assert state.hunks["src/foo.py:abc123"].reviewed_by == "agent"

    def test_mark_hunk_idempotent(self, state_service: ReviewStateService) -> None:
        state_service.mark_hunk("main..feature", "src/foo.py:abc123")
        state_service.mark_hunk("main..feature", "src/foo.py:abc123")
        state = state_service.load("main..feature")
        # Should only have one entry for the hunk
        assert len([k for k in state.hunks if k == "src/foo.py:abc123"]) == 1
        assert state.hunks["src/foo.py:abc123"].reviewed_by == "human"

    def test_unmark_hunk(self, state_service: ReviewStateService) -> None:
        state_service.mark_hunk("main..feature", "src/foo.py:abc123")
        state_service.unmark_hunk("main..feature", "src/foo.py:abc123")
        state = state_service.load("main..feature")
        # Hunk should exist but be marked as not reviewed
        assert "src/foo.py:abc123" in state.hunks
        assert state.hunks["src/foo.py:abc123"].reviewed_by is None

    def test_is_hunk_reviewed(self, state_service: ReviewStateService) -> None:
        assert not state_service.is_hunk_reviewed("main..feature", "src/foo.py:abc123")
        state_service.mark_hunk("main..feature", "src/foo.py:abc123")
        assert state_service.is_hunk_reviewed("main..feature", "src/foo.py:abc123")

    def test_get_reviewed_hunk_keys(self, state_service: ReviewStateService) -> None:
        state_service.mark_hunk("main..feature", "src/foo.py:abc123")
        state_service.mark_hunk("main..feature", "src/bar.py:def456")
        keys = state_service.get_reviewed_hunk_keys("main..feature")
        assert len(keys) == 2
        assert "src/foo.py:abc123" in keys
        assert "src/bar.py:def456" in keys

    def test_update_notes(self, state_service: ReviewStateService) -> None:
        state_service.update_notes("main..feature", "New notes")
        state = state_service.load("main..feature")
        assert state.notes == "New notes"

    def test_append_notes(self, state_service: ReviewStateService) -> None:
        state_service.update_notes("main..feature", "First")
        state_service.append_notes("main..feature", "Second")
        state = state_service.load("main..feature")
        assert state.notes == "First\n\nSecond"

    def test_append_notes_to_empty(self, state_service: ReviewStateService) -> None:
        state_service.append_notes("main..feature", "First")
        state = state_service.load("main..feature")
        assert state.notes == "First"

    def test_get_current_comparison_none(
        self, state_service: ReviewStateService
    ) -> None:
        assert state_service.get_current_comparison() is None

    def test_set_and_get_current_comparison(
        self, state_service: ReviewStateService
    ) -> None:
        state_service.set_current_comparison("main..feature+")
        assert state_service.get_current_comparison() == "main..feature+"

    def test_clear_current_comparison(self, state_service: ReviewStateService) -> None:
        state_service.set_current_comparison("main..feature+")
        state_service.clear_current_comparison()
        assert state_service.get_current_comparison() is None

    def test_file_format(
        self, state_service: ReviewStateService, temp_repo: Path
    ) -> None:
        """Verify the JSON format matches VSCode extension expectations."""
        state = ReviewState(
            comparison=make_comparison(),
            hunks={
                "src/foo.py:abc123": HunkState(reviewed_by="human"),
                "src/bar.py:def456": HunkState(reviewed_by="agent"),
            },
            notes="Test notes",
        )
        state_service.save(state)

        file_path = state_service.get_file_path("main..feature")
        data = json.loads(file_path.read_text())

        assert data["comparison"] == {
            "old": "main",
            "new": "feature",
            "working_tree": False,
            "key": "main..feature",
        }
        assert data["hunks"] == {
            "src/foo.py:abc123": {
                "suggested": None,
                "reviewed_by": "human",
                "reason": None,
            },
            "src/bar.py:def456": {
                "suggested": None,
                "reviewed_by": "agent",
                "reason": None,
            },
        }
        assert data["notes"] == "Test notes"
        assert "created_at" in data
        assert "updated_at" in data

    def test_migration_from_old_format(
        self, state_service: ReviewStateService, temp_repo: Path
    ) -> None:
        """Test that old format files are migrated correctly."""
        state_service.ensure_directory()
        file_path = state_service.get_file_path("main..feature")

        # Write old format file
        old_data = {
            "comparisonKey": "main..feature",
            "reviewedHunks": ["src/foo.py:abc123"],
            "notes": "Old notes",
            "classifications": {
                "src/bar.py:def456": {"trivial": True, "reason": "whitespace"},
            },
        }
        file_path.write_text(json.dumps(old_data))

        # Load should migrate
        state = state_service.load("main..feature")

        assert state.comparison.key == "main..feature"
        assert state.comparison.old == "main"
        assert state.comparison.new == "feature"
        assert state.notes == "Old notes"
        # Old reviewedHunks should be migrated
        assert "src/foo.py:abc123" in state.hunks
        assert state.hunks["src/foo.py:abc123"].reviewed_by == "human"
        # Old classifications should be migrated (trivial: True -> suggested: "agent")
        assert "src/bar.py:def456" in state.hunks
        assert state.hunks["src/bar.py:def456"].suggested == "agent"
        assert state.hunks["src/bar.py:def456"].reason == "whitespace"

    def test_migration_trivial_to_suggested(
        self, state_service: ReviewStateService, temp_repo: Path
    ) -> None:
        """Test that old trivial field in hunks is migrated to suggested field."""
        state_service.ensure_directory()
        file_path = state_service.get_file_path("main..feature")

        # Write file with old trivial field in hunks
        old_data = {
            "comparison": {
                "old": "main",
                "new": "feature",
                "working_tree": False,
                "key": "main..feature",
            },
            "hunks": {
                "src/foo.py:abc123": {
                    "reviewed": True,
                    "trivial": True,
                    "reason": "whitespace",
                },
                "src/bar.py:def456": {
                    "reviewed": False,
                    "trivial": False,
                    "reason": "logic change",
                },
                "src/baz.py:ghi789": {
                    "reviewed": False,
                    "trivial": None,
                    "reason": None,
                },
            },
            "notes": "",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
        }
        file_path.write_text(json.dumps(old_data))

        # Load should migrate
        state = state_service.load("main..feature")

        # trivial: True -> suggested: "agent", reviewed: True -> reviewed_by: "human"
        assert state.hunks["src/foo.py:abc123"].suggested == "agent"
        assert state.hunks["src/foo.py:abc123"].reviewed_by == "human"
        # trivial: False -> suggested: "human", reviewed: False -> reviewed_by: None
        assert state.hunks["src/bar.py:def456"].suggested == "human"
        assert state.hunks["src/bar.py:def456"].reviewed_by is None
        # trivial: None -> suggested: None
        assert state.hunks["src/baz.py:ghi789"].suggested is None

    def test_migration_review_to_suggested(
        self, state_service: ReviewStateService, temp_repo: Path
    ) -> None:
        """Test that old review field in hunks is migrated to suggested field."""
        state_service.ensure_directory()
        file_path = state_service.get_file_path("main..feature")

        # Write file with old review field in hunks
        old_data = {
            "comparison": {
                "old": "main",
                "new": "feature",
                "working_tree": False,
                "key": "main..feature",
            },
            "hunks": {
                "src/foo.py:abc123": {
                    "reviewed": True,
                    "review": "agent",
                    "reason": "whitespace",
                },
                "src/bar.py:def456": {
                    "reviewed": False,
                    "review": "human",
                    "reason": "logic change",
                },
            },
            "notes": "",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
        }
        file_path.write_text(json.dumps(old_data))

        # Load should migrate
        state = state_service.load("main..feature")

        # review -> suggested, reviewed: True -> reviewed_by: "human"
        assert state.hunks["src/foo.py:abc123"].suggested == "agent"
        assert state.hunks["src/foo.py:abc123"].reviewed_by == "human"
        # review -> suggested, reviewed: False -> reviewed_by: None
        assert state.hunks["src/bar.py:def456"].suggested == "human"
        assert state.hunks["src/bar.py:def456"].reviewed_by is None
