import { createConfigResponse } from '../server/config';
import { createSearchResponse } from '../server/search';
import { PUBLIC_SUPABASE_CONFIG } from '../src/config/public';

export interface WorkerEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  YOUTUBE_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
}

type ApiResult = { statusCode: number; body: string; headers: Record<string, string> };
function apiResponse(response: ApiResult): Response {
  return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: response.headers });
}

export default {
  async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    const url = new URL(request.url);
    const headers = { origin: request.headers.get('Origin') ?? undefined };
    if (url.pathname === '/api/config') {
      const overrides = environment.SUPABASE_URL !== undefined || environment.SUPABASE_PUBLISHABLE_KEY !== undefined || environment.SUPABASE_ANON_KEY !== undefined;
      const settings = overrides ? {
        SUPABASE_URL: environment.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: environment.SUPABASE_PUBLISHABLE_KEY,
        SUPABASE_ANON_KEY: environment.SUPABASE_ANON_KEY,
      } : { SUPABASE_URL: PUBLIC_SUPABASE_CONFIG.url, SUPABASE_PUBLISHABLE_KEY: PUBLIC_SUPABASE_CONFIG.publishableKey };
      return apiResponse(await createConfigResponse({ httpMethod: request.method, headers }, settings));
    }
    if (url.pathname === '/api/search') {
      return apiResponse(await createSearchResponse({ httpMethod: request.method, headers, queryStringParameters: { q: url.searchParams.get('q') ?? undefined, safeSearch: url.searchParams.get('safeSearch') ?? undefined } }, environment.YOUTUBE_API_KEY));
    }
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'API introuvable.' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    return environment.ASSETS.fetch(request);
  },
};
