import {
  addTrackToQueue,
  fetchRecommendationTrackUrisFromSeeds,
  getProfile,
  getRemotePlaybackState,
  playTrackUris,
  spotifyUriToTrackId,
} from '@/services/spotify-api';

const REFILL_INTERVAL_MS = 18_000;
const BATCH_LIMIT = 18;
const ADD_PER_TICK = 15;
/** Keep modest — over-pruning makes Spotify return the same small set and repeats one track. */
const SEEN_CAP = 120;

let refillTimer: ReturnType<typeof setInterval> | null = null;
const queuedSeen = new Set<string>();

function trimSeen(): void {
  if (queuedSeen.size <= SEEN_CAP) return;
  const drop = queuedSeen.size - SEEN_CAP + 40;
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

function dedupeUris(uris: string[]): string[] {
  const out: string[] = [];
  const set = new Set<string>();
  for (const u of uris) {
    if (!u?.startsWith('spotify:track:') || set.has(u)) continue;
    set.add(u);
    out.push(u);
  }
  return out;
}

/** Seed URIs should be ordered best-first (e.g. live track, then last/first in block). IDs passed to Spotify are capped at 5. */
export async function startRecommendationsContinuation(seedTrackUris: string[], deviceId: string): Promise<void> {
  stopRecommendationsContinuation();

  const uris = dedupeUris(seedTrackUris);
  const seedIds = uris.map((u) => spotifyUriToTrackId(u)).filter((id): id is string => id != null);
  if (seedIds.length === 0) throw new Error('No valid seed track URIs');

  const profile = await getProfile();
  const market = profile.country ?? undefined;

  const fetchBatch = async (forSeedIds: string[]) =>
    fetchRecommendationTrackUrisFromSeeds(forSeedIds.slice(0, 5), BATCH_LIMIT, market ?? undefined);

  let recs = await fetchBatch(seedIds);
  const firstPlaying = uris[0];
  recs = recs.filter((u) => u !== firstPlaying);
  if (recs.length === 0) {
    recs = await fetchBatch(seedIds);
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

      const batch = await fetchBatch([curId, ...seedIds.filter((id) => id !== curId)].slice(0, 5));
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
      /* ignore; next tick */
    }
  };

  void tick();

  refillTimer = setInterval(() => {
    void tick();
  }, REFILL_INTERVAL_MS);
}
