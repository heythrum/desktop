import { describe, expect, it } from 'vitest';
import { createPlaylistShareUrl, decodeSharedPlaylist } from './share';
import type { Track } from './types';

const track: Track = { id: '4NRXx6U8ABQ', title: 'Nuit étoilée 🌙 & rêves', artist: 'Björk · 坂本龍一', thumbnail: 'https://untrusted.example/ignored.jpg', duration: '3:10' };
function fragment(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return '#playlist=' + btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('self-contained playlist links', () => {
  it('roundtrips Unicode and reconstructs only trusted metadata', () => {
    const url = createPlaylistShareUrl('Mes découvertes 🎧', [track], 'https://music.example/app');
    expect(url).toMatch(/^https:\/\/music\.example\/#playlist=[A-Za-z0-9_-]+$/);
    expect(decodeSharedPlaylist(new URL(url).hash)).toEqual({ name: 'Mes découvertes 🎧', tracks: [{ id: track.id, title: track.title, artist: track.artist, thumbnail: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg` }] });
  });

  it.each(['http://localhost:5173', 'https://localhost:5173', 'file://', 'null', 'thrum://app', 'https://user:secret@example.com'])('uses the public site for nonshareable origin %s', (origin) => {
    expect(createPlaylistShareUrl('Test', [track], origin)).toMatch(/^https:\/\/thrum\.uno\/#playlist=/);
  });

  it('ignores unrelated fragments', () => {
    expect(decodeSharedPlaylist('')).toBeNull();
    expect(decodeSharedPlaylist('#settings')).toBeNull();
    expect(decodeSharedPlaylist('#playlist-other=anything')).toBeNull();
  });

  it('deduplicates IDs deterministically and ignores imported URLs and extra keys', () => {
    const shared = decodeSharedPlaylist(fragment({ v: 1, n: 'Collection', t: [{ i: track.id, t: 'First', a: 'Artist', thumbnail: 'javascript:alert(1)', __proto__: { unsafe: true } }, { i: track.id, t: 'Second', a: 'Other' }], origin: 'https://evil.com' }));
    expect(shared?.tracks).toHaveLength(1);
    expect(shared?.tracks[0].title).toBe('First');
    expect(shared?.tracks[0].thumbnail).toBe(`https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`);
    const created = createPlaylistShareUrl('Collection', [track, track]);
    expect(decodeSharedPlaylist(new URL(created).hash)?.tracks).toHaveLength(1);
  });

  it('rejects invalid versions, schemas and YouTube IDs rather than creating unsafe tracks', () => {
    expect(() => decodeSharedPlaylist(fragment({ v: 2, n: 'Test', t: [] }))).toThrow('version');
    expect(() => decodeSharedPlaylist(fragment({ v: 1, n: 'Test', t: [{ i: 'javascript:alert(1)', t: 'Title', a: 'Artist' }] }))).toThrow('identifiant');
    expect(() => decodeSharedPlaylist(fragment({ v: 1, n: {}, t: [] }))).toThrow('nom');
    expect(() => decodeSharedPlaylist(fragment({ v: 1, n: 'Test', t: 'unsafe' }))).toThrow('aucun titre');
    expect(() => decodeSharedPlaylist('#playlist=evil%2Fpayload')).toThrow('encodées');
    expect(() => decodeSharedPlaylist('#playlist=a')).toThrow('encodées');
    expect(() => decodeSharedPlaylist('#playlist=____')).toThrow('encodage');
  });

  it('checks text length and empty playlists', () => {
    expect(() => createPlaylistShareUrl('', [track])).toThrow('nom');
    expect(() => createPlaylistShareUrl('a'.repeat(81), [track])).toThrow('80');
    expect(() => createPlaylistShareUrl('Test', [])).toThrow('au moins un titre');
    expect(() => createPlaylistShareUrl('Test', [{ ...track, title: 'a'.repeat(301) }])).toThrow('300');
    expect(() => createPlaylistShareUrl('Test', [{ ...track, artist: 'a'.repeat(201) }])).toThrow('200');
  });

  it('enforces playlist-count and final URL size limits', () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => ({ ...track, id: index.toString().padStart(11, '0') }));
    expect(() => createPlaylistShareUrl('Test', tooMany)).toThrow('50');
    expect(() => decodeSharedPlaylist(fragment({ v: 1, n: 'Test', t: tooMany.map((item) => ({ i: item.id, t: 'Title', a: 'Artist' })) }))).toThrow('50');
    const long = tooMany.slice(0, 50).map((item) => ({ ...item, title: 'é'.repeat(300), artist: 'é'.repeat(200) }));
    expect(() => createPlaylistShareUrl('Test', long)).toThrow('volumineuse');
    expect(() => decodeSharedPlaylist('#playlist=' + 'a'.repeat(24_000))).toThrow('volumineux');
  });
});
