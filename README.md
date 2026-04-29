# Radio Sankt

Radio Sankt is a desktop radio automation app built with Electron and React. It connects to your Spotify account and remote-controls your Spotify desktop/mobile app (Spotify Connect), letting you build playlists, schedule automation sequences, play jingles, go live, and crossfade — all from a single interface.

Local jingles and ads play through a Web Audio API mixing engine and can duck the Spotify app's volume automatically via the Spotify Web API. Automation playlists run unattended while you step away, and Live Mode fades out the music and takes you on-air whenever you want.

## How Spotify playback works

Radio Sankt does **not** play Spotify audio itself. Instead it uses Spotify's Web API to control whatever Spotify app you already have running (the Spotify desktop app, your phone, a Spotify-connected speaker, etc.).

- You **must** keep a Spotify app running and signed in on some device while using Radio Sankt.
- Premium is required by Spotify for most Web API playback endpoints.
- This approach avoids Widevine / DRM entirely, so the app works on any machine Spotify runs on (Windows, macOS, Linux — no special drivers required).

Jingles and ads are stored as local files and play through Radio Sankt directly. Ducking works by asking the Spotify device to lower its volume while the jingle runs.

## Prerequisites

- Node.js 18+
- A Spotify account (Premium recommended for full playback control)
- The Spotify desktop (or mobile) app installed and signed in on the same account

## Creating a Spotify Developer App

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click **Create app**
4. Give it any name (e.g. "Radio Sankt")
5. Set the **Redirect URI** to `http://127.0.0.1:8888/callback`
6. Under **APIs used**, check **Web API**
7. Save the app and copy the **Client ID**
8. Paste the Client ID into Radio Sankt's Settings page and click **Connect**

## Development Setup

```bash
# Install dependencies
npm install

# Run in development mode (Vite + Electron)
npm run electron:dev
```

The app opens at `http://localhost:5173` with hot reload. Electron launches automatically once the dev server is ready.

## Building

```bash
# Build for production
npm run electron:build
```

Output goes to the `release/` directory. On macOS you get a `.dmg`, on Windows an `.exe` installer. No Widevine/EVS setup is required because Radio Sankt does not decode DRM audio itself.

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

## Troubleshooting

**"No Spotify device available"** — Open the Spotify app on this computer (or any signed-in device) so it appears as a Spotify Connect device. Radio Sankt will automatically pick it up within a few seconds.

**Auth callback fails** — Verify your Redirect URI is exactly `http://127.0.0.1:8888/callback` in your Spotify Developer dashboard. No trailing slash.

**Play commands return 403/Premium required** — Some Spotify Web API playback endpoints require Premium. Also make sure your Client ID matches the app you created (the OAuth consent screen should show **your** app's name).

**Volume control has no effect on one device** — A few Spotify Connect devices (some speakers, web players) reject the Web API `volume` endpoint. Try controlling the Spotify desktop app instead.

**Token refresh errors** — The app auto-refreshes tokens every 60 seconds. If you see repeated auth errors, disconnect and reconnect from Settings.
