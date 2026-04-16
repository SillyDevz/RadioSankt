# Widevine, Spotify Web Playback, and Castlabs EVS

This document explains how DRM signing works in Radio Sankt so you can run the app locally, ship releases, and debug `widevine-license` errors. Point AI assistants at this file for setup questions.

## Why this exists

- Spotify’s **Web Playback SDK** plays encrypted audio using **Widevine** (browser **EME** APIs).
- Stock **Electron** does not ship a usable Widevine path for production-style services.
- This project uses [**Electron for Content Security (ECS)**](https://github.com/castlabs/electron-releases) (`electron` dependency with a `+wvcus` tag) so the Widevine CDM can load.
- Spotify’s license server expects a **production-grade VMP (Verified Media Path)** signature on the client. The default ECS download is only **development**-signed, which commonly causes:
  - `POST …/widevine-license/v1/audio/license` → **500**
  - `EMEError: No supported keysystem`
  - Playback briefly working after many retries, then failing again

**Fix:** sign the correct **Electron bundle** with [**Castlabs EVS**](https://github.com/castlabs/electron-releases/wiki/EVS) (free account, `castlabs-evs` Python package).

---

## Critical: two different Electron binaries

| How you run | Path that must be VMP-signed |
|-------------|------------------------------|
| **`npm run electron:dev`** | **`node_modules/electron/dist`** (contains `Electron.app` / Windows equivalents) |
| **Packaged app** (`npm run electron:build:mac`, etc.) | **`release/…`** directory that contains **`Radio Sankt.app`** (or `win-unpacked` on Windows) |

Signing only **`release/…`** does **not** fix **`electron:dev`**. Signing only **`node_modules/electron/dist`** does **not** fix a **new** `.dmg` / installer unless you also run release signing for that build.

---

## One-time EVS setup

```bash
python3 -m pip install --upgrade castlabs-evs
python3 -m castlabs_evs.account signup   # follow prompts (email verification)
```

Full details: [EVS wiki](https://github.com/castlabs/electron-releases/wiki/EVS).

---

## Day-to-day development (macOS / Windows)

After **every** `npm install` (or any change that replaces `node_modules/electron`):

```bash
npm install
npm run evs:sign-electron-dist
npm run evs:verify-electron-dist   # optional; should show valid streaming signature
npm run electron:dev
```

### npm scripts reference

| Script | Purpose |
|--------|---------|
| `evs:sign-electron-dist` | `sign-pkg` on **`node_modules/electron/dist`** (for **`electron:dev`**) |
| `evs:verify-electron-dist` | Verify VMP signature on **`node_modules/electron/dist`** |
| `evs:sign-release` | Manual fallback: sign an already-built **`release/…`** folder (`.app` or `win-unpacked`) |
| `electron:build:evs` | Alias of the default packaged build; EVS now runs in electron-builder hooks |
| `electron:build:mac:evs` | Alias of `electron:build:mac`; mac EVS runs before Apple signing |
| `electron:build:win:evs` | Alias of `electron:build:win`; Windows EVS runs after code signing |

**Linux:** EVS does not sign Linux the same way; see Castlabs docs for Widevine on Linux.

---

## Packaged releases

```bash
npm run electron:build:mac    # or electron:build:win
```

Legacy/manual fallback:

```bash
npm run evs:sign-release
```

### Signing order (from Castlabs)

- **macOS:** VMP signing **before** Apple code signing (if you use a real signing identity).
- **Windows:** VMP signing **after** your code signing.

This repo runs EVS inside electron-builder hooks so packaged builds are signed in the correct phase automatically. Apple signing/notarization is optional and separate from Spotify DRM support.

---

## macOS: broken `Electron.app` after `npm install`

npm’s unzip can drop **symlinks** inside `*.framework` bundles (`Electron Framework`, `Versions/Current`, etc.), which causes:

`Library not loaded: @rpath/Electron Framework.framework/Electron Framework`

This repo runs **`scripts/repair-electron-mac-framework.cjs`** on **`postinstall`** to recreate those symlinks.

**Order matters:** repair runs on install, then **you** run **`evs:sign-electron-dist`** so the signed tree matches what actually runs.

---

## Sharing the app with others

- **End users** install **your built, signed** `.dmg` / `.exe`. They do **not** need an EVS account.
- **From source:** contributors must run **`evs:sign-electron-dist`** for dev. Packaged builds run EVS automatically via electron-builder hooks, or you can use **`evs:sign-release`** as a manual fallback on an existing build.
- Re-sign when you ship a **new** Electron version or a **new** packaged layout.

---

## Quick diagnosis

| Symptom | Likely cause |
|---------|----------------|
| Many **500**s on `widevine-license` | Unsigned or wrong binary; run **`evs:sign-electron-dist`** for dev |
| Works after many failures, then stops | Typical without stable production VMP; sign + verify |
| **Connect** shows “Playing on Radio Sankt” but no sound | License failing; same as above |
| dyld **Electron Framework** missing | Run **`npm install`** again so **`postinstall`** repair runs |

Verify:

```bash
npm run evs:verify-electron-dist
```

---

## Links

- [Castlabs ECS / electron-releases](https://github.com/castlabs/electron-releases)
- [EVS (VMP signing)](https://github.com/castlabs/electron-releases/wiki/EVS)
- [electron-builder + ECS mirror (FAQ)](https://github.com/castlabs/electron-releases/wiki/FAQ#how-can-i-use-electron-builder-with-ecs)
