import { publicCorsHeaders } from './config';

export type SearchEvent = {
  httpMethod: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters: Record<string, string | undefined> | null;
};

type YoutubeItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: { medium?: { url?: string } };
  };
};

const cache = new Map<string, { expires: number; items: unknown[] }>();
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

function reply(statusCode: number, body: unknown, cached = false, origin?: string) {
  return {
    statusCode,
    headers: { ...headers, ...publicCorsHeaders(origin), 'Cache-Control': cached ? 'public, max-age=300, s-maxage=600' : 'no-store' },
    body: JSON.stringify(body),
  };
}

export async function createSearchResponse(event: SearchEvent, serverKey?: string) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const respond = (status: number, body: unknown, cached = false) => reply(status, body, cached, origin);
  if (event.httpMethod === 'OPTIONS') return { statusCode: publicCorsHeaders(origin)['Access-Control-Allow-Origin'] ? 204 : 403, headers: publicCorsHeaders(origin), body: '' };
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Méthode non autorisée.' });
  const query = event.queryStringParameters?.q?.trim() ?? '';
  if (query.length < 2 || query.length > 100) {
    return respond(400, { error: 'Saisissez une recherche de 2 à 100 caractères.' });
  }
  const safeSearch = event.queryStringParameters?.safeSearch ?? 'none';
  if (!['none', 'strict'].includes(safeSearch)) return respond(400, { error: 'Filtre de recherche invalide.' });
  const key = serverKey?.trim();
  if (!key) return respond(503, { error: 'La recherche nécessite une clé YouTube Data API v3. Ajoutez un lien YouTube ou configurez une clé dans les paramètres.', code: 'API_KEY_MISSING' });

  const cacheKey = `${safeSearch}:${query.toLocaleLowerCase('fr')}`;
  const found = cache.get(cacheKey);
  if (found && found.expires > Date.now()) return respond(200, { items: found.items }, true);

  const params = new URLSearchParams({
    part: 'snippet', type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true',
    maxResults: '20', q: query, key, safeSearch,
  });
  try {
    const upstream = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) {
      if (upstream.status === 403 || upstream.status === 429) return respond(429, { error: 'Quota YouTube atteint ou clé non autorisée. Vérifiez la clé et ses restrictions dans Google Cloud.', code: 'YOUTUBE_QUOTA_OR_ACCESS' });
      if (upstream.status === 400 || upstream.status === 401) return respond(502, { error: 'La clé YouTube du serveur est invalide. Vérifiez la configuration de l’hébergement.' });
      return respond(502, { error: 'YouTube est temporairement indisponible. Réessayez plus tard.' });
    }
    const payload = await upstream.json() as { items?: YoutubeItem[] };
    const items = (payload.items ?? []).flatMap((item) => {
      const id = item.id?.videoId;
      if (!id || !/^[\w-]{11}$/.test(id)) return [];
      return [{
        id, title: item.snippet?.title ?? 'Sans titre', artist: item.snippet?.channelTitle ?? 'YouTube',
        thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      }];
    });
    if (cache.size >= 100) cache.delete(cache.keys().next().value as string);
    cache.set(cacheKey, { expires: Date.now() + 600_000, items });
    return respond(200, { items }, true);
  } catch {
    return respond(502, { error: 'Impossible de contacter YouTube. Vérifiez la connexion puis réessayez.' });
  }
}
