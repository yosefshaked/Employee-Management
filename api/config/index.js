import { createClient } from '@supabase/supabase-js';

function jsonResponse(context, status, payload, extraHeaders = {}) {
  context.res = {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function maskForLog(value) {
  if (!value) return '';
  const stringValue = String(value);
  if (stringValue.length <= 6) return '••••';
  return `${stringValue.slice(0, 2)}••••${stringValue.slice(-2)}`;
}

function readOrgId(req) {
  const headers = req.headers || {};
  if (typeof headers.get === 'function') {
    const viaGetter = headers.get('x-org-id');
    if (viaGetter) {
      return String(viaGetter);
    }
  }

  const headerId = headers['x-org-id'] || headers['X-Org-Id'];
  return headerId ? String(headerId) : null;
}

function respondWithBaseConfig(context, supabaseUrl, anonKey) {
  jsonResponse(
    context,
    200,
    {
      supabase_url: supabaseUrl,
      anon_key: anonKey,
    },
    {
      'X-Config-Scope': 'app',
    },
  );
}

export default async function (context, req) {
  const request = req || context.req;
  const env = context.env ?? globalThis.process?.env ?? {};

  const supabaseUrl = env.APP_SUPABASE_URL;
  const anonKey = env.APP_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.APP_SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !anonKey) {
    context.log.error('APP Supabase public credentials are missing.');
    jsonResponse(context, 500, { error: 'חסרה תצורת שרת. פנה למנהל המערכת.' });
    return;
  }

  const orgId = readOrgId(request);
  const authorization = request.headers?.authorization || request.headers?.Authorization || '';
  const isBearer = authorization.startsWith('Bearer ');

  if (!orgId || !isBearer) {
    if (orgId && !isBearer) {
      context.log.warn('Ignoring organization config request without bearer token', {
        orgId,
      });
    }
    respondWithBaseConfig(context, supabaseUrl, anonKey);
    return;
  }

  if (!serviceRoleKey) {
    context.log.error('APP Supabase service role is missing for org config request.');
    jsonResponse(context, 500, { error: 'שגיאת שרת בבדיקת ההרשאות.' });
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    jsonResponse(context, 401, { error: 'פג תוקף ההתחברות. התחבר שוב ונסה מחדש.' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let userId;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    userId = data?.user?.id;
  } catch (error) {
    context.log.warn('Failed to authenticate token for org request', {
      orgId,
      message: error?.message,
    });
    jsonResponse(context, 401, { error: 'פג תוקף ההתחברות. התחבר שוב ונסה מחדש.' });
    return;
  }

  if (!userId) {
    jsonResponse(context, 401, { error: 'פג תוקף ההתחברות. התחבר שוב ונסה מחדש.' });
    return;
  }

  try {
    const { data: membership, error: membershipError } = await supabase
      .from('org_memberships')
      .select('id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership) {
      context.log.warn('User is not a member of requested organization', {
        orgId,
        userId: maskForLog(userId),
      });
      jsonResponse(context, 403, { error: 'אין לך הרשאה לארגון שנבחר.' });
      return;
    }
  } catch (membershipError) {
    context.log.error('Failed to verify membership', {
      orgId,
      userId: maskForLog(userId),
      message: membershipError?.message,
    });
    jsonResponse(context, 500, { error: 'שגיאת שרת בבדיקת ההרשאות.' });
    return;
  }

  try {
    const settingsResponse = await supabase
      .from('org_settings')
      .select('supabase_url, anon_key')
      .eq('org_id', orgId)
      .maybeSingle();

    if (settingsResponse.error) {
      throw settingsResponse.error;
    }

    const settings = settingsResponse.data;
    if (!settings?.supabase_url || !settings?.anon_key) {
      jsonResponse(context, 404, { error: 'הארגון לא הושלם או שחסרים פרטי חיבור.' });
      return;
    }

    context.log.info('Issued org config', {
      orgId,
      supabaseUrl: maskForLog(settings.supabase_url),
      anonKey: maskForLog(settings.anon_key),
    });

    jsonResponse(
      context,
      200,
      {
        supabase_url: settings.supabase_url,
        anon_key: settings.anon_key,
      },
      {
        'X-Config-Scope': 'org',
      },
    );
  } catch (settingsError) {
    context.log.error('Failed to load org config', {
      orgId,
      message: settingsError?.message,
    });
    jsonResponse(context, 500, { error: 'שגיאת שרת בטעינת הגדרות הארגון.' });
  }
}
