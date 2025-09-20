/* eslint-env node */
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

function normalizePolicyLinks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'string') return item.trim();
      if (typeof item.url === 'string') return item.url.trim();
      if (typeof item.href === 'string') return item.href.trim();
      return '';
    })
    .filter(Boolean);
}

function sanitizeLegalSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return Object.entries(raw).reduce((acc, [key, value]) => {
    if (value === null) {
      acc[key] = null;
      return acc;
    }
    if (typeof value === 'string') {
      acc[key] = value.trim();
      return acc;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      acc[key] = value;
    }
    return acc;
  }, {});
}

export default async function (context, req) {
  const env = context.env ?? globalThis.process?.env ?? {};
  const supabaseUrl = env.APP_SUPABASE_URL;
  const serviceRoleKey = env.APP_SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceRoleKey) {
    context.log.error('Supabase metadata credentials are missing.');
    jsonResponse(context, 500, { error: 'server_misconfigured' });
    return;
  }

  if (req.method !== 'POST') {
    jsonResponse(
      context,
      405,
      { error: 'method_not_allowed' },
      { Allow: 'POST' },
    );
    return;
  }

  const authorization = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
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
    context.log.warn('Failed to authenticate token for org creation.', {
      message: authError?.message,
    });
    jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
    return;
  }

  if (!userId) {
    jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
    return;
  }

  const body = req.body || {};
  const trimmedName = typeof body.name === 'string' ? body.name.trim() : '';

  if (!trimmedName) {
    jsonResponse(context, 400, { error: 'missing_name', message: 'יש להזין שם ארגון.' });
    return;
  }

  const incomingSupabaseUrl = typeof body.supabaseUrl === 'string' ? body.supabaseUrl.trim() : '';
  const incomingAnonKey = typeof body.supabaseAnonKey === 'string' ? body.supabaseAnonKey.trim() : '';
  const policyLinks = normalizePolicyLinks(body.policyLinks);
  const legalSettings = sanitizeLegalSettings(body.legalSettings);
  const now = new Date().toISOString();

  try {
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: trimmedName,
        supabase_url: incomingSupabaseUrl || null,
        supabase_anon_key: incomingAnonKey || null,
        policy_links: policyLinks,
        legal_settings: legalSettings,
        created_by: userId,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (orgError) {
      throw orgError;
    }

    const { error: membershipError } = await supabase
      .from('org_memberships')
      .insert({
        org_id: orgData.id,
        user_id: userId,
        role: 'admin',
        created_at: now,
      });

    if (membershipError && membershipError.code !== '23505') {
      throw membershipError;
    }

    if (incomingSupabaseUrl && incomingAnonKey) {
      const { error: settingsError } = await supabase
        .from('org_settings')
        .upsert({
          org_id: orgData.id,
          supabase_url: incomingSupabaseUrl,
          anon_key: incomingAnonKey,
          updated_at: now,
        }, { onConflict: 'org_id' });

      if (settingsError) {
        throw settingsError;
      }
    }

    context.log.info('Organization created successfully.', {
      orgId: orgData.id,
      userId: maskForLog(userId),
    });

    jsonResponse(context, 201, { id: orgData.id });
  } catch (error) {
    context.log.error('Failed to create organization.', {
      code: error?.code,
      message: error?.message,
      userId: maskForLog(userId),
    });

    if (error?.code === '23505') {
      jsonResponse(context, 409, {
        error: 'duplicate_organization',
        message: 'ארגון עם שם זה כבר קיים.',
      });
      return;
    }

    jsonResponse(context, 500, {
      error: 'server_error',
      message: 'יצירת הארגון נכשלה. נסה שוב מאוחר יותר.',
    });
  }
}
