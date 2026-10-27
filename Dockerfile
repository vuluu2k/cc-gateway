FROM node:22-slim AS builder
WORKDIR /app
# Build tools needed by better-sqlite3 if no prebuilt binary matches the runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
RUN mkdir -p /app/data

EXPOSE 8443
# Config path defaults to /app/data/config.yaml (persistent volume); if missing,
# a default one is generated on first start. No credentials are needed: accounts,
# clients and tokens live in /app/data/ccg.db and are managed from /admin (the
# first admin uses the setup code printed in the log). CCG_REFRESH_TOKEN or a
# mounted credentials.json only seeds a first account on a fresh database.
# Override the path with CCG_CONFIG_PATH env or by passing an arg to node.
CMD ["node", "dist/index.js"]
