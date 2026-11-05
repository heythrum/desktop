export interface LyricLine { time: number; text: string }
export interface SavedLyrics { lines: LyricLine[]; offsetSeconds: number; filename: string }
export const LYRICS_STORAGE_KEY = 'thrum.lyrics.v1';
export const MAX_LRC_BYTES = 1024 * 1024;
const MAX_LINES = 5000;
const MAX_STORE_BYTES = 2 * 1024 * 1024;

/** Parse line-synchronised LRC. Positive LRC offsets advance the lyrics. */
export function parseLrc(text: string): LyricLine[] {
  if (new TextEncoder().encode(text).byteLength > MAX_LRC_BYTES) throw new Error('Le fichier LRC doit faire moins de 1 Mo.');
  const offsetMatch = text.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  if (!Number.isFinite(offset) || Math.abs(offset) > 86400) throw new Error('Le décalage du fichier LRC est invalide.');
  const lines: LyricLine[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const timestamps = [...raw.matchAll(/\[(\d{1,4}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    if (!timestamps.length) continue;
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!content) continue;
    for (const stamp of timestamps) {
      const seconds = Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || '0'}`);
      if (seconds > 86400) throw new Error('Un horodatage dépasse la limite de 24 heures.');
      const adjusted = Math.max(0, seconds - offset);
      if (adjusted > 86400) throw new Error('Un horodatage dépasse la limite de 24 heures.');
      lines.push({time: adjusted, text: content.slice(0, 2000)});
      if (lines.length > MAX_LINES) throw new Error('Le fichier contient trop de lignes de paroles (maximum 5 000).');
    }
  }
  if (!lines.length) throw new Error('Aucune parole synchronisée trouvée. Utilisez un fichier LRC avec des repères [mm:ss.xx].');
  return lines.sort((a, b) => a.time - b.time);
}

function validSaved(value: unknown): value is SavedLyrics {
  if (!value || typeof value !== 'object') return false;
  const item = value as SavedLyrics;
  return Array.isArray(item.lines) && item.lines.length > 0 && item.lines.length <= MAX_LINES &&
    item.lines.every((line, index) => line && typeof line.time === 'number' && Number.isFinite(line.time) && line.time >= 0 && line.time <= 86400 &&
      typeof line.text === 'string' && line.text.length > 0 && line.text.length <= 2000 && (index === 0 || line.time >= item.lines[index - 1].time)) &&
    typeof item.offsetSeconds === 'number' && Number.isFinite(item.offsetSeconds) && Math.abs(item.offsetSeconds) <= 30 &&
    typeof item.filename === 'string' && item.filename.length <= 240;
}

function readStore(): Record<string, SavedLyrics> {
  try {
    const raw = localStorage.getItem(LYRICS_STORAGE_KEY);
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_STORE_BYTES) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.tracks !== 'object' || !parsed.tracks || Array.isArray(parsed.tracks)) return {};
    return Object.fromEntries(Object.entries(parsed.tracks).filter((entry): entry is [string, SavedLyrics] => /^[A-Za-z0-9_-]{1,128}$/.test(entry[0]) && validSaved(entry[1])).slice(0, 100));
  } catch { return {}; }
}

export function getSavedLyrics(trackId: string): SavedLyrics | null {
  const tracks = readStore();
  return Object.hasOwn(tracks, trackId) ? tracks[trackId] : null;
}

/** Throws a user-facing message if local storage is unavailable or full. */
export function saveLyrics(trackId: string, value: SavedLyrics | null): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(trackId)) throw new Error('Identifiant du morceau invalide.');
  if (value && !validSaved(value)) throw new Error('Les paroles sont invalides.');
  const tracks = readStore();
  if (value) Object.defineProperty(tracks, trackId, {value, enumerable: true, configurable: true, writable: true});
  else delete tracks[trackId];
  if (Object.keys(tracks).length > 100) throw new Error('La bibliothèque de paroles est pleine (100 morceaux). Retirez quelques fichiers.');
  const raw = JSON.stringify({version: 1, tracks});
  if (new TextEncoder().encode(raw).byteLength > MAX_STORE_BYTES) throw new Error('La bibliothèque de paroles est pleine (2 Mo). Retirez quelques fichiers.');
  try { localStorage.setItem(LYRICS_STORAGE_KEY, raw); }
  catch { throw new Error('Impossible de sauvegarder les paroles : le stockage local est plein ou indisponible.'); }
}

export function activeLyricIndex(lines: LyricLine[], time: number, offsetSeconds = 0): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time + offsetSeconds <= time) index = i;
    else break;
  }
  return index;
}
