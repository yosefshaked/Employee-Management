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

export default async function (context, req) {
  const request = req || context.req;
  const env = context.env ?? globalThis.process?.env ?? {};

  try {
    const supabaseUrl = env.APP_SUPABASE_URL;
    const serviceRoleKey = env.APP_SUPABASE_SERVICE_ROLE;

    if (!supabaseUrl || !serviceRoleKey) {
      context.log.error('Supabase server credentials are missing.');
      jsonResponse(context, 500, { error: 'server_misconfigured' });
      return;
    }

    const orgId = readOrgId(request);

    if (!orgId) {
      context.log.warn('Missing x-org-id header on config request.');
      jsonResponse(context, 400, { error: 'missing_org_id' });
      return;
    }

    const authorization =
      request.headers?.authorization || request.headers?.Authorization || '';

    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      context.log.warn('Missing or invalid bearer token for config request.', {
        orgId,
      });
      jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
      return;
    }

    const token = authorization.slice('Bearer '.length).trim();

    if (!token) {
      context.log.warn('Empty bearer token for config request.', { orgId });
      jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
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
    } catch (authError) {
      context.log.warn('Failed to authenticate token for org request.', {
        orgId,
        message: authError?.message,
      });
      jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
      return;
    }

    if (!userId) {
      jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
      return;
    }

    let membership;
    try {
      const membershipResponse = await supabase
        .from('org_memberships')
        .select('id')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();

      if (membershipResponse.error) {
        throw membershipResponse.error;
      }

      membership = membershipResponse.data;
    } catch (membershipError) {
      context.log.error('Failed to verify membership.', {
        orgId,
        userId: maskForLog(userId),
        message: membershipError?.message,
      });
      jsonResponse(context, 500, { error: 'server_error' });
      return;
    }

    if (!membership) {
      context.log.warn('User is not a member of requested organization.', {
        orgId,
        userId: maskForLog(userId),
      });
      jsonResponse(context, 403, { error: 'forbidden' });
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
        context.log.error('Organization settings missing Supabase credentials.', {
          orgId,
        });
        jsonResponse(context, 500, { error: 'server_misconfigured' });
        return;
      }

      context.log.info('Issued org config.', {
        orgId,
        userId: maskForLog(userId),
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
      context.log.error('Failed to load org config.', {
        orgId,
        userId: maskForLog(userId),
        message: settingsError?.message,
      });
      jsonResponse(context, 500, { error: 'server_error' });
    }
  } catch (error) {
    context.log.error('Unhandled configuration error.', {
      message: error?.message,
    });
    jsonResponse(context, 500, { error: 'server_error' });
  }
}
