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

## Steps

1. **Ask the user**: Should this be a `patch` or `minor` release?

2. **Draft release notes** from the commits since the last release:

   ```bash
   git log --oneline $(git describe --tags --abbrev=0)..HEAD
   ```

   Write concise, user-facing notes — new features, fixes, improvements from
   the user's perspective. Skip internal/build changes. Save to a temp file.

3. **Show the notes to the user for approval** (this is the one human
   decision — everything after is automated). Edit until approved.

4. **Run the release script**:

   ```bash
   scripts/release <patch|minor> <notes-file>
   ```

   This preflights (default branch, clean tree, synced, tag free), bumps
   versions, commits `Release vX.Y.Z` with the notes as the body, pushes, and
   dispatches `.github/workflows/release.yml`.

5. **Watch the run** (takes ~30–60 minutes; builds, signs, notarizes, then
   publishes):

   ```bash
   gh run watch --exit-status
   ```

   The user doesn't need to stay for this — the workflow needs nothing further.

6. **On success, print the release URL**:
   `https://github.com/dropseed/review/releases/tag/v<version>`

   On failure: nothing was tagged or published. Diagnose the run
   (`gh run view --log-failed`), fix, and re-dispatch — if the fix needs no
   new commit, `gh workflow run release.yml -f tag=v<version> -f sha=<bump-sha>`
   reuses the existing bump commit (the workflow checks out that exact SHA,
   so this works even after master has moved past it); if the fix needs a
   commit, that commit isn't in the bump, so cut a fresh release.
