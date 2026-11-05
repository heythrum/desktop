import { createSearchResponse } from '../../server/search';

interface Context { request: Request; env: { YOUTUBE_API_KEY?: string } }

export async function onRequest({ request, env }: Context): Promise<Response> {
  const url = new URL(request.url);
  const response = await createSearchResponse({ httpMethod: request.method, headers: { origin: request.headers.get('Origin') ?? undefined }, queryStringParameters: { q: url.searchParams.get('q') ?? undefined } }, env.YOUTUBE_API_KEY);
  return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: response.headers });
}
