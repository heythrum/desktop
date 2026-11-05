import { describe, expect, it } from 'vitest';
import { createInitialState, exportLibrary, loadLibrary, normalizeLibrary, parseLibraryBackup, saveLibrary } from './library';

describe('library storage and backups', () => {
  it('creates independent default collections', () => {
    const a = createInitialState();
    const b = createInitialState();
    a.playlists[0].trackIds.pop();
    a.tracks[0].title = 'changed';
    expect(b.playlists[0].trackIds).toHaveLength(4);
    expect(b.tracks[0].title).toBe('Blinding Lights');
  });

  it('roundtrips a user library without losing playlists and settings', () => {
    const state = createInitialState();
    state.favorites = [state.tracks[2].id];
    state.queue = [state.tracks[0].id, state.tracks[2].id];
    state.currentTrackId = state.tracks[2].id;
    state.volume = 43;
    state.repeat = 'all';
    state.shuffle = true;
    expect(parseLibraryBackup(exportLibrary(state))).toEqual(state);
  });

  it('deduplicates, repairs references, clamps settings and distrusts thumbnail URLs', () => {
    const initial = createInitialState();
    const id = initial.tracks[0].id;
    const result = normalizeLibrary({
      ...initial,
      tracks: [{ ...initial.tracks[0], thumbnail: 'javascript:alert(1)' }, initial.tracks[0], { id: 'invalid' }],
      favorites: [id, id, 'missing'],
      playlists: [{ id: 'safe', name: '  Evening  ', trackIds: [id, 'missing', id], createdAt: 0 }, { id: 'safe', name: 'duplicate' }],
      queue: [id, 'missing'], volume: 500, repeat: 'anything', currentTrackId: 'missing',
    });
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].thumbnail).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    expect(result.favorites).toEqual([id]);
    expect(result.playlists).toEqual([{ id: 'safe', name: 'Evening', trackIds: [id], createdAt: 0 }]);
    expect(result.queue).toEqual([id]);
    expect(result.volume).toBe(100);
    expect(result.repeat).toBe('off');
    expect(result.currentTrackId).toBeNull();
  });

  it('rejects malformed, unsupported and oversized backups', () => {
    expect(() => parseLibraryBackup('{oops')).toThrow('JSON');
    expect(() => parseLibraryBackup('{"version":2,"tracks":[]}')).toThrow('version');
    expect(() => parseLibraryBackup(' '.repeat(5_000_001))).toThrow('5 Mo');
    expect(() => normalizeLibrary({ version: 1, tracks: Array.from({ length: 5001 }) })).toThrow('5 000');
  });

  it('survives corrupt and unavailable browser storage', () => {
    const broken = { getItem: () => '{bad', setItem: () => { throw new Error('Quota exceeded'); } };
    expect(loadLibrary(broken)).toEqual(createInitialState());
    expect(saveLibrary(createInitialState(), broken)).toBe(false);
  });

  it('stores a normalized state and reads it back', () => {
    let value: string | null = null;
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    expect(saveLibrary(createInitialState(), storage)).toBe(true);
    expect(loadLibrary(storage)).toEqual(createInitialState());
  });
});
