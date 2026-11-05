import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../netlify/functions/search';

const request = (q = 'indie music') => ({ httpMethod: 'GET', queryStringParameters: { q } });

describe('YouTube search function', () => {
  beforeEach(() => {
    vi.stubEnv('YOUTUBE_API_KEY', 'unit-test-key-not-a-credential');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects writes and invalid query lengths without contacting YouTube', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await handler({ ...request(), httpMethod: 'POST' })).statusCode).toBe(405);
    expect((await handler(request('x'))).statusCode).toBe(400);
    expect((await handler(request('a'.repeat(101)))).statusCode).toBe(400);
    expect((await handler({ httpMethod: 'GET', queryStringParameters: null })).statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('explains missing server configuration without leaking values', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '');
    const response = await handler(request());
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).code).toBe('API_KEY_MISSING');
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('returns only embeddable video results and caches repeated queries', async () => {
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify({ items: [
      { id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'A song', channelTitle: 'An artist' } },
      { id: { channelId: 'not-a-video' }, snippet: { title: 'A channel' } },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await handler(request('unique cached search'));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).items).toEqual([{
      id: 'dQw4w9WgXcQ', title: 'A song', artist: 'An artist',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    }]);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.hostname).toBe('www.googleapis.com');
    expect(url.searchParams.get('videoEmbeddable')).toBe('true');
    expect(url.searchParams.get('videoSyndicated')).toBe('true');
    expect(url.searchParams.get('type')).toBe('video');
    expect(result.body).not.toContain('unit-test-key');
    await handler(request('UNIQUE CACHED SEARCH'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([403, 429])('turns upstream %s into an actionable quota/access error', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private upstream content', { status })));
    const response = await handler(request(`quota test ${status}`));
    expect(response.statusCode).toBe(429);
    expect(JSON.parse(response.body).code).toBe('YOUTUBE_QUOTA_OR_ACCESS');
    expect(response.body).not.toContain('private upstream');
  });

  it.each([400, 401, 500])('does not expose upstream errors for status %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private upstream content', { status })));
    const response = await handler(request(`failure test ${status}`));
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('private upstream');
  });

  it('handles network failures without returning internal diagnostic strings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private diagnostic'); }));
    const response = await handler(request('network failure test'));
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('private diagnostic');
  });
});

it('separates family-filter caches and rejects unsupported filters', async () => {
  vi.stubEnv('YOUTUBE_API_KEY', 'test-public-search-key');
  const fetcher=vi.fn(async (_url: string) => new Response(JSON.stringify({items:[]})));
  vi.stubGlobal('fetch',fetcher);
  try {
    await handler(request('separate filter cache example'));
    await handler({...request(),queryStringParameters:{q:'separate filter cache example',safeSearch:'strict'}});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(fetcher.mock.calls[0][0] as string).searchParams.get('safeSearch')).toBe('none');
    expect(new URL(fetcher.mock.calls[1][0] as string).searchParams.get('safeSearch')).toBe('strict');
    expect((await handler({...request(),queryStringParameters:{q:'filter test',safeSearch:'other'}})).statusCode).toBe(400);
  } finally {vi.unstubAllGlobals();vi.unstubAllEnvs();}
});
