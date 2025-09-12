# AGENTS

## Code Style
- Use 2 spaces for indentation.
- Prefer ES module syntax.

## Workflow
- Lint any changed JavaScript or JSX files with `npx eslint <files>`.
- Run `npm run build` to ensure the project builds.
- No test script is configured; note this in your testing summary.
- Add any important information learned into this AGENTS.md file.

## Documentation
- When editing files in `ProjectDoc/`, keep `Eng.md` and `Heb.md` in sync and update their version and last-updated fields.

## Notes
- WorkSessions inserts should omit `id` so the database can generate it; include `id` only when updating existing records.
- Global employees earn base pay only for months where they have at least one work session; include their salary only for months with activity.

- When filtering reports, apply global base salaries only to employees included in the filtered results.

- Prorate global employees' base salaries when they start mid-month using `getProratedBaseSalary`.

