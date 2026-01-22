"""Integration tests for the CLI against a real git repository."""

import json
import os
import subprocess
from pathlib import Path
from typing import Generator

import pytest
from click.testing import CliRunner

from human_review.cli import cli


@pytest.fixture
def temp_git_repo(tmp_path: Path) -> Generator[Path, None, None]:
    """Create a temporary git repository with some commits and changes."""
    repo = tmp_path / "repo"
    repo.mkdir()

    # Save original directory
    original_dir = os.getcwd()

    # Initialize git repo
    subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test User"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    # Disable GPG signing for test commits
    subprocess.run(
        ["git", "config", "commit.gpgsign", "false"],
        cwd=repo,
        check=True,
        capture_output=True,
    )

    # Create initial file and commit
    (repo / "file1.py").write_text("def hello():\n    print('hello')\n")
    (repo / "file2.py").write_text("def world():\n    print('world')\n")
    subprocess.run(["git", "add", "."], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=repo,
        check=True,
        capture_output=True,
    )

    # Create a branch for comparison tests
    subprocess.run(
        ["git", "checkout", "-b", "feature"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    (repo / "file1.py").write_text("def hello():\n    print('hello, world!')\n")
    (repo / "file3.py").write_text("def new_func():\n    pass\n")
    subprocess.run(["git", "add", "."], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Feature commit"],
        cwd=repo,
        check=True,
        capture_output=True,
    )

    # Go back to master and make some uncommitted changes for working tree tests
    subprocess.run(
        ["git", "checkout", "master"],
        cwd=repo,
        check=True,
        capture_output=True,
    )

    # Make uncommitted changes
    (repo / "file1.py").write_text("def hello():\n    print('modified hello')\n")
    (repo / "file2.py").write_text(
        "def world():\n    print('world')\n\ndef extra():\n    pass\n"
    )

    # Change to repo directory
    os.chdir(repo)

    yield repo

    # Restore original directory
    os.chdir(original_dir)


@pytest.fixture
def runner() -> CliRunner:
    """Create a Click CLI runner."""
    return CliRunner()


class TestStart:
    """Tests for the 'start' command."""

    def test_start_working_tree(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test starting a working tree review."""
        result = runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        assert result.exit_code == 0, result.output
        assert "Review started" in result.output
        assert "master" in result.output

    def test_start_branch_comparison(
        self, runner: CliRunner, temp_git_repo: Path
    ) -> None:
        """Test starting a branch comparison review."""
        result = runner.invoke(cli, ["start", "--old", "master", "--new", "feature"])
        assert result.exit_code == 0, result.output
        assert "Review started" in result.output
        assert "master..feature" in result.output

    def test_start_invalid_old_ref(
        self, runner: CliRunner, temp_git_repo: Path
    ) -> None:
        """Test starting with an invalid --old ref."""
        result = runner.invoke(cli, ["start", "--old", "nonexistent", "--working-tree"])
        assert result.exit_code != 0
        assert "not found" in result.output

    def test_start_invalid_new_ref(
        self, runner: CliRunner, temp_git_repo: Path
    ) -> None:
        """Test starting with an invalid --new ref."""
        result = runner.invoke(
            cli, ["start", "--old", "master", "--new", "nonexistent"]
        )
        assert result.exit_code != 0
        assert "not found" in result.output

    def test_start_errors_if_exists(
        self, runner: CliRunner, temp_git_repo: Path
    ) -> None:
        """Test that start errors if review already exists."""
        # Start first review
        result = runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        assert result.exit_code == 0, result.output

        # Try to start again - should error
        result = runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        assert result.exit_code != 0
        assert "already exists" in result.output
        assert "switch" in result.output  # Should suggest switch


class TestSwitch:
    """Tests for the 'switch' command."""

    def test_switch_between_reviews(
        self, runner: CliRunner, temp_git_repo: Path
    ) -> None:
        """Test switching between existing reviews."""
        # Start working tree review
        result = runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        assert result.exit_code == 0, result.output

        # Get the working tree review key
        result = runner.invoke(cli, ["status", "--json"])
        working_tree_key = json.loads(result.output)["comparison"]

        # Start branch comparison review
        result = runner.invoke(cli, ["start", "--old", "master", "--new", "feature"])
        assert result.exit_code == 0, result.output

        # Check status shows branch comparison
        result = runner.invoke(cli, ["status", "--short"])
        assert result.exit_code == 0, result.output
        assert "master..feature" in result.output

        # Switch back to working tree review
        result = runner.invoke(cli, ["switch", working_tree_key])
        assert result.exit_code == 0, result.output
        assert "Switched" in result.output

        # Verify we're back on working tree review
        result = runner.invoke(cli, ["status", "--short"])
        assert result.exit_code == 0, result.output
        assert working_tree_key in result.output

    def test_switch_nonexistent(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test switch errors for nonexistent review."""
        result = runner.invoke(cli, ["switch", "nonexistent..review"])
        assert result.exit_code != 0
        assert "no review found" in result.output
        assert "list" in result.output  # Should suggest list


class TestStatus:
    """Tests for the 'status' command."""

    def test_status_no_review(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test status errors when no review is in progress."""
        result = runner.invoke(cli, ["status"])
        assert result.exit_code != 0
        assert "no review in progress" in result.output
        assert "start" in result.output  # Should suggest start command

    def test_status_short(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test short status output."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["status", "--short"])
        assert result.exit_code == 0, result.output
        assert "master" in result.output

    def test_status_json(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test JSON status output."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["status", "--json"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert "total_hunks" in data
        assert "approved_hunks" in data
        assert "comparison" in data

    def test_status_with_files(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test status with per-file breakdown."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["status", "--files"])
        assert result.exit_code == 0, result.output
        assert "file1.py" in result.output or "file2.py" in result.output


class TestDiff:
    """Tests for the 'diff' command."""

    def test_diff_all(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test showing all diffs."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["diff"])
        assert result.exit_code == 0, result.output
        # Should show file names
        assert "file1.py" in result.output or "file2.py" in result.output

    def test_diff_json(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test JSON diff output."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["diff", "--json"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert "files" in data
        assert "comparison" in data

    def test_diff_name_only(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test name-only diff output."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["diff", "--name-only"])
        assert result.exit_code == 0, result.output

    def test_diff_specific_file(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test diff for a specific file."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["diff", "file1.py"])
        assert result.exit_code == 0, result.output
        assert "file1.py" in result.output


class TestLabelTrustApprove:
    """Tests for label, trust, and approve workflow."""

    def test_label_and_trust(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test labeling hunks with label patterns and trusting the pattern."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])

        # Get hunks via JSON diff
        result = runner.invoke(cli, ["diff", "--json"])
        data = json.loads(result.output)
        assert len(data["files"]) > 0

        # Get first hunk hash
        first_file = data["files"][0]
        first_hunk = first_file["hunks"][0]
        hunk_hash = first_hunk["hash"]
        file_path = first_file["path"]
        hunk_key = f"{file_path}:{hunk_hash}"

        # Label the hunk with label pattern via --stdin
        label_data = json.dumps(
            {hunk_key: {"label": ["imports:added"], "reasoning": "test label"}}
        )
        result = runner.invoke(cli, ["label", "--stdin"], input=label_data)
        assert result.exit_code == 0, result.output

        # Check label shows in list (JSON format shows label patterns)
        result = runner.invoke(cli, ["label", "--list", "--json"])
        assert result.exit_code == 0, result.output
        list_data = json.loads(result.output)
        assert hunk_key in list_data
        assert list_data[hunk_key]["label"] == ["imports:added"]
        assert list_data[hunk_key]["reasoning"] == "test label"

        # Trust the pattern (adds to review-level trust list)
        result = runner.invoke(cli, ["trust", "imports:added"])
        assert result.exit_code == 0, result.output
        assert "Added" in result.output

        # Check status shows progress (hunk is now trusted)
        result = runner.invoke(cli, ["status", "--json"])
        data = json.loads(result.output)
        assert data["approved_hunks"] > 0

    def test_approve_by_hash(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test approving by bare hash."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])

        # Get hunks via JSON diff
        result = runner.invoke(cli, ["diff", "--json"])
        data = json.loads(result.output)
        first_file = data["files"][0]
        first_hunk = first_file["hunks"][0]
        hunk_hash = first_hunk["hash"]

        # Approve by hash
        result = runner.invoke(cli, ["approve", hunk_hash])
        assert result.exit_code == 0, result.output

        # Check it's approved
        result = runner.invoke(cli, ["status", "--json"])
        data = json.loads(result.output)
        assert data["approved_hunks"] > 0

    def test_approve_by_file(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test approving all hunks in a file."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])

        # Approve entire file
        result = runner.invoke(cli, ["approve", "file1.py"])
        assert result.exit_code == 0, result.output
        assert "Approved" in result.output

    def test_unapprove(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test unapproving hunks."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])

        # Approve file
        runner.invoke(cli, ["approve", "file1.py"])

        # Check it's approved
        result = runner.invoke(cli, ["status", "--json"])
        data = json.loads(result.output)
        initial_approved = data["approved_hunks"]
        assert initial_approved > 0

        # Unapprove
        result = runner.invoke(cli, ["unapprove", "file1.py"])
        assert result.exit_code == 0, result.output

        # Check it's no longer approved
        result = runner.invoke(cli, ["status", "--json"])
        data = json.loads(result.output)
        assert data["approved_hunks"] < initial_approved

    def test_untrust(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test untrusting a pattern."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])

        # Get and label a hunk with label pattern
        result = runner.invoke(cli, ["diff", "--json"])
        data = json.loads(result.output)
        first_file = data["files"][0]
        first_hunk = first_file["hunks"][0]
        hunk_key = f"{first_file['path']}:{first_hunk['hash']}"

        # Label with label pattern via --stdin
        label_data = json.dumps(
            {
                hunk_key: {
                    "label": ["formatting:whitespace"],
                    "reasoning": "untrust-test",
                }
            }
        )
        runner.invoke(cli, ["label", "--stdin"], input=label_data)
        runner.invoke(cli, ["trust", "formatting:whitespace"])

        # Check it's approved (trusted)
        result = runner.invoke(cli, ["status", "--json"])
        data = json.loads(result.output)
        initial_approved = data["approved_hunks"]

        # Untrust (removes from review-level trust list)
        result = runner.invoke(cli, ["untrust", "formatting:whitespace"])
        assert result.exit_code == 0, result.output
        assert "Removed" in result.output

        # Check it's no longer approved
        result = runner.invoke(cli, ["status", "--json"])
        data = json.loads(result.output)
        assert data["approved_hunks"] < initial_approved


class TestList:
    """Tests for the 'list' command."""

    def test_list_no_reviews(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test list with no stored reviews."""
        result = runner.invoke(cli, ["list"])
        assert result.exit_code == 0, result.output

    def test_list_with_reviews(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test list after creating reviews."""
        # Create a review
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        # Do something to persist state
        runner.invoke(cli, ["status"])

        result = runner.invoke(cli, ["list"])
        assert result.exit_code == 0, result.output


class TestInfo:
    """Tests for the 'info' command."""

    def test_info(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test info command."""
        result = runner.invoke(cli, ["info"])
        assert result.exit_code == 0, result.output
        assert "Data directory" in result.output
        assert "Repo root" in result.output


class TestDelete:
    """Tests for the 'delete' command."""

    def test_delete(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test deleting a review."""
        # Start and do some work
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        runner.invoke(cli, ["approve", "file1.py"])

        # Delete with confirmation
        result = runner.invoke(cli, ["delete", "--yes"])
        assert result.exit_code == 0, result.output
        assert "Deleted" in result.output

        # Check review is gone from list
        result = runner.invoke(cli, ["list"])
        assert (
            "master[uncommitted]" not in result.output or "No reviews" in result.output
        )

    def test_delete_clears_current(
        self, runner: CliRunner, temp_git_repo: Path
    ) -> None:
        """Test that deleting current review clears current pointer."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])

        # Delete the current review
        result = runner.invoke(cli, ["delete", "--yes"])
        assert result.exit_code == 0

        # Starting the same review again should work (not error about existing)
        result = runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        assert result.exit_code == 0, result.output

    def test_delete_specific_review(
        self, runner: CliRunner, temp_git_repo: Path
    ) -> None:
        """Test deleting a specific review by key."""
        # Start first review
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["status", "--json"])
        key = json.loads(result.output)["comparison"]

        # Delete by explicit key
        result = runner.invoke(cli, ["delete", key, "--yes"])
        assert result.exit_code == 0, result.output
        assert "Deleted" in result.output


class TestNotes:
    """Tests for the 'notes' command."""

    def test_notes_empty(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test viewing empty notes."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["notes"])
        assert result.exit_code == 0, result.output

    def test_notes_add(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test adding notes."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])
        result = runner.invoke(cli, ["notes", "--add", "Test note content"])
        assert result.exit_code == 0, result.output
        assert "Notes updated" in result.output

        # Check note is stored
        result = runner.invoke(cli, ["notes"])
        assert result.exit_code == 0, result.output
        assert "Test note content" in result.output


class TestBranchComparison:
    """Tests specific to branch comparison mode."""

    def test_branch_comparison_diff(
        self, runner: CliRunner, temp_git_repo: Path
    ) -> None:
        """Test diff in branch comparison mode."""
        runner.invoke(cli, ["start", "--old", "master", "--new", "feature"])

        result = runner.invoke(cli, ["diff", "--json"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert "master..feature" in data["comparison"]

    def test_stage_fails_for_branch_comparison(
        self, runner: CliRunner, temp_git_repo: Path
    ) -> None:
        """Test that stage fails for branch comparisons."""
        runner.invoke(cli, ["start", "--old", "master", "--new", "feature"])
        runner.invoke(cli, ["approve", "file1.py"])

        result = runner.invoke(cli, ["stage"])
        assert result.exit_code != 0
        # Check either output or stderr contains the expected message
        full_output = result.output + (result.stderr or "")
        assert "working tree" in full_output.lower()


class TestFilters:
    """Tests for diff filtering options."""

    def test_diff_unlabeled(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test filtering to unlabeled hunks."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])

        result = runner.invoke(cli, ["diff", "--unlabeled", "--json"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        # All hunks should be unlabeled initially
        for f in data["files"]:
            for h in f["hunks"]:
                assert h["reasoning"] is None
                assert h["label"] == []

    def test_diff_unreviewed(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test filtering to unreviewed hunks."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])

        # Approve one file
        runner.invoke(cli, ["approve", "file1.py"])

        # Check unreviewed filter excludes approved
        result = runner.invoke(cli, ["diff", "--unreviewed", "--json"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        for f in data["files"]:
            assert f["path"] != "file1.py" or len(f["hunks"]) == 0

    def test_diff_with_limit(self, runner: CliRunner, temp_git_repo: Path) -> None:
        """Test limiting number of hunks returned."""
        runner.invoke(cli, ["start", "--old", "master", "--working-tree"])

        result = runner.invoke(cli, ["diff", "--json", "--limit", "1"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["pagination"]["limit"] == 1
        assert data["pagination"]["returned"] <= 1
