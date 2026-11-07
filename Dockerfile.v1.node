FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 compiles a native module. The slim image has no toolchain.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# npm ci runs prepare before the rest of the source is copied.
# The script exits 0 when vite.config.ts is absent.
COPY scripts/prepare.mjs scripts/prepare.mjs
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SREP_DATABASE_URL=sqlite:/data/srep.db
# Media files live in the /data volume, for SQLite and for Postgres.
ENV SREP_MEDIA_DIR=/data/media
# One media file can be 10 MiB. JSON routes keep their own 64 KiB limit.
ENV BODY_SIZE_LIMIT=11M
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/build-cli ./build-cli
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
RUN printf '#!/bin/sh\nexec node /app/build-cli/srep.js "$@"\n' > /usr/local/bin/srep && chmod 755 /usr/local/bin/srep
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["sh", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build"]
