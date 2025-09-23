/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { readEnv, respond } from '../_shared/context.js';
import {
  normalizeString,
  resolveEncryptionSecret,
  deriveEncryptionKey,
  decryptDedicatedKey,
  createTenantClient,
  fetchOrgConnection,
} from '../_shared/org-connections.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRequestBody(req) {
  if (req?.body && typeof req.body === 'object') {
    return req.body;
  }

  const rawBody = typeof req?.body === 'string'
    ? req.body
    : typeof req?.rawBody === 'string'
      ? req.rawBody
      : null;

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return {};
  }
}

function isValidOrgId(value) {
  return UUID_PATTERN.test(value);
}

function isAdminRole(role) {
  if (!role) {
    return false;
  }
  const normalized = String(role).trim().toLowerCase();
  return normalized === 'admin' || normalized === 'owner';
}

async function ensureMembership(supabase, orgId, userId) {
  const { data, error } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return data.role || 'member';
}

async function fetchEmployeesBundle(tenantClient) {
  const [employeesResult, ratesResult, servicesResult, leaveBalancesResult, settingsResult] = await Promise.all([
    tenantClient.from('Employees').select('*').order('name'),
    tenantClient.from('RateHistory').select('*'),
    tenantClient.from('Services').select('*'),
    tenantClient.from('LeaveBalances').select('*'),
    tenantClient
      .from('Settings')
      .select('key, settings_value')
      .in('key', ['leave_policy', 'leave_pay_policy']),
  ]);

  const errors = [
    employeesResult.error,
    ratesResult.error,
    servicesResult.error,
    leaveBalancesResult.error,
    settingsResult.error,
  ].filter(Boolean);

  if (errors.length) {
    const [firstError] = errors;
    return { error: firstError || new Error('unknown_error') };
  }

  const settingsMap = new Map();
  for (const entry of settingsResult.data || []) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    settingsMap.set(entry.key, entry.settings_value ?? null);
  }

  return {
    employees: employeesResult.data || [],
    rateHistory: ratesResult.data || [],
    services: servicesResult.data || [],
    leaveBalances: leaveBalancesResult.data || [],
    leavePolicy: settingsMap.get('leave_policy') ?? null,
    leavePayPolicy: settingsMap.get('leave_pay_policy') ?? null,
  };
}

function normalizeEmployeePayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const payload = { ...raw };
  if (payload.annual_leave_days !== undefined && payload.annual_leave_days !== null) {
    const parsed = Number(payload.annual_leave_days);
    payload.annual_leave_days = Number.isNaN(parsed) ? 0 : parsed;
  }
  return payload;
}

function normalizeRateHistoryEntries(entries, employeeId) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const normalized = { ...entry };
      if (!normalized.employee_id && employeeId) {
        normalized.employee_id = employeeId;
      }
      return normalized;
    })
    .filter(Boolean);
}

async function upsertRateHistory(client, entries, options = {}) {
  if (!entries.length) {
    return null;
  }
  const config = options?.onConflict ? { onConflict: options.onConflict } : undefined;
  const { error } = await client.from('RateHistory').upsert(entries, config);
  return error || null;
}

export default async function (context, req) {
  console.log('[API INIT] /api/employees handler invoked');

  try {
    console.log('[API STAGE 1] Validating JWT...');
    const authorization = resolveBearerAuthorization(req);
    if (!authorization?.token) {
      context.log?.warn?.('employees missing bearer token');
      return respond(context, 401, { message: 'missing bearer' });
    }

    const env = readEnv(context);
    const adminConfig = readSupabaseAdminConfig(env);
    const { supabaseUrl, serviceRoleKey } = adminConfig;

    if (!supabaseUrl || !serviceRoleKey) {
      context.log?.error?.('employees missing Supabase admin credentials');
      return respond(context, 500, { message: 'server_misconfigured' });
    }

    const supabase = createSupabaseAdminClient(adminConfig);

    let authResult;
    try {
      authResult = await supabase.auth.getUser(authorization.token);
    } catch (error) {
      context.log?.error?.('employees failed to validate token', { message: error?.message });
      return respond(context, 401, { message: 'invalid or expired token' });
    }

    if (authResult.error || !authResult.data?.user?.id) {
      context.log?.warn?.('employees token did not resolve to user');
      return respond(context, 401, { message: 'invalid or expired token' });
    }

    const userId = authResult.data.user.id;
    console.log(`[API STAGE 1] JWT validation successful for user ${userId}.`);

    const method = String(req.method || 'GET').toUpperCase();
    const body = method === 'GET' ? {} : parseRequestBody(req);
    const query = req?.query ?? {};
    const orgCandidate = body.org_id || body.orgId || query.org_id || query.orgId;
    const orgId = normalizeString(orgCandidate);

    if (!orgId || !isValidOrgId(orgId)) {
      return respond(context, 400, { message: 'invalid org id' });
    }

    try {
      const role = await ensureMembership(supabase, orgId, userId);
      if (!role) {
        return respond(context, 403, { message: 'forbidden' });
      }

      if ((method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') && !isAdminRole(role)) {
        return respond(context, 403, { message: 'forbidden' });
      }
    } catch (membershipError) {
      context.log?.error?.('employees failed to verify membership', {
        message: membershipError?.message,
        orgId,
        userId,
      });
      return respond(context, 500, { message: 'failed_to_verify_membership' });
    }

    console.log(`[API STAGE 2] Fetching encrypted dedicated key for org ${orgId}...`);
    const connectionResult = await fetchOrgConnection(supabase, orgId);
    if (connectionResult.error) {
      const message = connectionResult.error.message || 'failed_to_load_connection';
      const status = message === 'missing_connection_settings' ? 412 : message === 'missing_dedicated_key' ? 428 : 500;
      return respond(context, status, { message });
    }
    console.log('[API STAGE 2] Retrieved encrypted key and connection details.');

    const encryptionSecret = resolveEncryptionSecret(env);
    const encryptionKey = deriveEncryptionKey(encryptionSecret);

    if (!encryptionKey) {
      context.log?.error?.('employees missing encryption secret');
      return respond(context, 500, { message: 'encryption_not_configured' });
    }

    console.log('[API STAGE 3] Decrypting dedicated key...');
    // --- Start of new debug block ---
    console.log('[DEBUG] Preparing for decryption...');
    console.log('[DEBUG] Encrypted Key Payload (from DB):', connectionResult.encryptedKey);
    console.log('[DEBUG] Encryption Secret (from env):', encryptionSecret ? `[SECRET PRESENT], Length: ${encryptionSecret.length}` : '[SECRET MISSING]');
    // --- End of new debug block ---

    const dedicatedKey = decryptDedicatedKey(connectionResult.encryptedKey, encryptionKey);
    if (!dedicatedKey) {
      return respond(context, 500, { message: 'failed_to_decrypt_key' });
    }
    console.log(`[API STAGE 3] Dedicated key decrypted successfully (length: ${dedicatedKey.length}).`);

    console.log('[API STAGE 4] Creating tenant Supabase client...');
    let tenantClient;
    try {
      tenantClient = createTenantClient({
        supabaseUrl: connectionResult.supabaseUrl,
        anonKey: connectionResult.anonKey,
        dedicatedKey,
      });
    } catch (clientError) {
      context.log?.error?.('employees failed to create tenant client', { message: clientError?.message });
      return respond(context, 500, { message: 'failed_to_connect_tenant' });
    }
    console.log('[API STAGE 4] Tenant client created.');

    if (method === 'GET') {
      console.log('[API STAGE 5] Executing GET operation against tenant DB...');
      const bundle = await fetchEmployeesBundle(tenantClient);
      if (bundle.error) {
        context.log?.error?.('employees fetch failed', { message: bundle.error.message });
        return respond(context, 500, { message: 'failed_to_fetch_employees' });
      }
      console.log('[API STAGE 5] GET operation completed successfully.');
      return respond(context, 200, { ...bundle });
    }

    if (method === 'POST') {
      console.log('[API STAGE 5] Executing POST operation against tenant DB...');
      const employeePayload = normalizeEmployeePayload(body.employee || body.employeeData);
      if (!employeePayload) {
        return respond(context, 400, { message: 'invalid employee payload' });
      }

      const rateUpdates = normalizeRateHistoryEntries(body.rate_updates || body.rateUpdates, null);
      const manualRateHistory = normalizeRateHistoryEntries(body.manual_rate_history || body.manualRateHistory, null);

      const insertResult = await tenantClient
        .from('Employees')
        .insert(employeePayload)
        .select('id')
        .single();

      if (insertResult.error) {
        context.log?.error?.('employees insert failed', { message: insertResult.error.message });
        return respond(context, 500, { message: 'failed_to_create_employee' });
      }

      const employeeId = insertResult.data?.id;
      const combinedErrors = [];

      const rateInsertError = await upsertRateHistory(
        tenantClient,
        normalizeRateHistoryEntries(rateUpdates, employeeId),
        { onConflict: 'employee_id,service_id,effective_date' },
      );
      if (rateInsertError) {
        combinedErrors.push(rateInsertError);
      }

      const manualError = await upsertRateHistory(
        tenantClient,
        normalizeRateHistoryEntries(manualRateHistory, employeeId),
        { onConflict: 'id' },
      );
      if (manualError) {
        combinedErrors.push(manualError);
      }

      if (combinedErrors.length) {
        context.log?.error?.('employees rate history upsert failed', {
          messages: combinedErrors.map((error) => error.message),
        });
        return respond(context, 500, { message: 'employee_created_but_rates_failed', employee_id: employeeId });
      }

      console.log('[API STAGE 5] POST operation completed successfully.');
      return respond(context, 201, { employee_id: employeeId });
    }

    if (method === 'PATCH' || method === 'PUT') {
      console.log(`[API STAGE 5] Executing ${method} operation against tenant DB...`);
      const employeeIdCandidate = context.bindingData?.employeeId || body.employee_id || body.employeeId;
      const employeeId = normalizeString(employeeIdCandidate);
      if (!employeeId || !isValidOrgId(employeeId)) {
        const numericId = Number(employeeIdCandidate);
        const acceptNumeric = !Number.isNaN(numericId) && numericId > 0;
        if (!acceptNumeric) {
          return respond(context, 400, { message: 'invalid employee id' });
        }
      }

      const updates = normalizeEmployeePayload(body.updates || body.employee || body.employeeData);
      const rateUpdates = normalizeRateHistoryEntries(body.rate_updates || body.rateUpdates, employeeId);
      const manualRateHistory = normalizeRateHistoryEntries(body.manual_rate_history || body.manualRateHistory, employeeId);

      if (updates) {
        const updateResult = await tenantClient
          .from('Employees')
          .update(updates)
          .eq('id', employeeId);

        if (updateResult.error) {
          context.log?.error?.('employees update failed', { message: updateResult.error.message });
          return respond(context, 500, { message: 'failed_to_update_employee' });
        }
      }

      const combinedErrors = [];

      const rateUpsertError = await upsertRateHistory(
        tenantClient,
        rateUpdates,
        { onConflict: 'employee_id,service_id,effective_date' },
      );
      if (rateUpsertError) {
        combinedErrors.push(rateUpsertError);
      }

      const manualUpsertError = await upsertRateHistory(
        tenantClient,
        manualRateHistory,
        { onConflict: 'id' },
      );
      if (manualUpsertError) {
        combinedErrors.push(manualUpsertError);
      }

      if (combinedErrors.length) {
        context.log?.error?.('employees update rate history failed', {
          messages: combinedErrors.map((error) => error.message),
        });
        return respond(context, 500, { message: 'employee_updated_but_rates_failed' });
      }

      console.log(`[API STAGE 5] ${method} operation completed successfully.`);
      return respond(context, 200, { updated: true });
    }

    if (method === 'DELETE') {
      console.log('[API STAGE 5] Executing DELETE operation against tenant DB...');
      const employeeIdCandidate = context.bindingData?.employeeId || body.employee_id || body.employeeId;
      const employeeId = normalizeString(employeeIdCandidate);
      if (!employeeId) {
        return respond(context, 400, { message: 'invalid employee id' });
      }

      const { error } = await tenantClient
        .from('Employees')
        .delete()
        .eq('id', employeeId);

      if (error) {
        context.log?.error?.('employees delete failed', { message: error.message });
        return respond(context, 500, { message: 'failed_to_delete_employee' });
      }

      console.log('[API STAGE 5] DELETE operation completed successfully.');
      return respond(context, 200, { deleted: true });
    }

    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST,PATCH,PUT,DELETE' });
  // WARNING: Exposing error details in production is a security risk. This is a temporary debugging measure.
  } catch (error) {
    console.error('[API CRASH] The function crashed unexpectedly.', error);

    // This is the critical change: we return the actual error details.
    return respond(context, 500, {
      message: 'internal_server_error',
      error_message: error.message,
      error_stack: error.stack,
    });
  }
}
