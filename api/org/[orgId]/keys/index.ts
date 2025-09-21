import type { Context, HttpRequest } from "@azure/functions";
import { createClient } from "@supabase/supabase-js";

// Environment variables configured in the Static Web App (Configuration → Application settings)
const CONTROL_SUPABASE_URL = process.env.CONTROL_SUPABASE_URL!;
const CONTROL_SUPABASE_SERVICE_ROLE = process.env.CONTROL_SUPABASE_SERVICE_ROLE!;

export default async function (context: Context, req: HttpRequest) {
  try {
    // Basic validation
    const orgId = context.bindingData?.orgId as string | undefined;
    if (!orgId) {
      return {
        status: 400,
        headers: { "content-type": "application/json" },
        body: { error: "Missing orgId in route" }
      };
    }

    // Require Authorization header with a Supabase user JWT (we pass it through to the RPC for auditing if needed)
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader?.toString().startsWith("Bearer ")) {
      return {
        status: 401,
        headers: { "content-type": "application/json" },
        body: { error: "Missing or invalid Authorization header" }
      };
    }

    // Service-role client to the CONTROL (organizations) database
    const supabase = createClient(CONTROL_SUPABASE_URL, CONTROL_SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false }
    });

    // Call the security-definer RPC which returns the org public keys
    const { data, error } = await supabase.rpc("get_org_public_keys", { p_org_id: orgId });

    if (error) {
      context.log.error("get_org_public_keys error", error);
      // 404 if org not found, otherwise 500
      const status = (error.code === "P0002" /* no_data_found */) ? 404 : 500;
      return {
        status,
        headers: { "content-type": "application/json" },
        body: { error: error.message }
      };
    }

    // Expecting { supabase_url, anon_key }
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: data
    };
  } catch (e: any) {
    context.log.error(e);
    return {
      status: 500,
      headers: { "content-type": "application/json" },
      body: { error: "Internal error" }
    };
  }
}
