# SMC Guidance Center — Secure Deployment Build

This build keeps student rosters and schedules out of the public website. The frontend is static, while authentication and private data access are handled by Google Apps Script.

## Required deployment steps

1. Keep the GitHub/static-host repository **private while configuring it**.
2. Create a private Google Sheet owned by the school account.
3. Import `SMC-PRIVATE-ClassLists-import.csv` into a tab named **ClassLists**.
4. Import `SMC-PRIVATE-Schedules-import.csv` into a tab named **Schedules**.
5. Add the other required tabs described in `ADMIN-HANDOVER.md`.
6. Paste `backend/Code.gs` and `backend/EvalExport.gs` into the Apps Script project.
7. Run `oneClickSetup()` once, set `SHEET_ID` and a new `REG_CODE`, then run `resetAdmin()` with a new password and immediately clear the temporary password from code.
8. Deploy a new Apps Script Web App version as the school account, with access set to **Anyone**. Application-level authentication protects the data.
9. Put the new `/exec` URL in `js/config.js`.
10. Test using a non-production copy of the Sheet before publishing the frontend.

## Important privacy rule

Never place student names, student numbers, counseling information, class lists, schedules, exports, or private CSV files in the public web folder or Git history. The two `SMC-PRIVATE-*.csv` files are migration files and must remain in restricted school storage.

## Security defaults

- Session tokens are stored in `sessionStorage`, not persistent browser storage.
- Accounts and current roles are revalidated on every authenticated request.
- Login throttling is per account and expires after 15 minutes.
- Trusted devices expire after 30 days.
- Existing 2FA email addresses cannot be replaced using only a password.
- Missing signing secrets cause the backend to fail closed.
- Public share links are disabled unless `PUBLIC_SHARING_ENABLED=true` is deliberately configured after a separate privacy review.

See `SECURITY.md` and `ADMIN-HANDOVER.md` before deployment.
