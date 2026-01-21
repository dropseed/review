# pullapprove-review

CLI for hunk-level code review tracking. Works with the PullApprove Review VSCode extension.

## Installation

```bash
pip install pullapprove-review
```

## Usage

```bash
# Start a review (compare working tree to main)
git review compare main

# Show review progress
git review status

# Show diff with hunk hashes and review markers
git review diff [path]

# Mark hunks as reviewed
git review mark <path>           # All hunks in file
git review mark <path>:<hash>    # Specific hunk
git review mark <path>:<h1>,<h2> # Multiple hunks

# Unmark hunks
git review unmark <path>[:<hash>]

# Manage notes
git review notes                 # Print notes
git review notes --edit          # Open in $EDITOR
git review notes --add "text"    # Append to notes

# Other commands
git review clear                 # Reset review state
git review export                # Full JSON export
```

## Data Location

Review state is stored in `.pullapprove/reviews/` which is shared with the VSCode extension.
