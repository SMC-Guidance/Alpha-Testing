# Administrator handover

## Components
- Static frontend with no embedded student or staff-schedule data.
- Google Apps Script backend in `backend/`.
- Private Sheet containing Users, Records, ClassLists, Schedules, Evaluations, Incidents, Messages, and supporting tabs.

## Setup
1. Import the two private CSV migration files into matching Sheet tabs.
2. Run `oneClickSetup()` and configure required Script Properties.
3. Seed a new admin password, remove it from source, and run `healthCheck()`.
4. Deploy a new version and update `js/config.js`.
5. Test sign-in, 2FA, role changes, account removal, class lists, schedules, records, and evaluation exports.

Never publish the Sheet or private CSVs. Public share links are disabled in this build.
