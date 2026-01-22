"""Business logic for human-review operations.

This module contains the core review operations, separated from CLI concerns.
"""

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .git import git_diff, git_diff_name_status, git_untracked_files
from .hunks import (
    ChangedFile,
    DiffHunk,
    create_untracked_hunk,
    get_hunk_key,
    parse_diff_to_hunks,
    parse_name_status,
)
from .state import HunkState, ReviewState, ReviewStateService
from .patterns import patterns_match_trust_list


def get_hunk_display_label(hunk_state: HunkState | None) -> str | None:
    """Get the display label for a hunk (reasoning text)."""
    if not hunk_state:
        return None
    return hunk_state.reasoning


# -----------------------------------------------------------------------------
# Trust resolution (declarative model)
# -----------------------------------------------------------------------------


def is_hunk_trusted(hunk: HunkState, effective_trust: list[str]) -> bool:
    """Check if hunk's labels are all trusted.

    Args:
        hunk: The hunk state
        effective_trust: Combined trust from config + review-level

    Returns:
        True if all labels in hunk match the effective trust list.
        Returns False if hunk has no labels (needs review).
    """
    if not hunk.label:
        return False  # No labels = needs review

    all_trusted, _ = patterns_match_trust_list(hunk.label, effective_trust)
    return all_trusted


def is_hunk_approved(hunk: HunkState, effective_trust: list[str]) -> bool:
    """Check if a hunk is approved (via review or trust).

    Args:
        hunk: The hunk state
        effective_trust: Combined trust from config + review-level

    Returns:
        True if hunk is manually reviewed OR all labels are trusted.
    """
    if hunk.approved_via == "review":
        return True
    return is_hunk_trusted(hunk, effective_trust)


# -----------------------------------------------------------------------------
# Hunk spec parsing
# -----------------------------------------------------------------------------


def parse_hunk_spec(spec: str) -> tuple[str, list[str] | None]:
    """Parse a hunk specification like 'path:hash' or 'path:h1,h2' or just 'path'.

    Returns (path, [hashes]) where hashes is None if no hashes specified.
    """
    if ":" in spec:
        path, hash_part = spec.rsplit(":", 1)
        # Check if hash_part looks like hashes (alphanumeric) vs part of path
        if hash_part and all(c.isalnum() or c == "," for c in hash_part):
            hashes = [h.strip() for h in hash_part.split(",") if h.strip()]
            return path, hashes
    return spec, None


def is_bare_hash(spec: str) -> bool:
    """Check if spec looks like a bare hash (short alphanumeric, no path separators)."""
    return (
        ":" not in spec
        and "/" not in spec
        and "\\" not in spec
        and "." not in spec
        and spec.isalnum()
        and len(spec) <= 40  # Git hashes are at most 40 chars
    )


def resolve_bare_hash(
    spec: str, files: list[ChangedFile]
) -> tuple[list[tuple[str, str]], str | None]:
    """Resolve a bare hash to list of (filepath, full_hash) matches.

    Returns (matches, None) on success, or ([], error_message) on failure.
    Supports prefix matching (e.g., '08ce' matches '08ce166c').
    Multiple hunks with identical content will share the same hash - this is intentional.
    """
    matches = []
    for f in files:
        for hunk in f.hunks:
            if hunk.hash == spec or hunk.hash.startswith(spec):
                matches.append((f.path, hunk.hash))

    if len(matches) == 0:
        return [], f"hash '{spec}' not found in current diff"
    return matches, None


# -----------------------------------------------------------------------------
# Changed files
# -----------------------------------------------------------------------------


def get_changed_files(
    base: str, compare: str | None, repo_root: Path
) -> list[ChangedFile]:
    """Get all changed files with their hunks."""
    # Get file statuses
    name_status_output = git_diff_name_status(base, compare, cwd=repo_root)
    file_status_map = parse_name_status(name_status_output)

    # Get diff with hunks
    diff_output = git_diff(base, compare, cwd=repo_root)
    files = parse_diff_to_hunks(diff_output, file_status_map)

    # For working tree, also get untracked files
    if compare is None:
        untracked = git_untracked_files(cwd=repo_root)
        for rel_path in untracked:
            abs_path = repo_root / rel_path
            try:
                content = abs_path.read_text()
            except Exception:
                content = ""
            hunk = create_untracked_hunk(rel_path, content)
            files.append(
                ChangedFile(
                    path=rel_path,
                    status="untracked",
                    hunks=[hunk],
                )
            )

    return files


# -----------------------------------------------------------------------------
# Status computation
# -----------------------------------------------------------------------------


@dataclass
class ReviewStatus:
    """Computed review status for display."""

    comparison_key: str
    total_files: int
    total_hunks: int
    approved_hunks: int
    unlabeled_count: int
    by_file_status: dict[str, dict[str, int]]
    unreviewed_by_label: list[tuple[str, int]]  # sorted by count desc
    trusted_by_label: list[tuple[str, int]]  # sorted by count desc
    reviewed_by_label: list[tuple[str, int]]  # sorted by count desc

    @property
    def progress_percent(self) -> int:
        if self.total_hunks == 0:
            return 0
        return round(self.approved_hunks / self.total_hunks * 100)

    @property
    def remaining_hunks(self) -> int:
        return self.total_hunks - self.approved_hunks

    @property
    def unreviewed_total(self) -> int:
        return sum(c for _, c in self.unreviewed_by_label)

    @property
    def trusted_total(self) -> int:
        return sum(c for _, c in self.trusted_by_label)

    @property
    def reviewed_total(self) -> int:
        return sum(c for _, c in self.reviewed_by_label)


def compute_review_status(
    files: list[ChangedFile],
    state: ReviewState,
    comparison_key: str,
    effective_trust: list[str] | None = None,
) -> ReviewStatus:
    """Compute review status from files and state.

    Args:
        files: List of changed files with hunks
        state: Review state
        comparison_key: The comparison key
        effective_trust: Combined trust list (config + review-level).
                         If None, uses state.trust_label only.
    """
    if effective_trust is None:
        effective_trust = list(state.trust_label)

    total_hunks = 0
    approved_hunks = 0
    unlabeled_total = 0

    # Labeled but not trusted (has labels but not all trusted)
    unreviewed_by_label: dict[str, int] = {}
    # Trusted hunks grouped by label (computed: all labels in trust list)
    trusted_by_label: dict[str, int] = {}
    # Reviewed hunks grouped by label (approved_via == "review")
    reviewed_by_label: dict[str, int] = {}

    # Track files by git status
    by_file_status: dict[str, dict[str, int]] = {}
    total_files = len(files)

    for f in files:
        # Track by file status
        if f.status not in by_file_status:
            by_file_status[f.status] = {"files": 0, "hunks": 0}
        by_file_status[f.status]["files"] += 1
        by_file_status[f.status]["hunks"] += len(f.hunks)

        for hunk in f.hunks:
            total_hunks += 1
            hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
            hunk_state = state.hunks.get(hunk_key)

            if hunk_state and hunk_state.approved_via == "review":
                # Manually reviewed
                approved_hunks += 1
                reasoning = hunk_state.reasoning or "(no reasoning)"
                reviewed_by_label[reasoning] = reviewed_by_label.get(reasoning, 0) + 1
            elif hunk_state and is_hunk_trusted(hunk_state, effective_trust):
                # Trusted (computed dynamically)
                approved_hunks += 1
                reasoning = hunk_state.reasoning or "(no reasoning)"
                trusted_by_label[reasoning] = trusted_by_label.get(reasoning, 0) + 1
            elif hunk_state and (hunk_state.label or hunk_state.reasoning is not None):
                # Has labels or reasoning but not trusted
                reasoning = hunk_state.reasoning or "(no reasoning)"
                unreviewed_by_label[reasoning] = (
                    unreviewed_by_label.get(reasoning, 0) + 1
                )
            else:
                # No labels or reasoning
                unlabeled_total += 1

    # Sort by count descending
    unreviewed_sorted = sorted(
        unreviewed_by_label.items(), key=lambda x: x[1], reverse=True
    )
    trusted_sorted = sorted(trusted_by_label.items(), key=lambda x: x[1], reverse=True)
    reviewed_sorted = sorted(
        reviewed_by_label.items(), key=lambda x: x[1], reverse=True
    )

    return ReviewStatus(
        comparison_key=comparison_key,
        total_files=total_files,
        total_hunks=total_hunks,
        approved_hunks=approved_hunks,
        unlabeled_count=unlabeled_total,
        by_file_status=by_file_status,
        unreviewed_by_label=unreviewed_sorted,
        trusted_by_label=trusted_sorted,
        reviewed_by_label=reviewed_sorted,
    )


# -----------------------------------------------------------------------------
# Diff filtering
# -----------------------------------------------------------------------------


@dataclass
class DiffFilters:
    """Filters for diff output."""

    path: str | None = None
    file_status: str | None = None
    unreviewed: bool = False
    unlabeled: bool = False
    label: str | None = None


def hunk_passes_filter(
    hunk: DiffHunk, hunk_state: HunkState | None, filters: DiffFilters
) -> bool:
    """Check if a hunk passes the given filters."""
    if filters.unreviewed:
        if hunk_state and hunk_state.approved_via is not None:
            return False
    if filters.unlabeled:
        if hunk_state and hunk_state.reasoning is not None:
            return False
    if filters.label:
        hunk_reasoning = hunk_state.reasoning if hunk_state else None
        if hunk_reasoning != filters.label:
            return False
    return True


def filter_files(files: list[ChangedFile], filters: DiffFilters) -> list[ChangedFile]:
    """Filter files by path and status."""
    result = files

    if filters.path:
        result = [
            f
            for f in result
            if f.path == filters.path or f.path.startswith(filters.path + "/")
        ]

    if filters.file_status:
        result = [f for f in result if f.status == filters.file_status]

    return result


# -----------------------------------------------------------------------------
# Patch building (for stage command)
# -----------------------------------------------------------------------------


def build_patch_for_approved_hunks(
    files: list[ChangedFile],
    service: ReviewStateService,
    comparison_key: str,
) -> tuple[str, int]:
    """Build a patch containing only approved hunks.

    Returns (patch_content, hunk_count).
    """
    patch_parts = []
    hunk_count = 0

    for changed_file in files:
        file_hunks_to_stage = []

        for hunk in changed_file.hunks:
            hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
            if service.is_hunk_approved(comparison_key, hunk_key):
                file_hunks_to_stage.append(hunk)
                hunk_count += 1

        if file_hunks_to_stage:
            # Get file header from full diff
            file_diff = git_diff(changed_file.path, cwd=service.repo_root)
            # Extract header (everything before first @@)
            header_end = file_diff.find("\n@@")
            if header_end > 0:
                file_header = file_diff[: header_end + 1]
                patch_parts.append(file_header)
                for hunk in file_hunks_to_stage:
                    patch_parts.append(hunk.content)

    return "\n".join(patch_parts), hunk_count


# -----------------------------------------------------------------------------
# Hunk key utilities
# -----------------------------------------------------------------------------


def count_hunks_by_key(files: list[ChangedFile]) -> Counter[str]:
    """Count how many times each hunk key appears in the file list."""
    counts: Counter[str] = Counter()
    for f in files:
        for hunk in f.hunks:
            counts[get_hunk_key(hunk.file_path, hunk.hash)] += 1
    return counts


def get_valid_hunk_keys(files: list[ChangedFile]) -> set[str]:
    """Get set of all valid hunk keys from current diff."""
    return set(count_hunks_by_key(files).keys())
