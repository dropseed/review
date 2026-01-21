"""Click CLI entry point."""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import click

from .git import (
    GitError,
    git_current_branch,
    git_default_branch,
    git_diff,
    git_diff_name_status,
    git_ref_exists,
    git_root,
    git_untracked_files,
)
from .hunks import (
    ChangedFile,
    create_untracked_hunk,
    get_hunk_key,
    parse_diff_to_hunks,
    parse_name_status,
)
from .skill import install_skill
from .state import ReviewState, ReviewStateService


# Styling helpers for consistent output
def success(text: str) -> str:
    """Style text as success (green)."""
    return click.style(text, fg="green")


def error(text: str) -> str:
    """Style text as error (red)."""
    return click.style(text, fg="red")


def warning(text: str) -> str:
    """Style text as warning (yellow)."""
    return click.style(text, fg="yellow")


def info(text: str) -> str:
    """Style text as info (cyan)."""
    return click.style(text, fg="cyan")


def dim(text: str) -> str:
    """Style text as dimmed."""
    return click.style(text, dim=True)


def bold(text: str) -> str:
    """Style text as bold."""
    return click.style(text, bold=True)


def header(text: str) -> str:
    """Style text as a header (bold cyan)."""
    return click.style(text, fg="cyan", bold=True)


def file_path_style(text: str) -> str:
    """Style a file path."""
    return click.style(text, fg="blue", bold=True)


def progress_bar(reviewed: int, total: int, width: int = 20) -> str:
    """Create a simple text progress bar."""
    if total == 0:
        return dim("─" * width)
    filled = int(width * reviewed / total)
    empty = width - filled
    bar = success("█" * filled) + dim("░" * empty)
    return bar


def get_repo_root() -> Path:
    """Get the git repository root, exiting on error."""
    try:
        return git_root()
    except GitError as e:
        click.echo(f"{error('Error:')} {e}", err=True)
        sys.exit(1)


def get_state_service() -> ReviewStateService:
    """Get the state service for the current repo."""
    return ReviewStateService(get_repo_root())


def get_current_comparison(
    service: ReviewStateService, base_override: str | None = None
) -> tuple[str, str | None]:
    """Get the current comparison (base, compare).

    If base_override is provided, uses that as base with working tree.
    Otherwise reads from .pullapprove/current or auto-detects.

    Returns (base, compare) where compare is None for working tree.
    """
    repo_root = service.repo_root

    if base_override:
        # Validate the ref exists
        if not git_ref_exists(base_override, cwd=repo_root):
            click.echo(f"{error('Error:')} ref '{base_override}' not found", err=True)
            sys.exit(1)
        return base_override, None

    # Check for saved current comparison
    current = service.get_current_comparison()
    if current:
        # Parse comparison key: base..compare or base..branch+
        if ".." in current:
            base, rest = current.split("..", 1)
            if rest.endswith("+"):
                # Working tree comparison
                return base, None
            else:
                # Branch comparison
                return base, rest
        # Just a base ref
        return current, None

    # Auto-detect: working tree vs default branch
    base = git_default_branch(cwd=repo_root)
    return base, None


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


@click.group()
@click.pass_context
def cli(ctx: click.Context) -> None:
    """Code review CLI - track hunk-level review progress.

    Run 'git review compare <base>' to start a review, then use
    'git review status' and 'git review diff' to see progress.
    """
    pass


def _format_relative_time(mtime: float) -> str:
    """Format a timestamp as relative time (e.g., '2 hours ago')."""
    import time

    diff = time.time() - mtime
    if diff < 60:
        return "just now"
    elif diff < 3600:
        mins = int(diff / 60)
        return f"{mins} minute{'s' if mins != 1 else ''} ago"
    elif diff < 86400:
        hours = int(diff / 3600)
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    elif diff < 604800:
        days = int(diff / 86400)
        return f"{days} day{'s' if days != 1 else ''} ago"
    else:
        weeks = int(diff / 604800)
        return f"{weeks} week{'s' if weeks != 1 else ''} ago"


@cli.command("list")
def list_cmd() -> None:
    """List stored reviews."""
    service = get_state_service()

    if not service.state_dir.exists():
        click.echo(dim("No reviews stored."))
        return

    current = service.get_current_comparison()
    reviews = list(service.state_dir.glob("*.json"))

    if not reviews:
        click.echo(dim("No reviews stored."))
        return

    click.echo(f"\n{bold('Stored Reviews')}")
    click.echo(dim("─" * 50))

    # Sort by modification time, newest first
    reviews.sort(key=lambda f: f.stat().st_mtime, reverse=True)

    for review_file in reviews:
        try:
            state = ReviewState.model_validate_json(review_file.read_text())
            comparison_key = state.comparison.key
            is_current = comparison_key == current
            hunk_count = sum(
                1 for h in state.hunks.values() if h.reviewed_by is not None
            )
            mtime = review_file.stat().st_mtime
            time_str = _format_relative_time(mtime)

            # Format with styling
            if is_current:
                marker = success("●")
                name = bold(info(comparison_key))
            else:
                marker = dim("○")
                name = comparison_key

            hunks_str = info(f"{hunk_count} hunks")
            time_str = dim(time_str)

            click.echo(f"  {marker} {name}  {hunks_str} reviewed {dim('·')} {time_str}")
        except Exception:
            # Skip invalid files
            pass
    click.echo()


@cli.command()
@click.argument("comparison")
def compare(comparison: str) -> None:
    """Start a review by setting the comparison.

    COMPARISON can be:
      - A branch name (e.g., 'main') for working tree comparison
      - Two refs with '..' (e.g., 'main..feature') for branch comparison
    """
    service = get_state_service()
    repo_root = service.repo_root

    if ".." in comparison:
        # Branch comparison
        base, compare_ref = comparison.split("..", 1)
        if not compare_ref:
            click.echo(f"{error('Error:')} missing compare branch after '..'", err=True)
            sys.exit(1)
        if not git_ref_exists(base, cwd=repo_root):
            click.echo(f"{error('Error:')} base ref '{base}' not found", err=True)
            sys.exit(1)
        if not git_ref_exists(compare_ref, cwd=repo_root):
            click.echo(
                f"{error('Error:')} compare ref '{compare_ref}' not found", err=True
            )
            sys.exit(1)
        comp = service.make_comparison(base, compare_ref)
    else:
        # Working tree comparison
        base = comparison
        if not git_ref_exists(base, cwd=repo_root):
            click.echo(f"{error('Error:')} ref '{base}' not found", err=True)
            sys.exit(1)
        current_branch = git_current_branch(cwd=repo_root)
        comp = service.make_comparison(base, None, current_branch)

    service.set_current_comparison(comp.key)
    click.echo(f"{success('✓')} Review started: {info(comp.key)}")


@cli.command()
@click.option("--base", help="Override base ref for this command")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.option("--files", "show_files", is_flag=True, help="Show per-file breakdown")
def status(base: str | None, as_json: bool, show_files: bool) -> None:
    """Show review progress and what actions are needed.

    Groups hunks by action needed:
    - Ready for bulk approval (agent-approved, awaiting confirmation)
    - Needs your review (flagged for human review)
    - Completed (already reviewed)
    """
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)
    current_branch = git_current_branch(cwd=service.repo_root)
    comp = service.make_comparison(base_ref, compare_ref, current_branch)
    comparison_key = comp.key

    files = get_changed_files(base_ref, compare_ref, service.repo_root)
    state = service.load(comparison_key)

    # Track hunks by action needed, grouped by reason
    # Each reason maps to {total, reviewed, suggested}
    by_reason: dict[str, dict] = {}
    total_hunks = 0
    reviewed_hunks = 0
    unclassified_total = 0

    for f in files:
        for hunk in f.hunks:
            total_hunks += 1
            hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
            hunk_state = state.hunks.get(hunk_key)
            is_reviewed = hunk_state.reviewed_by is not None if hunk_state else False

            if is_reviewed:
                reviewed_hunks += 1

            if hunk_state and hunk_state.suggested is not None:
                reason = hunk_state.reason or "(no reason)"
                if reason not in by_reason:
                    by_reason[reason] = {
                        "total": 0,
                        "reviewed": 0,
                        "suggested": hunk_state.suggested,
                    }
                by_reason[reason]["total"] += 1
                if is_reviewed:
                    by_reason[reason]["reviewed"] += 1
            else:
                unclassified_total += 1

    # Group reasons by action needed
    # Ready for bulk approval: agent + unreviewed
    # Needs your review: human + unreviewed
    # Completed: anything reviewed
    ready_for_approval: list[tuple[str, dict]] = []
    needs_review: list[tuple[str, dict]] = []
    completed: list[tuple[str, dict]] = []

    for reason, stats in by_reason.items():
        unreviewed = stats["total"] - stats["reviewed"]
        if stats["reviewed"] > 0:
            # Some or all reviewed - add to completed
            completed.append(
                (reason, {"count": stats["reviewed"], "suggested": stats["suggested"]})
            )
        if unreviewed > 0:
            if stats["suggested"] == "agent":
                ready_for_approval.append((reason, {"count": unreviewed}))
            elif stats["suggested"] == "human":
                needs_review.append((reason, {"count": unreviewed}))

    # Sort by count descending
    ready_for_approval.sort(key=lambda x: x[1]["count"], reverse=True)
    needs_review.sort(key=lambda x: x[1]["count"], reverse=True)
    completed.sort(key=lambda x: x[1]["count"], reverse=True)

    if as_json:
        output = {
            "comparison": comparison_key,
            "total_hunks": total_hunks,
            "reviewed_hunks": reviewed_hunks,
            "progress_percent": round(reviewed_hunks / total_hunks * 100)
            if total_hunks
            else 0,
            "ready_for_approval": [
                {"reason": r, "count": s["count"]} for r, s in ready_for_approval
            ],
            "needs_review": [
                {"reason": r, "count": s["count"]} for r, s in needs_review
            ],
            "completed": [
                {"reason": r, "count": s["count"], "suggested": s["suggested"]}
                for r, s in completed
            ],
            "unclassified": unclassified_total,
        }
        click.echo(json.dumps(output, indent=2))
        return

    # Human-readable output
    def hunk_word(n: int) -> str:
        return "hunk" if n == 1 else "hunks"

    click.echo()

    if total_hunks == 0:
        click.echo(dim("No changes to review."))
        return

    # Progress bar at top
    percent = round(reviewed_hunks / total_hunks * 100)
    overall_bar = progress_bar(reviewed_hunks, total_hunks, width=30)
    percent_style = success if percent == 100 else (warning if percent >= 50 else dim)
    click.echo(
        f"{bold('Progress:')} {overall_bar} {percent_style(f'{percent}%')} {dim(f'({reviewed_hunks}/{total_hunks} hunks)')}"
    )

    # Ready for bulk approval
    if ready_for_approval:
        click.echo()
        total_ready = sum(s["count"] for _, s in ready_for_approval)
        click.echo(
            f"{success('Ready for bulk approval')} ({total_ready} {hunk_word(total_ready)}) {dim('← mark --agent')}"
        )
        for reason, stats in ready_for_approval:
            display_reason = reason if len(reason) <= 30 else reason[:27] + "..."
            click.echo(
                f"  {dim('·')} {display_reason:32} {stats['count']:3} {hunk_word(stats['count'])}"
            )

    # Needs your review
    if needs_review:
        click.echo()
        total_needs = sum(s["count"] for _, s in needs_review)
        click.echo(
            f"{warning('Needs your review')} ({total_needs} {hunk_word(total_needs)})"
        )
        for reason, stats in needs_review:
            display_reason = reason if len(reason) <= 30 else reason[:27] + "..."
            click.echo(
                f"  {dim('·')} {display_reason:32} {stats['count']:3} {hunk_word(stats['count'])}"
            )

    # Unclassified
    if unclassified_total > 0:
        click.echo()
        click.echo(
            f"{dim('Unclassified')} ({unclassified_total} {hunk_word(unclassified_total)}) {dim('← needs classification')}"
        )

    # Completed
    if completed:
        click.echo()
        total_completed = sum(s["count"] for _, s in completed)
        click.echo(
            f"{dim('Completed')} ({total_completed} {hunk_word(total_completed)})"
        )
        for reason, stats in completed:
            display_reason = reason if len(reason) <= 30 else reason[:27] + "..."
            reviewer = "agent" if stats["suggested"] == "agent" else "you"
            click.echo(
                f"  {dim('·')} {display_reason:32} {stats['count']:3} {hunk_word(stats['count'])} {dim(f'({reviewer})')}"
            )

    # Optional per-file breakdown
    if show_files:
        click.echo()
        click.echo(dim("─" * 60))
        click.echo(bold("Per-file breakdown:"))
        for f in files:
            file_reviewed = sum(
                1
                for h in f.hunks
                if (hs := state.hunks.get(get_hunk_key(h.file_path, h.hash)))
                and hs.reviewed_by is not None
            )
            file_total = len(f.hunks)
            is_complete = file_reviewed >= file_total
            status_mark = success("✓") if is_complete else dim("○")
            path_display = dim(f.path) if is_complete else file_path_style(f.path)
            count_display = f"{file_reviewed}/{file_total}"
            click.echo(f"  {status_mark} {path_display:55} {count_display}")

    click.echo()


@cli.command("stats")
@click.option("--base", help="Override base ref for this command")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def stats_cmd(base: str | None, as_json: bool) -> None:
    """Show diff statistics grouped by file status.

    Use this to understand the scope of changes before classification.
    For review progress, use 'status' instead.
    """
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)

    files = get_changed_files(base_ref, compare_ref, service.repo_root)

    # Group by status
    by_status: dict[str, dict] = {}
    total_hunks = 0
    total_files = len(files)

    for f in files:
        status = f.status
        if status not in by_status:
            by_status[status] = {"files": 0, "hunks": 0}
        by_status[status]["files"] += 1
        by_status[status]["hunks"] += len(f.hunks)
        total_hunks += len(f.hunks)

    if as_json:
        output = {
            "total_files": total_files,
            "total_hunks": total_hunks,
            "by_status": by_status,
        }
        click.echo(json.dumps(output, indent=2))
        return

    # Human-readable output
    click.echo()
    click.echo(f"{bold(str(total_hunks))} hunks across {bold(str(total_files))} files")
    click.echo()

    # By status (git-native colors and symbols)
    status_style = {
        "added": (click.style("A", fg="green"), click.style("added", fg="green")),
        "deleted": (click.style("D", fg="red"), click.style("deleted", fg="red")),
        "modified": (
            click.style("M", fg="yellow"),
            click.style("modified", fg="yellow"),
        ),
        "renamed": (click.style("R", fg="cyan"), click.style("renamed", fg="cyan")),
        "untracked": (
            click.style("?", fg="magenta"),
            click.style("untracked", fg="magenta"),
        ),
    }
    status_order = ["added", "modified", "deleted", "renamed", "untracked"]
    for status in status_order:
        if status in by_status:
            s = by_status[status]
            files_word = "file" if s["files"] == 1 else "files"
            hunks_word = "hunk" if s["hunks"] == 1 else "hunks"
            symbol, styled_status = status_style.get(status, ("·", status))
            click.echo(
                f"  {symbol} {styled_status:20} {s['files']:3} {files_word}, {s['hunks']:3} {hunks_word}"
            )
    # Any other statuses not in the order
    for status, s in by_status.items():
        if status not in status_order:
            files_word = "file" if s["files"] == 1 else "files"
            hunks_word = "hunk" if s["hunks"] == 1 else "hunks"
            click.echo(
                f"  · {status:20} {s['files']:3} {files_word}, {s['hunks']:3} {hunks_word}"
            )

    click.echo()


@cli.command("files")
@click.option("--base", help="Override base ref for this command")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.option(
    "--status",
    "file_status",
    type=click.Choice(["renamed", "deleted", "added", "modified", "untracked"]),
    help="Only show files with this git status",
)
@click.option(
    "--reason",
    "filter_reason",
    help="Only show files with hunks classified with this reason",
)
@click.option(
    "--unreviewed", is_flag=True, help="Only show files with unreviewed hunks"
)
@click.option(
    "--unclassified", is_flag=True, help="Only show files with unclassified hunks"
)
def files_cmd(
    base: str | None,
    as_json: bool,
    file_status: str | None,
    filter_reason: str | None,
    unreviewed: bool,
    unclassified: bool,
) -> None:
    """List changed files with hunk counts (lightweight, no content).

    Use this to get an overview before fetching individual file diffs.
    """
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)
    current_branch = git_current_branch(cwd=service.repo_root)
    comp = service.make_comparison(base_ref, compare_ref, current_branch)
    comparison_key = comp.key

    files = get_changed_files(base_ref, compare_ref, service.repo_root)
    state = service.load(comparison_key)

    # Filter by status if specified
    if file_status:
        files = [f for f in files if f.status == file_status]

    file_data = []
    for f in files:
        reviewed_count = 0
        classified_count = 0
        has_matching_reason = False
        has_unreviewed = False
        has_unclassified_hunk = False
        file_reasons: set[str] = set()

        for hunk in f.hunks:
            hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
            hunk_state = state.hunks.get(hunk_key)
            is_reviewed = hunk_state.reviewed_by is not None if hunk_state else False
            is_classified = hunk_state.suggested is not None if hunk_state else False

            if is_reviewed:
                reviewed_count += 1
            else:
                has_unreviewed = True

            if is_classified:
                classified_count += 1
                if hunk_state.reason:
                    file_reasons.add(hunk_state.reason)
                    if hunk_state.reason == filter_reason:
                        has_matching_reason = True
            else:
                has_unclassified_hunk = True

        # Apply filters
        if filter_reason and not has_matching_reason:
            continue
        if unreviewed and not has_unreviewed:
            continue
        if unclassified and not has_unclassified_hunk:
            continue

        file_data.append(
            {
                "path": f.path,
                "status": f.status,
                "hunks": len(f.hunks),
                "reviewed": reviewed_count,
                "classified": classified_count,
                "reasons": sorted(file_reasons),
            }
        )

    if as_json:
        click.echo(
            json.dumps({"comparison": comparison_key, "files": file_data}, indent=2)
        )
        return

    # Human-readable output
    if not file_data:
        filters = []
        if file_status:
            filters.append(f"status '{file_status}'")
        if filter_reason:
            filters.append(f"reason '{filter_reason}'")
        if unreviewed:
            filters.append("unreviewed")
        if unclassified:
            filters.append("unclassified")
        if filters:
            click.echo(dim(f"No files matching: {', '.join(filters)}."))
        else:
            click.echo(dim("No changed files."))
        return

    # Build header suffix
    filter_parts = []
    if file_status:
        filter_parts.append(file_status)
    if filter_reason:
        filter_parts.append(f"reason: {filter_reason}")
    if unreviewed:
        filter_parts.append("unreviewed")
    if unclassified:
        filter_parts.append("unclassified")
    filter_suffix = f" [{', '.join(filter_parts)}]" if filter_parts else ""

    click.echo(f"\n{bold('Files')}{filter_suffix} {dim(f'({comparison_key})')}")
    click.echo(dim("─" * 60))
    for fd in file_data:
        is_complete = fd["reviewed"] >= fd["hunks"]
        status_mark = success("✓") if is_complete else dim("○")
        path_display = (
            file_path_style(fd["path"]) if not is_complete else dim(fd["path"])
        )
        hunks_str = f"{fd['reviewed']}/{fd['hunks']} hunks"
        if is_complete:
            hunks_str = success(hunks_str)
        else:
            hunks_str = warning(hunks_str)
        # Show reasons if any
        if fd["reasons"]:
            reason_str = dim(f"({', '.join(fd['reasons'])})")
        else:
            reason_str = dim("(unclassified)")
        click.echo(f"  {status_mark} {path_display:50} {hunks_str} {reason_str}")
    click.echo()


@cli.command("diff")
@click.argument("path", required=False)
@click.option("--base", help="Override base ref for this command")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON for agents")
@click.option("--unreviewed", is_flag=True, help="Only show unreviewed hunks")
@click.option("--unclassified", is_flag=True, help="Only show unclassified hunks")
@click.option(
    "--reason", "filter_reason", help="Only show hunks with this classification reason"
)
@click.option(
    "--status",
    "file_status",
    type=click.Choice(["renamed", "deleted", "added", "modified", "untracked"]),
    help="Only show files with this git status",
)
@click.option("--limit", type=int, help="Maximum number of hunks to return")
@click.option(
    "--offset", type=int, default=0, help="Skip first N hunks (for pagination)"
)
def diff_cmd(
    path: str | None,
    base: str | None,
    as_json: bool,
    unreviewed: bool,
    unclassified: bool,
    filter_reason: str | None,
    file_status: str | None,
    limit: int | None,
    offset: int,
) -> None:
    """Show diff with hunk hashes and review markers.

    Optionally filter to a specific PATH.

    \b
    Filtering options:
      --unreviewed    Only show hunks not yet reviewed
      --unclassified  Only show hunks not yet classified
      --reason TEXT   Only show hunks with this classification reason
      --status TEXT   Only show files with this git status

    \b
    Pagination (for large diffs):
      --limit N       Maximum number of hunks to return
      --offset N      Skip first N hunks
    """
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)
    current_branch = git_current_branch(cwd=service.repo_root)
    comp = service.make_comparison(base_ref, compare_ref, current_branch)
    comparison_key = comp.key

    files = get_changed_files(base_ref, compare_ref, service.repo_root)
    state = service.load(comparison_key)

    # Filter by path if provided
    if path:
        files = [f for f in files if f.path == path or f.path.startswith(path + "/")]

    # Filter by status if provided
    if file_status:
        files = [f for f in files if f.status == file_status]

    # Helper to check if a hunk passes filters
    def hunk_passes_filter(hunk, hunk_state) -> bool:
        if unreviewed:
            is_reviewed = hunk_state.reviewed_by is not None if hunk_state else False
            if is_reviewed:
                return False
        if unclassified:
            is_classified = hunk_state.suggested is not None if hunk_state else False
            if is_classified:
                return False
        if filter_reason:
            hunk_reason = hunk_state.reason if hunk_state else None
            if hunk_reason != filter_reason:
                return False
        return True

    if as_json:
        output = {
            "comparison": comparison_key,
            "files": [],
        }

        # Track pagination
        total_matching = 0
        hunks_skipped = 0
        hunks_included = 0

        for f in files:
            file_data = {
                "path": f.path,
                "status": f.status,
                "hunks": [],
            }
            if f.old_path:
                file_data["old_path"] = f.old_path

            for hunk in f.hunks:
                hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                hunk_state = state.hunks.get(hunk_key)

                # Apply filters
                if not hunk_passes_filter(hunk, hunk_state):
                    continue

                total_matching += 1

                # Apply offset
                if hunks_skipped < offset:
                    hunks_skipped += 1
                    continue

                # Apply limit
                if limit is not None and hunks_included >= limit:
                    continue

                hunks_included += 1

                hunk_data = {
                    "hash": hunk.hash,
                    "reviewed_by": hunk_state.reviewed_by if hunk_state else None,
                    "header": hunk.header,
                    "content": hunk.content,
                    "start_line": hunk.start_line,
                    "end_line": hunk.end_line,
                }
                # Include classification if present
                if hunk_state and hunk_state.suggested is not None:
                    hunk_data["classification"] = {
                        "suggested": hunk_state.suggested,
                        "reason": hunk_state.reason,
                    }
                file_data["hunks"].append(hunk_data)

            # Only include files that have hunks after filtering
            if file_data["hunks"]:
                output["files"].append(file_data)

        # Add pagination metadata
        output["pagination"] = {
            "offset": offset,
            "limit": limit,
            "returned": hunks_included,
            "total_matching": total_matching,
            "has_more": total_matching > offset + hunks_included,
        }

        click.echo(json.dumps(output, indent=2))
        return

    # Human-readable output
    if not files:
        click.echo(dim("No changes to show."))
        return

    # Track pagination for human output too
    hunks_skipped = 0
    hunks_shown = 0

    for f in files:
        # Filter hunks for this file
        filtered_hunks = []
        for hunk in f.hunks:
            hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
            hunk_state = state.hunks.get(hunk_key)
            if hunk_passes_filter(hunk, hunk_state):
                filtered_hunks.append((hunk, hunk_state))

        if not filtered_hunks:
            continue

        file_reviewed = sum(
            1
            for h in f.hunks
            if (hs := state.hunks.get(get_hunk_key(h.file_path, h.hash)))
            and hs.reviewed_by is not None
        )
        is_complete = file_reviewed >= len(f.hunks)

        # File header with visual separation
        click.echo()
        click.echo(dim("─" * 70))
        status_indicator = success("✓") if is_complete else warning("○")
        progress_text = f"{file_reviewed}/{len(f.hunks)}"
        if is_complete:
            progress_text = success(progress_text)
        else:
            progress_text = warning(progress_text)
        click.echo(
            f"{status_indicator} {file_path_style(f.path)} {dim('·')} {progress_text} {dim('hunks reviewed')}"
        )
        if f.old_path:
            click.echo(f"  {dim('renamed from')} {dim(f.old_path)}")
        click.echo()

        for hunk, hunk_state in filtered_hunks:
            # Apply offset
            if hunks_skipped < offset:
                hunks_skipped += 1
                continue

            # Apply limit
            if limit is not None and hunks_shown >= limit:
                continue

            hunks_shown += 1

            is_reviewed = hunk_state.reviewed_by is not None if hunk_state else False
            marker = success("✓") if is_reviewed else dim("○")
            hash_display = info(hunk.hash)
            header_display = dim(hunk.header)

            click.echo(f"  {marker} {hash_display} {header_display}")

            # Show content lines (indented)
            for line in hunk.content.split("\n"):
                if line.startswith("+") and not line.startswith("+++"):
                    click.echo(click.style(f"    {line}", fg="green"))
                elif line.startswith("-") and not line.startswith("---"):
                    click.echo(click.style(f"    {line}", fg="red"))
                elif not line.startswith("@@"):
                    click.echo(f"    {dim(line)}")

            click.echo()


@cli.command()
@click.argument("spec", required=False)
@click.option("--base", help="Override base ref for this command")
@click.option(
    "--agent",
    "mark_agent",
    is_flag=True,
    help="Mark all agent-reviewable hunks as reviewed",
)
@click.option(
    "--reason", "mark_reason", help="Mark all hunks with this classification reason"
)
def mark(
    spec: str | None, base: str | None, mark_agent: bool, mark_reason: str | None
) -> None:
    """Mark hunks as reviewed.

    \b
    SPEC can be:
      - A file path (marks all hunks in file)
      - path:hash (marks specific hunk)
      - path:h1,h2 (marks multiple hunks)

    Or use --agent to mark all hunks classified as agent-reviewable (suggested: "agent").
    Or use --reason to mark all hunks with a specific classification reason.
    """
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)
    current_branch = git_current_branch(cwd=service.repo_root)
    comp = service.make_comparison(base_ref, compare_ref, current_branch)
    comparison_key = comp.key

    # Handle --agent: mark all agent-reviewable hunks
    if mark_agent:
        files = get_changed_files(base_ref, compare_ref, service.repo_root)
        agent_keys = service.get_agent_hunk_keys(comparison_key)

        if not agent_keys:
            click.echo(dim("No hunks classified as agent-reviewable."))
            return

        # Build set of valid hunk keys from current diff
        valid_keys = set()
        for f in files:
            for hunk in f.hunks:
                valid_keys.add(get_hunk_key(hunk.file_path, hunk.hash))

        marked_count = 0
        for hunk_key in agent_keys:
            if hunk_key in valid_keys:
                service.mark_hunk(comparison_key, hunk_key, "agent")
                marked_count += 1

        click.echo(
            f"{success('✓')} Marked {bold(str(marked_count))} agent-reviewable hunk(s) as reviewed."
        )
        return

    # Handle --reason: mark all hunks with matching classification reason
    if mark_reason:
        files = get_changed_files(base_ref, compare_ref, service.repo_root)
        state = service.load(comparison_key)

        # Build set of valid hunk keys from current diff
        valid_keys = set()
        for f in files:
            for hunk in f.hunks:
                valid_keys.add(get_hunk_key(hunk.file_path, hunk.hash))

        # Find hunks with matching reason
        matching_keys = []
        for hunk_key, hunk_state in state.hunks.items():
            if hunk_state.reason == mark_reason and hunk_key in valid_keys:
                matching_keys.append(hunk_key)

        if not matching_keys:
            click.echo(dim(f"No hunks with reason '{mark_reason}'."))
            return

        marked_count = 0
        for hunk_key in matching_keys:
            service.mark_hunk(comparison_key, hunk_key)
            marked_count += 1

        click.echo(
            f"{success('✓')} Marked {bold(str(marked_count))} hunk(s) with reason '{info(mark_reason)}'."
        )
        return

    if not spec:
        click.echo(
            f"{error('Error:')} SPEC required (or use --agent, --reason)", err=True
        )
        sys.exit(1)

    files = get_changed_files(base_ref, compare_ref, service.repo_root)
    path, hashes = parse_hunk_spec(spec)

    # Find matching file(s)
    matching_files = [
        f for f in files if f.path == path or f.path.startswith(path + "/")
    ]
    if not matching_files:
        click.echo(f"{error('Error:')} no changes found for '{path}'", err=True)
        sys.exit(1)

    marked_count = 0
    for f in matching_files:
        for hunk in f.hunks:
            if hashes is None or hunk.hash in hashes:
                hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                service.mark_hunk(comparison_key, hunk_key)
                marked_count += 1
                if hashes:
                    click.echo(
                        f"  {success('✓')} {file_path_style(f.path)}{dim(':')}{info(hunk.hash)}"
                    )

    if hashes:
        not_found = set(hashes) - {h.hash for f in matching_files for h in f.hunks}
        for h in not_found:
            click.echo(
                f"{warning('Warning:')} hash '{h}' not found in {path}", err=True
            )
    else:
        click.echo(
            f"{success('✓')} Marked {bold(str(marked_count))} hunk(s) in {file_path_style(path)}"
        )


@cli.command()
@click.argument("spec", required=False)
@click.option("--base", help="Override base ref for this command")
@click.option(
    "--agent", "unmark_agent", is_flag=True, help="Unmark all agent-reviewed hunks"
)
@click.option(
    "--reason", "unmark_reason", help="Unmark all hunks with this classification reason"
)
def unmark(
    spec: str | None, base: str | None, unmark_agent: bool, unmark_reason: str | None
) -> None:
    """Unmark hunks as reviewed.

    \b
    SPEC can be:
      - A file path (unmarks all hunks in file)
      - path:hash (unmarks specific hunk)
      - path:h1,h2 (unmarks multiple hunks)

    Or use --agent to unmark all hunks that were marked by the agent.
    Or use --reason to unmark all hunks with a specific classification reason.
    """
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)
    current_branch = git_current_branch(cwd=service.repo_root)
    comp = service.make_comparison(base_ref, compare_ref, current_branch)
    comparison_key = comp.key

    # Handle --agent: unmark all agent-reviewed hunks
    if unmark_agent:
        files = get_changed_files(base_ref, compare_ref, service.repo_root)
        state = service.load(comparison_key)

        # Build set of valid hunk keys from current diff
        valid_keys = set()
        for f in files:
            for hunk in f.hunks:
                valid_keys.add(get_hunk_key(hunk.file_path, hunk.hash))

        # Find hunks reviewed by agent
        agent_reviewed_keys = []
        for hunk_key, hunk_state in state.hunks.items():
            if hunk_state.reviewed_by == "agent" and hunk_key in valid_keys:
                agent_reviewed_keys.append(hunk_key)

        if not agent_reviewed_keys:
            click.echo(dim("No hunks reviewed by agent."))
            return

        unmarked_count = 0
        for hunk_key in agent_reviewed_keys:
            service.unmark_hunk(comparison_key, hunk_key)
            unmarked_count += 1

        click.echo(
            f"{dim('○')} Unmarked {bold(str(unmarked_count))} agent-reviewed hunk(s)."
        )
        return

    # Handle --reason: unmark all hunks with matching classification reason
    if unmark_reason:
        files = get_changed_files(base_ref, compare_ref, service.repo_root)
        state = service.load(comparison_key)

        # Build set of valid hunk keys from current diff
        valid_keys = set()
        for f in files:
            for hunk in f.hunks:
                valid_keys.add(get_hunk_key(hunk.file_path, hunk.hash))

        # Find reviewed hunks with matching reason
        matching_keys = []
        for hunk_key, hunk_state in state.hunks.items():
            if (
                hunk_state.reason == unmark_reason
                and hunk_state.reviewed_by is not None
                and hunk_key in valid_keys
            ):
                matching_keys.append(hunk_key)

        if not matching_keys:
            click.echo(dim(f"No reviewed hunks with reason '{unmark_reason}'."))
            return

        unmarked_count = 0
        for hunk_key in matching_keys:
            service.unmark_hunk(comparison_key, hunk_key)
            unmarked_count += 1

        click.echo(
            f"{dim('○')} Unmarked {bold(str(unmarked_count))} hunk(s) with reason '{info(unmark_reason)}'."
        )
        return

    if not spec:
        click.echo(
            f"{error('Error:')} SPEC required (or use --agent, --reason)", err=True
        )
        sys.exit(1)

    files = get_changed_files(base_ref, compare_ref, service.repo_root)
    path, hashes = parse_hunk_spec(spec)

    # Find matching file(s)
    matching_files = [
        f for f in files if f.path == path or f.path.startswith(path + "/")
    ]
    if not matching_files:
        click.echo(f"{error('Error:')} no changes found for '{path}'", err=True)
        sys.exit(1)

    unmarked_count = 0
    for f in matching_files:
        for hunk in f.hunks:
            if hashes is None or hunk.hash in hashes:
                hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                service.unmark_hunk(comparison_key, hunk_key)
                unmarked_count += 1
                if hashes:
                    click.echo(
                        f"  {dim('○')} {file_path_style(f.path)}{dim(':')}{info(hunk.hash)}"
                    )

    if hashes:
        not_found = set(hashes) - {h.hash for f in matching_files for h in f.hunks}
        for h in not_found:
            click.echo(
                f"{warning('Warning:')} hash '{h}' not found in {path}", err=True
            )
    else:
        click.echo(
            f"{dim('○')} Unmarked {bold(str(unmarked_count))} hunk(s) in {file_path_style(path)}"
        )


@cli.command()
@click.option("--base", help="Override base ref for this command")
@click.option("--edit", is_flag=True, help="Open notes in $EDITOR")
@click.option("--add", "add_text", help="Append text to notes")
def notes(base: str | None, edit: bool, add_text: str | None) -> None:
    """View or edit review notes."""
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)
    current_branch = git_current_branch(cwd=service.repo_root)
    comp = service.make_comparison(base_ref, compare_ref, current_branch)
    comparison_key = comp.key

    state = service.load(comparison_key)

    if add_text:
        service.append_notes(comparison_key, add_text)
        click.echo(f"{success('✓')} Notes updated.")
        return

    if edit:
        editor = os.environ.get("EDITOR", "vi")
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(state.notes)
            temp_path = f.name

        try:
            subprocess.run([editor, temp_path], check=True)
            new_notes = Path(temp_path).read_text()
            service.update_notes(comparison_key, new_notes)
            click.echo(f"{success('✓')} Notes saved.")
        finally:
            Path(temp_path).unlink(missing_ok=True)
        return

    # Print notes
    if state.notes:
        click.echo(state.notes)
    else:
        click.echo(dim("(no notes)"))


@cli.command()
@click.option("--base", help="Override base ref for this command")
@click.confirmation_option(prompt="Are you sure you want to clear review state?")
def clear(base: str | None) -> None:
    """Reset review state for the current comparison."""
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)
    current_branch = git_current_branch(cwd=service.repo_root)
    comp = service.make_comparison(base_ref, compare_ref, current_branch)
    comparison_key = comp.key

    service.clear(comparison_key)
    click.echo(f"{success('✓')} Cleared review state for {info(comparison_key)}")


@cli.command("export")
@click.option("--base", help="Override base ref for this command")
def export_cmd(base: str | None) -> None:
    """Export full review state as JSON."""
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)
    current_branch = git_current_branch(cwd=service.repo_root)
    comp = service.make_comparison(base_ref, compare_ref, current_branch)
    comparison_key = comp.key

    state = service.load(comparison_key)
    click.echo(json.dumps(state.model_dump(), indent=2))


@cli.command()
@click.argument("spec", required=False)
@click.option("--base", help="Override base ref for this command")
@click.option(
    "--human", "human_flag", is_flag=True, help="Mark hunk as needing human review"
)
@click.option("--undecided", is_flag=True, help="Mark hunk as undecided (AI is unsure)")
@click.option("--reason", help="Explanation for the classification")
@click.option(
    "--stdin", "from_stdin", is_flag=True, help="Read JSON classifications from stdin"
)
@click.option(
    "--status",
    "file_status",
    type=click.Choice(["renamed", "deleted", "added", "modified", "untracked"]),
    help="Classify all hunks in files with this git status",
)
@click.option("--list", "list_mode", is_flag=True, help="List current classifications")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON (with --list)")
@click.option("--clear", "clear_mode", is_flag=True, help="Clear all classifications")
@click.option(
    "--verbose",
    "-v",
    is_flag=True,
    help="Show detailed output (list affected files with --status)",
)
def classify(
    spec: str | None,
    base: str | None,
    human_flag: bool,
    undecided: bool,
    reason: str | None,
    from_stdin: bool,
    file_status: str | None,
    list_mode: bool,
    as_json: bool,
    clear_mode: bool,
    verbose: bool,
) -> None:
    """Classify hunks for review.

    SPEC can be a hunk key (path:hash) to classify a single hunk,
    or a path to filter when used with --status.

    \b
    Classification values:
      --human      Needs human review (suggested: "human")
      --undecided  AI is uncertain (suggested: "undecided")
      (default)    Agent can mark it (suggested: "agent")

    \b
    Examples:
      pullapprove-review classify src/auth.py:abc123 --human --reason "modifies auth"
      pullapprove-review classify src/utils.py:def456 --reason "whitespace only"
      pullapprove-review classify src/other.py:ghi789 --undecided --reason "complex refactor"
      echo '{"src/auth.py:abc123": {"suggested": "human", "reason": "security change"}}' | pullapprove-review classify --stdin
      pullapprove-review classify --status renamed --reason "directory rename"
      pullapprove-review classify --status renamed src/components/ --reason "component directory rename"
      pullapprove-review classify --status deleted --reason "removed old files"
      pullapprove-review classify --list
      pullapprove-review classify --list --json
      pullapprove-review classify --clear
    """
    service = get_state_service()
    base_ref, compare_ref = get_current_comparison(service, base)
    current_branch = git_current_branch(cwd=service.repo_root)
    comp = service.make_comparison(base_ref, compare_ref, current_branch)
    comparison_key = comp.key

    # Handle --clear
    if clear_mode:
        service.clear_classifications(comparison_key)
        click.echo(f"{success('✓')} Classifications cleared.")
        return

    # Handle --list
    if list_mode:
        state = service.load(comparison_key)
        # Get hunks that have been classified (suggested is not None)
        classified_hunks = {
            k: h for k, h in state.hunks.items() if h.suggested is not None
        }

        if as_json:
            output = {
                hunk_key: {"suggested": h.suggested, "reason": h.reason}
                for hunk_key, h in classified_hunks.items()
            }
            click.echo(json.dumps(output, indent=2))
            return

        if not classified_hunks:
            click.echo(dim("No classifications."))
            return

        human_count = sum(
            1 for h in classified_hunks.values() if h.suggested == "human"
        )
        agent_count = sum(
            1 for h in classified_hunks.values() if h.suggested == "agent"
        )
        undecided_count = sum(
            1 for h in classified_hunks.values() if h.suggested == "undecided"
        )

        click.echo(
            f"{bold('Classifications:')} {info(str(len(classified_hunks)))} total ({warning(f'{human_count} human')}, {success(f'{agent_count} agent')}, {info(f'{undecided_count} undecided')})"
        )
        click.echo()
        for hunk_key, h in classified_hunks.items():
            if h.suggested == "human":
                marker = warning("!")
                suggested_label = warning(h.suggested)
            elif h.suggested == "undecided":
                marker = info("?")
                suggested_label = info(h.suggested)
            else:
                marker = success("✓")
                suggested_label = success(h.suggested)
            # Split the hunk_key into path:hash
            if ":" in hunk_key:
                path_part, hash_part = hunk_key.rsplit(":", 1)
                hunk_display = (
                    f"{file_path_style(path_part)}{dim(':')}{info(hash_part)}"
                )
            else:
                hunk_display = hunk_key
            click.echo(f"  {marker} {hunk_display} [{suggested_label}]")
            click.echo(f"      {dim(h.reason)}")
        return

    # Handle --stdin (batch mode)
    if from_stdin:
        try:
            data = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            click.echo(f"{error('Error:')} invalid JSON: {e}", err=True)
            sys.exit(1)

        if not isinstance(data, dict):
            click.echo(f"{error('Error:')} expected JSON object", err=True)
            sys.exit(1)

        service.set_classifications(comparison_key, data)
        click.echo(f"{success('✓')} Classified {bold(str(len(data)))} hunk(s).")
        return

    # Handle --status (classify all hunks in files with matching status)
    if file_status:
        if reason is None:
            click.echo(
                f"{error('Error:')} --reason is required with --status", err=True
            )
            sys.exit(1)

        # Determine review value
        if human_flag and undecided:
            click.echo(
                f"{error('Error:')} --human and --undecided are mutually exclusive",
                err=True,
            )
            sys.exit(1)

        if human_flag:
            review_value = "human"
            marker = warning("!")
        elif undecided:
            review_value = "undecided"
            marker = info("?")
        else:
            review_value = "agent"
            marker = success("✓")

        files = get_changed_files(base_ref, compare_ref, service.repo_root)
        matching_files = [f for f in files if f.status == file_status]

        # If spec (path) is provided, filter to files matching that path
        path_filter = spec
        if path_filter:
            matching_files = [
                f
                for f in matching_files
                if f.path == path_filter
                or f.path.startswith(path_filter.rstrip("/") + "/")
            ]

        if not matching_files:
            if path_filter:
                click.echo(
                    dim(
                        f"No files with status '{file_status}' matching '{path_filter}'."
                    )
                )
            else:
                click.echo(dim(f"No files with status '{file_status}'."))
            return

        # Build classifications dict
        classifications = {}
        for f in matching_files:
            for hunk in f.hunks:
                hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                classifications[hunk_key] = {
                    "suggested": review_value,
                    "reason": reason,
                }

        service.set_classifications(comparison_key, classifications)
        path_suffix = f" in {info(path_filter)}" if path_filter else ""
        click.echo(
            f"{marker} Classified {bold(str(len(classifications)))} hunk(s) in {bold(str(len(matching_files)))} {file_status} file(s){path_suffix}."
        )
        if verbose:
            for f in matching_files:
                hunk_count = len(f.hunks)
                hunk_word = "hunk" if hunk_count == 1 else "hunks"
                click.echo(
                    f"  {dim('·')} {file_path_style(f.path)} {dim(f'({hunk_count} {hunk_word})')}"
                )
        return

    # Handle single hunk classification
    if not spec:
        click.echo(
            f"{error('Error:')} SPEC required (or use --stdin, --status, --list, --clear)",
            err=True,
        )
        sys.exit(1)

    if reason is None:
        click.echo(f"{error('Error:')} --reason is required", err=True)
        sys.exit(1)

    # Determine review value based on flags
    if human_flag and undecided:
        click.echo(
            f"{error('Error:')} --human and --undecided are mutually exclusive",
            err=True,
        )
        sys.exit(1)

    if human_flag:
        review_value = "human"
        review_styled = warning(review_value)
        marker = warning("!")
    elif undecided:
        review_value = "undecided"
        review_styled = info(review_value)
        marker = info("?")
    else:
        review_value = "agent"
        review_styled = success(review_value)
        marker = success("✓")

    service.set_classification(comparison_key, spec, review_value, reason)
    click.echo(f"{marker} Classified as {review_styled}")


@cli.group()
def agent() -> None:
    """Agent-related commands."""
    pass


@agent.command("install")
def agent_install() -> None:
    """Install the Claude skill for assisted code review.

    Creates ~/.claude/skills/pullapprove-review.md for global availability.
    """
    skill_path = install_skill()
    click.echo(f"{success('✓')} Skill installed: {file_path_style(str(skill_path))}")
    click.echo()
    click.echo(
        f"You can now use {info('/pullapprove-review')} in Claude Code to start an assisted review."
    )


if __name__ == "__main__":
    cli()
