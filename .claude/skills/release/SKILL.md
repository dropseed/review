---
description: Run the full release process — build, tag, push, and create a draft GitHub release with release notes
user_invocable: true
---

# /release

Orchestrate a full release of the Review desktop app.

## Steps

1. **Ask the user**: Should this be a `patch` or `minor` release?

2. **Run the release script**:
   ```bash
   scripts/release <patch|minor>
   ```
   This bumps versions, builds both architectures, signs artifacts, commits, tags, and pushes.

3. **Read the new version** from `package.json` (the `"version"` field).

4. **Get the commit log** between the previous tag and the new tag:
   ```bash
   git log --oneline <previous-tag>..v<version>
   ```
   Exclude the version bump commit itself from the notes.

5. **Generate release notes**: Write concise, user-facing release notes based on the commit log. Focus on what changed from the user's perspective — new features, fixes, improvements. Skip internal/build changes. Write the notes to a temp file.

6. **Create the GitHub release**:
   ```bash
   scripts/gh-release <version> <notes-file>
   ```

7. **Print the release URL** so the user can review and publish the draft.
