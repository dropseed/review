---
description: Prepare a change for human review — run AI quality and bug-hunt passes, fix or defer each finding with evidence, and persist the results into the Review app so the human starts from a record instead of a raw diff. Use at the end of a dev loop, before handing work to a human reviewer.
user_invocable: true
---

# Preparing a change for human review

A human reviewer shouldn't start from scratch. By the time they open the diff,
an AI review should already have run — and its results should live *in the
review*, not scrolled away in a chat transcript. This skill is the last step of
a dev loop: sweep the change, fix what you can prove, record what you can't,
and hand over a prepared review.

The one hard rule: **nothing you learn here is allowed to evaporate.** Every
finding ends up either fixed (and recorded as fixed) or deferred to the human
(and recorded as deferred). The transcript is not a record.

Run `review --help` first to confirm the CLI is installed.

## The pass

### 1. Establish the review

```
review status                # is there a review for this change already?
```

If there isn't one for the comparison you're preparing, start it
(`review start` resolves the default comparison; `review start --working`,
`--staged`, a `base..head` spec, etc. for anything else — it also opens the
desktop app). Then get the shape of what you're preparing:

```
review hunks --json          # files, hunks, classifications — no --diff yet
```

### 2. Quality pass

If your harness has a dedicated cleanup skill (e.g. `/simplify`), run it and
apply the fixes. Otherwise, make an equivalent pass yourself — reuse,
simplification, efficiency — and apply what's clearly right.

Quality cleanups don't get per-finding records: they just become part of the
diff the human reviews. Records are for findings that carry a *decision*.

### 3. Bug hunt

Run your harness's review skill (e.g. `/code-review`), or an equivalent
careful pass over the diff. Then — and this is the part that earns the
human's trust — **verify each candidate finding before recording it**:
reproduce it with a failing test, a one-off script, or a trace through real
inputs. A finding you couldn't verify must say so. Speculation dressed up as
a finding is how reviewers learn to ignore the whole channel.

Triage each verified finding:

- **You can fix it and the fix is uncontroversial** → fix it, keep the
  evidence, and record it as fixed (below).
- **It needs a call you shouldn't make alone** — product behavior, acceptable
  risk, a refactor beyond this change's scope → defer it to the human.

### 4. Record everything in the review

Findings are comments, attributed to you. One comment per finding, on the
exact line, following this convention (it's a format the app will grow into —
keep it):

- First line: `<type>/<severity>: <summary>` — type is one of
  `bug` | `risk` | `question` | `improvement`; severity is `high` | `medium` | `low`.
- `Evidence:` — how you verified it (the command, the test, the trace).
  Write `Evidence: unverified — <why>` honestly if you couldn't.
- `Suggested:` — what you think should happen (deferred findings), or
- `Fixed:` — what you did (fixed findings).
- `Deferred:` — one line on why this is the human's decision, not yours.

Deferred finding — the comment stays open:

```
review comment add src/auth.rs:142 "bug/high: expiry compared in ms vs s — sessions never expire. Evidence: test_session_expiry fails against real timestamps (repro included). Suggested: compare epoch seconds. Deferred: fix changes session semantics — your call." --source agent
```

Fixed finding — same comment, then resolve it, so the record shows
found-and-fixed rather than nothing at all:

```
review comment add src/cache.rs:57 "bug/medium: TOCTOU between stat and read on the cache file. Evidence: repro script raced it in ~50 iterations. Fixed: hold the read lock across both; regression test added." --source agent
review comment resolve <comment-id>
```

**Never write `review note`.** The note is the human's own space — read it
for context if it exists (`review note show`), never write it.

### 5. Hand off in chat

The run summary has no home in the app yet, so it goes in the conversation.
Keep it short:

- what passes ran, and against what state of the diff
- findings verified: how many fixed (resolved comments), how many deferred
  (open comments)
- the one or two things the human should look at first

If the diff is large, offer to also compose a walkthrough with
`review guide add` (see the `review-guide` skill) — but that's their call,
not part of this pass.

## Command reference

```
review status                          # progress + overall state
review start [spec] [--working|--staged|--commit REF|--stash N|--patch FILE]
review hunks [--file|--label|--risk] [--json] [--diff]
review comment add <file>:<line>[:<end>] "<text>" [--side new|old|file] --source agent
review comment resolve <comment-id>
review comments [--unresolved|--resolved] [--author NAME]
review note show                       # the human's note — read-only for agents
```
