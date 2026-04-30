import {
  addTrackToQueue,
  fetchRecommendationTrackUris,
  getProfile,
  getRemotePlaybackState,
  playTrackUris,
  remoteResumeActiveDevice,
  spotifyUriToTrackId,
} from '@/services/spotify-api';
import { useStore } from '@/store';

const REFILL_INTERVAL_MS = 10_000;
const BATCH_LIMIT = 18;
const ADD_PER_TICK = 15;
const SEEN_CAP = 400;
const MAX_NULL_TICKS = 2;

let refillTimer: ReturnType<typeof setInterval> | null = null;
const queuedSeen = new Set<string>();
let lastKnownSeedId: string | null = null;
let consecutiveNullTicks = 0;
let resumeAttempts = 0;
let consecutiveTickFailures = 0;

function trimSeen(): void {
  if (queuedSeen.size <= SEEN_CAP) return;
  const drop = queuedSeen.size - SEEN_CAP + 80;
  const it = queuedSeen.values();
  for (let i = 0; i < drop; i++) {
    const n = it.next();
    if (n.done) break;
    queuedSeen.delete(n.value);
  }
}

export function stopRecommendationsContinuation(): void {
  if (refillTimer !== null) {
    clearInterval(refillTimer);
    refillTimer = null;
  }
  queuedSeen.clear();
  lastKnownSeedId = null;
  consecutiveNullTicks = 0;
  resumeAttempts = 0;
  consecutiveTickFailures = 0;
}

if (typeof window !== 'undefined') {
  window.addEventListener('radio-sankt:stop-recommendations', () => stopRecommendationsContinuation());
}

/** Seed from the last playlist track; replaces queue with a recommendation batch and keeps topping up. */
export async function startRecommendationsContinuation(seedTrackUri: string, deviceId: string): Promise<void> {
  stopRecommendationsContinuation();

  const seedId = spotifyUriToTrackId(seedTrackUri);
  if (!seedId) throw new Error('Invalid seed track URI');

  const profile = await getProfile();
  const market = profile.country ?? undefined;

  let recs = await fetchRecommendationTrackUris(seedId, BATCH_LIMIT, market ?? undefined);
  recs = recs.filter((u) => u !== seedTrackUri);
  if (recs.length === 0) {
    recs = await fetchRecommendationTrackUris(seedId, BATCH_LIMIT, market ?? undefined);
  }
  if (recs.length === 0) throw new Error('No recommendations from Spotify');

  for (const u of recs) queuedSeen.add(u);
  trimSeen();

  await playTrackUris(recs, deviceId);

  const tick = async () => {
    try {
      const state = await getRemotePlaybackState();
      const curUri = state?.track?.uri;
      const curId = curUri ? spotifyUriToTrackId(curUri) : null;

      if (!curId) {
        consecutiveNullTicks++;
        if (consecutiveNullTicks >= MAX_NULL_TICKS && lastKnownSeedId) {
          const deviceId = useStore.getState().deviceId;
          const batch = await fetchRecommendationTrackUris(lastKnownSeedId, BATCH_LIMIT, market ?? undefined);
          const novel = batch.filter((u) => !queuedSeen.has(u));
          if (novel.length > 0 && deviceId) {
            for (const u of novel) queuedSeen.add(u);
            trimSeen();
            await playTrackUris(novel, deviceId);
            consecutiveNullTicks = 0;
          }
        }
        consecutiveTickFailures = 0;
        return;
      }

      consecutiveTickFailures = 0;
      consecutiveNullTicks = 0;
      lastKnownSeedId = curId;

      if (state && !state.isPlaying) {
        resumeAttempts++;
        if (resumeAttempts <= 2) {
          try { await remoteResumeActiveDevice(); } catch { /* best effort */ }
        } else {
          const deviceId = useStore.getState().deviceId;
          if (deviceId && lastKnownSeedId) {
            const batch = await fetchRecommendationTrackUris(lastKnownSeedId, BATCH_LIMIT, market ?? undefined);
            const novel = batch.filter((u) => !queuedSeen.has(u));
            if (novel.length > 0) {
              for (const u of novel) queuedSeen.add(u);
              trimSeen();
              await playTrackUris(novel, deviceId);
              resumeAttempts = 0;
            }
          }
        }
      } else if (state?.isPlaying) {
        resumeAttempts = 0;
      }

      const batch = await fetchRecommendationTrackUris(curId, BATCH_LIMIT, market ?? undefined);
      let novel = batch.filter((u) => u !== curUri && !queuedSeen.has(u));
      if (novel.length === 0 && batch.length > 0) {
        novel = batch.filter((u) => u !== curUri);
      }
      let added = 0;
      for (const u of novel) {
        if (added >= ADD_PER_TICK) break;
        try {
          await addTrackToQueue(u);
          queuedSeen.add(u);
          added++;
        } catch {
          /* rate limit or transient */
        }
      }
      trimSeen();
    } catch {
      consecutiveTickFailures++;
      if (consecutiveTickFailures >= 5) {
        useStore.getState().addToast('Recommendations queue is having trouble', 'warning');
        consecutiveTickFailures = 0;
      }
    }
  };

  void tick();

  refillTimer = setInterval(() => {
    void tick();
  }, REFILL_INTERVAL_MS);
}
