"""Git operations wrapper."""

import subprocess
from pathlib import Path


class GitError(Exception):
    """Error from git command."""

    pass


def run_git(*args: str, cwd: Path | None = None) -> str:
    """Run a git command and return stdout.

    Raises GitError on non-zero exit code.
    """
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        raise GitError(f"git {' '.join(args)} failed: {e.stderr.strip()}") from e


def git_root(cwd: Path | None = None) -> Path:
    """Get the git repository root directory."""
    output = run_git("rev-parse", "--show-toplevel", cwd=cwd)
    return Path(output.strip())


def git_common_dir(cwd: Path | None = None) -> Path:
    """Get the git common dir (shared across worktrees).

    Returns the .git directory (or the main repo's .git for worktrees).
    State stored here is automatically ignored by git and shared across worktrees.
    """
    output = run_git("rev-parse", "--git-common-dir", cwd=cwd)
    return Path(output.strip())


def git_current_branch(cwd: Path | None = None) -> str | None:
    """Get the current branch name, or None if detached HEAD."""
    try:
        output = run_git("rev-parse", "--abbrev-ref", "HEAD", cwd=cwd)
        branch = output.strip()
        return None if branch == "HEAD" else branch
    except GitError:
        return None


def git_default_branch(cwd: Path | None = None) -> str:
    """Get the default branch (main or master)."""
    # Try main first
    try:
        run_git("rev-parse", "--verify", "main", cwd=cwd)
        return "main"
    except GitError:
        pass

    # Try master
    try:
        run_git("rev-parse", "--verify", "master", cwd=cwd)
        return "master"
    except GitError:
        pass

    # Fallback to main
    return "main"


def git_merge_base(ref1: str, ref2: str, cwd: Path | None = None) -> str:
    """Get the merge base (common ancestor) of two refs."""
    output = run_git("merge-base", ref1, ref2, cwd=cwd)
    return output.strip()


def git_diff(base: str, compare: str | None = None, cwd: Path | None = None) -> str:
    """Get diff output between base and compare (or working tree if compare is None).

    Uses -U0 for zero context lines, giving exact change boundaries and stable hashes.
    """
    if compare is None:
        # Working tree comparison
        return run_git("diff", base, "-p", "-U0", cwd=cwd)
    else:
        # Branch comparison - use three dots for changes since common ancestor
        return run_git("diff", f"{base}...{compare}", "-p", "-U0", cwd=cwd)


def git_diff_name_status(
    base: str, compare: str | None = None, cwd: Path | None = None
) -> str:
    """Get diff name-status output showing file changes."""
    if compare is None:
        return run_git("diff", base, "--name-status", cwd=cwd)
    else:
        return run_git("diff", f"{base}...{compare}", "--name-status", cwd=cwd)


def git_untracked_files(cwd: Path | None = None) -> list[str]:
    """Get list of untracked files."""
    output = run_git("ls-files", "--others", "--exclude-standard", cwd=cwd)
    return [line for line in output.strip().split("\n") if line]


def git_ref_exists(ref: str, cwd: Path | None = None) -> bool:
    """Check if a git ref exists."""
    try:
        run_git("rev-parse", "--verify", ref, cwd=cwd)
        return True
    except GitError:
        return False
