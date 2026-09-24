# Administrator handover

## Components

- **Frontend:** static website; must contain no student or staff schedule data.
- **Backend:** `backend/Code.gs` and `backend/EvalExport.gs` in Google Apps Script.
- **Private Sheet:** Users, Records, ClassLists, Schedules, Evaluations, Incidents, Messages, and supporting tabs.

## First deployment

1. Import the two private CSV migration files into `ClassLists` and `Schedules` tabs in the private Sheet.
2. Run `oneClickSetup()` in Apps Script.
3. Set `SHEET_ID`, `REG_CODE`, `UNLOCK_CODE`, and `MAINT_CODE` in Script Properties.
4. Run `resetAdmin()` with a new password, then erase the temporary password from the source and save.
5. Run `healthCheck()`.
6. Deploy a **new version** of the web app and update `js/config.js`.
7. Test sign-in, 2FA, role changes, account removal, class lists, schedules, records, and evaluation exports.

## Routine operations

- Add staff using a newly rotated registration code.
- Remove departed users immediately.
- Review admin/co-admin roles regularly.
- Rotate registration and unlock codes during every administrator handover.
- Never publish the private Sheet or the migration CSV files.
- Never commit `.git`, exports, screenshots containing student data, or private data files to the frontend host.

## Public sharing

Public share links are disabled in this build. Keep them disabled unless the school has approved the data flow and a security review has been completed.

## Emergency response

If compromise or accidental publication is suspected, take the site private, disable the Apps Script deployment, preserve logs, rotate credentials, and follow the school’s incident-response and notification process.
