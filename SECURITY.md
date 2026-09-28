# Security and privacy requirements

This system processes confidential records about minors. Keep the Sheet and private migration CSVs restricted to authorized school personnel.

- Use new random values for all passwords, registration codes, unlock codes, `SESSION_SECRET`, and `PEPPER`.
- Never reuse credentials from earlier builds or Git history.
- Remove departed staff immediately and review privileged roles regularly.
- Keep public sharing disabled unless separately approved and reviewed.
- Define retention, deletion, incident-response, and notification procedures.
- Arrange an independent privacy review and penetration test before production use.

If private data was publicly hosted, restrict the site and repository, preserve logs, rotate credentials, rewrite Git history, assess the exposure window, and follow school/legal notification requirements.
