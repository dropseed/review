"""Output styling helpers for consistent CLI display."""

import os

import click


def _color_enabled() -> bool:
    """Check if color output is enabled (respects NO_COLOR)."""
    # https://no-color.org/ - disable if NO_COLOR is set (any non-empty value)
    return not bool(os.environ.get("NO_COLOR"))


def success(text: str) -> str:
    """Style text as success (green)."""
    if not _color_enabled():
        return text
    return click.style(text, fg="green")


def error(text: str) -> str:
    """Style text as error (red)."""
    if not _color_enabled():
        return text
    return click.style(text, fg="red")


def warning(text: str) -> str:
    """Style text as warning (yellow)."""
    if not _color_enabled():
        return text
    return click.style(text, fg="yellow")


def info(text: str) -> str:
    """Style text as info (cyan)."""
    if not _color_enabled():
        return text
    return click.style(text, fg="cyan")


def dim(text: str) -> str:
    """Style text as dimmed."""
    if not _color_enabled():
        return text
    return click.style(text, dim=True)


def bold(text: str) -> str:
    """Style text as bold."""
    if not _color_enabled():
        return text
    return click.style(text, bold=True)


def file_path_style(text: str) -> str:
    """Style a file path."""
    if not _color_enabled():
        return text
    return click.style(text, fg="blue", bold=True)


def progress_bar(reviewed: int, total: int, width: int = 20) -> str:
    """Create a simple text progress bar."""
    if total == 0:
        return "─" * width if not _color_enabled() else dim("─" * width)
    filled = int(width * reviewed / total)
    empty = width - filled
    if not _color_enabled():
        return "█" * filled + "░" * empty
    return success("█" * filled) + dim("░" * empty)
