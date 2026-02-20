# Review

A local code review app for humans.

## Features

### Local desktop app

Review runs as a native desktop app on your machine. It reads directly from your local git repo — no browser tabs, no network latency, no uploading diffs to a third party. File watchers reload automatically when your code changes on disk.

### Trust patterns

Classify hunks into categories like `imports:added` or `formatting:whitespace`, then build a trust list to auto-approve entire classes of trivial changes. Focus your attention on the hunks that actually need human review.

### Multiple comparisons at once

Open the same repo in multiple tabs or windows, each with a different comparison (e.g. `main..feature-a` in one tab, `main..feature-b` in another). Each tab has its own independent review state. This isn't possible in most editors or web-based review tools.

### Read-only by design

Review is for reviewing, not editing. You can't modify code from inside the app — and that's the point. When most of the code is written by AI or teammates, your job shifts from writing to evaluating. Review is built for that: approve, reject, or annotate changes without the distraction of an editor.

### Symbol diffs

See which functions, classes, and methods are affected by each change, powered by tree-sitter. Navigate diffs at the symbol level instead of scrolling through raw line diffs. Supports 10+ languages.

## Privacy

Review is local-first — your code stays on your machine. No diffs are uploaded to third parties.

The desktop app includes optional crash reporting via [Sentry](https://sentry.io). It is **off by default** and requires explicit opt-in. When enabled, PII is stripped before transmission. No code or diff content is ever included in crash reports.

## Development

Requires Node.js 18+ and Rust (latest stable). See `CLAUDE.md` for full development docs.

```bash
scripts/install          # Install dependencies
scripts/dev              # Run in development mode
scripts/test             # Run tests
scripts/build            # Build production app
```
