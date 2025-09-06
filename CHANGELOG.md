# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
- **Monthly Report Filter Fix:** When filtering a specific employee, it still shows the information about all of the employees.
- **Monthly Report Improvement:** Make it possible to choose 6-months times (For example, to choose between Jan2024-June2024 even though it was a year ago).
- **Hide Other Employees on PayrollSummary.jsx Upon Filtering:** When filtering a specific employee, it does remove the calculations for the other employees, but keeps their names. - ***Last Priority!***
- **Improve Design of Popup in Specific Day:** At the moment looks weird. - ***Last Priority!***
- **Default View in Employees Page:** Have it set to "Active".
- **Fix Top Row of the Table:** Become RTL to fix to the data. - פירוט הרישומים, דף שירותים
- **Instructions:** Easy to understand explanations about functionality of the different, functions that are around the system. Not every function but the more complicated ones.
- **System Version + Update Log Input:** Create a version to the system by known standard, show under the "מנהל מערכת" and input the functions created to the system in the Update Log.
- **Fixing Excel Output and Sorting by Date** - DONE.

## [2025-09-05] - Infrastructure Migration & Feature Enhancement

This release marks a major migration from the initial low-code platform to a self-hosted, robust infrastructure using Supabase and React. It also introduces significant feature enhancements for dynamic rate and service management.

### Added
- **Dynamic Service Management:** Created a new "Services" page allowing administrators to dynamically add, edit, and manage different types of instructor sessions (e.g., "30-min session", "45-min per student").
- **Dynamic Rate Management:** Refactored the employee management system to support dynamic rates. Administrators can now set a unique rate for each instructor for each specific service.
- **Multi-Entry Time Logging:** The "Time Entry" form was completely redesigned to support adding multiple work sessions at once, significantly improving workflow efficiency for administrators.
- **Smart UX for Time Entry:** Implemented an `AlertDialog` to warn users when switching between different employee types (`hourly` vs. `instructor`), preventing accidental data loss while preserving relevant information.
- **Drill-Down in Payroll Report:** The main payroll report in the "Reports" page now features an interactive drill-down view. Users can expand an instructor's summary row to see a detailed breakdown of their work by service type.

### Changed
- **Backend Migration:** Migrated the entire backend logic and database from the Base44 low-code platform to **Supabase** (PostgreSQL).
- **Frontend Refactoring:** Refactored all page and component files to use the Supabase client for all data operations (CRUD), replacing the platform-specific data access methods.
- **Refined Payroll Report UI:** Redesigned the payroll summary table to be cleaner and more context-aware. It now displays relevant columns based on employee type and hides irrelevant data (e.g., hourly rate for instructors).
- **Improved Data Calculation:** Corrected and enhanced data aggregation logic across all reports (`PayrollSummary`, `Reports` page totals) to accurately calculate total hours, including estimated hours for instructor sessions based on service duration.

### Fixed
- **Rate History Logic:** Corrected the database schema and application logic for `RateHistory` to properly store a historical log of rate changes, ensuring retroactive payroll calculations are always accurate. This was achieved by implementing a composite unique constraint and using `upsert` for idempotent operations.
- **Component State Synchronization:** Resolved a critical bug where editing an employee's rates would not be reflected in the time entry form due to stale state. The `EmployeeForm` component was refactored to be self-reliant in fetching the most current rate data.
- **Numerous UI/UX Fixes:**
  - Restored and improved styling for summary cards and badges in the "Reports" page.
  - Corrected table header alignment.
  - Improved layout and spacing in the multi-entry time form for better readability.
  - Resolved all `unique key` prop warnings in React lists.

## [2025-09-05]
- User-facing changelog modal with blurred background
- Sidebar button for changelog
- Calendar popover redesign and bug fixes
- Month navigation restored
- Debug window removed
- Code cleanup and integration fixes
- Connected the project to GitHub

## [2025-09-04]
- Refactored calendar popover logic to use React portal for correct stacking and positioning.
- Fixed popover anchor and z-index issues.
- Improved popover appearance and stacking context.
- Cleaned up popover code and removed duplicate definitions.
- Validated dashboard and calendar integration.
- General UI/UX improvements for dashboard and calendar.
