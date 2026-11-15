import { describe, expect, it } from 'vitest';
import { normalizeSpotifyUri } from '../src/spotifyApi';

describe('normalizeSpotifyUri', () => {
  it('keeps Spotify URIs unchanged', () => {
    expect(normalizeSpotifyUri('spotify:playlist:4up5XDc1zk8V3y8T6lltmT')).toBe('spotify:playlist:4up5XDc1zk8V3y8T6lltmT');
  });

  it('converts share links and drops tracking parameters', () => {
    expect(normalizeSpotifyUri(
      'https://open.spotify.com/playlist/4up5XDc1zk8V3y8T6lltmT?si=s1eCkxpTQNm4OeznDBTTnA&dlsi=188a1f6d2be64665',
    )).toBe('spotify:playlist:4up5XDc1zk8V3y8T6lltmT');
  });

  it('handles localized links and other content types', () => {
    expect(normalizeSpotifyUri('https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3'))
      .toBe('spotify:album:1DFixLWuPkv3KT3TnV35m3');
    expect(normalizeSpotifyUri(' https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl '))
      .toBe('spotify:track:11dFghVXANMlKmJXsNCbNl');
  });
});
