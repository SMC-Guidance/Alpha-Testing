# Security and privacy requirements

## Data classification

This system processes information about minors, including counseling records, class rosters, student identifiers, incident reports, and guidance concerns. Treat all such information as confidential school records.

## Required controls

- Host only frontend code and non-sensitive assets publicly.
- Keep the Google Sheet private and restrict editors to authorized school personnel.
- Use unique, randomly generated values for `SESSION_SECRET`, `PEPPER`, `REG_CODE`, `UNLOCK_CODE`, and `MAINT_CODE`.
- Do not reuse old passwords or registration codes from prior builds or Git history.
- Use the school-owned Google account for the Sheet, Apps Script project, and deployment.
- Review access and remove departed staff immediately. Existing tokens are revalidated against the live Users sheet.
- Keep session duration modest and require 2FA.
- Public sharing is disabled by default. Do not enable it without written approval and a dedicated security review.
- Maintain retention and deletion procedures for counseling, incident, chat, and evaluation records.

## Operational limitations

Google Apps Script and Sheets are not a dedicated identity, audit, chat, or clinical-record platform. Before production use, the school should complete a privacy-impact assessment, verify applicable legal obligations, establish incident-response procedures, and arrange an independent penetration test.

## Incident response

If private data was ever hosted publicly:

1. Remove the public files and restrict the repository/site.
2. Preserve access logs and record the exposure window.
3. Rotate all credentials and redeploy the backend.
4. Review legal and school-policy notification requirements.
5. Rewrite Git history where private data was committed; deleting only the latest file is insufficient.
