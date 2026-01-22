# human-review

A Claude Code skill that helps humans review diffs more efficiently. It classifies hunks, lets you trust categories of changes, and focuses your attention on what actually needs careful human review.

This is **not** an AI code review tool that replaces human judgment—it separates the signal from the noise so you can spend your review time on the hunks that actually need your brain.

## Install

```bash
curl -fsSL https://www.pullapprove.com/human-review/install.sh | bash
```

Or install directly with uv:

```bash
uv tool install human-review
human-review install-skill
```

Then use `/human-review` in Claude Code to start an assisted review.

## What it does

- **Classifies hunks** with reasons explaining what each change is
- **Trusts reasons** to bulk-approve categories of changes
- **Narrows focus** to the hunks that actually need careful human consideration

The goal: help humans spend their review time where it counts.

## Optional: Auto-approve CLI commands

For the best experience, add this to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(human-review:*)"]
  }
}
```

This allows the skill to run `human-review` commands without requiring approval for each one.

## How it works

The workflow has two distinct steps:

1. **Classify** — AI examines each hunk and assigns a reason explaining what the change is. Hunks with the same reason are grouped together.

2. **Trust/Approve** — You approve hunks by trusting entire reasons (bulk approval) or approving individually. This is the actual review moment.

Classification is a _proposal_. Trust/approval is _your decision_. The AI doesn't review your code—it helps you decide where to spend your attention.

Review state is stored in `.git/human-review/reviews/` in the git common directory (shared across worktrees). The skill uses a CLI under the hood—run `human-review --help` for all commands.
