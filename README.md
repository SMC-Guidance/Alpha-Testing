# SMC Guidance Center — Secure Deployment Build

This build keeps student rosters and schedules out of the public website. Authentication and private data access are handled by Google Apps Script.

## Deployment
1. Keep the repository private while configuring it.
2. Create a school-owned private Google Sheet.
3. Import `SMC-PRIVATE-ClassLists-import.csv` into **ClassLists** and `SMC-PRIVATE-Schedules-import.csv` into **Schedules**.
4. Add `backend/Code.gs` and `backend/EvalExport.gs` to Apps Script.
5. Run `oneClickSetup()`, set `SHEET_ID`, a new `REG_CODE`, `UNLOCK_CODE`, and `MAINT_CODE`, then run `resetAdmin()` with a new password and erase the temporary password from source.
6. Deploy a new web-app version and put its `/exec` URL in `js/config.js`.
7. Test with a non-production copy before publishing.

Never place private CSVs, exports, screenshots containing student data, or `.git` history in the public web folder.

Security defaults include tab-scoped sessions, live account/role revalidation, per-account login throttling, expiring trusted devices, protected 2FA email enrollment, fail-closed secret validation, and public sharing disabled by default.
