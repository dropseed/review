"""Configuration management for human-review.

Supports tiered configuration with user-level and project-level settings:
- User-level: ~/.config/human-review/settings.json
- Project-level: .human-review/settings.json

Project config overrides user config. Trust patterns support glob matching.
"""

import json
from pathlib import Path

from pydantic import BaseModel, Field

from .patterns import patterns_match_trust_list


class CustomPattern(BaseModel):
    """A user-defined custom pattern."""

    id: str  # Pattern ID (must start with "custom:")
    description: str


class HumanReviewConfig(BaseModel):
    """Configuration for human-review."""

    # Trust patterns that are auto-approved
    # Supports glob patterns like "imports:*"
    trust: list[str] = Field(default_factory=list)

    # Custom pattern definitions
    # Maps pattern ID (custom:*) to description
    patterns: dict[str, str] = Field(default_factory=dict)


def get_user_config_path() -> Path:
    """Get the user-level config file path."""
    return Path.home() / ".config" / "human-review" / "settings.json"


def get_project_config_path(repo_root: Path) -> Path:
    """Get the project-level config file path."""
    return repo_root / ".human-review" / "settings.json"


def load_config_file(path: Path) -> HumanReviewConfig:
    """Load config from a JSON file.

    Returns empty config if file doesn't exist or is invalid.
    """
    if not path.exists():
        return HumanReviewConfig()

    try:
        data = json.loads(path.read_text())
        return HumanReviewConfig.model_validate(data)
    except (json.JSONDecodeError, ValueError):
        return HumanReviewConfig()


def save_config_file(path: Path, config: HumanReviewConfig) -> None:
    """Save config to a JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config.model_dump(), indent=2) + "\n")


def merge_configs(
    user_config: HumanReviewConfig, project_config: HumanReviewConfig
) -> HumanReviewConfig:
    """Merge user and project configs.

    Project config takes precedence - its trust list replaces user's,
    and its custom patterns override user's.
    """
    # Start with user config
    merged_trust = list(user_config.trust)
    merged_patterns = dict(user_config.patterns)

    # Project trust completely replaces user trust if provided
    if project_config.trust:
        merged_trust = list(project_config.trust)
    else:
        # If project has no trust config, extend user's trust
        pass

    # Project patterns override user patterns
    merged_patterns.update(project_config.patterns)

    return HumanReviewConfig(
        trust=merged_trust,
        patterns=merged_patterns,
    )


class ConfigService:
    """Service for managing human-review configuration."""

    def __init__(self, repo_root: Path | None = None):
        self.repo_root = repo_root
        self._user_config: HumanReviewConfig | None = None
        self._project_config: HumanReviewConfig | None = None
        self._merged_config: HumanReviewConfig | None = None

    @property
    def user_config_path(self) -> Path:
        return get_user_config_path()

    @property
    def project_config_path(self) -> Path | None:
        if self.repo_root is None:
            return None
        return get_project_config_path(self.repo_root)

    def load_user_config(self) -> HumanReviewConfig:
        """Load user-level config."""
        if self._user_config is None:
            self._user_config = load_config_file(self.user_config_path)
        return self._user_config

    def load_project_config(self) -> HumanReviewConfig:
        """Load project-level config."""
        if self._project_config is None:
            if self.project_config_path:
                self._project_config = load_config_file(self.project_config_path)
            else:
                self._project_config = HumanReviewConfig()
        return self._project_config

    def get_config(self) -> HumanReviewConfig:
        """Get merged config (project overrides user)."""
        if self._merged_config is None:
            user = self.load_user_config()
            project = self.load_project_config()
            self._merged_config = merge_configs(user, project)
        return self._merged_config

    def invalidate_cache(self) -> None:
        """Clear cached configs."""
        self._user_config = None
        self._project_config = None
        self._merged_config = None

    def save_user_config(self, config: HumanReviewConfig) -> None:
        """Save user-level config."""
        save_config_file(self.user_config_path, config)
        self.invalidate_cache()

    def save_project_config(self, config: HumanReviewConfig) -> None:
        """Save project-level config."""
        if self.project_config_path is None:
            raise ValueError("No repo_root specified")
        save_config_file(self.project_config_path, config)
        self.invalidate_cache()

    def add_trust_pattern(self, pattern: str, *, project_level: bool = False) -> None:
        """Add a pattern to the trust list.

        Args:
            pattern: Pattern to trust (e.g., "imports:added" or "imports:*")
            project_level: If True, add to project config; otherwise user config
        """
        if project_level:
            config = self.load_project_config()
            if pattern not in config.trust:
                config.trust.append(pattern)
                self.save_project_config(config)
        else:
            config = self.load_user_config()
            if pattern not in config.trust:
                config.trust.append(pattern)
                self.save_user_config(config)

    def remove_trust_pattern(
        self, pattern: str, *, project_level: bool = False
    ) -> bool:
        """Remove a pattern from the trust list.

        Returns True if the pattern was found and removed.
        """
        if project_level:
            config = self.load_project_config()
            if pattern in config.trust:
                config.trust.remove(pattern)
                self.save_project_config(config)
                return True
        else:
            config = self.load_user_config()
            if pattern in config.trust:
                config.trust.remove(pattern)
                self.save_user_config(config)
                return True
        return False

    def is_pattern_trusted(self, pattern: str) -> bool:
        """Check if a single pattern is trusted by config."""
        config = self.get_config()
        trusted, _ = patterns_match_trust_list([pattern], config.trust)
        return trusted

    def are_patterns_trusted(self, patterns: list[str]) -> tuple[bool, list[str]]:
        """Check if all patterns are trusted.

        Returns (all_trusted, untrusted_patterns).
        """
        config = self.get_config()
        return patterns_match_trust_list(patterns, config.trust)

    def get_trust_list(self) -> list[str]:
        """Get the merged trust list."""
        return self.get_config().trust

    def get_custom_patterns(self) -> dict[str, str]:
        """Get custom pattern definitions."""
        return self.get_config().patterns

    def add_custom_pattern(
        self, pattern_id: str, description: str, *, project_level: bool = True
    ) -> None:
        """Add a custom pattern definition.

        Custom patterns should have IDs starting with "custom:".
        """
        if not pattern_id.startswith("custom:"):
            pattern_id = f"custom:{pattern_id}"

        if project_level:
            config = self.load_project_config()
            config.patterns[pattern_id] = description
            self.save_project_config(config)
        else:
            config = self.load_user_config()
            config.patterns[pattern_id] = description
            self.save_user_config(config)


def get_default_trust_list() -> list[str]:
    """Get a sensible default trust list for new users.

    These are patterns that are generally safe to auto-approve.
    """
    return [
        "imports:*",  # Import changes are usually safe
        "formatting:*",  # Formatting is purely cosmetic
        "comments:*",  # Comment changes don't affect behavior
        "generated:lockfile",  # Lock files are auto-generated
        "file:renamed",  # Renames with unchanged content
        "file:moved",  # Moves with unchanged content
    ]


def format_config_for_display(config: HumanReviewConfig) -> str:
    """Format config for human-readable display."""
    lines = []

    if config.trust:
        lines.append("Trust patterns:")
        for pattern in config.trust:
            lines.append(f"  - {pattern}")
    else:
        lines.append("Trust patterns: (none)")

    if config.patterns:
        lines.append("")
        lines.append("Custom patterns:")
        for pattern_id, description in config.patterns.items():
            lines.append(f"  - {pattern_id}: {description}")

    return "\n".join(lines)
