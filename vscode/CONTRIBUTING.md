# PullApprove Review

A VS Code extension for code review workflows. Compare branches, track reviewed files, and export review notes as markdown.

## Features

- **Branch comparison** - Compare any two branches, staged changes, or uncommitted changes
- **File tracking** - Check off files as you review them with progress indicator
- **Review notes** - Write notes with easy file:line references
- **Markdown export** - Copy your review as markdown to paste into Claude or GitHub

## Development

### Prerequisites

- Node.js 18+
- VS Code 1.85+

### Setup

```bash
cd pullapprove-review
npm install
```

### Common Workflows

Use the scripts in the `scripts/` folder:

```bash
# Start development with watch mode
./scripts/dev

# Build for production
./scripts/build

# Package as .vsix for distribution
./scripts/package

# Clean build artifacts
./scripts/clean
```

### Manual Development

1. Start the build in watch mode:
   ```bash
   npm run watch
   ```

2. Press `F5` in VS Code to launch the Extension Development Host

3. In the new VS Code window, click the PullApprove icon in the Activity Bar (sidebar)

### Project Structure

```
pullapprove-review/
├── src/
│   ├── extension.ts              # Extension entry point
│   ├── providers/
│   │   ├── GitProvider.ts        # Wraps vscode.git extension API
│   │   └── ReviewViewProvider.ts # Sidebar webview provider
│   ├── services/
│   │   ├── ReviewStateService.ts # Persists review state to disk
│   │   └── MarkdownExporter.ts   # Generates markdown export
│   ├── commands/
│   │   └── commands.ts           # Command handlers
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces
│   └── webview/
│       ├── main.tsx              # React entry point
│       ├── components/           # React components
│       │   ├── App.tsx
│       │   ├── BranchSelector.tsx
│       │   ├── FileTree.tsx
│       │   ├── FileItem.tsx
│       │   └── NotesPanel.tsx
│       ├── hooks/
│       │   └── useVSCodeApi.ts   # VS Code messaging hook
│       └── styles/
│           └── main.css          # Webview styles
├── media/
│   └── icon.svg                  # Activity bar icon
├── scripts/                      # Development scripts
├── out/                          # Build output (gitignored)
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript config (extension)
├── tsconfig.webview.json         # TypeScript config (webview/React)
└── esbuild.js                    # Build script
```

### Architecture

The extension has two main parts:

1. **Extension Host** (Node.js) - `src/extension.ts`, `src/providers/`, `src/services/`, `src/commands/`
   - Runs in VS Code's extension host process
   - Accesses VS Code APIs (git, filesystem, commands)
   - Communicates with webview via `postMessage`

2. **Webview** (Browser/React) - `src/webview/`
   - Runs in an isolated iframe
   - React UI for the sidebar panel
   - Communicates with extension via `postMessage`

### Key Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Activates extension, registers providers and commands |
| `src/providers/GitProvider.ts` | Wraps `vscode.git` API for branch listing and diffs |
| `src/providers/ReviewViewProvider.ts` | Creates sidebar webview, handles messaging |
| `src/services/ReviewStateService.ts` | Persists review state to `.vscode/pullapprove-reviews/` |
| `src/webview/hooks/useVSCodeApi.ts` | React hook for VS Code messaging |
| `package.json` | Defines commands, menus, views, keybindings |

### State Persistence

Review state is stored per-comparison in `.vscode/pullapprove-reviews/`:

```
.vscode/pullapprove-reviews/
├── master__feature-branch.json
├── staged.json
└── uncommitted.json
```

Each file contains:
- `reviewedFiles` - List of file paths marked as reviewed
- `notes` - Review notes text
- `lineReferences` - File:line references added from editor
- `lastUpdated` - Timestamp

### Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `pullapproveReview.addLineReference` | `Cmd+Shift+R` | Add current line to review notes |
| `pullapproveReview.addSelectionReference` | (context menu) | Add selection to review notes |
| `pullapproveReview.copyAsMarkdown` | (toolbar) | Copy review as markdown |
| `pullapproveReview.clearReview` | (toolbar menu) | Clear current review |
| `pullapproveReview.refresh` | (toolbar) | Refresh file list |

### Debugging

1. Set breakpoints in `src/` files
2. Press `F5` to launch Extension Development Host
3. Use the Debug Console to see `console.log` output

For webview debugging:
1. In the Extension Development Host, open Command Palette
2. Run "Developer: Open Webview Developer Tools"

### Publishing

```bash
# Package the extension
./scripts/package

# This creates pullapprove-review-0.1.0.vsix
```

To install the `.vsix` file:
```bash
code --install-extension pullapprove-review-0.1.0.vsix
```
