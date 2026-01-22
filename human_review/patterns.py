"""Trust patterns taxonomy for human-review.

This module defines the core trust patterns that can be recognized and
auto-approved during code review. These patterns represent mechanical,
patterned changes that don't require human judgment.

Key insight: We're not categorizing ALL changes. We're identifying changes
that fit known trustable patterns. Everything else needs review.
"""

import fnmatch
from dataclasses import dataclass


@dataclass(frozen=True)
class TrustPattern:
    """Definition of a trust pattern."""

    id: str  # Pattern identifier (e.g., "imports:added")
    description: str  # Human-readable description


# Core trust patterns taxonomy (~20 patterns)
# These are ONLY for trustable/mechanical/patterned changes.
TRUST_PATTERNS: dict[str, TrustPattern] = {}


def _register(*patterns: TrustPattern) -> None:
    """Register patterns in the global registry."""
    for p in patterns:
        TRUST_PATTERNS[p.id] = p


# Imports
_register(
    TrustPattern("imports:added", "Import statements added"),
    TrustPattern("imports:removed", "Import statements removed"),
    TrustPattern("imports:reordered", "Imports reordered/reorganized"),
)

# Formatting
_register(
    TrustPattern(
        "formatting:whitespace", "Whitespace changes (spaces, tabs, blank lines)"
    ),
    TrustPattern("formatting:line-length", "Line wrapping/length changes"),
    TrustPattern("formatting:style", "Code style (quotes, trailing commas, etc.)"),
)

# Comments
_register(
    TrustPattern("comments:added", "Comments added"),
    TrustPattern("comments:removed", "Comments removed"),
    TrustPattern("comments:modified", "Comments changed"),
)

# Types & Annotations
_register(
    TrustPattern("types:added", "Type annotations added (no logic change)"),
    TrustPattern("types:removed", "Type annotations removed"),
    TrustPattern("types:modified", "Type annotations changed"),
)

# Files
_register(
    TrustPattern("file:deleted", "File deleted entirely"),
    TrustPattern("file:renamed", "File renamed (content unchanged)"),
    TrustPattern("file:moved", "File moved to different directory"),
)

# Code Movement & Renames (unchanged logic)
_register(
    TrustPattern(
        "code:relocated",
        "Code relocated with no behavior change (reordering, not new class/scope)",
    ),
    TrustPattern("rename:variable", "Variable/constant renamed"),
    TrustPattern("rename:function", "Function renamed"),
    TrustPattern("rename:class", "Class renamed"),
    TrustPattern("rename:parameter", "Parameter renamed"),
)

# Generated & Mechanical
_register(
    TrustPattern(
        "generated:lockfile", "Package lock file (package-lock.json, uv.lock, etc.)"
    ),
    TrustPattern("generated:config", "Auto-generated configuration"),
    TrustPattern("generated:migration", "Database migration files"),
    TrustPattern("version:bumped", "Version number changed"),
)

# Removal
_register(
    TrustPattern("remove:deprecated", "Deprecated code removed"),
)


def get_pattern(pattern_id: str) -> TrustPattern | None:
    """Get a pattern by ID."""
    return TRUST_PATTERNS.get(pattern_id)


def is_valid_pattern(pattern_id: str) -> bool:
    """Check if a pattern ID is valid (exists in taxonomy or is custom:*)."""
    if pattern_id in TRUST_PATTERNS:
        return True
    # Allow custom patterns (custom:whatever)
    if pattern_id.startswith("custom:"):
        return True
    return False


def get_all_patterns() -> list[TrustPattern]:
    """Get all registered patterns."""
    return list(TRUST_PATTERNS.values())


def get_category(pattern_id: str) -> str:
    """Extract the category from a pattern ID (the part before the colon)."""
    if ":" in pattern_id:
        return pattern_id.split(":")[0]
    return pattern_id


def pattern_matches_glob(pattern_id: str, glob_pattern: str) -> bool:
    """Check if a pattern ID matches a glob pattern.

    Examples:
        pattern_matches_glob("imports:added", "imports:*") -> True
        pattern_matches_glob("imports:added", "imports:added") -> True
        pattern_matches_glob("imports:added", "*:added") -> True
        pattern_matches_glob("imports:added", "formatting:*") -> False
    """
    return fnmatch.fnmatch(pattern_id, glob_pattern)


def patterns_match_trust_list(
    patterns: list[str], trust_list: list[str]
) -> tuple[bool, list[str]]:
    """Check if all patterns are trusted by the trust list.

    Args:
        patterns: List of pattern IDs from a hunk (e.g., ["imports:added"])
        trust_list: User's configured trust patterns (e.g., ["imports:*", "formatting:*"])

    Returns:
        (all_trusted, untrusted_patterns)
        - all_trusted: True if every pattern in `patterns` matches at least one in trust_list
        - untrusted_patterns: List of patterns that weren't matched
    """
    if not patterns:
        # Empty patterns = needs review (no trustable pattern recognized)
        return False, []

    untrusted = []
    for pattern in patterns:
        is_trusted = any(
            pattern_matches_glob(pattern, trusted) for trusted in trust_list
        )
        if not is_trusted:
            untrusted.append(pattern)

    return len(untrusted) == 0, untrusted


def format_pattern_list(patterns: list[str]) -> str:
    """Format a list of patterns for display."""
    if not patterns:
        return "(no patterns)"
    return ", ".join(patterns)


def get_pattern_description(pattern_id: str) -> str:
    """Get the description for a pattern ID."""
    pattern = TRUST_PATTERNS.get(pattern_id)
    if pattern:
        return pattern.description
    if pattern_id.startswith("custom:"):
        return f"Custom pattern: {pattern_id[7:]}"
    return pattern_id
