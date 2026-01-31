# git-review

Open the Review desktop app to review diffs for the current repository and branch.

## Usage

Run this command to open the Review app:

```bash
review open
```

This auto-detects the comparison as `<default_branch>..<current_branch>+working-tree` and opens the desktop GUI for interactive diff review.

To check review progress from the terminal:

```bash
review status
```

This shows the current comparison, hunk counts (approved, trusted, pending, rejected), and trust list.
