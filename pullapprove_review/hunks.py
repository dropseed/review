"""Diff parsing and hunk hashing."""

import hashlib
import re
from typing import Literal

from pydantic import BaseModel


class DiffHunk(BaseModel):
    """A single hunk from a diff."""

    file_path: str
    hash: str  # MD5 first 8 chars of content
    header: str  # The @@ line
    content: str  # Full hunk content
    start_line: int
    end_line: int


class ChangedFile(BaseModel):
    """A file with its hunks."""

    path: str
    status: Literal["added", "modified", "deleted", "renamed", "untracked"]
    old_path: str | None = None  # For renames
    hunks: list[DiffHunk] = []


def hash_content(content: str) -> str:
    """Hash content using MD5, returning first 8 characters."""
    return hashlib.md5(content.encode()).hexdigest()[:8]


def get_hunk_key(file_path: str, hunk_hash: str) -> str:
    """Get the key for identifying a hunk (filepath:hash)."""
    return f"{file_path}:{hunk_hash}"


def parse_hunk_key(hunk_key: str) -> tuple[str, str]:
    """Parse a hunk key into (file_path, hash)."""
    parts = hunk_key.rsplit(":", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid hunk key: {hunk_key}")
    return parts[0], parts[1]


def map_status_code(
    code: str,
) -> Literal["added", "modified", "deleted", "renamed", "untracked"]:
    """Map git status code to our status type."""
    code = code[0] if code else "M"
    if code == "A":
        return "added"
    if code == "D":
        return "deleted"
    if code == "R":
        return "renamed"
    return "modified"


def parse_name_status(
    output: str,
) -> dict[
    str,
    tuple[Literal["added", "modified", "deleted", "renamed", "untracked"], str | None],
]:
    """Parse git diff --name-status output.

    Returns dict mapping file path to (status, old_path).
    """
    result: dict[
        str,
        tuple[
            Literal["added", "modified", "deleted", "renamed", "untracked"], str | None
        ],
    ] = {}

    for line in output.strip().split("\n"):
        if not line:
            continue
        parts = line.split("\t")
        status_code = parts[0]
        # For renames (R) and copies (C), format is "R100\told\tnew"
        is_rename_or_copy = status_code[0] in ("R", "C")
        if is_rename_or_copy and len(parts) >= 3:
            old_path = parts[1]
            new_path = parts[2]
            result[new_path] = (map_status_code(status_code), old_path)
        elif len(parts) >= 2:
            file_path = parts[1]
            result[file_path] = (map_status_code(status_code), None)

    return result


def parse_diff_to_hunks(
    diff_output: str, file_status_map: dict[str, tuple[str, str | None]] | None = None
) -> list[ChangedFile]:
    """Parse unified diff output into ChangedFile objects with hunks.

    Args:
        diff_output: Output from git diff -p
        file_status_map: Optional mapping of path -> (status, old_path)
    """
    files: list[ChangedFile] = []

    if not diff_output.strip():
        return files

    # Split by file headers
    # Note: git can use different prefixes (a/b, c/w, i/w) depending on config
    # mnemonicPrefix uses: c=commit, i=index, w=worktree, o=object
    file_pattern = re.compile(r"^diff --git \w/(.+?) \w/(.+)$", re.MULTILINE)
    parts = file_pattern.split(diff_output)

    # parts[0] is empty or header, then groups of 3: a-path, b-path, content
    for i in range(1, len(parts), 3):
        if i + 2 > len(parts):
            break
        b_path = parts[i + 1]  # Use b/ path (destination)
        content = parts[i + 2] if i + 2 < len(parts) else ""

        hunks = _parse_hunks_from_content(b_path, content)

        # Get status from map or default to modified
        status: Literal["added", "modified", "deleted", "renamed", "untracked"] = (
            "modified"
        )
        old_path = None
        if file_status_map and b_path in file_status_map:
            status, old_path = file_status_map[b_path]

        if hunks:
            files.append(
                ChangedFile(
                    path=b_path,
                    status=status,
                    old_path=old_path,
                    hunks=hunks,
                )
            )

    return files


def _parse_hunks_from_content(file_path: str, diff_content: str) -> list[DiffHunk]:
    """Parse hunks from a single file's diff content."""
    hunks: list[DiffHunk] = []

    # Match hunk headers: @@ -start,count +start,count @@
    hunk_pattern = re.compile(
        r"^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@.*$", re.MULTILINE
    )

    hunk_starts: list[dict] = []
    for match in hunk_pattern.finditer(diff_content):
        hunk_starts.append(
            {
                "index": match.start(),
                "header": match.group(0),
                "start_line": int(match.group(2)),
                "line_count": int(match.group(3)) if match.group(3) else 1,
            }
        )

    # Extract content for each hunk
    for i, start in enumerate(hunk_starts):
        end_index = (
            hunk_starts[i + 1]["index"]
            if i + 1 < len(hunk_starts)
            else len(diff_content)
        )
        content = diff_content[start["index"] : end_index].strip()

        # Hash only the diff lines (excluding header) so line number changes don't invalidate reviews
        header_end = start["index"] + len(start["header"])
        diff_lines = diff_content[header_end:end_index].strip()
        hunk_hash = hash_content(diff_lines)

        hunks.append(
            DiffHunk(
                file_path=file_path,
                hash=hunk_hash,
                header=start["header"],
                content=content,
                start_line=start["start_line"],
                end_line=start["start_line"] + start["line_count"] - 1,
            )
        )

    # If no hunks found but there's content, treat as single hunk (e.g., binary file)
    if not hunks and diff_content.strip():
        hunks.append(
            DiffHunk(
                file_path=file_path,
                hash=hash_content(diff_content),
                header="(entire file)",
                content=diff_content.strip(),
                start_line=1,
                end_line=1,
            )
        )

    return hunks


def create_untracked_hunk(file_path: str, content: str) -> DiffHunk:
    """Create a hunk for an untracked file."""
    return DiffHunk(
        file_path=file_path,
        hash=hash_content(content or f"untracked:{file_path}"),
        header="@@ -0,0 +1 @@ (new file)",
        content="(untracked file)",
        start_line=1,
        end_line=1,
    )
