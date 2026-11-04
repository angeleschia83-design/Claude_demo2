# syntax=docker/dockerfile:1

# better-sqlite3 is a native module. Its prebuilt binary covers the common
# platforms; the toolchain here is the fallback for the ones it does not, and
# is left behind in the builder stage either way.
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev


FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATABASE_PATH=/data/register.db \
    PORT=3000
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public

# /data holds register.db, the only copy of every correction. compose mounts a
# named volume over it so the corrections outlive the container.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
