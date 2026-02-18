# Proposal: AI-Powered Hunk Decomposition

## Problem

Git hunks are defined by **proximity** (lines that are close together get merged into one hunk based on context lines), not by **semantic meaning**. So you can easily end up with a hunk that contains, say, an import addition at the top and an unrelated variable rename a few lines below — git treats it as one hunk because they're within the context window, but they're logically two separate changes.

## Approach

AI could help decompose these. A few angles on how:

### Line-level semantic grouping

An LLM could look at the changed lines within a hunk and cluster them into logical "sub-hunks" based on what each change is actually doing. For example: "lines 3-5 are adding an import, lines 8-12 are renaming a variable" → two logical groups from one physical hunk.

### Natural split points

Unchanged context lines between changed lines are natural candidates for splitting. The simplest heuristic would be to split at any gap of unchanged lines, but AI could be smarter — keeping related changes together even if they're separated by a context line, or splitting changes that are adjacent but unrelated.

### Implementation spectrum (simple → sophisticated)

1. **Heuristic splitting** — Split any hunk that has gaps of unchanged lines between changed regions (no AI needed, but loses the "related changes that happen to be separated" case)
2. **AI classification then grouping** — Send the hunk to an LLM, ask it to label each changed line with a "logical change ID," then group by those IDs
3. **Hybrid** — Split heuristically first, then use AI to optionally re-merge sub-hunks that are actually related

## Design considerations

The main design question is: does this create **sub-hunks** (children of a hunk, each independently classifiable/approvable), or does it replace the hunk concept entirely?

Given the current model where hunks are identified by `filepath:hash` and each gets a single classification label, sub-hunks would probably be the more natural extension.
