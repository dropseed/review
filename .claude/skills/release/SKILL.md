---
description: Cut a release — draft notes, bump + push, then GitHub Actions builds, signs, and publishes
user_invocable: true
---

# /release

Cut a release of the Review desktop app. The build no longer happens locally:
`scripts/release` pushes a version-bump commit and dispatches the Release
workflow, which builds/signs/notarizes both architectures and creates the tag
and GitHub release only after everything succeeds (`gh release create
--target` — a failed run leaves no tag behind).

Release notes are written **first**: they ride in the release commit's body,
and the workflow publishes that body verbatim as the release notes.

**Run the whole thing without stopping.** Asking to release *is* the approval —
for the bump size, for the notes, and for publishing. Don't ask which bump, and
don't present the notes for sign-off; write them as well as you can and ship.
Say what you released and what the notes said afterward, not before.

## Steps

1. **Pick the bump.** `patch` unless the invocation said `minor`.

2. **Draft release notes** from the commits since the last release:

   ```bash
   git fetch --tags --quiet
   git log --oneline $(git describe --tags --abbrev=0)..HEAD
   ```

   Fetch first: a local tag list can lag behind what is actually published, and
   a stale one silently widens the range into changes that already shipped.
   Cross-check against `gh release list --limit 5` when the newest tag and the
   newest `Release vX.Y.Z` commit disagree.

   Write concise, user-facing notes — new features, fixes, improvements from
   the user's perspective. Skip internal/build changes. Save to a temp file.

3. **Run the release script**:

   ```bash
   scripts/release <patch|minor> <notes-file>
   ```

   This preflights (default branch, clean tree, synced, tag free), bumps
   versions, commits `Release vX.Y.Z` with the notes as the body, pushes, and
   dispatches `.github/workflows/release.yml`.

4. **Watch the run** (takes ~30–60 minutes; builds, signs, notarizes, then
   publishes):

   ```bash
   gh run watch --exit-status
   ```

   Run this in the background — it outlives the turn, and the user doesn't need
   to stay for it either; the workflow needs nothing further.

5. **On success, print the release URL**:
   `https://github.com/dropseed/spur/releases/tag/v<version>`

   On failure: nothing was tagged or published. Diagnose the run
   (`gh run view --log-failed`), fix, and re-dispatch — if the fix needs no
   new commit, `gh workflow run release.yml -f tag=v<version> -f sha=<bump-sha>`
   reuses the existing bump commit (the workflow checks out that exact SHA,
   so this works even after master has moved past it); if the fix needs a
   commit, that commit isn't in the bump, so cut a fresh release.
