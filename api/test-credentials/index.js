/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { readSupabaseAdminConfig, createSupabaseAdminClient } from '../_shared/supabase-admin.js';
import { readEnv, respond } from '../_shared/context.js';
import {
  normalizeString,
  resolveEncryptionSecret,
  deriveEncryptionKey,
  decryptDedicatedKey,
  createTenantClient,
  fetchOrgConnection,
} from '../_shared/org-connections.js';

export default async function (context, req) {
  const results = {};
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  let supabaseAdmin;
  try {
    supabaseAdmin = createSupabaseAdminClient(adminConfig);
  } catch (error) {
    results.stage1_jwt_validation = {
      success: false,
      error: error?.message || 'Failed to create Supabase admin client.',
    };
    return respond(context, 500, results);
  }

  let userId;
  try {
    const authorization = resolveBearerAuthorization(req);
    if (!authorization?.token) {
      throw new Error('Missing bearer token in request.');
    }
    const { data, error } = await supabaseAdmin.auth.getUser(authorization.token);
    if (error) {
      throw error;
    }
    userId = data?.user?.id;
    if (!userId) {
      throw new Error('User not found for token.');
    }
    results.stage1_jwt_validation = { success: true, userId };
  } catch (error) {
    results.stage1_jwt_validation = { success: false, error: error?.message || 'JWT validation failed.' };
    return respond(context, 500, results);
  }

  let connectionResult;
  try {
    const query = req?.query ?? {};
    const orgCandidate = query.org_id || query.orgId;
    const orgId = normalizeString(orgCandidate);
    if (!orgId) {
      throw new Error('Missing org_id query parameter.');
    }
    connectionResult = await fetchOrgConnection(supabaseAdmin, orgId);
    if (connectionResult.error) {
      throw connectionResult.error;
    }
    results.stage2_fetch_key = {
      success: true,
      encryptedKey: connectionResult.encryptedKey,
      orgId,
    };
  } catch (error) {
    results.stage2_fetch_key = { success: false, error: error?.message || 'Failed to fetch encrypted key.' };
    return respond(context, 500, results);
  }

  let dedicatedKey;
  try {
    const encryptionSecret = resolveEncryptionSecret(env);
    const normalizedSecret = normalizeString(encryptionSecret);
    const encryptionKey = deriveEncryptionKey(encryptionSecret);
    if (!encryptionKey) {
      throw new Error('Encryption secret is missing or invalid.');
    }
    dedicatedKey = decryptDedicatedKey(results.stage2_fetch_key.encryptedKey, encryptionKey);
    if (!dedicatedKey) {
      throw new Error('Decryption resulted in null key.');
    }
    results.stage3_decrypt_key = {
      success: true,
      keyLength: dedicatedKey.length,
      secretLength: normalizedSecret ? normalizedSecret.length : null,
    };
  } catch (error) {
    results.stage3_decrypt_key = { success: false, error: error?.message || 'Failed to decrypt dedicated key.' };
    return respond(context, 500, results);
  }

  try {
    const tenantClient = createTenantClient({
      supabaseUrl: connectionResult.supabaseUrl,
      anonKey: connectionResult.anonKey,
      dedicatedKey,
    });
    const { error } = await tenantClient
      .from('Employees')
      .select('id', { count: 'exact', head: true });
    if (error) {
      throw error;
    }
    results.stage4_tenant_connection = { success: true };
  } catch (error) {
    results.stage4_tenant_connection = { success: false, error: error?.message || 'Tenant query failed.' };
  }

  return respond(context, 200, results);
}
