import type { Context, HttpRequest } from "@azure/functions";
import jwt from "jsonwebtoken";

export default async function (context: Context, req: HttpRequest) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (!authHeader?.toString().startsWith("Bearer ")) {
    return {
      status: 401,
      headers: { "content-type": "application/json" },
      body: { error: "Missing or invalid Authorization header" }
    };
  }
  const token = authHeader.toString().slice("Bearer ".length);

  // We don't verify here against a secret (SWA cannot know your Supabase JWT secret);
  // we decode ONLY to reflect back basic claims for the FE.
  try {
    const decoded = jwt.decode(token) as any;
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        sub: decoded?.sub,
        email: decoded?.email || decoded?.user_metadata?.email || decoded?.["email"],
        role: decoded?.role,
        aud: decoded?.aud,
        exp: decoded?.exp
      }
    };
  } catch {
    return {
      status: 400,
      headers: { "content-type": "application/json" },
      body: { error: "Invalid JWT" }
    };
  }
}
