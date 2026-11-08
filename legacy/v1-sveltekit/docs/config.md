# Configuration

Environment variables (prefix `SREP_` unless noted):

| Variable                | Purpose                             |
| ----------------------- | ----------------------------------- |
| `SREP_DATABASE_URL`     | SQLite path or Postgres URL         |
| `SREP_AUTH_ORIGIN`      | Public origin for WebAuthn and CSRF |
| `SREP_DATA_DIR`         | Data directory (SQLite, media)      |
| `SREP_MEDIA_MAX_BYTES`  | Upload size cap                     |
| `SREP_IMPORT_MAX_BYTES` | Import upload cap                   |

See `src/lib/server/config.ts` for the full list and defaults.
