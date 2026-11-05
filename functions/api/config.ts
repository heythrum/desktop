import { createConfigResponse } from '../../server/config';

interface Context {
  request: Request;
  env: { SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string; SUPABASE_ANON_KEY?: string };
}

export async function onRequest({ request, env }: Context): Promise<Response> {
  const response = await createConfigResponse({ httpMethod: request.method, headers: { origin: request.headers.get('Origin') ?? undefined } }, env);
  return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: response.headers });
}
