# Reviewing Someone Else's Work

This workflow is for reviewing code written by someone else—GitHub PR reviews, team branches, or code you're being asked to evaluate. Your notes become feedback for the author.

**Common scenarios:**

- Reviewing a GitHub pull request before approving/merging
- Reviewing a teammate's branch before they open a PR
- Evaluating code from an external contributor

## Phase 1: Label

Start by labeling hunks to understand what the author changed. Run `git review status` to see the scope.

**For labeling strategy and guidelines, see the Labeling Guidelines section in SKILL.md.**

Label by status and path:

```bash
git review label --status renamed src/old/ --as "Rename src/old to src/new"
git review label --status deleted deprecated/ --as "Delete deprecated code"
git review label path/to/file.py --as "Add error handling to save()"
```

Once all hunks are labeled, move to Phase 2.

## Phase 2: Trust

**Trust is for patterned changes.** The question is: "If I see one example, do I know all the others are fine?" If yes, it's a pattern—trust it. If no, it needs reasoning—walkthrough.

**Patterned (trust):** Identical hunks across files (same import in 12 files), file deletions/renames. Test: are the hunks interchangeable?

**Mechanical (trust):** Lock files, version bumps, generated code. No judgment needed, even if just 1 hunk.

**Reasoned (walkthrough):** New implementations, behavior changes, small-hunk-count labels (1-2 hunks), moved code, different hunks labeled together.

### Presenting Trust Options

Show the top 3-4 most trustable labels with sample diffs, then use AskUserQuestion with `multiSelect: true`:

**Review Progress:** 0% (0/35 hunks) · 6 labels

**"Update package-lock.json"** (1 hunk)

```diff
  "version": "2.0.0",
+ "resolved": "https://registry.npmjs.org/..."
```

**"Remove old decorator-based rate limiting"** (8 hunks)

```diff
-@rate_limit(100, 60)
 def get_data():
```

```
Question: "Which labels do you want to trust?"
multiSelect: true
Options:
- "Lockfile (1)" (description: "Update package-lock.json")
- "Remove decorators (8)" (description: "Remove old rate limiting decorators")
- "Show all labels" (description: "See full list of all 6 labels")
- "Start walkthrough" (description: "Skip trusting, review changes individually")
```

After trusting, show updated progress and present the next batch of 3-4 labels. Continue until all labels have been presented or the user starts the walkthrough.

### When Labels Are Skipped

Labels not selected in a batch remain available in subsequent batches. Once all batches have been shown, any unselected labels go to individual review in Phase 3.

### Transitioning to Phase 3

Move to the walkthrough when all labels have been trusted/skipped or the user chooses to start the walkthrough.

## Phase 3: Walkthrough

The remaining hunks are **reasoned changes**—they need your careful attention. Walk through them in story order.

**Your role: Narrator, not reviewer.** Explain what the author's code does without passing judgment. You decide if it's correct—the AI helps you understand it.

### Ordering the Walkthrough

Present changes in an order that builds understanding:

1. **Foundations first** — New types, interfaces, base classes
2. **Then the usage** — Code that uses those foundations
3. **Ripple effects** — Call sites, imports, signatures that changed

**Group related hunks into logical changes.** A "change" may span multiple hunks:

- **Moved code** — Deletion + addition elsewhere = show together
- **New abstraction + usage** — New class + where it's used
- **Interface change + call sites** — Changed signature + updated callers

4. **Finishing touches** — Tests, documentation

### Presenting Each Change

```bash
git review diff --unreviewed
```

**[1/5] The Core Change**

The author added a new `RateLimiter` class:

```diff
+ class RateLimiter:
+     def __init__(self, max_requests: int, window_seconds: int):
+         self.max_requests = max_requests
+         self.window = window_seconds
+         self._requests = []
```

This introduces rate limiting at the class level rather than the decorator they had before.

**Use AskUserQuestion:**

```
Question: "[1/5] RateLimiter class"
Options:
- "Approve and continue" (description: "Looks good, move on")
- "I have feedback" (description: "Capture a note for the author")
- "Show more context" (description: "See surrounding code")
- "Skip for now" (description: "Don't approve yet, continue")
```

## Capturing Notes (Feedback)

Notes in this context are **feedback for the author**. When you have a question, suggestion, or concern, capture it and continue.

**When you say "I have feedback":**

Agent: "What would you like to tell the author?"
You: "Should this use a constant for the default timeout?"
Agent: "Got it—I'll capture that."

```bash
git review notes --add "rate_limiter.py:12 - Consider extracting the timeout (30) to a named constant"
```

**After capturing a note, the hunk is SKIPPED.** Feedback indicates something needs the author's attention.

The walkthrough continues. Notes are compiled at the end.

## Finishing the Review

The walkthrough ends when all hunks have been seen. Now compile your feedback.

### If No Notes (LGTM)

> Review complete. All hunks look good—this is an LGTM.

```
Question: "Ready to approve?"
Options:
- "LGTM" (description: "Approve the PR")
- "Let me add a comment" (description: "I want to leave a note anyway")
```

**If this is a GitHub PR**, offer to submit the approval:

```bash
gh pr review --approve --body "LGTM! 🚀"
```

### If Notes Exist

> Review complete. You captured 4 notes:
>
> 1. `rate_limiter.py:12` - Consider extracting timeout to a constant
> 2. `rate_limiter.py:45` - What happens if the request list is empty?
> 3. `utils.py:23` - Typo: "recieve" → "receive"
> 4. `tests/test_rate.py:50` - Missing test for edge case

```
Question: "How would you like to share this feedback?"
Options:
- "Draft PR comment" (description: "Help me write a cohesive review")
- "Just show notes" (description: "I'll copy them manually")
- "Add more notes" (description: "Go back to review more hunks")
```

### Drafting the PR Comment

If they choose "Draft PR comment", help turn raw notes into polished feedback:

> Here's a draft PR comment:
>
> ---
>
> Thanks for this! The rate limiter refactor looks solid. A few things I noticed:
>
> **Questions:**
>
> - `rate_limiter.py:45` - What's the expected behavior if the request list is empty?
>
> **Suggestions:**
>
> - `rate_limiter.py:12` - Consider extracting the timeout value (30) to a named constant
> - `utils.py:23` - Small typo: "recieve" → "receive"
>
> **Testing:**
>
> - Would be great to add a test for the empty list edge case
>
> ---
>
> Want me to adjust anything?

**Use AskUserQuestion:**

```
Question: "How does this draft look?"
Options:
- "Looks good, copy it" (description: "I'll paste this into the PR")
- "Soften the tone" (description: "Make suggestions less direct")
- "Make it more direct" (description: "Be clearer about what needs to change")
- "Edit specific parts" (description: "I'll tell you what to change")
```

### Categorizing Feedback

When drafting, group notes into useful categories:

- **Blockers** — Must fix before merge
- **Questions** — Need clarification from author
- **Suggestions** — Nice-to-haves, take it or leave it
- **Nits** — Minor issues (typos, formatting)
- **Testing** — Coverage gaps

### Submitting the Review (GitHub PRs)

After finalizing the draft, ask how they want to submit:

```
Question: "How should this review be submitted?"
Options:
- "Comment only" (description: "Leave feedback without approval status")
- "Request changes" (description: "Block merge until issues are addressed")
- "Approve with comments" (description: "Approve but include the feedback")
- "Copy to clipboard" (description: "I'll paste it manually")
```

**If they choose a GitHub action**, use the `gh` CLI:

```bash
# Comment only
gh pr review --comment --body "$(cat <<'EOF'
[draft content here]
EOF
)"

# Request changes
gh pr review --request-changes --body "$(cat <<'EOF'
[draft content here]
EOF
)"

# Approve with comments
gh pr review --approve --body "$(cat <<'EOF'
[draft content here]
EOF
)"
```

## Example Session

````
AGENT: Let me check where we are.

$ git review status --short
No review in progress

AGENT: I'll start a review of this branch.

$ git review start main..feature-auth
Started review: main..feature-auth
35 hunks across 8 files

[AGENT examines and labels hunks...]

$ git review status
Unreviewed (35 hunks)
  · Add RateLimiter class                                        3 hunks
  · Update API endpoints to use RateLimiter                     12 hunks
  · Remove old decorator-based rate limiting                     8 hunks
  · Add rate limiting tests                                      5 hunks
  · Update package-lock.json                                     1 hunk
  [... more labels ...]

AGENT: **Review Progress:** 0% (0/35 hunks) · 6 labels

**"Update package-lock.json"** (1 hunk)

```diff
+ "resolved": "https://registry.npmjs.org/..."
```

**"Remove old decorator-based rate limiting"** (8 hunks)

```diff
-@rate_limit(100, 60)
 def get_data():
```

**"Add rate limiting tests"** (5 hunks)

```diff
+class RateLimiterTests(TestCase):
```

[AskUserQuestion: Which labels do you want to trust? (multiSelect)]

USER: [selects "Lockfile (1)", "Remove decorators (8)", "Tests (5)"]

$ git review trust "Update package-lock.json"
$ git review trust "Remove old decorator-based rate limiting"
$ git review trust "Add rate limiting tests"
✓ Trusted 3 labels — approved 14 hunk(s).

AGENT: **Review Progress:** 40% (14/35 hunks) · 3 labels remaining

[... trust phase continues ...]

AGENT: 15 hunks remain—these are reasoned changes that need your attention.

[AskUserQuestion: Ready to walk through remaining hunks?]

USER: [selects "Start walkthrough"]

AGENT: ---

**[1/3] The Core Change**

The author added a new `RateLimiter` class in `rate_limiter.py`:

```diff
+ class RateLimiter:
+     def __init__(self, max_requests=100, window_seconds=60):
+         self.max_requests = max_requests
+         self.window = window_seconds
+         self._requests = []
+
+     def is_allowed(self, identifier: str) -> bool:
+         now = time.time()
+         self._cleanup(now)
+         if len(self._requests) >= self.max_requests:
+             return False
+         self._requests.append(now)
+         return True
````

This is a class-based rate limiter replacing the decorator pattern.

[AskUserQuestion: Approve?]

USER: [selects "I have feedback"]

AGENT: What feedback do you have for the author?

USER: The magic numbers 100 and 60 should probably be constants

AGENT: Good point—I'll capture that.

$ git review notes --add "rate_limiter.py:12 - Consider extracting default values (100, 60) to named constants"
✓ Note added

Moving on without approving.

---

**[2/3] API Integration**

Here's how the endpoints use the new limiter:

```diff
+ limiter = RateLimiter()
+
  @app.route('/api/data')
  def get_data():
+     if not limiter.is_allowed(request.remote_addr):
+         return jsonify(error="Rate limited"), 429
      return jsonify(data=fetch_data())
```

The same pattern appears in 12 endpoints.

[AskUserQuestion: Trust this pattern?]

USER: [selects "I have feedback"]

AGENT: What's your feedback?

USER: What if request.remote_addr is None behind a proxy?

AGENT: Capturing that.

$ git review notes --add "api.py:45 - What if request.remote_addr is None behind a proxy?"
✓ Note added

---

**[3/3] Tests**

```diff
+ class RateLimiterTests(TestCase):
+     def test_allows_under_limit(self):
+         limiter = RateLimiter(max_requests=5)
+         for _ in range(5):
+             self.assertTrue(limiter.is_allowed("test"))
```

[AskUserQuestion: Approve tests?]

USER: [selects "Approve and continue"]

$ git review approve tests/test_rate.py:def456
✓ Approved 5 hunk(s)

---

**Walkthrough Complete**

$ git review notes
2 notes:

1. rate_limiter.py:12 - Consider extracting default values (100, 60) to named constants
2. api.py:45 - What if request.remote_addr is None behind a proxy?

AGENT: Review complete. You have **2 notes** for the author:

1. `rate_limiter.py:12` - Consider extracting default values to constants
2. `api.py:45` - What if request.remote_addr is None behind a proxy?

[AskUserQuestion: How to share feedback?]

USER: [selects "Draft PR comment"]

AGENT: Here's a draft:

---

Nice work on the rate limiter refactor! A couple of things:

**Questions:**

- `api.py:45` - What happens if `request.remote_addr` is None (e.g., behind a proxy)? Might need to check `X-Forwarded-For` header.

**Suggestions:**

- `rate_limiter.py:12` - Consider extracting the default values (100, 60) to named constants like `DEFAULT_MAX_REQUESTS` and `DEFAULT_WINDOW_SECONDS`

---

[AskUserQuestion: How does this look?]

USER: [selects "Looks good"]

[AskUserQuestion: How should this review be submitted?]

USER: [selects "Comment only"]

$ gh pr review --comment --body "Nice work on the rate limiter refactor! ..."
✓ Submitted review comment on PR #42

AGENT: Done! Your review has been posted to the PR.

```

```
