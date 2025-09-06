# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
- **Monthly Report Filter Fix:** When filtering a specific employee, it still shows the information about all of the employees.
- **Monthly Report Improvement:** Make it possible to choose 6-months times (For example, to choose between Jan2024-June2024 even though it was a year ago).
- **Hide Other Employees on PayrollSummary.jsx Upon Filtering:** When filtering a specific employee, it does remove the calculations for the other employees, but keeps their names. - ***Last Priority!***
- **Design of Popup in Specific Day:** Improve the design of the popup shown when clicking a specific date in the Dashboard. At the moment looks weird. - ***Last Priority!***
- **Default View in Employees Page:** Have it set to "Active".
- **Fix Top Row of the Table:** Become RTL to fix to the data. - פירוט הרישומים, דף שירותים
- **Instructions:** Easy to understand explanations about functionality of the different, functions that are around the system. Not every function but the more complicated ones.
- **System Version + Update Log Input:** Create a version to the system by known standard, show under the "מנהל מערכת" and input the functions created to the system in the Update Log.
- **User-Friendly Startup:** Make it so upon startup, a loading window is opened and then the launcher. At the moment it takes a few seconds to launch.
- **Current Page Signal:** Have a color/signal of sort to tell within which page we are.

## [2025-09-06] - Desktop App & UX Refinements

This release finalizes the MVP by packaging the application for desktop use with Electron and adds several key user experience (UX) and quality-of-life improvements based on user feedback.

### Added
- **Desktop Application (Electron):** The entire React application has been wrapped in Electron to create a standalone desktop app. This includes a custom-designed launcher (`launcher.html`) that provides options to open the app in its own window or in the user's default browser.
- **Calendar Date Picker:** The dashboard calendar now includes a user-friendly dropdown picker for quickly navigating to any specific month and year, alongside the existing arrow and "Today" buttons.

### Changed
- **Launcher Logic:** The Electron main process (`electron.cjs`) was refactored to handle different launch modes (app window vs. external browser) and to correctly manage the application lifecycle.
- **Refined Calendar UI:** The calendar header was redesigned to seamlessly integrate the new month/year pickers without compromising the existing clean layout.
- **Path of "release" Folder** Having the release folder within the project's folder created issues uploading to GitHub.

### Fixed
- **Launcher UI:** Fixed several design issues in the launcher, including button colors, layout, and alignment to ensure a professional and polished first impression.
- **Launcher Stability:** Resolved an issue where the "Restart" function was unreliable by simplifying the launcher's options to "Open App" and "Open in Browser", providing a more robust and predictable user experience.
- **Excel Output and Sorting by Date in File**

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
- **Rate History Logic:** Corrected the database schema and application logic for `RateHistory` to properly store a historical log of rate changes, ensuring retroactive payroll calculations are always accurate. This was achieved by implementing a composite unique constraint (`employee_id`, `service_id`, `effective_date`) and using `upsert` for idempotent operations.
- **Component State Synchronization:** Resolved multiple critical bugs related to stale state, ensuring forms and reports always display the most current data after an update (e.g., employee rates in `EmployeeForm`, recent sessions in `Dashboard`).
- **Data Fetching & Sorting Logic:** Refactored data fetching queries. The Dashboard's "Recent Activity" now sorts by creation time (`created_at`) for true "last-in" view, while other reports sort chronologically by `date` for logical consistency.
- **Cross-Component Unification:** Refactored `RecentActivity` and `RecentEntries` into a single, reusable component, adhering to the DRY principle.
- **Dynamic Color System:** Implemented a centralized color management system (`colorUtils.js`) and integrated it into the database `Services` table, allowing for dynamic, consistent, and user-configurable colors for different service types across all reports.
- **Numerous UI/UX Fixes:**
  - RTL Layout Correction: Fixed CSS for the `Switch` component to ensure correct behavior in a right-to-left layout.
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