# Compare Mobile

iOS companion app for Compare, built with Expo.

## Quick Start

```bash
# From the root of the repository
scripts/mobile           # Start Expo dev server
scripts/mobile ios       # Start and open iOS simulator
scripts/mobile clear     # Clear cache and start fresh
scripts/mobile-build     # Build development client
scripts/mobile-check     # Type check
```

Or from the `mobile/` directory:

```bash
npm install              # Install dependencies
npm start                # Start Expo dev server
npm run ios              # Run on iOS simulator
```

## Connecting to Desktop

1. Start the desktop Compare app
2. Go to **Settings > Mobile Sync**
3. Enable the sync server
4. Copy the server URL and auth token
5. In the mobile app, enter the URL and token to connect

For remote access (not on the same network), use [Tailscale](https://tailscale.com) to create a secure VPN connection between your devices.

## Project Structure

```
mobile/
├── app/                    # Expo Router screens (file-based routing)
│   ├── _layout.tsx         # Root layout with native tabs
│   ├── (review)/           # Review tab screens
│   │   ├── _layout.tsx     # Stack navigation for review
│   │   ├── index.tsx       # Repository/comparison list
│   │   └── [id].tsx        # Review detail screen (hunks)
│   └── (settings)/         # Settings tab screens
│       ├── _layout.tsx     # Stack navigation for settings
│       └── index.tsx       # Connection & display settings
├── components/             # React Native components
│   ├── code-block.tsx      # Syntax-highlighted diff display
│   ├── hunk-card.tsx       # Compact hunk card (list view)
│   ├── swipeable-hunk.tsx  # Full-screen swipeable hunk (cards view)
│   ├── connection-form.tsx # Server URL & token input
│   ├── glass-view.tsx      # Blur background component
│   └── icon.tsx            # SF Symbols wrapper
├── stores/                 # Zustand state management
│   ├── index.ts            # Combined store
│   └── slices/
│       ├── connection-slice.ts  # Server connection state
│       └── sync-slice.ts        # Review state & file content
├── api/
│   └── sync-client.ts      # HTTP/WebSocket client for desktop sync
├── types/
│   └── index.ts            # TypeScript type definitions
├── theme/
│   ├── index.ts            # Combined theme exports
│   └── colors.ts           # Color palette (matches desktop)
└── utils/
    ├── haptics.ts          # Haptic feedback utilities
    └── storage.ts          # localStorage wrapper (expo-sqlite)
```

## Tech Stack

- **Expo SDK 54** - React Native framework
- **Expo Router 6** - File-based navigation
- **React Native Gesture Handler** - Swipe gestures
- **React Native Reanimated** - Smooth animations
- **Zustand** - State management
- **expo-secure-store** - Secure token storage
- **expo-symbols** - SF Symbols icons (iOS)

## Sync Protocol

The mobile app connects to the desktop sync server via HTTP REST + WebSocket:

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/repos` | List available repositories |
| GET | `/api/comparisons/:repoId` | List reviews for a repo |
| GET | `/api/state/:repoId/:comparisonKey` | Get review state |
| PATCH | `/api/state/:repoId/:comparisonKey` | Update review state |
| GET | `/api/diff/:repoId/:comparisonKey` | Get file tree |
| GET | `/api/diff/:repoId/:comparisonKey/:file` | Get file content & hunks |
| GET | `/api/taxonomy` | Get trust patterns |

### WebSocket Events

Connect to `/api/events` for real-time updates:

```typescript
{ type: "state_changed", repo: string, comparisonKey: string, version: number }
{ type: "client_connected", clientId: string }
{ type: "client_disconnected", clientId: string }
```

### Authentication

All requests require a Bearer token in the Authorization header:

```
Authorization: Bearer <auth_token>
```

For WebSocket, the token is passed via the `Sec-WebSocket-Protocol` header as `bearer-<token>`.

## Debugging

### View Expo Logs

Press `j` in the Expo dev server terminal to open the debugger, or shake your device to open the developer menu.

### Type Checking

```bash
scripts/mobile-check     # From root
# or
npx tsc --noEmit         # From mobile/
```

### Common Issues

**"Network request failed"**
- Ensure the desktop app sync server is running
- Check the server URL is correct (include port, e.g., `http://192.168.1.100:17950`)
- Verify both devices are on the same network (or connected via Tailscale)

**"Invalid token"**
- Regenerate the auth token in the desktop app
- Make sure you copied the full token without extra spaces

**Metro bundler issues**
- Run `scripts/mobile clear` to clear the cache
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
