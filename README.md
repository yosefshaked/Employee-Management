# Employee Management

This project is a Vite + React application for managing employees, work sessions and payroll records. Supabase provides persistence and authentication.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `api/local.settings.json` with your Supabase credentials:
   ```json
   {
     "IsEncrypted": false,
     "Values": {
       "APP_SUPABASE_URL": "https://your-project.supabase.co",
       "APP_SUPABASE_ANON_KEY": "public-anon-key",
       "APP_SUPABASE_SERVICE_ROLE": "service-role-key-with-org-access"
     }
   }
   ```
3. Start the Vite dev server:
   ```bash
   npm run dev
   ```
4. In another terminal launch the Azure Static Web Apps emulator so `/api/config` is available:
   ```bash
   swa start http://localhost:5173 --api-location api
   ```

## Building for Azure Static Web Apps

The production build uses the standard Vite flow:

```bash
npm run build
```

The command outputs static assets to the `dist/` directory. Configure Azure Static Web Apps with `app_location: "/"`, `output_location: "dist"`, `api_location: "api"`, and `npm run build` as the build command.

## Runtime configuration

At bootstrap the SPA calls the Azure Function `GET /api/config`. Without credentials the function returns the core Supabase URL and anon key defined by `APP_SUPABASE_URL` and `APP_SUPABASE_ANON_KEY`.

After the user signs in and selects an organization the client issues `GET /api/org/<org-id>/keys` with `Authorization: Bearer <supabase_access_token>`. The API forwards the token to the Control database RPC `public.get_org_public_keys`, which verifies the caller’s membership before returning the organization’s `supabase_url` and `anon_key`. Missing or invalid tokens yield `401`, while users outside the organization receive `403` or `404`.

Visit `/#/diagnostics` in development to review the last configuration request (endpoint, org id, HTTP status, and request scope). Secrets are masked except for the last four characters.

If either `/api/config` or `/api/org/:id/keys` is unreachable or returns non-JSON content the UI shows a blocking error screen in Hebrew with recovery steps.

## Health check endpoint

Azure Static Web Apps automatically deploys Azure Functions inside the `api/` directory. The `/api/healthcheck` function responds with:

```json
{ "ok": true }
```

Use this endpoint for platform health probes after deploying to Azure Static Web Apps.
