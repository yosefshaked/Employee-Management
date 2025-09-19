import { createClient } from '@supabase/supabase-js';

function jsonResponse(context, status, payload) {
  context.res = {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
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
  const headerId = req.headers?.['x-org-id'] || req.headers?.['X-Org-Id'];
  if (headerId) return String(headerId);
  const query = req.query || {};
  return query.org_id || query.orgId || null;
}

export default async function (context, req) {
  const request = req || context.req;
  const env = context.env ?? globalThis.process?.env ?? {};

  const supabaseUrl = env.APP_SUPABASE_URL;
  const serviceRoleKey = env.APP_SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceRoleKey) {
    context.log.error('APP Supabase environment variables are missing.');
    jsonResponse(context, 500, { error: 'חסרה תצורת שרת. פנה למנהל המערכת.' });
    return;
  }

  const authorization = request.headers?.authorization || request.headers?.Authorization;
  if (!authorization || !authorization.startsWith('Bearer ')) {
    jsonResponse(context, 401, { error: 'פג תוקף ההתחברות. התחבר שוב ונסה מחדש.' });
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    jsonResponse(context, 401, { error: 'פג תוקף ההתחברות. התחבר שוב ונסה מחדש.' });
    return;
  }

  const orgId = readOrgId(request);
  if (!orgId) {
    jsonResponse(context, 400, { error: 'חסר מזהה ארגון בבקשה.' });
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
    const membershipResponse = await supabase
      .from('app_org_memberships')
      .select('id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipResponse.error) {
      throw membershipResponse.error;
    }

    if (!membershipResponse.data) {
      jsonResponse(context, 403, { error: 'אין לך הרשאה לארגון שנבחר.' });
      return;
    }
  } catch (membershipError) {
    context.log.error('Failed to verify membership', {
      orgId,
      userId,
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

    jsonResponse(context, 200, {
      supabase_url: settings.supabase_url,
      anon_key: settings.anon_key,
    });
  } catch (settingsError) {
    context.log.error('Failed to load org config', {
      orgId,
      message: settingsError?.message,
    });
    jsonResponse(context, 500, { error: 'שגיאת שרת בטעינת הגדרות הארגון.' });
  }
}
