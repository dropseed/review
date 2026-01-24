"""Click CLI entry point."""

import difflib
import fnmatch
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import click

from .git import (
    GitError,
    git_common_dir,
    git_current_branch,
    git_ref_exists,
    git_root,
)
from .hunks import (
    ChangedFile,
    get_hunk_key,
    parse_hunk_key,
)
from .review import (
    DiffFilters,
    build_patch_for_approved_hunks,
    compute_review_status,
    count_hunks_by_key,
    get_changed_files,
    get_valid_hunk_keys,
    hunk_passes_filter,
    is_bare_hash,
    is_hunk_approved,
    is_hunk_trusted,
    parse_hunk_spec,
    resolve_bare_hash,
)
from .output import (
    bold,
    dim,
    error,
    file_path_style,
    info,
    progress_bar,
    success,
    warning,
)
from .state import Comparison, ReviewState, ReviewStateService

# Exit codes following common conventions:
# 0 = success
# 1 = user input error (bad args, invalid ref, file not found)
# 2 = operational error (nothing to do, wrong context)
EXIT_SUCCESS = 0
EXIT_USER_ERROR = 1
EXIT_OPERATIONAL_ERROR = 2


def get_repo_root() -> Path:
    """Get the git repository root, exiting on error."""
    try:
        return git_root()
    except GitError as e:
        click.echo(f"{error('Error:')} {e}", err=True)
        sys.exit(EXIT_USER_ERROR)


def get_state_service() -> ReviewStateService:
    """Get the state service for the current repo."""
    repo_root = get_repo_root()
    common_dir = git_common_dir(cwd=repo_root)
    return ReviewStateService(repo_root, git_common_dir=common_dir)


def get_current_comparison(
    service: ReviewStateService, base_override: str | None = None
) -> "Comparison":
    """Get the current comparison.

    If base_override is provided, creates an ad-hoc working tree comparison.
    Otherwise loads from the current review's state file.

    Exits with error if no review is in progress.
    """
    repo_root = service.repo_root

    if base_override:
        # Ad-hoc working tree diff (not saved state)
        if not git_ref_exists(base_override, cwd=repo_root):
            click.echo(f"{error('Error:')} ref '{base_override}' not found", err=True)
            sys.exit(EXIT_USER_ERROR)
        current_branch = git_current_branch(cwd=repo_root) or "HEAD"
        return service.make_comparison(base_override, current_branch, working_tree=True)

    # Load from saved current comparison
    current_key = service.get_current_comparison()
    if current_key:
        state = service.load(current_key)
        return state.comparison

    # No review in progress
    click.echo(f"{error('Error:')} no review in progress", err=True)
    click.echo(dim("→ Run 'human-review start <base>' to begin a review"), err=True)
    click.echo(dim("→ Run 'human-review list' to see stored reviews"), err=True)
    sys.exit(EXIT_USER_ERROR)


@dataclass
class ReviewContext:
    """Context for review commands with lazy-loaded data."""

    service: ReviewStateService
    base_ref: str
    compare_ref: str | None
    comparison: Comparison

    _files: list[ChangedFile] | None = field(default=None, repr=False)
    _state: ReviewState | None = field(default=None, repr=False)

    @property
    def comparison_key(self) -> str:
        return self.comparison.key

    @property
    def is_working_tree(self) -> bool:
        return self.comparison.working_tree

    @property
    def files(self) -> list[ChangedFile]:
        if self._files is None:
            # If working_tree, diff base vs working tree (compare=None)
            # Otherwise, diff base vs compare ref
            compare = None if self.comparison.working_tree else self.compare_ref
            self._files = get_changed_files(
                self.base_ref, compare, self.service.repo_root
            )
        return self._files

    @property
    def state(self) -> ReviewState:
        if self._state is None:
            self._state = self.service.load(self.comparison_key)
        return self._state


def get_review_context(base_override: str | None = None) -> ReviewContext:
    """Get review context for commands.

    This encapsulates the common setup pattern used by most commands:
    - Get the state service
    - Load the current comparison

    Files and state are lazy-loaded when accessed.
    """
    service = get_state_service()
    comp = get_current_comparison(service, base_override)
    return ReviewContext(
        service=service,
        base_ref=comp.old,
        compare_ref=comp.new,
        comparison=comp,
    )


# Command groupings for help display
COMMAND_GROUPS: list[tuple[str, list[str]]] = [
    ("Review Session", ["start", "switch", "status", "diff", "classify"]),
    ("Trust", ["label", "trust", "untrust"]),
    ("Approval", ["approve", "unapprove"]),
    ("Utilities", ["info", "list", "notes", "delete", "stage"]),
]


class GroupedCommands(click.Group):
    """Custom Group that displays commands in organized sections and suggests typo fixes."""

    def resolve_command(
        self, ctx: click.Context, args: list[str]
    ) -> tuple[str | None, click.Command | None, list[str]]:
        """Resolve command with typo suggestions for unknown commands."""
        try:
            return super().resolve_command(ctx, args)
        except click.UsageError as e:
            # Check if this is an unknown command error
            if args and "No such command" in str(e):
                cmd_name = args[0]
                available = self.list_commands(ctx)
                # Use difflib to find close matches
                suggestions = difflib.get_close_matches(
                    cmd_name, available, n=2, cutoff=0.6
                )
                if suggestions:
                    suggestion_str = " or ".join(f"'{s}'" for s in suggestions)
                    raise click.UsageError(
                        f"No such command '{cmd_name}'. Did you mean {suggestion_str}?"
                    ) from None
            raise

    def format_commands(
        self, ctx: click.Context, formatter: click.HelpFormatter
    ) -> None:
        # Build a set of all grouped commands
        grouped_cmds = {cmd for _, cmds in COMMAND_GROUPS for cmd in cmds}
        commands = {
            name: self.get_command(ctx, name) for name in self.list_commands(ctx)
        }

        for group_name, cmd_names in COMMAND_GROUPS:
            rows = []
            for name in cmd_names:
                cmd = commands.get(name)
                if cmd is None:
                    continue
                help_text = cmd.get_short_help_str(limit=formatter.width)
                # Style command name in cyan
                styled_name = click.style(name, fg="cyan")
                rows.append((styled_name, help_text))

            if rows:
                # Write styled section header
                formatter.write_paragraph()
                header = click.style(f"{group_name}:", fg="yellow", bold=True)
                formatter.write_text(header)
                formatter.indent()
                formatter.write_dl(rows)
                formatter.dedent()

        # Any commands not in groups (shouldn't happen, but safety net)
        other_rows = []
        for name, cmd in sorted(commands.items()):
            if name not in grouped_cmds and cmd is not None:
                help_text = cmd.get_short_help_str(limit=formatter.width)
                styled_name = click.style(name, fg="cyan")
                other_rows.append((styled_name, help_text))

        if other_rows:
            formatter.write_paragraph()
            header = click.style("Other:", fg="yellow", bold=True)
            formatter.write_text(header)
            formatter.indent()
            formatter.write_dl(other_rows)
            formatter.dedent()


def _get_version() -> str:
    """Get version from package metadata."""
    from importlib.metadata import version

    return version("human-review")


def _should_disable_color() -> bool:
    """Check if color should be disabled per NO_COLOR spec."""
    # https://no-color.org/ - disable if NO_COLOR is set (any non-empty value)
    return bool(os.environ.get("NO_COLOR"))


@click.group(
    cls=GroupedCommands,
    context_settings={"help_option_names": ["-h", "--help"]},
)
@click.version_option(version=_get_version(), prog_name="human-review")
@click.pass_context
def cli(ctx: click.Context) -> None:
    """Code review CLI - track hunk-level review progress.

    Run 'human-review start <base>' to start a review, then use
    'human-review status' and 'human-review diff' to see progress.

    Documentation: https://www.pullapprove.com/human-review/
    """
    # Respect NO_COLOR environment variable
    if _should_disable_color():
        ctx.color = False


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


@cli.command("info")
def info_cmd() -> None:
    """Show human-review configuration and paths."""
    service = get_state_service()

    # Resolve paths to absolute for clarity
    data_dir = service.state_dir.resolve()
    repo_root = service.repo_root.resolve()
    common_dir = service.git_common_dir.resolve()

    click.echo()
    click.echo(f"{bold('Data directory:')}  {data_dir}")
    click.echo(f"{bold('Repo root:')}       {repo_root}")

    # Show git common dir only for worktrees (when it's not this repo's .git)
    expected_git_dir = repo_root / ".git"
    if common_dir != expected_git_dir:
        click.echo(f"{bold('Git common dir:')} {common_dir}")

    current = service.get_current_comparison()
    if current:
        click.echo(f"{bold('Current review:')}  {info(current)}")
    else:
        click.echo(f"{bold('Current review:')}  {dim('(none)')}")
    click.echo()


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
                1 for h in state.hunks.values() if h.approved_via is not None
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
@click.option(
    "--old",
    required=True,
    help="Base ref to compare against (e.g., main, origin/main)",
)
@click.option(
    "--new",
    "new_ref",
    default=None,
    help="Target ref to compare (default: current branch)",
)
@click.option(
    "--working-tree",
    "working_tree",
    is_flag=True,
    help="Include uncommitted changes (diff against working tree instead of --new)",
)
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
def start(old: str, new_ref: str | None, working_tree: bool, quiet: bool) -> None:
    """Start a new review session.

    \b
    Examples:
      human-review start --old main --working-tree       # uncommitted changes vs main
      human-review start --old main                      # current branch vs main
      human-review start --old main --new feature        # feature branch vs main
      human-review start --old main --new feature --working-tree  # feature + uncommitted

    Use 'switch' to resume an existing review.
    """
    service = get_state_service()
    repo_root = service.repo_root
    current_branch = git_current_branch(cwd=repo_root) or "HEAD"

    # Resolve HEAD to current branch for readability
    if old.upper() == "HEAD":
        old = current_branch
    if new_ref is None or new_ref.upper() == "HEAD":
        new_ref = current_branch

    # Validate --old ref exists
    if not git_ref_exists(old, cwd=repo_root):
        click.echo(f"{error('Error:')} ref '{old}' not found", err=True)
        sys.exit(EXIT_USER_ERROR)

    # Validate --new ref exists
    if not git_ref_exists(new_ref, cwd=repo_root):
        click.echo(f"{error('Error:')} ref '{new_ref}' not found", err=True)
        sys.exit(EXIT_USER_ERROR)

    # Build comparison
    comp = service.make_comparison(old, new_ref, working_tree=working_tree)

    # Build description
    if working_tree:
        review_desc = (
            f"working tree vs {old}"
            if new_ref == current_branch
            else f"{new_ref} + uncommitted vs {old}"
        )
    else:
        review_desc = f"commits on {new_ref} vs {old}"

    # Check if review already exists
    if service.get_file_path(comp.key).exists():
        click.echo(
            f"{error('Error:')} review already exists for {info(comp.key)}", err=True
        )
        click.echo(dim("→ Use 'human-review switch' to resume it"), err=True)
        click.echo(dim("→ Use 'human-review delete' to remove it first"), err=True)
        sys.exit(EXIT_USER_ERROR)

    # Create the review state file
    state = service.load(comp.key)
    service.save(state)

    service.set_current_comparison(comp.key)
    if not quiet:
        click.echo(f"{success('✓')} Review started: {info(comp.key)}")
        click.echo(f"  Reviewing: {review_desc}")


@cli.command()
@click.argument("comparison")
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
def switch(comparison: str, quiet: bool) -> None:
    """Switch to an existing review.

    COMPARISON is the review key (e.g., 'main..HEAD+' or 'main..feature').
    Use 'list' to see available reviews.
    """
    service = get_state_service()

    # Check if review exists
    file_path = service.get_file_path(comparison)
    if not file_path.exists():
        click.echo(
            f"{error('Error:')} no review found for {info(comparison)}", err=True
        )
        click.echo(dim("→ Use 'human-review list' to see available reviews"), err=True)
        click.echo(dim("→ Use 'human-review start' to create a new review"), err=True)
        sys.exit(EXIT_USER_ERROR)

    service.set_current_comparison(comparison)
    if not quiet:
        click.echo(f"{success('✓')} Switched to review: {info(comparison)}")


@cli.command()
@click.option("--base", help="Override base ref for this command")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.option("--files", "show_files", is_flag=True, help="Show per-file breakdown")
@click.option("--short", "short_mode", is_flag=True, help="Show condensed summary")
def status(base: str | None, as_json: bool, show_files: bool, short_mode: bool) -> None:
    """Show review status and progress.

    Shows diff scope (files by type) and review progress (hunks by label).
    """
    ctx = get_review_context(base)
    # Use only review-level trust list
    effective_trust = list(ctx.state.trust_label)
    rs = compute_review_status(
        ctx.files, ctx.state, ctx.comparison_key, effective_trust
    )

    if as_json:
        output = {
            "comparison": ctx.comparison_key,
            "total_files": rs.total_files,
            "total_hunks": rs.total_hunks,
            "approved_hunks": rs.approved_hunks,
            "progress_percent": rs.progress_percent,
            "by_file_status": rs.by_file_status,
            "unreviewed": [{"label": r, "count": c} for r, c in rs.unreviewed_by_label],
            "trusted": [{"label": r, "count": c} for r, c in rs.trusted_by_label],
            "reviewed": [{"label": r, "count": c} for r, c in rs.reviewed_by_label],
            "unlabeled": rs.unlabeled_count,
        }
        click.echo(json.dumps(output, indent=2))
        return

    # Human-readable output
    def hunk_word(n: int) -> str:
        return "hunk" if n == 1 else "hunks"

    # Short mode: condensed summary
    if short_mode:
        review_type = "working tree" if ctx.is_working_tree else "branch comparison"
        if rs.total_hunks == 0:
            click.echo(f"{info(ctx.comparison_key)} ({review_type}) — no changes")
            return
        percent_style = (
            success
            if rs.progress_percent == 100
            else (warning if rs.progress_percent >= 50 else dim)
        )
        click.echo(
            f"{info(ctx.comparison_key)} ({review_type}) — {percent_style(f'{rs.progress_percent}%')} ({rs.approved_hunks}/{rs.total_hunks} hunks)"
        )
        if rs.remaining_hunks > 0:
            click.echo(
                dim(
                    f"  {rs.unlabeled_count} unlabeled, {rs.unreviewed_total} to approve"
                )
            )
        return

    click.echo()

    # Show comparison being reviewed
    click.echo(f"{bold('Reviewing:')} {info(ctx.comparison_key)}")

    if rs.total_hunks == 0:
        click.echo()
        click.echo(dim("No changes to review."))
        return

    click.echo()

    # Scope: files by git status
    click.echo(
        f"{bold(str(rs.total_hunks))} hunks across {bold(str(rs.total_files))} files"
    )
    click.echo()
    file_status_style = {
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
    file_status_order = ["added", "modified", "deleted", "renamed", "untracked"]
    for file_status in file_status_order:
        if file_status in rs.by_file_status:
            s = rs.by_file_status[file_status]
            files_word = "file" if s["files"] == 1 else "files"
            hunks_word = "hunk" if s["hunks"] == 1 else "hunks"
            symbol, styled_status = file_status_style.get(
                file_status, ("·", file_status)
            )
            click.echo(
                f"  {symbol} {styled_status:20} {s['files']:3} {files_word}, {s['hunks']:3} {hunks_word}"
            )
    # Any other statuses not in the order
    for file_status, s in rs.by_file_status.items():
        if file_status not in file_status_order:
            files_word = "file" if s["files"] == 1 else "files"
            hunks_word = "hunk" if s["hunks"] == 1 else "hunks"
            click.echo(
                f"  · {file_status:20} {s['files']:3} {files_word}, {s['hunks']:3} {hunks_word}"
            )

    click.echo()

    # Progress bar
    overall_bar = progress_bar(rs.approved_hunks, rs.total_hunks, width=30)
    percent_style = (
        success
        if rs.progress_percent == 100
        else (warning if rs.progress_percent >= 50 else dim)
    )
    click.echo(
        f"{bold('Progress:')} {overall_bar} {percent_style(f'{rs.progress_percent}%')} {dim(f'({rs.approved_hunks}/{rs.total_hunks} hunks)')}"
    )

    # Unreviewed (classified but not approved)
    if rs.unreviewed_total > 0:
        click.echo()
        click.echo(
            f"{warning('Unreviewed')} ({rs.unreviewed_total} {hunk_word(rs.unreviewed_total)})"
        )
        for label, count in rs.unreviewed_by_label:
            display_label = label if len(label) <= 40 else label[:37] + "..."
            click.echo(f"  {dim('·')} {display_label:44} {count:3} {hunk_word(count)}")

    # Unlabeled
    if rs.unlabeled_count > 0:
        click.echo()
        click.echo(
            f"{dim('Unlabeled')} ({rs.unlabeled_count} {hunk_word(rs.unlabeled_count)})"
        )

    # Trusted (approved via trust)
    if rs.trusted_total > 0:
        click.echo()
        click.echo(
            f"{success('Trusted')} ({rs.trusted_total} {hunk_word(rs.trusted_total)})"
        )
        for label, count in rs.trusted_by_label:
            display_label = label if len(label) <= 40 else label[:37] + "..."
            click.echo(f"  {dim('·')} {display_label:44} {count:3} {hunk_word(count)}")

    # Reviewed (approved via review)
    if rs.reviewed_total > 0:
        click.echo()
        click.echo(
            f"{success('Reviewed')} ({rs.reviewed_total} {hunk_word(rs.reviewed_total)})"
        )
        for label, count in rs.reviewed_by_label:
            display_label = label if len(label) <= 40 else label[:37] + "..."
            click.echo(f"  {dim('·')} {display_label:44} {count:3} {hunk_word(count)}")

    # Optional per-file breakdown
    if show_files:
        click.echo()
        click.echo(dim("─" * 60))
        click.echo(bold("Per-file breakdown:"))
        for f in ctx.files:
            file_approved = sum(
                1
                for h in f.hunks
                if (hs := ctx.state.hunks.get(get_hunk_key(h.file_path, h.hash)))
                and hs.approved_via is not None
            )
            file_total = len(f.hunks)
            is_complete = file_approved >= file_total
            status_mark = success("✓") if is_complete else dim("○")
            path_display = dim(f.path) if is_complete else file_path_style(f.path)
            count_display = f"{file_approved}/{file_total}"
            click.echo(f"  {status_mark} {path_display:55} {count_display}")

    click.echo()


@cli.command("diff")
@click.argument("path", required=False)
@click.option("--base", help="Override base ref for this command")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON for agents")
@click.option("--unreviewed", is_flag=True, help="Only show unreviewed hunks")
@click.option("--unlabeled", is_flag=True, help="Only show unlabeled hunks")
@click.option("--label", "filter_label", help="Only show hunks with this label")
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
@click.option(
    "--name-only", "name_only", is_flag=True, help="List files only (no content)"
)
def diff_cmd(
    path: str | None,
    base: str | None,
    as_json: bool,
    unreviewed: bool,
    unlabeled: bool,
    filter_label: str | None,
    file_status: str | None,
    limit: int | None,
    offset: int,
    name_only: bool,
) -> None:
    """Show diff with hunk hashes and review markers.

    Optionally filter to a specific PATH.

    \b
    Filtering options:
      --unreviewed    Only show hunks not yet reviewed
      --unlabeled     Only show hunks not yet labeled
      --label TEXT    Only show hunks with this label
      --status TEXT   Only show files with this git status

    \b
    Output options:
      --name-only     List files only (no content)
      --limit N       Maximum number of hunks to return
      --offset N      Skip first N hunks (for pagination)
    """
    ctx = get_review_context(base)
    files = ctx.files

    # Filter by path if provided
    if path:
        files = [f for f in files if f.path == path or f.path.startswith(path + "/")]

    # Build filters
    filters = DiffFilters(
        path=path,
        file_status=file_status,
        unreviewed=unreviewed,
        unlabeled=unlabeled,
        label=filter_label,
    )

    # Filter by status if provided
    if file_status:
        files = [f for f in files if f.status == file_status]

    # --name-only mode: list files without content
    if name_only:
        file_data = []
        for f in files:
            reviewed_count = 0
            has_matching_hunk = False
            file_labels: set[str] = set()

            for hunk in f.hunks:
                hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                hunk_state = ctx.state.hunks.get(hunk_key)

                if hunk_state and hunk_state.approved_via is not None:
                    reviewed_count += 1

                if hunk_state and hunk_state.reasoning is not None:
                    file_labels.add(hunk_state.reasoning)

                if hunk_passes_filter(hunk, hunk_state, filters):
                    has_matching_hunk = True

            # Skip files with no matching hunks
            if not has_matching_hunk:
                continue

            file_data.append(
                {
                    "path": f.path,
                    "status": f.status,
                    "hunks": len(f.hunks),
                    "reviewed": reviewed_count,
                    "labels": sorted(file_labels),
                }
            )

        if as_json:
            click.echo(
                json.dumps(
                    {"comparison": ctx.comparison_key, "files": file_data}, indent=2
                )
            )
            return

        # Human-readable output
        if not file_data:
            filters = []
            if file_status:
                filters.append(f"status '{file_status}'")
            if filter_label:
                filters.append(f"label '{filter_label}'")
            if unreviewed:
                filters.append("unreviewed")
            if unlabeled:
                filters.append("unlabeled")
            if filters:
                click.echo(dim(f"No files matching: {', '.join(filters)}."))
            else:
                click.echo(dim("No changed files."))
            return

        # Build header suffix
        filter_parts = []
        if file_status:
            filter_parts.append(file_status)
        if filter_label:
            filter_parts.append(f"label: {filter_label}")
        if unreviewed:
            filter_parts.append("unreviewed")
        if unlabeled:
            filter_parts.append("unlabeled")
        filter_suffix = f" [{', '.join(filter_parts)}]" if filter_parts else ""

        click.echo(f"\n{bold('Files')}{filter_suffix} {dim(f'({ctx.comparison_key})')}")
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
            # Show labels if any
            if fd["labels"]:
                label_str = dim(f"({', '.join(fd['labels'])})")
            else:
                label_str = dim("(unlabeled)")
            click.echo(f"  {status_mark} {path_display:50} {hunks_str} {label_str}")
        click.echo()
        return

    if as_json:
        output_files: list[dict] = []

        # Track pagination
        total_matching = 0
        hunks_skipped = 0
        hunks_included = 0

        for f in files:
            file_hunks: list[dict] = []
            file_data: dict = {
                "path": f.path,
                "status": f.status,
                "hunks": file_hunks,
            }
            if f.old_path:
                file_data["old_path"] = f.old_path

            for hunk in f.hunks:
                hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                hunk_state = ctx.state.hunks.get(hunk_key)

                # Apply filters
                if not hunk_passes_filter(hunk, hunk_state, filters):
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

                # Compute trust status using review-level trust only
                effective_trust = list(ctx.state.trust_label)
                hunk_data = {
                    "hash": hunk.hash,
                    "labels": hunk_state.label if hunk_state else [],
                    "reasoning": hunk_state.reasoning if hunk_state else None,
                    "trusted": (
                        is_hunk_trusted(hunk_state, effective_trust)
                        if hunk_state
                        else False
                    ),
                    "reviewed": (
                        hunk_state.approved_via == "review" if hunk_state else False
                    ),
                    "approved": (
                        is_hunk_approved(hunk_state, effective_trust)
                        if hunk_state
                        else False
                    ),
                    "header": hunk.header,
                    "content": hunk.content,
                    "start_line": hunk.start_line,
                    "end_line": hunk.end_line,
                }
                file_hunks.append(hunk_data)

            # Only include files that have hunks after filtering
            if file_hunks:
                output_files.append(file_data)

        # Add pagination metadata and trust list
        output = {
            "comparison": ctx.comparison_key,
            "trust_list": list(ctx.state.trust_label),
            "files": output_files,
            "pagination": {
                "offset": offset,
                "limit": limit,
                "returned": hunks_included,
                "total_matching": total_matching,
                "has_more": total_matching > offset + hunks_included,
            },
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
            hunk_state = ctx.state.hunks.get(hunk_key)
            if hunk_passes_filter(hunk, hunk_state, filters):
                filtered_hunks.append((hunk, hunk_state))

        if not filtered_hunks:
            continue

        file_approved = sum(
            1
            for h in f.hunks
            if (hs := ctx.state.hunks.get(get_hunk_key(h.file_path, h.hash)))
            and hs.approved_via is not None
        )
        is_complete = file_approved >= len(f.hunks)

        # File header with visual separation
        click.echo()
        click.echo(dim("─" * 70))
        status_indicator = success("✓") if is_complete else warning("○")
        progress_text = f"{file_approved}/{len(f.hunks)}"
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

            is_approved = hunk_state.approved_via is not None if hunk_state else False
            marker = success("✓") if is_approved else dim("○")
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


def _is_glob_pattern(s: str) -> bool:
    """Check if a string contains glob pattern characters."""
    return any(c in s for c in "*?[]")


@cli.command()
@click.argument("pattern", required=True)
@click.option("--base", help="Override base ref for this command")
@click.option("--preview", is_flag=True, help="Preview hunks that would become trusted")
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
def trust(pattern: str, base: str | None, preview: bool, quiet: bool) -> None:
    """Add a pattern to the review-level trust list.

    PATTERN is a trust pattern like "imports:added" or a glob like "imports:*".
    Hunks with labels matching trusted patterns are dynamically approved.

    \b
    Examples:
      human-review trust imports:added
      human-review trust "imports:*"        # matches all import patterns
      human-review trust "formatting:*" --preview
    """
    ctx = get_review_context(base)

    # Build set of valid hunk keys and count occurrences from current diff
    hunk_key_counts = count_hunks_by_key(ctx.files)
    valid_keys = get_valid_hunk_keys(ctx.files)

    is_glob = _is_glob_pattern(pattern)

    # Build current effective trust (before adding this pattern)
    current_trust = list(ctx.state.trust_label)

    # Find hunks that would become trusted by adding this pattern
    new_trust = current_trust + [pattern]
    matching_keys = []
    matched_patterns: set[str] = set()
    for hunk_key, hunk_state in ctx.state.hunks.items():
        if not hunk_state.label or hunk_key not in valid_keys:
            continue
        if hunk_state.approved_via == "review":
            continue  # Already manually reviewed
        if is_hunk_trusted(hunk_state, current_trust):
            continue  # Already trusted

        # Check if this pattern would make the hunk trusted
        if is_hunk_trusted(hunk_state, new_trust):
            matching_keys.append(hunk_key)
            # Track which label patterns matched the new trust pattern
            for label_pattern in hunk_state.label:
                if is_glob:
                    if fnmatch.fnmatch(label_pattern, pattern):
                        matched_patterns.add(label_pattern)
                else:
                    if label_pattern == pattern:
                        matched_patterns.add(label_pattern)

    # Preview mode: show what would be trusted
    total_count = sum(hunk_key_counts.get(k, 1) for k in matching_keys)
    if preview:
        if is_glob:
            click.echo(f"{bold('Glob:')} {info(pattern)}")
            if matched_patterns:
                click.echo(f"{bold('Matched label patterns:')} {len(matched_patterns)}")
                for p in sorted(matched_patterns):
                    pattern_keys = [
                        k for k in matching_keys if p in ctx.state.hunks[k].label
                    ]
                    pattern_count = sum(hunk_key_counts.get(k, 1) for k in pattern_keys)
                    click.echo(f"  → {p} {dim(f'({pattern_count} hunks)')}")
        else:
            click.echo(f"{bold('Pattern:')} {info(pattern)}")
        click.echo(f"{bold('Hunks that would become trusted:')} {total_count}")
        click.echo()

        if matching_keys:
            # Show up to 5 sample hunks with reasoning
            sample_keys = matching_keys[:5]
            for hunk_key in sample_keys:
                path, hash_val = parse_hunk_key(hunk_key)
                hunk_state = ctx.state.hunks.get(hunk_key)
                reasoning = hunk_state.reasoning if hunk_state else ""
                click.echo(f"  · {file_path_style(path)}{dim(':')}{info(hash_val)}")
                if reasoning:
                    click.echo(f"    {dim(reasoning[:60])}")

            if len(matching_keys) > 5:
                click.echo(f"  {dim(f'... and {len(matching_keys) - 5} more')}")
            click.echo()

        click.echo(dim(f"Run without --preview to add '{pattern}' to trust list."))
        return

    # Check if pattern is already trusted
    if pattern in ctx.state.trust_label:
        click.echo(dim(f"Pattern '{pattern}' is already in the trust list."))
        return

    # Add pattern to review-level trust list
    ctx.service.add_trust_label(ctx.comparison_key, pattern)

    if not quiet:
        if total_count > 0:
            if is_glob:
                click.echo(
                    f"{success('✓')} Added '{info(pattern)}' to trust list — {bold(str(total_count))} hunk(s) now trusted."
                )
            else:
                click.echo(
                    f"{success('✓')} Added '{info(pattern)}' to trust list — {bold(str(total_count))} hunk(s) now trusted."
                )
        else:
            click.echo(
                f"{success('✓')} Added '{info(pattern)}' to trust list (no matching hunks currently)."
            )
        click.echo(dim("→ Run 'human-review status' to see progress"))


@cli.command()
@click.argument("pattern", required=True)
@click.option("--base", help="Override base ref for this command")
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
def untrust(pattern: str, base: str | None, quiet: bool) -> None:
    """Remove a pattern from the review-level trust list.

    PATTERN is a trust pattern like "imports:added" or a glob like "imports:*".
    Hunks with labels matching this pattern will no longer be automatically trusted.
    """
    ctx = get_review_context(base)

    # Build current effective trust
    valid_keys = get_valid_hunk_keys(ctx.files)
    hunk_key_counts = count_hunks_by_key(ctx.files)
    current_trust = list(ctx.state.trust_label)

    # Check if pattern is in review-level trust list
    if pattern not in ctx.state.trust_label:
        if not quiet:
            click.echo(dim(f"Pattern '{pattern}' is not in the trust list."))
        return

    # Calculate how many hunks will become untrusted
    new_trust = [p for p in current_trust if p != pattern]
    affected_count = 0
    for hunk_key, hunk_state in ctx.state.hunks.items():
        if hunk_key not in valid_keys:
            continue
        if hunk_state.approved_via == "review":
            continue  # Manually reviewed, not affected
        # Check if this hunk is currently trusted but won't be after removal
        if is_hunk_trusted(hunk_state, current_trust) and not is_hunk_trusted(
            hunk_state, new_trust
        ):
            affected_count += hunk_key_counts.get(hunk_key, 1)

    # Remove pattern from review-level trust list
    ctx.service.remove_trust_label(ctx.comparison_key, pattern)

    if not quiet:
        if affected_count > 0:
            click.echo(
                f"{success('✓')} Removed '{info(pattern)}' from trust list — {bold(str(affected_count))} hunk(s) now need review."
            )
        else:
            click.echo(f"{success('✓')} Removed '{info(pattern)}' from trust list.")


@cli.command()
@click.argument("specs", nargs=-1, required=True)
@click.option("--base", help="Override base ref for this command")
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
def approve(specs: tuple[str, ...], base: str | None, quiet: bool) -> None:
    """Approve hunks after review.

    \b
    SPEC can be:
      - A file path (approves all hunks in file)
      - path:hash (approves specific hunk)
      - path:h1,h2 (approves multiple hunks)
      - Multiple SPECs can be provided

    \b
    Examples:
      human-review approve src/auth.py
      human-review approve src/auth.py:abc123
      human-review approve abc123  # bare hash lookup
      human-review approve abc123 def456  # multiple hashes
    """
    ctx = get_review_context(base)
    hunk_key_counts = count_hunks_by_key(ctx.files)

    for spec in specs:
        # Handle bare hash (e.g., "08ce166c" or "08ce")
        if is_bare_hash(spec):
            matches, err = resolve_bare_hash(spec, ctx.files)
            if err:
                click.echo(f"{error('Error:')} {err}", err=True)
                sys.exit(EXIT_USER_ERROR)

            # Count occurrences of each (filepath, hash) pair
            match_counts = Counter(matches)

            for (filepath, full_hash), count in match_counts.items():
                hunk_key = get_hunk_key(filepath, full_hash)
                ctx.service.approve_hunk(ctx.comparison_key, hunk_key, count=count)
                if not quiet:
                    click.echo(
                        f"{success('✓')} {file_path_style(filepath)}{dim(':')}{info(full_hash)}"
                    )
                    if count > 1:
                        click.echo(dim(f"    ({count} hunks with identical content)"))
            continue

        path, hashes = parse_hunk_spec(spec)

        # Find matching file(s)
        matching_files = [
            f for f in ctx.files if f.path == path or f.path.startswith(path + "/")
        ]
        if not matching_files:
            click.echo(f"{error('Error:')} no changes found for '{path}'", err=True)
            sys.exit(EXIT_USER_ERROR)

        approved_count = 0
        for f in matching_files:
            for hunk in f.hunks:
                if hashes is None or hunk.hash in hashes:
                    hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                    ctx.service.approve_hunk(
                        ctx.comparison_key,
                        hunk_key,
                        count=hunk_key_counts[hunk_key],
                    )
                    approved_count += 1
                    if hashes and not quiet:
                        click.echo(
                            f"  {success('✓')} {file_path_style(f.path)}{dim(':')}{info(hunk.hash)}"
                        )

        if hashes:
            not_found = set(hashes) - {h.hash for f in matching_files for h in f.hunks}
            for h in not_found:
                click.echo(
                    f"{warning('Warning:')} hash '{h}' not found in {path}", err=True
                )
        elif not quiet:
            click.echo(
                f"{success('✓')} Approved {bold(str(approved_count))} hunk(s) in {file_path_style(path)}"
            )


@cli.command()
@click.argument("specs", nargs=-1, required=True)
@click.option("--base", help="Override base ref for this command")
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
def unapprove(specs: tuple[str, ...], base: str | None, quiet: bool) -> None:
    """Remove approval from hunks.

    \b
    SPEC can be:
      - A file path (unapproves all hunks in file)
      - path:hash (unapproves specific hunk)
      - path:h1,h2 (unapproves multiple hunks)
      - Multiple SPECs can be provided

    \b
    To unapprove all hunks with a specific label, use 'untrust' instead.
    """
    ctx = get_review_context(base)

    for spec in specs:
        # Handle bare hash (e.g., "08ce166c" or "08ce")
        if is_bare_hash(spec):
            matches, err = resolve_bare_hash(spec, ctx.files)
            if err:
                click.echo(f"{error('Error:')} {err}", err=True)
                sys.exit(EXIT_USER_ERROR)

            # Get unique (filepath, hash) pairs
            unique_matches = set(matches)

            for filepath, full_hash in unique_matches:
                hunk_key = get_hunk_key(filepath, full_hash)
                ctx.service.unapprove_hunk(ctx.comparison_key, hunk_key)
                if not quiet:
                    count = sum(1 for m in matches if m == (filepath, full_hash))
                    click.echo(
                        f"{dim('○')} {file_path_style(filepath)}{dim(':')}{info(full_hash)}"
                    )
                    if count > 1:
                        click.echo(dim(f"    ({count} hunks with identical content)"))
            continue

        path, hashes = parse_hunk_spec(spec)

        # Find matching file(s)
        matching_files = [
            f for f in ctx.files if f.path == path or f.path.startswith(path + "/")
        ]
        if not matching_files:
            click.echo(f"{error('Error:')} no changes found for '{path}'", err=True)
            sys.exit(EXIT_USER_ERROR)

        unapproved_count = 0
        for f in matching_files:
            for hunk in f.hunks:
                if hashes is None or hunk.hash in hashes:
                    hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                    ctx.service.unapprove_hunk(ctx.comparison_key, hunk_key)
                    unapproved_count += 1
                    if hashes and not quiet:
                        click.echo(
                            f"  {dim('○')} {file_path_style(f.path)}{dim(':')}{info(hunk.hash)}"
                        )

        if hashes:
            not_found = set(hashes) - {h.hash for f in matching_files for h in f.hunks}
            for h in not_found:
                click.echo(
                    f"{warning('Warning:')} hash '{h}' not found in {path}", err=True
                )
        elif not quiet:
            click.echo(
                f"{dim('○')} Unapproved {bold(str(unapproved_count))} hunk(s) in {file_path_style(path)}"
            )


@cli.command()
@click.option("--base", help="Override base ref for this command")
@click.option("--edit", is_flag=True, help="Open notes in $EDITOR")
@click.option("--add", "add_text", help="Append text to notes")
def notes(base: str | None, edit: bool, add_text: str | None) -> None:
    """View or edit review notes."""
    ctx = get_review_context(base)

    if add_text:
        ctx.service.append_notes(ctx.comparison_key, add_text)
        click.echo(f"{success('✓')} Notes updated.")
        return

    if edit:
        editor = os.environ.get("EDITOR", "vi")
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(ctx.state.notes)
            temp_path = f.name

        try:
            subprocess.run([editor, temp_path], check=True)
            new_notes = Path(temp_path).read_text()
            ctx.service.update_notes(ctx.comparison_key, new_notes)
            click.echo(f"{success('✓')} Notes saved.")
        finally:
            Path(temp_path).unlink(missing_ok=True)
        return

    # Print notes
    if ctx.state.notes:
        click.echo(ctx.state.notes)
    else:
        click.echo(dim("(no notes)"))


@cli.command()
@click.argument("comparison", required=False)
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
@click.option("-y", "--yes", is_flag=True, help="Skip confirmation prompt")
def delete(comparison: str | None, quiet: bool, yes: bool) -> None:
    """Delete a review.

    COMPARISON is the review key to delete. If not specified, deletes the current review.
    Use 'list' to see available reviews.
    """
    service = get_state_service()
    current = service.get_current_comparison()

    # Resolve comparison to delete
    target: str
    if comparison is not None:
        target = comparison
    elif current is not None:
        target = current
    else:
        click.echo(f"{error('Error:')} no current review to delete", err=True)
        click.echo(dim("→ Use 'human-review list' to see available reviews"), err=True)
        sys.exit(EXIT_USER_ERROR)

    # Check if review exists
    file_path = service.get_file_path(target)
    if not file_path.exists():
        click.echo(f"{error('Error:')} no review found for {info(target)}", err=True)
        click.echo(dim("→ Use 'human-review list' to see available reviews"), err=True)
        sys.exit(EXIT_USER_ERROR)

    # Confirm deletion
    if not yes:
        click.confirm(f"Delete review {info(target)}?", abort=True)

    # Delete the review
    service.clear(target)

    # Clear current pointer if we deleted the current review
    if target == current:
        service.clear_current_comparison()

    if not quiet:
        click.echo(f"{success('✓')} Deleted review: {info(target)}")


@cli.command()
@click.option("--base", help="Override base ref")
@click.option(
    "-n", "--dry-run", is_flag=True, help="Show what would be staged without staging"
)
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
def stage(base: str | None, dry_run: bool, quiet: bool) -> None:
    """Stage all approved hunks.

    Uses git apply --cached to stage only the hunks that have been
    approved (via trust or individual review).
    """
    ctx = get_review_context(base)

    # Stage only works for working tree reviews (uncommitted changes)
    if not ctx.is_working_tree:
        click.echo(
            f"{error('Error:')} stage only works for working tree reviews", err=True
        )
        click.echo(
            dim("Branch comparisons have no uncommitted changes to stage."), err=True
        )
        sys.exit(EXIT_OPERATIONAL_ERROR)

    patch, count = build_patch_for_approved_hunks(
        ctx.files, ctx.service, ctx.comparison_key
    )

    if count == 0:
        if not quiet:
            click.echo("No approved hunks to stage.")
        return

    if dry_run:
        click.echo(f"Would stage {count} hunk(s):")
        click.echo(patch)
        return

    # Write patch to temp file and apply
    with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as f:
        f.write(patch)
        patch_file = f.name

    try:
        result = subprocess.run(
            ["git", "apply", "--cached", patch_file],
            cwd=ctx.service.repo_root,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            click.echo(f"{error('Error:')} Failed to apply patch", err=True)
            click.echo(result.stderr, err=True)
            sys.exit(EXIT_USER_ERROR)

        if not quiet:
            click.echo(f"{success('✓')} Staged {count} approved hunk(s)")
    finally:
        os.unlink(patch_file)


@cli.command("label")
@click.argument("specs", nargs=-1)
@click.option("--base", help="Override base ref for this command")
@click.option("--as", "label_text", required=False, help="Label text to assign")
@click.option("--stdin", "from_stdin", is_flag=True, help="Read JSON labels from stdin")
@click.option(
    "--status",
    "file_status",
    type=click.Choice(["renamed", "deleted", "added", "modified", "untracked"]),
    help="Label all hunks in files with this git status",
)
@click.option(
    "--unlabeled",
    is_flag=True,
    help="Only label hunks that don't already have a label",
)
@click.option("--list", "list_mode", is_flag=True, help="List hunks grouped by label")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON (with --list)")
@click.option("--clear", "clear_mode", is_flag=True, help="Clear all labels")
@click.option(
    "--verbose",
    "-v",
    is_flag=True,
    help="Show detailed output (list affected files with --status)",
)
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
def label_cmd(
    specs: tuple[str, ...],
    base: str | None,
    label_text: str | None,
    from_stdin: bool,
    file_status: str | None,
    unlabeled: bool,
    list_mode: bool,
    as_json: bool,
    clear_mode: bool,
    verbose: bool,
    quiet: bool,
) -> None:
    """Label hunks for bulk trust operations.

    Assign labels to hunks, then use 'trust' to approve all hunks
    with a specific label.

    \b
    SPEC can be:
      - A bare hash (abc123) - looks up and labels matching hunks
      - path:hash - labels specific hunk
      - A file path - labels all hunks in that file/directory

    \b
    Examples:
      human-review label src/auth.py --as "new auth logic"
      human-review label src/auth.py:abc123 --as "specific hunk"
      human-review label abc123 def456 --as "same change"
      human-review label --status renamed --as "directory rename"
      human-review label --status deleted --as "removed old files"
      human-review label src/models/ --unlabeled --as "remaining model changes"
      echo '{"src/auth.py:abc123": "security change"}' | human-review label --stdin
      human-review label --list
      human-review label --clear
    """
    ctx = get_review_context(base)

    # Handle --clear
    if clear_mode:
        ctx.service.clear_labels(ctx.comparison_key)
        if not quiet:
            click.echo(f"{success('✓')} Labels cleared.")
        return

    # Handle --list
    if list_mode:
        # Get valid hunk keys and counts from current diff (excludes orphaned labels)
        hunk_key_counts = count_hunks_by_key(ctx.files)
        valid_keys = set(hunk_key_counts.keys())

        # Get hunks grouped by reasoning (only for hunks that exist in current diff)
        # Track both unique keys and total count (accounting for duplicates)
        hunks_by_reasoning: dict[str, list[str]] = {}
        counts_by_reasoning: dict[str, int] = {}
        for hunk_key, h in ctx.state.hunks.items():
            if h.reasoning and hunk_key in valid_keys:
                if h.reasoning not in hunks_by_reasoning:
                    hunks_by_reasoning[h.reasoning] = []
                    counts_by_reasoning[h.reasoning] = 0
                hunks_by_reasoning[h.reasoning].append(hunk_key)
                counts_by_reasoning[h.reasoning] += hunk_key_counts[hunk_key]

        if as_json:
            output = {
                hunk_key: {
                    "label": h.label,
                    "reasoning": h.reasoning,
                }
                for hunk_key, h in ctx.state.hunks.items()
                if h.reasoning and hunk_key in valid_keys
            }
            click.echo(json.dumps(output, indent=2))
            return

        if not hunks_by_reasoning:
            click.echo(dim("No labeled hunks."))
            return

        total_hunks = sum(counts_by_reasoning.values())
        click.echo(
            f"{bold('Labeled:')} {info(str(total_hunks))} hunks in {info(str(len(hunks_by_reasoning)))} label(s)"
        )
        click.echo()
        for reasoning_text, count in sorted(
            counts_by_reasoning.items(), key=lambda x: -x[1]
        ):
            click.echo(f"  · {info(reasoning_text)} {dim(f'({count} hunks)')}")
        return

    # Handle --stdin (batch mode)
    if from_stdin:
        try:
            data = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            click.echo(f"{error('Error:')} invalid JSON: {e}", err=True)
            sys.exit(EXIT_USER_ERROR)

        if not isinstance(data, dict):
            click.echo(f"{error('Error:')} expected JSON object", err=True)
            sys.exit(EXIT_USER_ERROR)

        # Handle both formats:
        # New: {"hunk_key": {"label": [...], "reasoning": "..."}}
        # Old: {"hunk_key": "reasoning_string"}
        classifications: dict[str, dict[str, list[str] | str]] = {}
        for hunk_key, value in data.items():
            if isinstance(value, str):
                # Simple string = just reasoning, no label patterns
                classifications[hunk_key] = {"label": [], "reasoning": value}
            elif isinstance(value, dict):
                label = value.get("label", [])
                reasoning = value.get("reasoning", value.get("reason", ""))
                classifications[hunk_key] = {
                    "label": label if isinstance(label, list) else [],
                    "reasoning": reasoning if isinstance(reasoning, str) else "",
                }
            else:
                classifications[hunk_key] = {"label": [], "reasoning": str(value)}

        ctx.service.set_hunk_classifications(ctx.comparison_key, classifications)
        if not quiet:
            click.echo(
                f"{success('✓')} Labeled {bold(str(len(classifications)))} hunk(s)."
            )
            click.echo(dim("→ Run 'human-review trust <label>' to approve"))
        return

    # Handle --status (label all hunks in files with matching status)
    if file_status:
        if label_text is None:
            click.echo(f"{error('Error:')} --as is required with --status", err=True)
            sys.exit(EXIT_USER_ERROR)

        matching_files = [f for f in ctx.files if f.status == file_status]

        # If specs (paths) provided, filter to files matching those paths
        path_filter = specs[0] if specs else None
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

        # Build labels dict and count total hunks
        labels = {}
        total_hunks = 0
        skipped_hunks = 0
        for f in matching_files:
            for hunk in f.hunks:
                hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                # Skip hunks that already have a label if --unlabeled is set
                if unlabeled:
                    existing_state = ctx.state.hunks.get(hunk_key)
                    if existing_state and existing_state.reasoning:
                        skipped_hunks += 1
                        continue
                total_hunks += 1
                labels[hunk_key] = label_text

        if total_hunks == 0:
            if skipped_hunks > 0:
                click.echo(dim(f"All {skipped_hunks} hunk(s) already have labels."))
            else:
                click.echo(dim("No hunks to label."))
            return

        ctx.service.set_labels(ctx.comparison_key, labels)
        if not quiet:
            path_suffix = f" in {info(path_filter)}" if path_filter else ""
            skipped_suffix = (
                f" (skipped {skipped_hunks} already labeled)"
                if skipped_hunks > 0
                else ""
            )
            click.echo(
                f"{success('✓')} Labeled {bold(str(total_hunks))} hunk(s) in {bold(str(len(matching_files)))} {file_status} file(s){path_suffix}.{skipped_suffix}"
            )
            if verbose:
                for f in matching_files:
                    hunk_count = len(f.hunks)
                    hunk_word = "hunk" if hunk_count == 1 else "hunks"
                    click.echo(
                        f"  {dim('·')} {file_path_style(f.path)} {dim(f'({hunk_count} {hunk_word})')}"
                    )
            click.echo(dim(f"→ Run 'human-review trust \"{label_text}\"' to approve"))
        return

    # Handle hunk labeling (one or more specs)
    if not specs:
        click.echo(
            f"{error('Error:')} SPEC required (or use --stdin, --status, --list, --clear)",
            err=True,
        )
        sys.exit(EXIT_USER_ERROR)

    if not label_text:
        click.echo(f"{error('Error:')} --as is required", err=True)
        sys.exit(EXIT_USER_ERROR)

    # Type narrowing for type checker
    assert label_text is not None

    total_labeled = 0
    total_skipped = 0
    for spec in specs:
        # Resolve spec to proper hunk_key format (filepath:hash)
        if is_bare_hash(spec):
            # Spec is just a hash - look it up in the current diff
            matches, err = resolve_bare_hash(spec, ctx.files)
            if err:
                click.echo(f"{error('Error:')} {err}", err=True)
                sys.exit(EXIT_USER_ERROR)

            # Get unique (filepath, hash) pairs and set label for each
            unique_matches = set(matches)
            for filepath, full_hash in unique_matches:
                hunk_key = get_hunk_key(filepath, full_hash)
                # Skip hunks that already have a label if --unlabeled is set
                if unlabeled:
                    existing_state = ctx.state.hunks.get(hunk_key)
                    if existing_state and existing_state.reasoning:
                        count = sum(1 for m in matches if m == (filepath, full_hash))
                        total_skipped += count
                        continue
                ctx.service.set_label(ctx.comparison_key, hunk_key, label_text)
                count = sum(1 for m in matches if m == (filepath, full_hash))
                total_labeled += count
                if not quiet:
                    click.echo(
                        f"{success('✓')} {file_path_style(filepath)}{dim(':')}{info(full_hash)}"
                    )
                    if count > 1:
                        click.echo(dim(f"    ({count} hunks with identical content)"))
        elif ":" in spec:
            # filepath:hash format - label specific hunk
            # Validate the spec exists in the current diff
            hunk_key_counts = count_hunks_by_key(ctx.files)
            if spec not in hunk_key_counts:
                # Try to resolve as a partial hash match
                path_part, hash_part = spec.rsplit(":", 1)
                matches = [
                    k
                    for k in hunk_key_counts.keys()
                    if k.startswith(path_part + ":")
                    and k.split(":")[-1].startswith(hash_part)
                ]
                if len(matches) == 1:
                    spec = matches[0]
                elif len(matches) > 1:
                    click.echo(
                        f"{error('Error:')} hash prefix '{hash_part}' is ambiguous, matches: {', '.join(m.split(':')[-1] for m in matches)}",
                        err=True,
                    )
                    sys.exit(EXIT_USER_ERROR)
                else:
                    click.echo(
                        f"{error('Error:')} hunk '{spec}' not found in current diff",
                        err=True,
                    )
                    sys.exit(EXIT_USER_ERROR)

            hunk_key = spec
            count = hunk_key_counts[hunk_key]
            # Skip hunks that already have a label if --unlabeled is set
            if unlabeled:
                existing_state = ctx.state.hunks.get(hunk_key)
                if existing_state and existing_state.reasoning:
                    total_skipped += count
                    continue
            ctx.service.set_label(ctx.comparison_key, hunk_key, label_text)
            total_labeled += count
            if not quiet:
                click.echo(f"{success('✓')} {spec}")
                if count > 1:
                    click.echo(dim(f"    ({count} hunks with identical content)"))
        else:
            # Spec is a file path - label all hunks in that file
            matching_files = [
                f
                for f in ctx.files
                if f.path == spec or f.path.startswith(spec.rstrip("/") + "/")
            ]
            if not matching_files:
                click.echo(f"{error('Error:')} no changes found for '{spec}'", err=True)
                sys.exit(EXIT_USER_ERROR)

            # Track which keys we've already labeled to avoid double-counting
            labeled_keys: set[str] = set()
            for f in matching_files:
                for hunk in f.hunks:
                    hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
                    # Skip hunks that already have a label if --unlabeled is set
                    if unlabeled:
                        existing_state = ctx.state.hunks.get(hunk_key)
                        if existing_state and existing_state.reasoning:
                            total_skipped += 1
                            continue
                    if hunk_key not in labeled_keys:
                        ctx.service.set_label(ctx.comparison_key, hunk_key, label_text)
                        labeled_keys.add(hunk_key)
                    total_labeled += 1

    if total_labeled == 0 and total_skipped > 0:
        click.echo(dim(f"All {total_skipped} hunk(s) already have labels."))
        return

    if not quiet:
        skipped_suffix = (
            f" (skipped {total_skipped} already labeled)" if total_skipped > 0 else ""
        )
        click.echo(
            f"Labeled {bold(str(total_labeled))} hunk(s) as: {info(label_text)}{skipped_suffix}"
        )
        click.echo(dim(f"→ Run 'human-review trust \"{label_text}\"' to approve"))


@cli.command("classify")
@click.option("--base", help="Override base ref for this command")
@click.option(
    "--model",
    default=None,
    help="Claude model to use (default: claude-sonnet-4-20250514)",
)
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output")
def classify(base: str | None, model: str | None, quiet: bool) -> None:
    """Classify hunks using Claude.

    Sends the diff to Claude for one-shot classification. Each hunk
    receives label patterns and reasoning explaining what changed.

    \b
    Examples:
      human-review classify
      human-review classify --model claude-sonnet-4-20250514
    """
    import shutil

    ctx = get_review_context(base)

    # Check for unlabeled hunks
    unlabeled_hunks = []
    for f in ctx.files:
        for hunk in f.hunks:
            hunk_key = get_hunk_key(hunk.file_path, hunk.hash)
            hunk_state = ctx.state.hunks.get(hunk_key)
            if not hunk_state or hunk_state.reasoning is None:
                unlabeled_hunks.append((f, hunk, hunk_key))

    if not unlabeled_hunks:
        if not quiet:
            click.echo(dim("All hunks are already classified."))
        return

    # Find claude executable
    claude_path = shutil.which("claude")
    if not claude_path:
        raise click.ClickException(
            "Claude CLI not found. Install it from https://claude.ai/code"
        )

    # Build the diff content for classification
    diff_content = []
    for f, hunk, hunk_key in unlabeled_hunks:
        diff_content.append(f"=== {hunk_key} ===")
        diff_content.append(f"File: {f.path} ({f.status})")
        diff_content.append(hunk.header)
        diff_content.append(hunk.content)
        diff_content.append("")

    # Build the prompt
    prompt = _build_classify_prompt(diff_content)

    if not quiet:
        click.echo(
            f"Classifying {bold(str(len(unlabeled_hunks)))} unlabeled hunk(s)..."
        )

    # Build command
    cmd = [claude_path, "--print", "-p", prompt]
    if model:
        cmd.extend(["--model", model])

    # Run claude and capture output
    try:
        result = subprocess.run(
            cmd,
            cwd=ctx.service.repo_root,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
        )
        if result.returncode != 0:
            click.echo(f"{error('Error:')} Claude failed", err=True)
            if result.stderr:
                click.echo(result.stderr, err=True)
            sys.exit(EXIT_USER_ERROR)

        # Parse the JSON response
        output = result.stdout.strip()

        # Extract JSON from the response (may have markdown code blocks)
        if "```json" in output:
            start = output.index("```json") + 7
            end = output.index("```", start)
            output = output[start:end].strip()
        elif "```" in output:
            start = output.index("```") + 3
            end = output.index("```", start)
            output = output[start:end].strip()

        try:
            classifications = json.loads(output)
        except json.JSONDecodeError as e:
            click.echo(
                f"{error('Error:')} Failed to parse Claude response: {e}", err=True
            )
            click.echo(dim("Response:"), err=True)
            click.echo(result.stdout[:500], err=True)
            sys.exit(EXIT_USER_ERROR)

        # Store the classifications
        if not isinstance(classifications, dict):
            click.echo(f"{error('Error:')} Expected JSON object from Claude", err=True)
            sys.exit(EXIT_USER_ERROR)

        # Convert to the expected format
        formatted_classifications: dict[str, dict[str, list[str] | str]] = {}
        for hunk_key, data in classifications.items():
            if isinstance(data, dict):
                label = data.get("label", [])
                reasoning = data.get("reasoning", "")
                formatted_classifications[hunk_key] = {
                    "label": label if isinstance(label, list) else [],
                    "reasoning": reasoning
                    if isinstance(reasoning, str)
                    else str(reasoning),
                }
            elif isinstance(data, str):
                formatted_classifications[hunk_key] = {"label": [], "reasoning": data}

        ctx.service.set_hunk_classifications(
            ctx.comparison_key, formatted_classifications
        )

        if not quiet:
            click.echo(
                f"{success('✓')} Classified {bold(str(len(formatted_classifications)))} hunk(s)"
            )
            click.echo(dim("→ Run 'human-review status' to see results"))
            click.echo(
                dim("→ Run 'human-review trust <pattern>' to approve matching hunks")
            )

    except subprocess.TimeoutExpired:
        click.echo(f"{error('Error:')} Claude timed out", err=True)
        sys.exit(EXIT_USER_ERROR)


def _build_classify_prompt(diff_content: list[str]) -> str:
    """Build the prompt for Claude classification."""
    from .patterns import TRUST_PATTERNS

    # Build pattern list
    pattern_list = "\n".join(
        f"- `{p.id}` — {p.description}" for p in TRUST_PATTERNS.values()
    )

    diff_text = "\n".join(diff_content)

    return f"""Classify each hunk in this diff. For each hunk, provide:
1. **label**: Array of trust patterns from the taxonomy (can be empty if no patterns apply)
2. **reasoning**: Brief explanation of what the change does

## Trust Patterns Taxonomy

Only use patterns from this list. Leave label empty if no patterns apply.

{pattern_list}

## Rules

- Apply patterns ONLY when they FULLY describe the change
- If a hunk has mixed changes (e.g., imports + logic), leave label empty
- Multiple patterns are allowed if the hunk combines trustable changes
- Reasoning should be specific and clear (e.g., "Added import for ChoicesFieldMixin")

## Output Format

Return a JSON object mapping hunk_key to classification:

```json
{{
  "filepath:hash": {{
    "label": ["pattern:id"],
    "reasoning": "Brief explanation"
  }}
}}
```

## Diff to Classify

{diff_text}

Return ONLY the JSON object, no other text."""


if __name__ == "__main__":
    cli()
