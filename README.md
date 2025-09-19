# Employee Management

This project is a Vite + React application for managing employees, work sessions and payroll records. Supabase provides persistence and authentication.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env.development` file with your Supabase credentials:
   ```bash
   VITE_SUPABASE_URL=your-url
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
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
       "SUPABASE_URL": "your-url",
       "SUPABASE_ANON_KEY": "your-anon-key"
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

At runtime the app first calls `/api/config` (an Azure Function) to load the public Supabase URL and anon key. If the endpoint is not available the app falls back to the Vite environment variables (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`). For backwards compatibility the loader also checks `/config` if the Azure endpoint is missing.

Visit `/#/diagnostics` to verify which source (function or env file) is currently in use; secrets are masked except for the last four characters.

If neither source is configured the UI shows a blocking error screen in Hebrew with setup instructions.

## Health check endpoint

Azure Static Web Apps automatically deploys Azure Functions inside the `api/` directory. The `/api/healthcheck` function responds with:

```json
{ "ok": true }
```

Use this endpoint for platform health probes after deploying to Azure Static Web Apps.
