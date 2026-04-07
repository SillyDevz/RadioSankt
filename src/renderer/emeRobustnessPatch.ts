/**
 * Spotify Web Playback (and some CDM code paths) call requestMediaKeySystemAccess
 * without an explicit robustness value; Chromium warns and Electron can be flaky.
 * Fill in missing robustness before delegating to the native implementation.
 */
const PATCH_FLAG = '__radioSanktEmeRobustnessPatch';

function patch(): void {
  const g = globalThis as typeof globalThis & { [PATCH_FLAG]?: boolean };
  if (g[PATCH_FLAG]) return;
  if (typeof Navigator === 'undefined' || !Navigator.prototype.requestMediaKeySystemAccess) return;

  g[PATCH_FLAG] = true;
  const original = Navigator.prototype.requestMediaKeySystemAccess.bind(Navigator.prototype);

  Navigator.prototype.requestMediaKeySystemAccess = function requestMediaKeySystemAccessPatched(
    keySystem: string,
    configurations: MediaKeySystemConfiguration[],
  ): Promise<MediaKeySystemAccess> {
    const patched = configurations.map((c) => ({
      ...c,
      audioCapabilities: (c.audioCapabilities ?? []).map((ac) => ({
        ...ac,
        robustness: ac.robustness ?? '',
      })),
      videoCapabilities: (c.videoCapabilities ?? []).map((vc) => ({
        ...vc,
        robustness: vc.robustness ?? '',
      })),
    }));
    return original(keySystem, patched);
  };
}

patch();
