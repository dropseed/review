# mobile/ — Mobile Companion App (Expo/React Native)

Expo Router app that connects to the desktop companion server over HTTP.

## Development

```bash
# Start the Expo dev server + open iOS simulator
cd mobile && npx expo start --ios --clear

# Or without cache clear (faster restart)
cd mobile && npx expo start --ios
```

The app runs inside **Expo Go** on the simulator. It connects to the desktop companion server (default `http://localhost:3333`).

## Controlling the iOS Simulator with agent-device

[`agent-device`](https://github.com/callstackincubator/agent-device) is a CLI tool for programmatic simulator control. Install globally:

```bash
npm install -g @anthropic-ai/agent-device
```

### Prerequisites

- macOS **Accessibility permission** must be enabled for your terminal app (System Settings → Privacy & Security → Accessibility). This is required for the `--backend ax` flag which is the fast, reliable backend.

### Common Commands

```bash
# Boot simulator
agent-device boot

# List available devices
agent-device devices

# Take a screenshot
agent-device screenshot /tmp/screenshot.png

# Get accessibility tree (interactive elements only, fast backend)
agent-device snapshot -i --backend ax

# Click an element by accessibility ref (from snapshot)
agent-device click @e3

# Tap at screen coordinates
agent-device press <x> <y>

# Type text into focused field
agent-device type "some text"

# Tap a field then type into it
agent-device fill <x> <y> "text to enter"
# Or by accessibility ref
agent-device fill @e3 "text to enter"

# Scroll
agent-device scroll down 0.5     # direction + amount (0-1)

# Navigate
agent-device back
agent-device home

# Check foreground app
agent-device appstate

# Open a specific app
agent-device open "Expo Go"

# Close current session
agent-device close
```

### Snapshot Backends

- `--backend ax` — Fast, uses macOS Accessibility API. **Requires Accessibility permission.** Preferred.
- `--backend xctest` — Slower, uses XCTest. No permissions needed but may return 0 nodes for React Native apps in Expo Go.

### Workflow for Iterating on UI

1. Start desktop dev server (`scripts/dev`) and Expo (`npx expo start --ios --clear`)
2. Take screenshot: `agent-device screenshot /tmp/screen.png`
3. Get interactive elements: `agent-device snapshot -i --backend ax`
4. Navigate by clicking refs: `agent-device click @e4`
5. Screenshot again to see the result
6. Edit code → hot reload updates automatically → screenshot to verify

### Tips

- Element refs (`@e1`, `@e2`, etc.) change between snapshots — always take a fresh snapshot before clicking
- **Text input is unreliable** — `fill`, `type`, and `focus` struggle with iOS text fields (URL keyboards, secure fields, autocomplete). Ask the user to type manually when needed.
- Use `--backend ax` flag always — xctest doesn't work well with Expo Go
- Coordinate-based `press` is a fallback when accessibility refs don't work
- Off-screen elements appear in snapshots but can't be clicked — scroll first or only click elements with reasonable y-coordinates (< ~800)

## Structure

- `app/` — Expo Router file-based routes
  - `_layout.tsx` — Root layout (dark theme, navigation headers)
  - `connect.tsx` — Connect/auth screen (server URL + token)
  - `(tabs)/` — Tab-based navigation (reviews list, settings)
  - `review/[key].tsx` — Review detail screen
  - `review/file/[...path].tsx` — File diff viewer
  - `settings.tsx` — Settings modal
- `components/` — Shared components (ReviewCard, DiffLine, HunkView, etc.)
- `stores/` — Zustand stores (connection, API client)
- `lib/` — Utilities (colors, API client)

## Color Palette

Dark theme using the same stone palette as the desktop app. Defined in `lib/colors.ts`:

- Background: stone-950 (`#0c0a09`)
- Surface: stone-900 (`#1c1917`)
- Elevated: stone-800 (`#292524`)
- Primary text: stone-50 (`#fafaf9`)
- Secondary text: stone-500 (`#78716c`)
- Borders: `rgba(168, 162, 158, 0.15)`
- Accent: amber-500 (`#d9923a`)
