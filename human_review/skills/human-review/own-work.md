# Reviewing Your Own Work

This workflow is for reviewing your own changes before committing, pushing, or merging. You're the author—the goal is to catch issues before they become someone else's problem.

## Phase 1: Label

Start by labeling hunks to understand what you're working with. Run `git review status` to see where you are.

**For labeling strategy and guidelines, see the Labeling Guidelines section in SKILL.md.**

Label by status and path for quick coverage:

```bash
git review label --status renamed src/old/ --as "Rename src/old to src/new"
git review label --status deleted deprecated/ --as "Delete deprecated code"
git review label path/to/file.py --as "Add error handling to save()"
```

Once all hunks are labeled, move to Phase 2.

## Phase 2: Trust

**Trust is for patterned changes.** The question is: "If I see one example, do I know all the others are fine?" If yes, it's a pattern—trust it. If no, it needs reasoning—walkthrough.

### Patterned & Mechanical vs Reasoned Changes

**Patterned changes (trust):**

- **Identical hunks across files** — Same import added to 12 files, same parameter removed from 8 constructors
- **File-level operations** — Deleted files, renamed files (where content didn't change)
- Test: can you look at one hunk and know _exactly_ what all the others look like?

**Mechanical changes (trust):**

- **Generated/automated** — Lock files, version bumps, formatting-only changes
- **Rote operations** — No human judgment needed, even if just 1 hunk

**Reasoned changes (walkthrough):**

- **New implementations** — New classes, new functions, new logic
- **Behavior changes** — Modified logic, changed conditionals, updated algorithms
- **Small-hunk-count labels** — 1-2 hunks is usually a unique change, not a pattern
- **Moved code** — Need to verify the logic moved correctly
- **Different hunks that form one logical change** — Even if labeled together, they need review as a unit

**Examples:**

| Label                                  | Hunks | Type       | Why                                       |
| -------------------------------------- | ----- | ---------- | ----------------------------------------- |
| "Add ChoicesFieldMixin import"         | 12    | Patterned  | All identical: `+from .mixins import ...` |
| "Update package-lock.json"             | 1     | Mechanical | Generated, no judgment needed             |
| "Update forms.py to check dynamically" | 2     | Reasoned   | Different hunks, logic change             |
| "Add ChoicesFieldMixin class"          | 1     | Reasoned   | New implementation, needs review          |

### Ordering Patterned Changes

Present patterned labels in this order (most obvious patterns first):

1. **File deletions** — "Delete old test fixtures" (whole files removed)
2. **Renames with no content changes** — "Rename src/old to src/new"
3. **Lock file/config updates** — "Update package-lock.json", "Bump version"
4. **Multi-hunk repetitive changes** — "Add import to 12 files" (same change repeated)
5. **Skip to walkthrough** — If remaining labels are reasoned changes, go straight to walkthrough

### Presenting Trust Options

Show the top 3-4 most trustable labels with sample diffs, then use AskUserQuestion with `multiSelect: true`:

**Review Progress:** 0% (0/50 hunks) · 19 labels

**"Remove choices parameter from field type stubs"** (20 hunks)

```diff
  def BooleanField(
-     choices: Any = None,
```

**"Add ChoicesFieldMixin to field class inheritance"** (6 hunks)

```diff
-class CharField(Field[str]):
+class CharField(ChoicesFieldMixin, Field[str]):
```

**"Remove now-unused imports"** (4 hunks)

```diff
-import collections.abc
-import enum
```

```
Question: "Which labels do you want to trust?"
multiSelect: true
Options:
- "Type stubs (20)" (description: "Remove choices param from fields that don't support choices")
- "Mixin inheritance (6)" (description: "Add ChoicesFieldMixin to field classes")
- "Remove imports (4)" (description: "Remove now-unused imports")
- "Show all labels" (description: "See full list of all 19 labels")
- "Start walkthrough" (description: "Skip trusting, review changes individually")
```

After trusting, show updated progress and present the next batch of 3-4 labels. Continue until all labels have been presented or the user starts the walkthrough.

### When Labels Are Skipped

Labels not selected in a batch remain available in subsequent batches. Once all batches have been shown, any unselected labels go to manual review in Phase 3.

### When to Transition to Phase 3

Move to the walkthrough when:

- **All patterned labels have been presented** (trusted or skipped)
- **The user chooses to start the walkthrough**
- **Only reasoned changes remain** — if remaining labels are single-hunk or unique, suggest transitioning

**Transition prompt:**

```
Question: "5 labels remain, all reasoned changes. Ready to walk through them?"
Options:
- "Start walkthrough" (description: "Walk through remaining 15 hunks")
- "Keep trusting labels" (description: "Present the next label")
- "Show me what's left" (description: "List remaining labels and counts")
```

## Phase 3: Walkthrough

The remaining hunks are **reasoned changes**—they need your actual attention. Don't just dump them—**walk through in story order**.

**Your role: Narrator, not reviewer.** Explain what's happening without passing judgment. You decide if it's correct; the AI helps you understand what you're looking at.

### Ordering the Walkthrough

Analyze remaining hunks and present them in an order that builds understanding:

1. **Foundations first** — New types, interfaces, base classes. These are building blocks.
2. **Then the usage** — Code that uses those foundations.
3. **Ripple effects** — Call sites that changed, imports added, signatures updated.
4. **Finishing touches** — Tests, documentation, configuration.

**Group related hunks into logical changes.** A "change" may span multiple hunks across different files:

- **Moved code** — Deletion in one file + addition in another = show together
- **New abstraction + usage** — New class + the places that use it
- **Interface change + call sites** — Changed signature + updated callers
- **Import + usage** — New import + the code that needs it

Present these as a single change, not separate items. The user needs to see both sides to verify correctness.

### Explaining Without Judgment

Describe what the code does, not whether it's good:

**Good (descriptive):**

- "This introduces a `ChoicesFieldMixin` class that extracts the choices validation logic"
- "This changes `CharField` to inherit from `ChoicesFieldMixin`"
- "This removes the `choices` parameter since it's now handled by the mixin"

**Avoid (judgmental):**

- ~~"This is a nice refactor"~~
- ~~"This looks safe"~~
- ~~"I recommend adding error handling here"~~

### Presenting Each Change

```bash
git review diff --unreviewed
```

Present hunks one at a time or in small related groups:

**[1/5] The New Foundation**

Let's start with the core of this change—a new `ChoicesFieldMixin` class:

```diff
+ class ChoicesFieldMixin:
+     def __init__(self, *args, choices=None, **kwargs):
+         super().__init__(*args, **kwargs)
+         self.choices = choices
```

This extracts choices handling that was previously in the base `Field` class.

**Use AskUserQuestion:**

```
Question: "[1/5] ChoicesFieldMixin class"
Options:
- "Approve and continue" (description: "Looks good, move on")
- "I have a question" (description: "Capture a note about this")
- "Show more context" (description: "See surrounding code")
- "Skip for now" (description: "Don't approve yet, continue")
```

## Capturing Notes

Notes are captured throughout the walkthrough. When you have a question or concern, **capture it and keep moving**. Don't derail into debugging.

**When you say "I have a question":**

Agent: "What specifically concerns you?"
You: "I'm wondering if the ValidationError message is clear enough"
Agent: "Got it—let me capture that."

```bash
git review notes --add "mixins.py:52 - Is the ValidationError message clear enough?"
```

**After capturing a note, the hunk is SKIPPED, not approved.** Notes indicate something needs attention—we don't auto-approve hunks with concerns.

The agent then moves to the next stop. The note is captured; we'll deal with it at the end.

**Always include file:line references** so notes are actionable later.

## Finishing the Review

The walkthrough ends when all hunks have been seen. What happens next depends on your context.

### Pre-Commit (Uncommitted Changes)

Goal: Decide whether to commit, or fix issues first.

**If no notes:**

> Review complete. All hunks approved—ready to commit.

```
Question: "All approved. Ready to commit?"
Options:
- "Yes, commit" (description: "I'll help write the commit message")
- "Stage approved hunks" (description: "Run `git review stage` to selectively stage")
- "Not yet" (description: "Exit review, I'll commit later")
```

**If notes exist:**

> Review complete. 3 notes captured:
>
> 1. `mixins.py:45` - Why convert choices to dict?
> 2. `fields.py:120` - Should this handle None?
> 3. `tests/test_choices.py:30` - Missing edge case test

```
Question: "You have 3 notes. What would you like to do?"
Options:
- "Address these now" (description: "Exit review, fix issues, then re-review")
- "Commit anyway" (description: "These aren't blockers")
- "Add as TODOs" (description: "Include notes in commit message as follow-up items")
```

### Pre-Push/Merge (Branch Review)

Goal: Decide whether the branch is ready to push/merge.

**If no notes:**

> Review complete. All 50 hunks approved—looks ready to push.

```
Question: "Branch review complete. What's next?"
Options:
- "Push/create PR" (description: "Ready to share this branch")
- "Merge locally" (description: "Merge into main without a PR")
- "Done for now" (description: "Exit, I'll push later")
```

**If notes exist:**

> Review complete. 2 notes captured:
>
> 1. `auth.py:45` - Should extract timeout to a constant
> 2. `tests/test_auth.py:90` - Missing test for refresh flow

```
Question: "You have 2 notes. What would you like to do?"
Options:
- "Fix before pushing" (description: "Exit review, address these, commit, then re-review")
- "Push anyway" (description: "These can be follow-up commits")
- "Add as PR description" (description: "Include as known issues/TODOs in PR")
```

### What Happens After "Address These Now"

When you exit to fix issues:

1. Your review progress is **saved**—approved hunks stay approved
2. You make your changes, creating new hunks
3. Run `/git review` again to resume
4. Only **new or modified hunks** need review—unchanged approved hunks stay approved

## Example Session

````
AGENT: Let me check where we are.

$ git review status --short
No review in progress

AGENT: I see uncommitted changes. Starting a review.

$ git review start master
Started review: master..master+ (working tree)
50 hunks across 12 files

[AGENT examines and labels hunks...]

$ git review status
Unreviewed (50 hunks)
  · Remove choices parameter from field constructors            12 hunks
  · Add ChoicesFieldMixin import                                 8 hunks
  · Add ChoicesFieldMixin class                                  1 hunk
  · Add ChoicesFieldMixin to field classes                       7 hunks
  · Add choices validation test                                  2 hunks
  [... more labels ...]

AGENT: **Review Progress:** 0% (0/50 hunks) · 8 labels

**"Remove choices parameter from field constructors"** (12 hunks)

```diff
-         choices: _Choices | None = ...,
```

**"Add ChoicesFieldMixin import"** (8 hunks)

```diff
+from .mixins import ChoicesFieldMixin
```

**"Add ChoicesFieldMixin to field classes"** (7 hunks)

```diff
-class CharField(Field[str]):
+class CharField(ChoicesFieldMixin, Field[str]):
```

[AskUserQuestion: Which labels do you want to trust? (multiSelect)]

USER: [selects "Remove choices (12)", "Add import (8)", "Add to classes (7)"]

$ git review trust "Remove choices parameter from field constructors"
$ git review trust "Add ChoicesFieldMixin import"
$ git review trust "Add ChoicesFieldMixin to field classes"
✓ Trusted 3 labels — approved 27 hunk(s).

AGENT: **Review Progress:** 54% (27/50 hunks) · 5 labels remaining

[... trust phase continues ...]

$ git review status
Progress: 80% (40/50 hunks)

Unreviewed (10 hunks)
· Add ChoicesFieldMixin class 1 hunk
· Add ChoicesFieldMixin to field classes 7 hunks
· Add choices validation test 2 hunks

AGENT: 10 hunks remain—these need your attention.

[AskUserQuestion: Ready to walk through remaining hunks?]

USER: [selects "Start walkthrough"]

AGENT: ---

**[1/3] The Foundation**

In `mixins.py`, there's a new `ChoicesFieldMixin` class:

```diff
+ class ChoicesFieldMixin:
+     def __init__(self, *args, choices=None, **kwargs):
+         super().__init__(*args, **kwargs)
+         self.choices = choices
+
+     def validate(self, value, model_instance):
+         if self.choices and value not in dict(self.choices):
+             raise ValidationError(...)
```

This extracts choices handling from the base `Field` class.

[AskUserQuestion: Approve?]

USER: [selects "I have a question"]

AGENT: What's on your mind?

USER: Why convert choices to dict()?

AGENT: Good question—let me capture that.

$ git review notes --add "mixins.py:52 - Why convert choices to dict()?"
✓ Note added

Moving on without approving this hunk.

---

**[2/3] Field Class Changes**

Here's how field classes adopt the mixin:

```diff
- class CharField(Field):
+ class CharField(ChoicesFieldMixin, Field):
```

Same pattern for IntegerField and others—7 hunks total.

[AskUserQuestion: Trust this pattern?]

USER: [selects "Trust this pattern"]

$ git review trust "Add ChoicesFieldMixin to field classes"
✓ Approved 7 hunk(s)

---

**[3/3] Tests**

```diff
+ class ChoicesFieldMixinTests(TestCase):
+     def test_valid_choice_passes(self):
+         field = CharField(choices=[('a', 'A')])
+         field.validate('a', None)  # should not raise
```

[AskUserQuestion: Approve tests?]

USER: [selects "Approve and continue"]

$ git review approve tests/test_choices.py:abc123
✓ Approved 2 hunk(s)

---

**Walkthrough Complete**

$ git review status
Progress: 98% (49/50 hunks)

Unreviewed (1 hunk)
· Add ChoicesFieldMixin class 1 hunk

$ git review notes
1 note:

1. mixins.py:52 - Why convert choices to dict()?

AGENT: 49 of 50 hunks approved. **1 hunk skipped** with a note:

- `mixins.py:52` - Why convert choices to dict()?

[AskUserQuestion: What would you like to do?]

USER: [selects "Address these now"]

AGENT: Your progress is saved. After you've looked into that dict() question:

1. Make any changes you want
2. Run `/git review` again
3. You'll only need to review new or changed hunks

```

```
````
