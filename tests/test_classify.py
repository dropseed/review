"""Tests for classification functionality."""

import json
from pathlib import Path

import pytest
from pullapprove_review.skill import SKILLS_DIR, install_skill
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
            old=old, new=new.rstrip("+"), working_tree=working_tree, key=key
        )
    return Comparison(old=key, new=None, working_tree=True, key=key)


class TestHunkState:
    def test_default_values(self) -> None:
        h = HunkState()
        assert h.reviewed_by is None
        assert h.suggested is None
        assert h.reason is None

    def test_with_classification_agent(self) -> None:
        h = HunkState(suggested="agent", reason="whitespace only")
        assert h.suggested == "agent"
        assert h.reason == "whitespace only"
        assert h.reviewed_by is None

    def test_with_classification_human(self) -> None:
        h = HunkState(suggested="human", reason="logic change")
        assert h.suggested == "human"
        assert h.reason == "logic change"
        assert h.reviewed_by is None

    def test_with_classification_undecided(self) -> None:
        h = HunkState(suggested="undecided", reason="complex refactor")
        assert h.suggested == "undecided"
        assert h.reason == "complex refactor"
        assert h.reviewed_by is None

    def test_reviewed_and_classified(self) -> None:
        h = HunkState(reviewed_by="human", suggested="human", reason="logic change")
        assert h.reviewed_by == "human"
        assert h.suggested == "human"
        assert h.reason == "logic change"


class TestReviewStateHunks:
    def test_default_empty_hunks(self) -> None:
        state = ReviewState(comparison=make_comparison())
        assert state.hunks == {}

    def test_with_hunks(self) -> None:
        state = ReviewState(
            comparison=make_comparison(),
            hunks={
                "src/foo.py:abc123": HunkState(suggested="agent", reason="whitespace"),
                "src/bar.py:def456": HunkState(
                    suggested="human", reason="logic change"
                ),
            },
        )
        assert len(state.hunks) == 2
        assert state.hunks["src/foo.py:abc123"].suggested == "agent"
        assert state.hunks["src/bar.py:def456"].suggested == "human"


class TestReviewStateServiceClassifications:
    def test_set_classification(self, state_service: ReviewStateService) -> None:
        state_service.set_classification(
            "main..feature", "src/foo.py:abc123", suggested="agent", reason="whitespace"
        )
        state = state_service.load("main..feature")
        assert "src/foo.py:abc123" in state.hunks
        assert state.hunks["src/foo.py:abc123"].suggested == "agent"
        assert state.hunks["src/foo.py:abc123"].reason == "whitespace"

    def test_set_classification_human(self, state_service: ReviewStateService) -> None:
        state_service.set_classification(
            "main..feature",
            "src/foo.py:abc123",
            suggested="human",
            reason="security change",
        )
        state = state_service.load("main..feature")
        assert state.hunks["src/foo.py:abc123"].suggested == "human"

    def test_set_classification_undecided(
        self, state_service: ReviewStateService
    ) -> None:
        state_service.set_classification(
            "main..feature",
            "src/foo.py:abc123",
            suggested="undecided",
            reason="complex refactor",
        )
        state = state_service.load("main..feature")
        assert state.hunks["src/foo.py:abc123"].suggested == "undecided"

    def test_set_classifications_batch(self, state_service: ReviewStateService) -> None:
        classifications = {
            "src/foo.py:abc123": {"suggested": "agent", "reason": "whitespace"},
            "src/bar.py:def456": {"suggested": "human", "reason": "logic change"},
        }
        state_service.set_classifications("main..feature", classifications)

        state = state_service.load("main..feature")
        # Count hunks with classifications (suggested is not None)
        classified = {k: v for k, v in state.hunks.items() if v.suggested is not None}
        assert len(classified) == 2
        assert state.hunks["src/foo.py:abc123"].suggested == "agent"
        assert state.hunks["src/bar.py:def456"].suggested == "human"

    def test_set_classifications_default_suggested(
        self, state_service: ReviewStateService
    ) -> None:
        """When suggested is not specified, it defaults to 'agent'."""
        classifications = {
            "src/foo.py:abc123": {"reason": "needs review"},
        }
        state_service.set_classifications("main..feature", classifications)

        state = state_service.load("main..feature")
        assert state.hunks["src/foo.py:abc123"].suggested == "agent"

    def test_get_classification(self, state_service: ReviewStateService) -> None:
        state_service.set_classification(
            "main..feature", "src/foo.py:abc123", suggested="agent", reason="whitespace"
        )

        h = state_service.get_classification("main..feature", "src/foo.py:abc123")
        assert h is not None
        assert h.suggested == "agent"
        assert h.reason == "whitespace"

    def test_get_classification_not_found(
        self, state_service: ReviewStateService
    ) -> None:
        h = state_service.get_classification("main..feature", "src/foo.py:abc123")
        assert h is None

    def test_get_agent_hunk_keys(self, state_service: ReviewStateService) -> None:
        state_service.set_classifications(
            "main..feature",
            {
                "src/foo.py:abc123": {"suggested": "agent", "reason": "whitespace"},
                "src/bar.py:def456": {"suggested": "human", "reason": "logic"},
                "src/baz.py:ghi789": {"suggested": "agent", "reason": "import reorder"},
            },
        )

        agent_keys = state_service.get_agent_hunk_keys("main..feature")
        assert len(agent_keys) == 2
        assert "src/foo.py:abc123" in agent_keys
        assert "src/baz.py:ghi789" in agent_keys
        assert "src/bar.py:def456" not in agent_keys

    def test_clear_classifications(self, state_service: ReviewStateService) -> None:
        state_service.set_classifications(
            "main..feature",
            {
                "src/foo.py:abc123": {"suggested": "agent", "reason": "whitespace"},
                "src/bar.py:def456": {"suggested": "human", "reason": "logic"},
            },
        )

        state_service.clear_classifications("main..feature")
        state = state_service.load("main..feature")
        # After clearing, hunks should have suggested=None
        for hunk in state.hunks.values():
            assert hunk.suggested is None

    def test_classifications_persist(
        self, state_service: ReviewStateService, temp_repo: Path
    ) -> None:
        """Verify classifications are persisted to disk correctly."""
        state_service.set_classification(
            "main..feature", "src/foo.py:abc123", suggested="agent", reason="whitespace"
        )

        # Create new service instance to verify persistence
        new_service = ReviewStateService(temp_repo)
        state = new_service.load("main..feature")
        assert "src/foo.py:abc123" in state.hunks
        assert state.hunks["src/foo.py:abc123"].suggested == "agent"

    def test_file_format_with_hunks(
        self, state_service: ReviewStateService, temp_repo: Path
    ) -> None:
        """Verify the JSON format includes hunks with classifications."""
        state = ReviewState(
            comparison=make_comparison("main..feature"),
            hunks={
                "src/foo.py:abc123": HunkState(
                    reviewed_by="human", suggested="agent", reason="whitespace"
                ),
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
                "suggested": "agent",
                "reviewed_by": "human",
                "reason": "whitespace",
            },
        }
        assert data["notes"] == "Test notes"
        assert "created_at" in data
        assert "updated_at" in data


class TestSkillInstall:
    def test_install_creates_skill_directory(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Mock Path.home() to use temp directory
        monkeypatch.setattr(Path, "home", lambda: tmp_path)

        skill_dir = install_skill()

        assert skill_dir.exists()
        assert skill_dir.is_dir()
        assert skill_dir == tmp_path / ".claude" / "skills" / "pullapprove-review"

        skill_file = skill_dir / "SKILL.md"
        assert skill_file.exists()

        # Verify content matches source
        source_content = (SKILLS_DIR / "pullapprove-review" / "SKILL.md").read_text()
        assert skill_file.read_text() == source_content

    def test_install_creates_parent_directories(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(Path, "home", lambda: tmp_path)

        # Verify directory doesn't exist yet
        skills_dir = tmp_path / ".claude" / "skills"
        assert not skills_dir.exists()

        install_skill()

        assert skills_dir.exists()
        assert skills_dir.is_dir()

    def test_install_overwrites_existing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(Path, "home", lambda: tmp_path)

        # Create skill file with different content
        skill_dir = tmp_path / ".claude" / "skills" / "pullapprove-review"
        skill_dir.mkdir(parents=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text("old content")

        install_skill()

        # Verify content matches source (overwrites old content)
        source_content = (SKILLS_DIR / "pullapprove-review" / "SKILL.md").read_text()
        assert skill_file.read_text() == source_content
