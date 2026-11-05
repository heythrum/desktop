import type { Track } from './types';

const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
export type YouTubeErrorCode = 'invalid' | 'not-configured' | 'quota' | 'network' | 'api';

export class YouTubeError extends Error {
  readonly code: YouTubeErrorCode;
  constructor(message: string, code: YouTubeErrorCode = 'api') {
    super(message);
    this.name = 'YouTubeError';
    this.code = code;
  }
}

/** Accept a bare video ID or a URL on explicitly supported YouTube hosts. */
export function parseYouTubeId(input: string): string | null {
  const clean = input.trim();
  if (VIDEO_ID.test(clean)) return clean;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  let id: string | null = null;
  if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(embed|shorts|live)\//.test(url.pathname)) id = url.pathname.split('/')[2] ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

function text(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  // API titles are HTML entity encoded; decode only text, never inject markup.
  if (typeof document !== 'undefined') {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = value;
    return decoder.value.slice(0, 300);
  }
  return value.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 300);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function getVideoMetadata(id: string, signal?: AbortSignal): Promise<Track> {
  if (!VIDEO_ID.test(id)) throw new YouTubeError('Ce lien YouTube est invalide.', 'invalid');
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, { signal });
    if (!response.ok) throw new YouTubeError('Les informations de cette vidéo sont indisponibles. Elle peut être privée ou supprimée.');
    const data: unknown = await response.json();
    if (!object(data)) throw new YouTubeError('La réponse de YouTube est invalide.');
    return { id, title: text(data.title, 'Vidéo YouTube'), artist: text(data.author_name, 'YouTube'), thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  } catch (error) {
    if (error instanceof YouTubeError || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new YouTubeError('Impossible de joindre YouTube. Vérifie ta connexion, ou ajoute le lien avec un titre personnalisé.', 'network');
  }
}

export function getYouTubeSafeSearch(): 'none' | 'strict' {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('thrum.family-filter') === 'true' ? 'strict' : 'none'; } catch { return 'none'; }
}

/** Server-side key on web deployments; optional personal key for local/desktop. */
export async function searchYouTube(query: string, key?: string, signal?: AbortSignal): Promise<Track[]> {
  const q = query.trim();
  if (q.length < 2) throw new YouTubeError('Saisis au moins deux caractères.', 'invalid');
  if (q.length > 200) throw new YouTubeError('La recherche est limitée à 200 caractères.', 'invalid');
  const direct = Boolean(key?.trim());
  const desktop = typeof window !== 'undefined' && window.location.hostname === '127.0.0.1' && window.location.port === '43197';
  const searchEndpoint = desktop ? 'https://thrum.uno/api/search' : '/api/search';
  const url = direct
    ? `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true', safeSearch: getYouTubeSafeSearch(), maxResults: '24', q, key: key!.trim() })}`
    : `${searchEndpoint}?${new URLSearchParams({ q, safeSearch: getYouTubeSafeSearch() })}`;
  try {
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const payload = object(raw) ? raw : {};
      if (response.status === 503 || payload.code === 'not-configured' || response.status === 404) {
        throw new YouTubeError('La recherche YouTube n’est pas encore configurée. Ajoute une clé API dans les réglages, ou colle un lien YouTube.', 'not-configured');
      }
      if (response.status === 429 || payload.code === 'quota') {
        throw new YouTubeError('Le quota de recherche YouTube est atteint. Réessaie plus tard ou ajoute un lien YouTube.', 'quota');
      }
      if (direct && response.status === 403 && object(payload.error) && Array.isArray(payload.error.errors)) {
        const quota = payload.error.errors.some((item) => object(item) && ['quotaExceeded', 'dailyLimitExceeded'].includes(String(item.reason)));
        if (quota) throw new YouTubeError('Le quota de recherche YouTube est atteint. Tu peux toujours ajouter un lien YouTube.', 'quota');
      }
      throw new YouTubeError(direct ? 'YouTube a refusé la recherche. Vérifie la clé API et ses restrictions dans les réglages.' : 'La recherche est indisponible. Réessaie plus tard ou colle un lien YouTube.');
    }
    if (!object(raw) || !Array.isArray(raw.items)) {
      // Static dev servers return HTML for unknown routes rather than JSON.
      throw new YouTubeError('La recherche YouTube n’est pas configurée. Ajoute une clé API dans les réglages, ou colle un lien YouTube.', 'not-configured');
    }
    const tracks: Track[] = [];
    const seen = new Set<string>();
    for (const item of raw.items) {
      if (!object(item)) continue;
      const id = direct && object(item.id) ? item.id.videoId : item.id;
      const snippet = direct && object(item.snippet) ? item.snippet : item;
      if (typeof id !== 'string' || !VIDEO_ID.test(id) || seen.has(id)) continue;
      seen.add(id);
      tracks.push({ id, title: text(snippet.title, 'Vidéo YouTube'), artist: text(direct ? snippet.channelTitle : snippet.artist, 'YouTube'), thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
    }
    return tracks;
  } catch (error) {
    if (error instanceof YouTubeError || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new YouTubeError('Impossible de joindre le service de recherche. Vérifie ta connexion ; tu peux aussi coller un lien YouTube.', 'network');
  }
}
