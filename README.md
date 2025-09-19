# Employee Management

This project is a Vite + React application for managing employees, work sessions and payroll records. Supabase provides persistence and authentication.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `public/runtime-config.example.json` to `public/runtime-config.json` and update the values with the **app metadata** Supabase URL and anon key.
3. Start the dev server:
   ```bash
   npm run dev
   ```

### Azure Static Web Apps emulator

To test the Azure runtime locally use the Static Web Apps CLI:

1. Install the CLI (once per machine):
   ```bash
   npm install -g @azure/static-web-apps-cli
   ```
2. Create an `api/local.settings.json` file with your Supabase credentials:
   ```json
   {
     "IsEncrypted": false,
     "Values": {
        "APP_SUPABASE_URL": "https://your-project.supabase.co",
        "APP_SUPABASE_SERVICE_ROLE": "service-role-key-with-org-access"
     }
   }
   ```
3. Start the Vite dev server:
   ```bash
   npm run dev
   ```
4. In another terminal launch the emulator:
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

At bootstrap the SPA reads `public/runtime-config.json` (or an injected `window.__EMPLOYEE_MANAGEMENT_PUBLIC_CONFIG__`) to create the **core** Supabase client used for authentication and organization management. After the user signs in and selects an organization the client calls `/api/config` with:

- `Authorization: Bearer <supabase_access_token>`
- `x-org-id: <selected org id>` (may also be provided as a `org_id` query string)

The Azure Function validates membership using the service role (`APP_SUPABASE_SERVICE_ROLE`) and returns the per-organization Supabase `supabase_url` and `anon_key`. Switching organizations re-requests this configuration and rebuilds the runtime client on the fly.

Visit `/#/diagnostics` to verify which configuration source is loaded for the core client. Secrets are masked except for the last four characters.

If `runtime-config.json` is missing the UI shows a blocking error screen in Hebrew with recovery steps.

## Health check endpoint

Azure Static Web Apps automatically deploys Azure Functions inside the `api/` directory. The `/api/healthcheck` function responds with:

```json
{ "ok": true }
```

Use this endpoint for platform health probes after deploying to Azure Static Web Apps.
