import { SEED_PLAYLISTS, SEED_TRACKS } from './catalog';
import type { LibraryState, Playlist, Track } from './types';

export const STORAGE_KEY = 'thrum.library.v1';
const ID = /^[a-zA-Z0-9_-]{11}$/;
const MAX_ITEMS = 5000;
const MAX_BACKUP_BYTES = 5_000_000;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function makeId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `thrum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createInitialState(): LibraryState {
  return {
    version: 1,
    tracks: SEED_TRACKS.map((track) => ({ ...track })),
    favorites: [],
    playlists: SEED_PLAYLISTS.map((playlist) => ({ ...playlist, trackIds: [...playlist.trackIds] })),
    recent: [],
    queue: [],
    currentTrackId: null,
    volume: 70,
    repeat: 'off',
    shuffle: false,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, fallback: string, length: number): string {
  return typeof value === 'string' ? value.trim().slice(0, length) || fallback : fallback;
}

function readTrack(value: unknown): Track | null {
  if (!record(value) || typeof value.id !== 'string' || !ID.test(value.id)) return null;
  // The thumbnail URL is derived rather than trusted from imported JSON.
  const track: Track = {
    id: value.id,
    title: cleanText(value.title, 'Titre sans nom', 300),
    artist: cleanText(value.artist, 'YouTube', 200),
    thumbnail: `https://i.ytimg.com/vi/${value.id}/hqdefault.jpg`,
  };
  if (typeof value.duration === 'string' && /^\d{1,3}:\d{2}(?::\d{2})?$/.test(value.duration)) {
    track.duration = value.duration;
  }
  return track;
}

function ids(value: unknown, known: Set<string>, limit = MAX_ITEMS): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && known.has(id)))].slice(0, limit)
    : [];
}

/** Validate and normalize a v1 backup. Throws for incompatible root schemas. */
export function normalizeLibrary(value: unknown): LibraryState {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.tracks)) {
    throw new Error('Cette sauvegarde Thrum est invalide ou sa version n’est pas compatible.');
  }
  if (value.tracks.length > MAX_ITEMS || (Array.isArray(value.playlists) && value.playlists.length > 200)) {
    throw new Error('Cette sauvegarde dépasse la limite de 5 000 titres ou 200 playlists.');
  }
  const tracks = [...new Map(value.tracks.map(readTrack).filter((t): t is Track => t !== null).map((t) => [t.id, t])).values()];
  const known = new Set(tracks.map((track) => track.id));
  const playlistIds = new Set<string>();
  const playlists: Playlist[] = [];
  if (Array.isArray(value.playlists)) {
    for (const item of value.playlists) {
      if (!record(item) || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || playlistIds.has(item.id)) continue;
      playlistIds.add(item.id);
      playlists.push({
        id: item.id,
        name: cleanText(item.name, 'Ma playlist', 80),
        trackIds: ids(item.trackIds, known),
        createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? Math.max(0, item.createdAt) : 0,
      });
    }
  }
  return {
    version: 1,
    tracks,
    favorites: ids(value.favorites, known),
    playlists,
    recent: ids(value.recent, known, 100),
    queue: ids(value.queue, known, 500),
    currentTrackId: typeof value.currentTrackId === 'string' && known.has(value.currentTrackId) ? value.currentTrackId : null,
    volume: typeof value.volume === 'number' && Number.isFinite(value.volume) ? Math.max(0, Math.min(100, Math.round(value.volume))) : 70,
    repeat: value.repeat === 'one' || value.repeat === 'all' ? value.repeat : 'off',
    shuffle: value.shuffle === true,
  };
}

export function parseLibraryBackup(json: string): LibraryState {
  if (json.length > MAX_BACKUP_BYTES) throw new Error('La sauvegarde doit faire moins de 5 Mo.');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Ce fichier n’est pas un fichier JSON valide.'); }
  return normalizeLibrary(parsed);
}

export function exportLibrary(state: LibraryState): string {
  return JSON.stringify(normalizeLibrary(state), null, 2);
}

/** Storage restrictions/corruption never prevent the app from opening. */
export function loadLibrary(storage?: StorageLike): LibraryState {
  try {
    const source = storage ?? globalThis.localStorage;
    const json = source.getItem(STORAGE_KEY);
    return json ? parseLibraryBackup(json) : createInitialState();
  } catch { return createInitialState(); }
}

/** Returns false when browser storage is unavailable/full. The UI can notify. */
export function saveLibrary(state: LibraryState, storage?: StorageLike): boolean {
  try {
    (storage ?? globalThis.localStorage).setItem(STORAGE_KEY, exportLibrary(state));
    return true;
  } catch { return false; }
}
