// supabase/functions/api-proxy/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders } from "../_shared/cors.ts";

// Helper function to decrypt the key (we will need to implement this)
// For now, it's a placeholder.
async function decryptDedicatedKey(encryptedKey: string): Promise<string | null> {
  // In a real implementation, we would use Deno's crypto libraries
  // and a secret stored in Supabase Secrets.
  // For now, we will assume a simple (and insecure) placeholder logic.
  // This MUST be replaced with real decryption later.
  return encryptedKey; // Placeholder!
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, payload, orgId } = await req.json();
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      throw new Error("Missing auth token");
    }

    // 1. Authenticate the user against the Control DB
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) {
      throw new Error("Invalid user JWT");
    }

    // 2. Verify user has access to the organization
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("org_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .single();
    
    if (membershipError || !membership) {
      throw new Error("User not a member of this organization");
    }
    
    // 3. Fetch the customer's credentials
    const { data: orgData, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("supabase_url, dedicated_key_encrypted, supabase_anon_key")
      .eq("id", orgId)
      .single();

    if (orgError || !orgData) {
      throw new Error("Could not find organization credentials");
    }
    
    // 4. Decrypt the dedicated key
    const dedicatedKey = await decryptDedicatedKey(orgData.dedicated_key_encrypted);
    if (!dedicatedKey) {
      throw new Error("Failed to decrypt dedicated key");
    }

    // 5. Create the temporary tenant client
    const tenantClient = createClient(orgData.supabase_url, orgData.supabase_anon_key, {
      global: { headers: { Authorization: `Bearer ${dedicatedKey}` } },
    });

    // 6. Perform the requested action on the customer's DB
    let data, error;
    switch (action) {
      case "GET_EMPLOYEES":
        ({ data, error } = await tenantClient.from("Employees").select("*"));
        break;
      case "CREATE_EMPLOYEE":
        ({ data, error } = await tenantClient.from("Employees").insert(payload).select());
        break;
      // Add more actions here in the future
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    if (error) {
      throw error;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
