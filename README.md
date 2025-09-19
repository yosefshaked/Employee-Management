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

### Cloudflare Pages emulator

To test the Cloudflare runtime locally use Wrangler with `.dev.vars`:

1. Create a `.dev.vars` file alongside your repo root:
   ```bash
   SUPABASE_URL=your-url
   SUPABASE_ANON_KEY=your-anon-key
   ```
2. Build the app:
   ```bash
   npm run build
   ```
3. Start the Pages dev server:
   ```bash
   npx wrangler pages dev dist
   ```

## Building for Cloudflare Pages

The production build uses the standard Vite flow:

```bash
npm run build
```

The command outputs static assets to the `dist/` directory. Configure Cloudflare Pages to use `npm run build` as the build command and `dist` as the output directory.

## Runtime configuration

At runtime the app first calls `/config` (a Cloudflare Pages Function) to load the public Supabase URL and anon key. If the endpoint is not available the app falls back to the Vite environment variables (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`).

Visit `/#/diagnostics` to verify which source (function or env file) is currently in use; secrets are masked except for the last four characters.

If neither source is configured the UI shows a blocking error screen in Hebrew with setup instructions.

## Health check endpoint

Cloudflare Pages automatically picks up Functions inside the `functions/` directory. The `/healthcheck` function responds with:

```json
{ "ok": true }
```

Use this endpoint for platform health probes after deploying to Pages.
