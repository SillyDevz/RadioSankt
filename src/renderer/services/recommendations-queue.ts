import {
  addTrackToQueue,
  fetchRecommendationTrackUris,
  getProfile,
  getRemotePlaybackState,
  playTrackUris,
  spotifyUriToTrackId,
} from '@/services/spotify-api';

const REFILL_INTERVAL_MS = 45_000;
const BATCH_LIMIT = 18;
const ADD_PER_TICK = 10;
const SEEN_CAP = 400;

let refillTimer: ReturnType<typeof setInterval> | null = null;
const queuedSeen = new Set<string>();

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
      if (!curId) return;

      const batch = await fetchRecommendationTrackUris(curId, BATCH_LIMIT, market ?? undefined);
      const novel = batch.filter((u) => u !== curUri && !queuedSeen.has(u));
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
      /* ignore; next tick */
    }
  };

  refillTimer = setInterval(() => {
    void tick();
  }, REFILL_INTERVAL_MS);
}
