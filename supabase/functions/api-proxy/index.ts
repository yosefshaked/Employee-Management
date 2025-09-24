// supabase/functions/api-proxy/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  PostgrestError,
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders } from "../_shared/cors.ts";

const ADMIN_ROLES = new Set(["admin", "owner"]);
const ADD_PLAINTEXT_COLUMN_SQL =
  "ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS dedicated_key_plaintext text;";

type ApiAction =
  | "FETCH_EMPLOYEE_BUNDLE"
  | "CREATE_EMPLOYEE"
  | "UPDATE_EMPLOYEE"
  | "DELETE_EMPLOYEE"
  | "TEST_TENANT_CONNECTION"
  | "SAVE_ORG_DEDICATED_KEY";

type JsonRecord = Record<string, unknown>;

interface ApiRequestBody {
  action?: string;
  orgId?: string;
  payload?: unknown;
}

interface OrgConnection {
  supabaseUrl: string;
  anonKey: string;
  dedicatedKey: string;
}

class ApiError extends Error {
  status: number;
  details?: JsonRecord;

  constructor(message: string, status = 400, details?: JsonRecord) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isAdminRole(role: unknown): boolean {
  if (typeof role !== "string") {
    return false;
  }
  return ADMIN_ROLES.has(role.trim().toLowerCase());
}

async function parseRequestBody(req: Request): Promise<ApiRequestBody> {
  try {
    const json = await req.json();
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new ApiError("invalid_request_body", 400);
    }
    return json as ApiRequestBody;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("invalid_json_payload", 400);
  }
}

function resolveAuthToken(headerValue: string | null): string {
  if (!headerValue) {
    throw new ApiError("missing_auth_token", 401);
  }
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) {
    throw new ApiError("missing_auth_token", 401);
  }
  const token = trimmed.slice(7).trim();
  if (!token) {
    throw new ApiError("missing_auth_token", 401);
  }
  return token;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new ApiError(`missing_env_${name.toLowerCase()}`, 500);
  }
  return value;
}

function createAdminClient(): SupabaseClient {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function fetchOrgMembership(
  supabaseAdmin: SupabaseClient,
  orgId: string,
  userId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("org_memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ApiError("failed_to_verify_membership", 500, { message: error.message });
  }

  if (!data) {
    throw new ApiError("user_not_member", 403);
  }

  return data;
}

async function decryptDedicatedKey(encryptedKey: string | null): Promise<string | null> {
  if (!encryptedKey) {
    return null;
  }
  // Placeholder implementation. Replace with secure decryption using Supabase Secrets.
  return encryptedKey;
}

function resolvePayloadRecord(payload: unknown): JsonRecord {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as JsonRecord;
}

async function fetchOrgConnection(
  supabaseAdmin: SupabaseClient,
  orgId: string,
  payload: unknown,
): Promise<OrgConnection> {
  const payloadRecord = resolvePayloadRecord(payload);
  const [{ data: settings, error: settingsError }, { data: organization, error: orgError }] =
    await Promise.all([
      supabaseAdmin
        .from("org_settings")
        .select("supabase_url, anon_key")
        .eq("org_id", orgId)
        .maybeSingle(),
      supabaseAdmin
        .from("organizations")
        .select("dedicated_key_plaintext, dedicated_key_encrypted, supabase_url, supabase_anon_key")
        .eq("id", orgId)
        .maybeSingle(),
    ]);

  if (settingsError) {
    throw new ApiError("failed_to_load_connection", 500, { message: settingsError.message });
  }

  if (orgError) {
    throw new ApiError("failed_to_load_connection", 500, { message: orgError.message });
  }

  const payloadUrl = normalizeString(
    payloadRecord.supabaseUrl
      || payloadRecord.orgSupabaseUrl
      || payloadRecord.customerSupabaseUrl,
  );
  const payloadAnonKey = normalizeString(payloadRecord.anonKey || payloadRecord.supabaseAnonKey);

  const supabaseUrl = normalizeString(settings?.supabase_url)
    || normalizeString(organization?.supabase_url)
    || payloadUrl;
  const anonKey = normalizeString(settings?.anon_key)
    || normalizeString(organization?.supabase_anon_key)
    || payloadAnonKey;

  if (!supabaseUrl || !anonKey) {
    throw new ApiError("missing_connection_settings", 412);
  }

  const plaintextKey = normalizeString(organization?.dedicated_key_plaintext);
  let dedicatedKey = plaintextKey;
  if (!dedicatedKey && organization?.dedicated_key_encrypted) {
    dedicatedKey = await decryptDedicatedKey(organization.dedicated_key_encrypted);
  }

  if (!dedicatedKey) {
    throw new ApiError("missing_dedicated_key", 428);
  }

  return { supabaseUrl, anonKey, dedicatedKey };
}

function createTenantClient(connection: OrgConnection): SupabaseClient {
  return createClient(connection.supabaseUrl, connection.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${connection.dedicatedKey}` },
    },
  });
}

async function fetchEmployeesBundle(tenantClient: SupabaseClient) {
  const [employeesResult, ratesResult, servicesResult, leaveBalancesResult, settingsResult] =
    await Promise.all([
      tenantClient.from("Employees").select("*").order("name"),
      tenantClient.from("RateHistory").select("*"),
      tenantClient.from("Services").select("*"),
      tenantClient.from("LeaveBalances").select("*"),
      tenantClient
        .from("Settings")
        .select("key, settings_value")
        .in("key", ["leave_policy", "leave_pay_policy"]),
    ]);

  const errors = [
    employeesResult.error,
    ratesResult.error,
    servicesResult.error,
    leaveBalancesResult.error,
    settingsResult.error,
  ].filter(Boolean) as PostgrestError[];

  if (errors.length) {
    throw new ApiError("failed_to_fetch_employees", 500, { message: errors[0]?.message });
  }

  const settingsMap = new Map<string, unknown>();
  for (const entry of settingsResult.data || []) {
    if (!entry || typeof entry.key !== "string") {
      continue;
    }
    settingsMap.set(entry.key, entry.settings_value ?? null);
  }

  return {
    employees: employeesResult.data || [],
    rateHistory: ratesResult.data || [],
    services: servicesResult.data || [],
    leaveBalances: leaveBalancesResult.data || [],
    leavePolicy: settingsMap.get("leave_policy") ?? null,
    leavePayPolicy: settingsMap.get("leave_pay_policy") ?? null,
  };
}

function normalizeEmployeePayload(raw: unknown): JsonRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const payload = { ...(raw as JsonRecord) };
  if (payload.annual_leave_days !== undefined && payload.annual_leave_days !== null) {
    const parsed = Number(payload.annual_leave_days);
    payload.annual_leave_days = Number.isNaN(parsed) ? 0 : parsed;
  }
  return payload;
}

function normalizeRateHistoryEntries(entries: unknown): JsonRecord[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      return { ...(entry as JsonRecord) };
    })
    .filter((entry): entry is JsonRecord => Boolean(entry));
}

function attachEmployeeId(entries: JsonRecord[], employeeId: unknown): JsonRecord[] {
  if (!entries.length) {
    return entries;
  }
  return entries.map((entry) => {
    if (entry.employee_id) {
      return entry;
    }
    return { ...entry, employee_id: employeeId };
  });
}

async function upsertRateHistory(
  client: SupabaseClient,
  entries: JsonRecord[],
  options?: { onConflict?: string },
): Promise<PostgrestError | null> {
  if (!entries.length) {
    return null;
  }
  const config = options?.onConflict ? { onConflict: options.onConflict } : undefined;
  const { error } = await client.from("RateHistory").upsert(entries, config);
  return error ?? null;
}

async function handleCreateEmployee(tenantClient: SupabaseClient, payload: unknown) {
  const record = resolvePayloadRecord(payload);
  const employeePayload = normalizeEmployeePayload(record.employee || record.employeeData);
  if (!employeePayload) {
    throw new ApiError("invalid_employee_payload", 400);
  }

  const rateUpdates = normalizeRateHistoryEntries(record.rate_updates || record.rateUpdates);
  const manualHistory = normalizeRateHistoryEntries(record.manual_rate_history || record.manualRateHistory);

  const insertResult = await tenantClient
    .from("Employees")
    .insert(employeePayload)
    .select("id")
    .single();

  if (insertResult.error) {
    throw new ApiError("failed_to_create_employee", 500, { message: insertResult.error.message });
  }

  const employeeId = insertResult.data?.id;
  if (!employeeId) {
    return { employee_id: null };
  }

  const combinedErrors: PostgrestError[] = [];

  const rateError = await upsertRateHistory(
    tenantClient,
    attachEmployeeId(rateUpdates, employeeId),
    { onConflict: "employee_id,service_id,effective_date" },
  );
  if (rateError) {
    combinedErrors.push(rateError);
  }

  const manualError = await upsertRateHistory(
    tenantClient,
    attachEmployeeId(manualHistory, employeeId),
    { onConflict: "id" },
  );
  if (manualError) {
    combinedErrors.push(manualError);
  }

  if (combinedErrors.length) {
    throw new ApiError("employee_created_but_rates_failed", 500, {
      messages: combinedErrors.map((error) => error.message),
    });
  }

  return { employee_id: employeeId };
}

function resolveEmployeeId(record: JsonRecord): string {
  const candidate = normalizeString(
    record.employee_id || record.employeeId || record.id || record.target_id,
  );
  if (!candidate) {
    throw new ApiError("invalid_employee_id", 400);
  }
  return candidate;
}

async function handleUpdateEmployee(tenantClient: SupabaseClient, payload: unknown) {
  const record = resolvePayloadRecord(payload);
  const employeeId = resolveEmployeeId(record);

  const updates = normalizeEmployeePayload(
    record.updates || record.employee || record.employeeData,
  );
  const rateUpdates = normalizeRateHistoryEntries(record.rate_updates || record.rateUpdates);
  const manualHistory = normalizeRateHistoryEntries(record.manual_rate_history || record.manualRateHistory);

  if (updates) {
    const updateResult = await tenantClient
      .from("Employees")
      .update(updates)
      .eq("id", employeeId);
    if (updateResult.error) {
      throw new ApiError("failed_to_update_employee", 500, { message: updateResult.error.message });
    }
  }

  const combinedErrors: PostgrestError[] = [];
  const rateError = await upsertRateHistory(
    tenantClient,
    attachEmployeeId(rateUpdates, employeeId),
    { onConflict: "employee_id,service_id,effective_date" },
  );
  if (rateError) {
    combinedErrors.push(rateError);
  }

  const manualError = await upsertRateHistory(
    tenantClient,
    attachEmployeeId(manualHistory, employeeId),
    { onConflict: "id" },
  );
  if (manualError) {
    combinedErrors.push(manualError);
  }

  if (combinedErrors.length) {
    throw new ApiError("employee_updated_but_rates_failed", 500, {
      messages: combinedErrors.map((error) => error.message),
    });
  }

  return { updated: true };
}

async function handleDeleteEmployee(tenantClient: SupabaseClient, payload: unknown) {
  const record = resolvePayloadRecord(payload);
  const employeeId = resolveEmployeeId(record);

  const { error } = await tenantClient
    .from("Employees")
    .delete()
    .eq("id", employeeId);

  if (error) {
    throw new ApiError("failed_to_delete_employee", 500, { message: error.message });
  }

  return { deleted: true };
}

async function handleTestConnection(
  tenantClient: SupabaseClient,
  connection: OrgConnection,
  orgId: string,
  userId: string,
) {
  const results: Record<string, unknown> = {
    stage1_jwt_validation: { success: true, userId },
    stage2_fetch_key: {
      success: true,
      orgId,
      supabaseUrl: connection.supabaseUrl,
    },
    stage3_decrypt_key: {
      success: true,
      keyLength: connection.dedicatedKey.length,
    },
  };

  try {
    const { error } = await tenantClient
      .from("Employees")
      .select("id", { count: "exact", head: true });
    if (error) {
      throw error;
    }
    results.stage4_tenant_connection = { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tenant query failed.";
    results.stage4_tenant_connection = { success: false, error: message };
  }

  return results;
}

async function handleSaveDedicatedKey(
  supabaseAdmin: SupabaseClient,
  orgId: string,
  payload: unknown,
) {
  const record = resolvePayloadRecord(payload);
  const dedicatedKey = normalizeString(
    record.service_role_key
      || record.serviceRoleKey
      || record.dedicated_key
      || record.dedicatedKey,
  );

  if (!dedicatedKey) {
    throw new ApiError("missing_service_role_key", 400);
  }

  const savedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("organizations")
    .update({
      dedicated_key_plaintext: dedicatedKey,
      dedicated_key_saved_at: savedAt,
      updated_at: savedAt,
    })
    .eq("id", orgId);

  if (error) {
    if (error.code === "42703") {
      throw new ApiError("missing_plaintext_column", 400, {
        sql: ADD_PLAINTEXT_COLUMN_SQL,
      });
    }
    throw new ApiError("failed_to_store_dedicated_key", 500, { message: error.message });
  }

  return { saved: true, saved_at: savedAt };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await parseRequestBody(req);
    const actionRaw = normalizeString(body.action);
    if (!actionRaw) {
      throw new ApiError("missing_action", 400);
    }
    const action = actionRaw.toUpperCase() as ApiAction;

    const orgId = normalizeString(body.orgId);
    if (!orgId || !isValidUuid(orgId)) {
      throw new ApiError("invalid_org_id", 400);
    }

    const token = resolveAuthToken(req.headers.get("Authorization"));
    const supabaseAdmin = createAdminClient();

    const { data: userResult, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userResult?.user) {
      throw new ApiError("invalid_user_jwt", 401);
    }

    const user = userResult.user;
    const membership = await fetchOrgMembership(supabaseAdmin, orgId, user.id);

    if (
      (action === "CREATE_EMPLOYEE"
        || action === "UPDATE_EMPLOYEE"
        || action === "DELETE_EMPLOYEE"
        || action === "SAVE_ORG_DEDICATED_KEY")
      && !isAdminRole(membership.role)
    ) {
      throw new ApiError("forbidden", 403);
    }

    if (action === "SAVE_ORG_DEDICATED_KEY") {
      const result = await handleSaveDedicatedKey(supabaseAdmin, orgId, body.payload);
      return jsonResponse(200, result);
    }

    const connection = await fetchOrgConnection(supabaseAdmin, orgId, body.payload);
    const tenantClient = createTenantClient(connection);

    switch (action) {
      case "FETCH_EMPLOYEE_BUNDLE": {
        const bundle = await fetchEmployeesBundle(tenantClient);
        return jsonResponse(200, bundle);
      }
      case "CREATE_EMPLOYEE": {
        const created = await handleCreateEmployee(tenantClient, body.payload);
        return jsonResponse(201, created);
      }
      case "UPDATE_EMPLOYEE": {
        const updated = await handleUpdateEmployee(tenantClient, body.payload);
        return jsonResponse(200, updated);
      }
      case "DELETE_EMPLOYEE": {
        const deleted = await handleDeleteEmployee(tenantClient, body.payload);
        return jsonResponse(200, deleted);
      }
      case "TEST_TENANT_CONNECTION": {
        const diagnostics = await handleTestConnection(tenantClient, connection, orgId, user.id);
        return jsonResponse(200, diagnostics);
      }
      default:
        throw new ApiError(`unknown_action_${action}`, 400);
    }
  } catch (error) {
    console.error("[api-proxy] Request failed", error);
    if (error instanceof ApiError) {
      const body = error.details ? { error: error.message, ...error.details } : { error: error.message };
      return jsonResponse(error.status, body);
    }
    const message = error instanceof Error ? error.message : "unexpected_error";
    return jsonResponse(500, { error: message });
  }
});
