/* eslint-env node */

export default async function (context) {
  const env = context.env ?? globalThis.process?.env ?? {};
  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    context.res = {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ error: 'Supabase config not found' }),
    };
    return;
  }

  context.res = {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
    body: JSON.stringify({
      supabaseUrl,
      supabaseAnonKey,
    }),
  };
}
