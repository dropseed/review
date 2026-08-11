---
description: Drive the Review app's terminal sessions from the `review` CLI — list them, start new ones, type into them, read their screens, and block until something happens. Use when asked to run something in a Review terminal, check what a terminal or agent in the app is doing, or automate a dev loop the human can watch in the app.
user_invocable: true
---

# Driving the Review app's terminals

The Review desktop app embeds terminal sessions that live in a `review-daemon`
process (they survive the app quitting). `review terminal` talks to that same
daemon, so everything you do here shows up live in the app — and everything the
human sees in the app, you can see too.

Run `review terminal list --all` first. If it errors with "daemon is not
running", the Review app isn't open — ask the human to open it; you can't
start the daemon yourself.

## The commands

```
review terminal list [--all|--repo PATH] [--json]     # sessions + phase + cwd
review terminal start [--id NAME] [--cwd DIR] [--json]
review terminal send <id> [TEXT] [--key KEY]... [--enter]
review terminal peek <id>                             # what's on screen right now
review terminal wait <id> [--until <phase|exit>] [--match REGEX] [--timeout SECS]
review terminal resize <id> --cols N --rows M
review terminal kill <id>...
```

Ids accept any unique prefix and resolve across all repos. `--json` on
`list`/`start`/`wait` gives you the wire shapes. Named keys: `enter`, `tab`,
`esc`, `backspace`, `space`, `up`/`down`/`left`/`right`, `home`, `end`,
`ctrl-<letter>`.

## Ground rules

- **Don't type into a session you didn't start** unless the human asked you
  to. Sessions in `list` include the human's own shells and running agents;
  `peek` is always safe, `send` is not.
- **Start your own session for your own work** — `review terminal start --id
  <task-name>` — and `kill` it when you're done. Naming it makes the app's
  sidebar legible for the human.

## Phases, and when to trust them

Every session has a phase: `working` (command running), `waiting_for_input`
(at a prompt), `needs_attention` (bell/notification), `idle`. Phases come from
OSC 133 shell integration plus process polling. Check `shellIntegrationActive`
in `list --json` — when it's `false`, phase transitions are best-effort, so
prefer `--match` or `peek` over `--until` for that session.

## Patterns

**Run a command and wait for it to finish** — send, then wait for the prompt
to come back. The phase check is race-free (a snapshot is taken after
subscribing), so it's fine if the command finishes before the wait starts:

```
review terminal send my-task 'cargo test' --enter
review terminal wait my-task --until waiting-for-input --timeout 600
review terminal peek my-task            # read the result / exit status
```

`list --json` also carries `lastExitCode` per session.

**Wait for a long-running process to say something** — `--match` sees only
output produced *after the wait starts*, so start the process, then wait for
its startup line:

```
review terminal send dev-server 'npm run dev' --enter
review terminal wait dev-server --match 'Listening on|ready in' --timeout 120
```

Output is matched with terminal semantics applied (escape sequences stripped,
`\r` progress lines overwritten), so write regexes against what a human sees,
not raw bytes. If the output you need already happened, it's history — `peek`
the screen instead of waiting.

**Check on an agent or long task the human asked about** — read-only, any
session:

```
review terminal list --all
review terminal peek 7e0d               # prefix of the id from list
```

**Drive an interactive prompt** — send keys without text:

```
review terminal send my-task --key down --key enter
review terminal send my-task --key ctrl-c          # interrupt
```

**Wait for a session to end** (you sent `exit`, or a one-shot command shell):

```
review terminal wait my-task --until exit
```

## Wrap up

Kill the sessions you started (`review terminal kill <id>`), leave everyone
else's alone, and tell the human what ran where — session ids included, so
they can peek at the scrollback in the app.
