# Installation

## Docker (recommended)

```bash
docker pull <your-registry>/srep:1.0.0
docker run -d --name srep -p 3000:3000 -v srep-data:/data <your-registry>/srep:1.0.0
```

Set `SREP_DATABASE_URL` for Postgres instead of the default SQLite volume.

## Bare metal

1. Node.js 22.17+.
2. `npm ci && npm run build`
3. `npm run db:migrate`
4. `node build/index.js`

## TLS

Terminate TLS with Caddy, nginx, or Traefik in front of port 3000. Set `SREP_AUTH_ORIGIN` to the public HTTPS origin.

## Upgrade

Back up first (`srep backup --out backup.zip`), pull the new image or `git pull`, run migrations, restart.
