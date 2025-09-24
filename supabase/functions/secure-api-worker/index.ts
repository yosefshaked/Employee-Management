// supabase/functions/secure-api-worker/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

serve(async (req) => {
  // 1. Get the authorization header from the incoming request
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization header" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  // 2. Create a Supabase admin client. This is safe because this code
  //    runs inside the customer's own Supabase project.
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 3. The `authHeader` contains the DEDICATED KEY we generated.
  //    We use it to verify that the caller is our application.
  //    For now, we will just check that it exists.
  //    A more robust solution would be to verify its signature.
  if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Invalid token format" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  // 4. Handle the specific action requested by the API Proxy
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (readError) {
    console.error("[secure-api-worker] Failed to read request body", readError);
    return new Response(JSON.stringify({ error: "Failed to read request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!rawBody) {
    return new Response(JSON.stringify({ error: "Request body is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let parsedBody: { action?: string; payload?: unknown };
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (parseError) {
    console.error("[secure-api-worker] Invalid JSON payload", parseError);
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { action, payload } = parsedBody;

  if (!action) {
    return new Response(JSON.stringify({ error: "Missing action in request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let data: any = null;
  let error: any = null;

  switch (action) {
    case "GET_EMPLOYEES":
      ({ data, error } = await supabaseAdmin.from("Employees").select("*"));
      break;
    // We will add more cases here in the future (CREATE_EMPLOYEE, etc.)
    default:
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
});
