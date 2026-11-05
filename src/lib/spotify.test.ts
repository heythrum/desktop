import { describe, expect, it } from 'vitest';
import { parseSpotifyCSV, parseSpotifyUrl } from './spotify';

const id = '37i9dQZF1DXcBWIGoYBM5M';

describe('Spotify link validation', () => {
  it.each(['track', 'album', 'playlist'] as const)('accepts an official %s link and rebuilds the embed URL', (type) => {
    expect(parseSpotifyUrl(`https://open.spotify.com/intl-fr/${type}/${id}?si=tracking`)).toEqual({ type, id, embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=thrum&theme=0` });
  });
  it.each([
    `https://evil.com/playlist/${id}`,
    `https://open.spotify.com.evil.com/playlist/${id}`,
    `http://open.spotify.com/playlist/${id}`,
    `https://user@open.spotify.com/playlist/${id}`,
    `https://open.spotify.com:999/playlist/${id}`,
    `https://open.spotify.com/embed/playlist/${id}`,
    'https://open.spotify.com/playlist/short',
    'javascript:alert(1)',
  ])('rejects unsupported or unsafe link %s', (input) => expect(parseSpotifyUrl(input)).toBeNull());
});

describe('Spotify CSV parsing', () => {
  it('parses an Exportify file with BOM, CRLF and Spotify URIs', () => {
    expect(parseSpotifyCSV(`\uFEFFTrack URI,Track Name,Artist Name(s),Album Name\r\nspotify:track:${id},Song,Artist,Album\r\n`)).toEqual([{ title: 'Song', artist: 'Artist', spotifyUrl: `https://open.spotify.com/track/${id}` }]);
  });
  it('supports quoted commas, doubled quotes and embedded newlines', () => {
    expect(parseSpotifyCSV('Track Name,Artist Name(s),Album Name\n"Hello, world","Artist ""One""","A\nB"\n"Multi\nline",Other,Album')).toEqual([{ title: 'Hello, world', artist: 'Artist "One"' }, { title: 'Multi line', artist: 'Other' }]);
  });
  it('deduplicates titles and skips incomplete rows', () => {
    expect(parseSpotifyCSV('Track Name,Artist Name(s)\nSong,Artist\nsong,artist\n,Someone\nOther,Else')).toEqual([{ title: 'Song', artist: 'Artist' }, { title: 'Other', artist: 'Else' }]);
  });
  it('never preserves an arbitrary imported URL', () => {
    expect(parseSpotifyCSV('Track Name,Artist Name(s),Track URI\nSong,Artist,javascript:alert(1)')).toEqual([{ title: 'Song', artist: 'Artist' }]);
  });
  it('rejects wrong schemas and malformed quoting', () => {
    expect(() => parseSpotifyCSV('Title\nSong')).toThrow('Colonnes');
    expect(() => parseSpotifyCSV('Track Name,Artist Name(s)\n"Song,Artist')).toThrow('fermé');
    expect(() => parseSpotifyCSV('Track Name,Artist Name(s)\n"Song"oops,Artist')).toThrow('guillemets');
    expect(() => parseSpotifyCSV('Track Name,Artist Name(s)\nSong,Artist,Unexpected')).toThrow('colonnes');
  });
  it('enforces size and title-count limits before search work', () => {
    expect(() => parseSpotifyCSV('😀'.repeat(1_300_000))).toThrow('5 Mo');
    expect(() => parseSpotifyCSV('Track Name,Artist Name(s)\n' + Array.from({ length: 501 }, (_, index) => `${index},Artist`).join('\n'))).toThrow('500');
  });
});
