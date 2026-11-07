# Threat model (v1.0)

srep is a single-user, self-hosted flashcard server. The main assets are study data, passkeys, and session cookies.

## Trust boundaries

- **Browser client** (first-party UI only in 1.0) talks HTTPS to **srep server**.
- **Operator** controls the host, database file, and backups.

## Primary risks

| Risk | Mitigation |
|------|------------|
| XSS via card HTML | Allowlisted sanitizer, CSP without `unsafe-inline` for scripts |
| Session hijack | HttpOnly cookies, `SameSite=Strict`, CSRF on mutating API |
| Passkey theft | WebAuthn with origin binding |
| SQL injection | Parameterized queries (Drizzle) |
| Unauthorized API use | Auth hook on all non-public `/api/*` routes |

## Out of scope for 1.0

Multi-tenant isolation, offline sync, and third-party plugins.
