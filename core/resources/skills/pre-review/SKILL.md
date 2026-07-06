---
description: Prepare a change for human review — run AI quality and bug-hunt passes, fix or defer each finding with evidence, and submit the results to the Review app as a review run so the human starts from a record instead of a raw diff. Use at the end of a dev loop, before handing work to a human reviewer.
user_invocable: true
---

# Preparing a change for human review

A human reviewer shouldn't start from scratch. By the time they open the diff,
an AI review should already have run — and its results should live *in the
review*, not scrolled away in a chat transcript. This skill is the last step of
a dev loop: sweep the change, fix what you can prove, record what you can't,
and hand over a prepared review.

The one hard rule: **nothing you learn here is allowed to evaporate.** The
whole pass ends in one `review findings submit` — a run record (proof the
review happened, and of what) plus every finding, fixed or deferred. The
transcript is not a record.

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

Quality cleanups don't get findings: they just become part of the diff the
human reviews. Findings are for issues that carry a *decision*.

### 3. Bug hunt

Run your harness's review skill (e.g. `/code-review`), or an equivalent
careful pass over the diff. Then — and this is the part that earns the
human's trust — **verify each candidate finding before recording it**:
reproduce it with a failing test, a one-off script, or a trace through real
inputs. That verification is the finding's `evidence`, and its result is your
`confidence` (`confirmed` = you reproduced it; `plausible` = you couldn't, say
why). Speculation dressed up as a finding is how reviewers learn to ignore
the whole channel.

Triage each finding:

- **You can fix it and the fix is uncontroversial** → fix it, re-run the
  evidence to prove the fix, and submit it with a `resolution`.
- **It needs a call you shouldn't make alone** — product behavior, acceptable
  risk, a refactor beyond this change's scope → submit it open, with a
  `suggestion` and your reasoning in `body`.

### 4. Submit the run

One submit records the run and all findings together. Build the JSON and pipe
it in:

```
review findings submit --source agent <<'EOF'
{
  "run": {
    "tool": "claude-code/code-review",
    "model": "<model id>",
    "summary": "simplify + code-review over the working tree. 3 findings: 2 fixed (evidence re-run), 1 deferred (session-expiry semantics)."
  },
  "findings": [
    {
      "kind": "bug", "severity": "high", "confidence": "confirmed",
      "title": "expiry compared in ms vs s — sessions never expire",
      "body": "token.expires_at is epoch seconds; the comparison uses Date.now() milliseconds.",
      "suggestion": "compare epoch seconds",
      "anchor": { "path": "src/auth.rs", "line": 142 },
      "evidence": [
        { "kind": "test", "command": "cargo test test_session_expiry", "output": "FAILED: expected expired, got active" }
      ]
    },
    {
      "kind": "bug", "severity": "medium", "confidence": "confirmed",
      "title": "TOCTOU between stat and read on the cache file",
      "anchor": { "path": "src/cache.rs", "line": 57 },
      "evidence": [
        { "kind": "command", "command": "./scripts/race-repro.sh", "output": "raced in 48 iterations" }
      ],
      "resolution": {
        "action": "fixed",
        "reason": "hold the read lock across stat+read; regression test added",
        "evidence": { "kind": "command", "command": "./scripts/race-repro.sh", "output": "clean after 5000 iterations" }
      }
    }
  ]
}
EOF
```

What matters in that shape:

- `run.summary` is the run's own record — what you examined, what ran
  against it, the headline numbers. It belongs here, not in the chat alone.
  Name the files/areas you actually reviewed; this prose is the coverage
  story (there is no per-hunk coverage field).
- Fixed findings carry a `resolution` with **proof-of-fix evidence** — the
  same repro, re-run, now passing. Found-and-fixed with receipts.
- Deferred findings have no `resolution`; they arrive open, which is the
  human's queue.
- `kind`: `bug` | `risk` | `question` | `improvement` · `severity`:
  `high` | `medium` | `low` · `confidence`: `confirmed` | `plausible`.
- A clean pass still gets submitted — a run with `"findings": []` is the
  record that review happened and found nothing.

Afterwards, `review findings` / `review finding show <id>` to double-check
what landed. Use `review comment add` only for line-level *conversation*
(questions about intent, naming); findings are for issues with a lifecycle.

**Never write `review note`.** The note is the human's own space — read it
for context if it exists (`review note show`), never write it.

### 5. Hand off in chat

The record is in the app; the chat handoff is just orientation. Keep it
short: what ran, the open-findings count, and the one or two things the human
should look at first.

If the diff is large, offer to also compose a walkthrough with
`review guide add` (see the `review-guide` skill) — but that's their call,
not part of this pass.

## Command reference

```
review status                          # progress + overall state
review start [spec] [--working|--staged|--commit REF|--stash N|--patch FILE]
review hunks [--file|--label|--risk] [--json] [--diff]
review findings submit [FILE] [--source agent] [--json]   # stdin or FILE
review findings [--open|--resolved] [--kind K] [--severity S] [--json]
review finding show <id> [--json]
review finding resolve <id> --as fixed|false-positive|accepted-risk|deferred [--reason TEXT] [--evidence TEXT]
review finding reopen <id> [--reason TEXT]
review runs [--json]
review comment add <file>:<line>[:<end>] "<text>" --source agent   # conversation, not findings
review note show                       # the human's note — read-only for agents
```
