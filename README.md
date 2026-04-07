# Radio Sankt

Radio Sankt is a desktop radio automation app built with Electron and React. It connects to your Spotify account via the Web Playback SDK, letting you build playlists, schedule automation sequences, play jingles, and go live — all from a single interface.

The app routes Spotify audio and local jingle files through a Web Audio API mixing engine with two channels, crossfading, ducking, and VU metering. Automation playlists run unattended while you step away, and Live Mode lets you fade out the music and take over whenever you want.

## Prerequisites

- Node.js 18+
- A Spotify account (Premium required for Web Playback SDK)
- macOS or Windows

## Creating a Spotify Developer App

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click **Create app**
4. Give it any name (e.g. "Radio Sankt")
5. Set the **Redirect URI** to `http://127.0.0.1:8888/callback`
6. Under **APIs used**, check **Web Playback SDK**
7. Save the app and copy the **Client ID**
8. Paste the Client ID into Radio Sankt's Settings page and click **Connect**

## Development Setup

```bash
# Install dependencies
npm install

# Spotify DRM: VMP-sign the dev Electron binary (required after every npm install that touches electron)
npm run evs:sign-electron-dist

# Run in development mode (Vite + Electron)
npm run electron:dev
```

The app opens at `http://localhost:5173` with hot reload. Electron launches automatically once the dev server is ready.

**Spotify / Widevine / Castlabs EVS:** See [docs/widevine-and-evs.md](docs/widevine-and-evs.md) for full setup, packaged builds, troubleshooting, and notes for AI assistants.

## Building

```bash
# Build for production
npm run electron:build
```

Output goes to the `release/` directory. On macOS you get a `.dmg`, on Windows an `.exe` installer.

## Publishing a Release

Releases are built automatically by GitHub Actions when you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds for macOS and Windows, then creates a GitHub Release with the installers attached. Make sure you have a `GH_TOKEN` secret configured in your repository settings.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Space | Play / Pause automation |
| S | Stop automation |
| C | Continue at pause point |
| Cmd/Ctrl+K | Open Spotify search |
| L | Toggle live mode |
| F1 | Open help panel |
| Shift+P | Previous track |
| Shift+N | Next track |

All shortcuts are rebindable from Settings.

## Troubleshooting

**"Spotify player not ready"** — Make sure you have Spotify Premium. The Web Playback SDK requires a Premium account to stream audio.

**Auth callback fails** — Verify your Redirect URI is exactly `http://127.0.0.1:8888/callback` in your Spotify Developer dashboard. No trailing slash.

**No audio after connecting** — Click anywhere in the app window first. Browsers (and Electron) require a user gesture before allowing audio playback via the Web Audio API.

**Token refresh errors** — The app auto-refreshes tokens every 60 seconds. If you see repeated auth errors, disconnect and reconnect from Settings.

**`widevine-license` 500 / no audio in dev** — You must VMP-sign **`node_modules/electron/dist`** (`npm run evs:sign-electron-dist`), not only `release/`. Details: [docs/widevine-and-evs.md](docs/widevine-and-evs.md).
