# Employee Management

This project is a Vite + React application for managing employees, work sessions and payroll records. Supabase provides persistence and authentication.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file with your Supabase credentials:
   ```bash
   VITE_SUPABASE_URL=your-url
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```

## Building for Cloudflare Pages

The production build uses the standard Vite flow:

```bash
npm run build
```

The command outputs static assets to the `dist/` directory. Configure Cloudflare Pages to use `npm run build` as the build command and `dist` as the output directory.

## Health check endpoint

Cloudflare Pages automatically picks up Functions inside the `functions/` directory. The `/healthcheck` function responds with:

```json
{ "ok": true }
```

Use this endpoint for platform health probes after deploying to Pages.
