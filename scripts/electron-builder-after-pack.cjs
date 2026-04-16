// Reserved for future per-platform post-pack hooks. Radio Sankt no longer needs
// EVS/Widevine signing because Spotify playback is driven via the Web API
// (Spotify Connect remote-control), not the Web Playback SDK.
module.exports = async function afterPack(_context) {
  return undefined;
};
