"""Tests for CLI module."""

import json
import subprocess
from pathlib import Path

import pytest
from click.testing import CliRunner
from pullapprove_review.cli import cli, parse_hunk_spec


class TestParseHunkSpec:
    def test_path_only(self) -> None:
        path, hashes = parse_hunk_spec("src/foo.py")
        assert path == "src/foo.py"
        assert hashes is None

    def test_path_with_single_hash(self) -> None:
        path, hashes = parse_hunk_spec("src/foo.py:abc12345")
        assert path == "src/foo.py"
        assert hashes == ["abc12345"]

    def test_path_with_multiple_hashes(self) -> None:
        path, hashes = parse_hunk_spec("src/foo.py:abc,def,ghi")
        assert path == "src/foo.py"
        assert hashes == ["abc", "def", "ghi"]

    def test_path_with_colons(self) -> None:
        # Windows-style paths shouldn't be confused with hunk spec
        path, hashes = parse_hunk_spec("C:/Users/foo/bar.py")
        assert path == "C:/Users/foo/bar.py"
        assert hashes is None


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Create a temporary git repository with a commit."""
    # Initialize repo
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test User"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    # Disable GPG signing for test commits
    subprocess.run(
        ["git", "config", "commit.gpgsign", "false"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )

    # Create initial commit
    (tmp_path / "README.md").write_text("# Test\n")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )

    # Create main branch (some git versions default to master)
    subprocess.run(
        ["git", "branch", "-M", "main"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )

    return tmp_path


@pytest.fixture
def runner() -> CliRunner:
    """Create a CLI runner."""
    return CliRunner()


class TestCli:
    def test_help(self, runner: CliRunner) -> None:
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "Code review CLI" in result.output

    def test_no_subcommand_no_repo(self, runner: CliRunner, tmp_path: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(tmp_path)
            result = runner.invoke(cli, [])
            # Should error because we're not in a git repo
            assert (
                result.exit_code != 0
                or "Error" in result.output
                or "No review" in result.output
            )
        finally:
            os.chdir(old_cwd)

    def test_compare_creates_current_file(
        self, runner: CliRunner, git_repo: Path
    ) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            result = runner.invoke(cli, ["compare", "main"])
            assert result.exit_code == 0
            assert "Review started" in result.output

            current_file = git_repo / ".pullapprove" / "current"
            assert current_file.exists()
            assert "main.." in current_file.read_text()
        finally:
            os.chdir(old_cwd)

    def test_status_no_changes(self, runner: CliRunner, git_repo: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            runner.invoke(cli, ["compare", "main"])
            result = runner.invoke(cli, ["status"])
            assert result.exit_code == 0
            assert "No changes to review" in result.output
        finally:
            os.chdir(old_cwd)

    def test_status_with_changes(self, runner: CliRunner, git_repo: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            # Make a change
            (git_repo / "README.md").write_text("# Test\n\nModified\n")

            runner.invoke(cli, ["compare", "main"])
            result = runner.invoke(cli, ["status"])
            assert result.exit_code == 0
            assert "Progress:" in result.output
            assert "1" in result.output  # 1 hunk
        finally:
            os.chdir(old_cwd)

    def test_status_json(self, runner: CliRunner, git_repo: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            (git_repo / "README.md").write_text("# Test\n\nModified\n")

            runner.invoke(cli, ["compare", "main"])
            result = runner.invoke(cli, ["status", "--json"])
            assert result.exit_code == 0
            data = json.loads(result.output)
            assert "comparison" in data
            assert "total_hunks" in data
            assert "unclassified" in data
        finally:
            os.chdir(old_cwd)

    def test_diff_json(self, runner: CliRunner, git_repo: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            (git_repo / "README.md").write_text("# Test\n\nModified\n")

            runner.invoke(cli, ["compare", "main"])
            result = runner.invoke(cli, ["diff", "--json"])
            assert result.exit_code == 0
            data = json.loads(result.output)
            assert "comparison" in data
            assert "files" in data
            if data["files"]:
                file_data = data["files"][0]
                assert "path" in file_data
                assert "hunks" in file_data
                if file_data["hunks"]:
                    hunk = file_data["hunks"][0]
                    assert "hash" in hunk
                    assert "reviewed_by" in hunk
        finally:
            os.chdir(old_cwd)

    def test_mark_and_unmark(self, runner: CliRunner, git_repo: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            (git_repo / "README.md").write_text("# Test\n\nModified\n")

            runner.invoke(cli, ["compare", "main"])

            # Get hunk hash
            result = runner.invoke(cli, ["diff", "--json"])
            data = json.loads(result.output)
            hunk_hash = data["files"][0]["hunks"][0]["hash"]

            # Mark the hunk
            result = runner.invoke(cli, ["mark", f"README.md:{hunk_hash}"])
            assert result.exit_code == 0
            assert "✓" in result.output  # Checkmark indicates marked

            # Verify marked
            result = runner.invoke(cli, ["diff", "--json"])
            data = json.loads(result.output)
            assert data["files"][0]["hunks"][0]["reviewed_by"] == "human"

            # Unmark
            result = runner.invoke(cli, ["unmark", f"README.md:{hunk_hash}"])
            assert result.exit_code == 0
            assert "○" in result.output  # Circle indicates unmarked

            # Verify unmarked
            result = runner.invoke(cli, ["diff", "--json"])
            data = json.loads(result.output)
            assert data["files"][0]["hunks"][0]["reviewed_by"] is None
        finally:
            os.chdir(old_cwd)

    def test_mark_all_hunks_in_file(self, runner: CliRunner, git_repo: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            (git_repo / "README.md").write_text("# Test\n\nModified\n")

            runner.invoke(cli, ["compare", "main"])

            # Mark all hunks in file
            result = runner.invoke(cli, ["mark", "README.md"])
            assert result.exit_code == 0
            assert "✓" in result.output  # Checkmark indicates marked

            # Verify all marked
            result = runner.invoke(cli, ["diff", "--json"])
            data = json.loads(result.output)
            for hunk in data["files"][0]["hunks"]:
                assert hunk["reviewed_by"] == "human"
        finally:
            os.chdir(old_cwd)

    def test_notes_add(self, runner: CliRunner, git_repo: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            runner.invoke(cli, ["compare", "main"])

            result = runner.invoke(cli, ["notes", "--add", "Test note"])
            assert result.exit_code == 0
            assert "Notes updated" in result.output

            result = runner.invoke(cli, ["notes"])
            assert result.exit_code == 0
            assert "Test note" in result.output
        finally:
            os.chdir(old_cwd)

    def test_export(self, runner: CliRunner, git_repo: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            runner.invoke(cli, ["compare", "main"])
            runner.invoke(cli, ["notes", "--add", "Test note"])

            result = runner.invoke(cli, ["export"])
            assert result.exit_code == 0
            data = json.loads(result.output)
            assert "comparison" in data
            assert data["comparison"]["key"].startswith("main..")
            assert "hunks" in data
            assert "notes" in data
            assert data["notes"] == "Test note"
        finally:
            os.chdir(old_cwd)

    def test_clear(self, runner: CliRunner, git_repo: Path) -> None:
        import os

        old_cwd = os.getcwd()
        try:
            os.chdir(git_repo)
            (git_repo / "README.md").write_text("# Test\n\nModified\n")
            runner.invoke(cli, ["compare", "main"])
            runner.invoke(cli, ["mark", "README.md"])
            runner.invoke(cli, ["notes", "--add", "Test"])

            # Clear with confirmation
            result = runner.invoke(cli, ["clear"], input="y\n")
            assert result.exit_code == 0
            assert "Cleared" in result.output

            # Verify cleared - export should show empty hunks and notes
            result = runner.invoke(cli, ["export"])
            data = json.loads(result.output)
            assert data["hunks"] == {}
            assert data["notes"] == ""
        finally:
            os.chdir(old_cwd)
