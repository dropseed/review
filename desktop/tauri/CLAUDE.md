# desktop/tauri/ — Desktop App (Tauri)

This crate wraps the `core` library into a Tauri desktop application.

## Structure

- `src/desktop/commands.rs` — All `#[tauri::command]` handlers. Thin wrappers that delegate to `review` crate.
- `src/desktop/mod.rs` — App setup: plugins, menus, window management, Sentry init, single-instance handling.
- `src/desktop/watchers.rs` — File system watcher using `notify`. Emits events to frontend on repo/review state changes.
- `src/desktop/companion_server.rs` — Companion HTTP server for mobile app and browser testing. Serves same API as Tauri commands over HTTP.
- `src/lib.rs` — Crate root, delegates to `desktop::run()`.
- `src/main.rs` — Binary entry point.

## Tauri Commands

Commands are registered in `mod.rs` via `tauri::generate_handler![]`. The frontend calls them via `invoke("command_name", { args })`.

Key command groups:
- **Git operations**: `get_current_repo`, `list_branches`, `get_git_status`, `list_commits`, `get_commit_detail`
- **File/diff**: `list_files`, `get_file_content`, `get_all_hunks`, `get_diff`, `get_expanded_context`
- **Review state**: `load_review_state`, `save_review_state`, `list_saved_reviews`, `delete_review`
- **Classification**: `classify_hunks_static`, `detect_hunks_move_pairs`
- **Trust**: `get_trust_taxonomy`, `get_trust_taxonomy_with_custom`, `match_trust_pattern`
- **Symbols**: `get_file_symbol_diffs`, `get_file_symbols`
- **Navigation**: `open_repo_window`
- **GitHub**: `check_github_available`, `list_pull_requests`
- **Misc**: `search_file_contents`, `generate_narrative`, `write_text_file`, `append_to_file`

## Watcher Events

The file watcher (`watchers.rs`) emits these events to the frontend:
- `fs:working-tree-changed` — Working tree file modified
- `fs:git-state-changed` — Git refs/HEAD changed
- `fs:review-state-changed` — `.git/review/` files changed

## Adding a New Command

1. Add the `#[tauri::command]` function in `commands.rs`
2. Register it in the `generate_handler![]` list in `mod.rs`
3. Add the corresponding `invoke()` call in `desktop/ui/api/tauri-client.ts`
4. Add the method to the `ApiClient` interface in `desktop/ui/api/client.ts`
