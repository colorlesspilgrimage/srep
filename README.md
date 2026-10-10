# srep

[![ci](https://github.com/colorlesspilgrimage/srep/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/colorlesspilgrimage/srep/actions/workflows/ci.yml)

srep is an open-source, self-hosted spaced-repetition web app (an Anki alternative) with a TUI-style interface, passwordless single-user auth, and a database backend.

## Status

The app is pre-1.0.
Milestone M0 is done.
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
The page is blank.
The title is `srep`.

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

| Variable                | Default                 | Rule                                                                 |
| ----------------------- | ----------------------- | -------------------------------------------------------------------- |
| `SREP_DATABASE_URL`     | `sqlite:./data/srep.db` | Starts with `sqlite:`, `postgres://`, or `postgresql://`.            |
| `SREP_LOG_LEVEL`        | `info`                  | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `SREP_MIGRATIONS_DIR`   | unset                   | Optional path. Default is `<cwd>/drizzle/<dialect>`.                 |
| `SREP_MIGRATE_ON_START` | `true`                  | `true` or `false`.                                                   |

`PORT`, `HOST`, and `ORIGIN` keep their adapter names.
`PORT` default is 3000 in the production image.
`HOST` default is `0.0.0.0`.

SvelteKit 3 does not read `ORIGIN` at run time.
The server uses the request host when `paths.origin` is unset.
Compose still sets `ORIGIN` for later milestones.

WebAuthn (M1) needs HTTPS.
Localhost does not need HTTPS.

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
The default end-to-end database is `sqlite:./data/e2e.db`.

## Licence

This project uses the MIT licence.
See [LICENSE](LICENSE).

## More documents

- [ROADMAP.md](ROADMAP.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
