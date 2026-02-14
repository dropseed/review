# ios/CLAUDE.md

## Development Commands

```bash
# Build
xcodebuild -project ios/Review.xcodeproj -scheme Review \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# Run on simulator
xcrun simctl boot "iPhone 17 Pro"
xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/Review-bdquuflcxwiasadxonymanswxjwe/Build/Products/Debug-iphonesimulator/Review.app
xcrun simctl launch booted com.dropseed.review
open -a Simulator

# Or just open in Xcode and Cmd+R
open ios/Review.xcodeproj
```

## Architecture

Native Swift/SwiftUI iOS companion app. Connects to the desktop Review app's companion server over HTTP.

- **iOS 26+**, Swift 6, SwiftUI only, zero third-party dependencies
- **Bundle ID**: `com.dropseed.review`

### Structure

- `Models/` — Codable structs matching the companion server API (`Comparison`, `FileEntry`, `DiffHunk`, `ReviewState`, etc.)
- `Networking/` — `APIClient` (async/await, Bearer auth) and `APIError`
- `Services/` — `ConnectionManager` (Keychain persistence, connect/disconnect) and `ReviewStateManager` (debounced save, optimistic updates)
- `Logic/` — `TrustMatching` (pattern matching), `TreeUtils` (file tree), `ReviewDetailLogic` (section grouping, stats)
- `Views/` — SwiftUI views organized by feature: `Connect/`, `Reviews/`, `ReviewDetail/`, `FileDiff/`, `Settings/`
- `Theme/` — `AppTheme` with semantic color and font extensions
- `Utilities/` — `KeychainHelper` (Security framework wrapper)

### Key Patterns

- `@Observable` classes for shared state, injected via `.environment()`
- `NavigationStack` with typed `navigationDestination(for:)`
- 30s polling on reviews list with `.refreshable` pull-to-refresh
- Swipe gestures on hunk cards with haptic feedback
- 500ms debounced save for all review state mutations

### Server Dependency

Requires the desktop Review app running with its companion server (`scripts/dev`). The iOS app connects via URL + token entered on the Connect screen.
