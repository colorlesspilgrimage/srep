# Threat model (v1.0)

srep is a single-user, self-hosted flashcard server. The main assets are study data, passkeys, session cookies, and paired-app Bearer tokens.

## Trust boundaries

- **Browser client** (first-party UI) talks HTTPS to **srep server** with cookie sessions.
- **Paired native app** (iOS) talks HTTPS with a long-lived Bearer token minted via a short-lived pairing code.
- **Operator** controls the host, database file, and backups.

## Primary risks

| Risk                 | Mitigation                                                                      |
| -------------------- | ------------------------------------------------------------------------------- |
| XSS via card HTML    | Allowlisted sanitizer, CSP without `unsafe-inline` for scripts                  |
| Session hijack       | HttpOnly cookies, `SameSite=Strict`, CSRF on mutating API                       |
| Passkey theft        | WebAuthn with origin binding                                                    |
| Stolen API token     | Token hashed at rest (`sha256`); revoke from Settings → Pair app; max 20 active |
| Pairing code guess   | 40-bit Crockford codes, 5-minute TTL, single-use, rate limits                   |
| SQL injection        | Parameterized queries (Drizzle)                                                 |
| Unauthorized API use | Auth hook on all non-public `/api/*` routes                                     |

## Out of scope for 1.0

Multi-tenant isolation, offline sync, and third-party plugins. Cross-origin browser companions (CORS) are intentionally unsupported; native clients use Bearer auth.
