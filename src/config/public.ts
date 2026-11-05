/** Public project identifiers only. RLS and authenticated sessions protect user data.
 * Never place service_role, sb_secret_ or Cloudflare tokens in this file.
 */
export const PUBLIC_SUPABASE_CONFIG = {
  url: 'https://ullogxbrgwkvgqqsotww.supabase.co',
  publishableKey: 'sb_publishable_NYxwt9-c8GjZwMAXRuw-rQ_IIKa1qIu',
} as const;
