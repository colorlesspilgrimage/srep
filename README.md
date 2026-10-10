# srep

srep is an open-source, self-hosted spaced-repetition web app (an Anki alternative) with a TUI-style interface, passwordless single-user auth, and a database backend.

## Status

The app is pre-1.0.
Milestones M0 and M1 are done.
M1 adds passkey and security-key login.
The Chromium end-to-end tests cover the flows.
The Firefox and Safari checks are manual (see "Browser matrix").
See [ROADMAP.md](ROADMAP.md).

## Requirements

You need Node.js 22 or later and npm.
Docker and Docker Compose are optional.
Use them for the container path.

## Quick start with Docker

Run this command:

```bash
docker compose up --build
```

Open http://localhost:3000.
Check the health endpoint:

```bash
curl http://localhost:3000/healthz
```

The body is `{"status":"ok"}`.

You do not need `SREP_POSTGRES_PASSWORD` for the default service.

To use Postgres, set `SREP_POSTGRES_PASSWORD`.
Set `SREP_DATABASE_URL` to a `postgres://` URL.
The host name inside Compose is `postgres`.
Example: `postgres://srep:change-me@postgres:5432/srep`.
Run this command:

```bash
docker compose --profile postgres up --build
```

The Postgres service publishes `127.0.0.1:5432`.
Set `SREP_POSTGRES_PORT` to change the host port.

## Local development

Install dependencies:

```bash
npm ci
```

Start the dev server:

```bash
npm run dev
```

Open http://localhost:5173.
A fresh instance sends you to `/setup` (see "Authentication").

Build and start the production server:

```bash
npm run build
node build
```

The production server listens on port 3000.

## Configuration

The app reads these environment variables.
An empty value means unset.
Copy `.env.example` to `.env` for local use.
Do not commit `.env`.

| Variable                | Default                 | Rule                                                                                       |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `SREP_DATABASE_URL`     | `sqlite:./data/srep.db` | Starts with `sqlite:`, `postgres://`, or `postgresql://`.                                  |
| `SREP_LOG_LEVEL`        | `info`                  | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`.                       |
| `SREP_MIGRATIONS_DIR`   | unset                   | Optional path. Default is `<cwd>/drizzle/<dialect>`.                                       |
| `SREP_MIGRATE_ON_START` | `true`                  | `true` or `false`.                                                                         |
| `SREP_ORIGIN`           | `http://localhost:3000` | The public origin. HTTPS, or HTTP on `localhost`. No path. No IP address. No trailing dot. |
| `SREP_RP_ID`            | host of `SREP_ORIGIN`   | WebAuthn RP ID in lowercase. The host, or a parent domain of it.                           |
| `SREP_RP_NAME`          | `srep`                  | Name that the authenticator shows. 1 to 64 characters.                                     |

`PORT`, `HOST`, and `ORIGIN` keep their adapter names.
`PORT` default is 3000 in the production image.
`HOST` default is `0.0.0.0`.

SvelteKit 3 does not read `ORIGIN` at run time.
The server uses the request host when `paths.origin` is unset.
Compose still sets `ORIGIN` for later milestones.

WebAuthn needs HTTPS.
Localhost does not need HTTPS.
The server refuses to start when `SREP_ORIGIN` or `SREP_RP_ID` is invalid.
The error names the variable.
The server never reads the RP ID or the origin from request headers.

## Authentication

srep has exactly one account.
There are no passwords.
You sign in with a passkey or a security key.

### Set up

1. Start the server. The log shows one line: `srep setup is not complete. Open <origin>/setup and use this setup token: <token>`.
2. Open `<SREP_ORIGIN>/setup`.
3. Enter the setup token and a nickname. Choose "Passkey" or "Security key". Press "Create".
4. Save the 10 recovery codes. The page shows them once. The database keeps only hashes.
5. Open `/security` and add a second credential.

After setup, the setup page is locked for good. The token stops working.

### Log in and manage credentials

- Open `/login`. Use "Log in with a passkey" or "Log in with a security key".
- Open `/security` to rename or revoke credentials, add new ones, and log out.
- srep refuses to revoke the last credential.
- "Log out everywhere" ends all sessions.
- A revoke does not end other sessions. Use "Log out everywhere" for that.

### Recovery

- A recovery code works once. Use "Use a recovery code" on `/login`.
- With host access, run `npm run srep -- reset-auth`. With Docker, run `docker compose exec srep srep reset-auth`.
- The command asks you to type `reset`. Add `--yes` to skip the question.
- It removes all credentials, recovery codes and sessions. It prints a new setup token. Setup opens again.
- In a production build, use `node build-cli/srep.js reset-auth`.

### Sessions and limits

- The session cookie is `HttpOnly` and `SameSite=Strict`. On HTTPS it is `Secure` and has the `__Host-` prefix.
- A session ends after 7 days without use, or 30 days after login.
- Every mutating request needs the right `Origin` header. Requests with a session also need the `x-srep-csrf` header.
- A mutating API call needs a `content-type` header. SvelteKit rejects a mutating call without one.
- Every `/api` route needs a session, except the public auth routes.
  The guard checks the decoded path, as SvelteKit does. A path that cannot be decoded gets 400.
- SvelteKit remote functions (`/_app/remote/*`) get the same guard as `/api`. They need a session and the CSRF header.
- Rate limits: 20 auth requests per address per 5 minutes. 5 bad setup tokens per 15 minutes. 5 bad recovery codes per 15 minutes.
- A setup or recovery request takes one failure slot before the check runs. A good token or code gives the slot back.
  Parallel requests therefore cannot pass the limit.
- A login must raise the sign counter of the credential (both 0 is also accepted). Of two logins with the same counter, only one passes.
- The limits live in memory. A restart clears them.

### Reverse proxy

Behind a reverse proxy, every client looks like the proxy address.
Then the per-address limit becomes one limit for all clients.
Set `ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH` (adapter-node variables) to fix this.
Set `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host` so that SvelteKit sees the public origin.
Set `SREP_ORIGIN` to the public HTTPS origin.

### Browser matrix

Chromium is tested by automation with a virtual authenticator.
Firefox and Safari have no virtual authenticator in automation, so they are checked by hand.
Repeat the steps "passkey login", "security key login" and "recovery code login" in each browser.
Safari needs HTTPS or `localhost`.
It does not keep `Secure` cookies over plain http, so use an HTTPS reverse proxy for Safari.

| Browser  | Automated | Manual result |
| -------- | --------- | ------------- |
| Chromium | yes       | not needed    |
| Firefox  | not run   | not run       |
| Safari   | not run   | not run       |

## Database

SQLite is the default.
The file path comes from `SREP_DATABASE_URL`.
The app sets WAL mode for a file database.
The app does not set WAL mode for `:memory:`.

Postgres is optional.
Both dialects use the same logical schema.
Set `SREP_DATABASE_URL` to a Postgres URL.

The app applies migrations on start when `SREP_MIGRATE_ON_START` is `true`.
Run migrations by hand:

```bash
npm run db:migrate
```

Edit both schema files when you add a table.
Then run:

```bash
npm run db:generate
```

Commit the files under `drizzle/`.
Every schema change needs both dialects.

## Testing

Run lint:

```bash
npm run lint
```

Run the type check:

```bash
npm run check
```

Run unit tests:

```bash
npm run test
```

Postgres unit tests run when `SREP_TEST_POSTGRES_URL` is set.
They are skipped when it is unset.

Run end-to-end tests:

```bash
npx playwright install chromium
npm run test:e2e
```

Set `E2E_DATABASE_URL` to test Postgres.
The end-to-end run resets the auth state with `srep reset-auth --yes`.
A reused local server keeps its rate-limit counters. Five runs in 15 minutes can hit the setup-token limit.
Stop the server to clear the counters.
The default end-to-end database is `sqlite:./data/e2e.db`.

## Licence

This project uses the MIT licence.
See [LICENSE](LICENSE).

## More documents

- [ROADMAP.md](ROADMAP.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
