import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVideoMetadata, parseYouTubeId, searchYouTube } from './youtube';

afterEach(() => vi.unstubAllGlobals());

describe('YouTube URL parsing', () => {
  it.each([
    '4NRXx6U8ABQ',
    'https://youtu.be/4NRXx6U8ABQ?t=10',
    'https://www.youtube.com/watch?v=4NRXx6U8ABQ&list=example',
    'youtube.com/shorts/4NRXx6U8ABQ',
    'https://music.youtube.com/watch?v=4NRXx6U8ABQ',
    'https://www.youtube-nocookie.com/embed/4NRXx6U8ABQ',
    'https://www.youtube.com/live/4NRXx6U8ABQ',
  ])('extracts a valid video ID from %s', (input) => expect(parseYouTubeId(input)).toBe('4NRXx6U8ABQ'));

  it.each(['', 'garbage', 'https://evil.com/watch?v=4NRXx6U8ABQ', 'https://youtube.com.evil.com/watch?v=4NRXx6U8ABQ', 'https://youtube.com@evil.com/watch?v=4NRXx6U8ABQ', 'javascript:alert(1)', 'https://youtube.com/watch?v=../../hello', 'https://youtube.com/playlist?list=hello'])('rejects unsafe or unsupported input %s', (input) => expect(parseYouTubeId(input)).toBeNull());
});

describe('YouTube search adapter', () => {
  it('uses the hosted search endpoint without a key and normalizes results', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: '4NRXx6U8ABQ', title: 'One &amp; Two', artist: 'Artist', thumbnail: 'https://evil.com/x' }, { id: 'bad' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const tracks = await searchYouTube('the weeknd');
    expect(fetcher.mock.calls[0][0]).toBe('/api/search?q=the+weeknd');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].title).toBe('One & Two');
    expect(tracks[0].thumbnail).toContain('i.ytimg.com');
  });

  it('uses only embeddable video search with a personal API key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: { videoId: '4NRXx6U8ABQ' }, snippet: { title: 'Song', channelTitle: 'Artist' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const tracks = await searchYouTube('song', 'personal-key');
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.hostname).toBe('www.googleapis.com');
    expect(url.searchParams.get('videoEmbeddable')).toBe('true');
    expect(url.searchParams.get('type')).toBe('video');
    expect(url.searchParams.get('key')).toBe('personal-key');
    expect(tracks[0].artist).toBe('Artist');
  });

  it('distinguishes missing configuration from empty results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'not configured' }), { status: 503 })));
    await expect(searchYouTube('song')).rejects.toMatchObject({ code: 'not-configured' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 })));
    await expect(searchYouTube('song')).resolves.toEqual([]);
  });

  it('reports quota, network and key errors without exposing the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 })));
    await expect(searchYouTube('song', 'secret')).rejects.toMatchObject({ code: 'quota' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network details secret')));
    await expect(searchYouTube('song', 'secret')).rejects.toMatchObject({ code: 'network' });
  });

  it('preserves cancellation and does not request invalid input', async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetcher);
    await expect(searchYouTube('x')).rejects.toMatchObject({ code: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(searchYouTube('song')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fetches metadata only for a valid ID', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'A Song', author_name: 'An Artist' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(getVideoMetadata('invalid')).rejects.toMatchObject({ code: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(getVideoMetadata('4NRXx6U8ABQ')).resolves.toMatchObject({ title: 'A Song', artist: 'An Artist' });
  });
});
