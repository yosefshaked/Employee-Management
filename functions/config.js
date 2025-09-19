export async function onRequest(context) {
  const { env } = context;
  const supabaseUrl = env?.SUPABASE_URL || env?.VITE_SUPABASE_URL;
  const supabaseAnonKey = env?.SUPABASE_ANON_KEY || env?.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: 'Supabase config not found' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response(
    JSON.stringify({
      supabaseUrl,
      supabaseAnonKey,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    },
  );
}
