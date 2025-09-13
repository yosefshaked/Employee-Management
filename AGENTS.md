# AGENTS

## Code Style
- Use 2 spaces for indentation.
- Prefer ES module syntax.

## Workflow
- Lint any changed JavaScript or JSX files with `npx eslint <files>`.
- Run `npm run build` to ensure the project builds.
- No test script is configured; note this in your testing summary.
- Add any important information learned into this AGENTS.md file.
- Use ProjectDoc/Eng.md to understand the overall project.

## Documentation
- When editing files in `ProjectDoc/`, keep `Eng.md` and `Heb.md` in sync and update their version and last-updated fields.

## Notes
- WorkSessions inserts should omit `id` so the database can generate it; include `id` only when updating existing records.
- Payroll calculations now rely solely on `WorkSessions.rate_used` and `total_payment`; avoid adding external salary adjustments in reports.
- Global employees use `working_days` for daily rate proration and `paid_leave` rows for paid days off.
- Reports date filters accept `DD/MM/YYYY`, `D/M/YY`, or ISO strings and hours KPIs count only hourly employees.

